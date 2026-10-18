import json

from confluent_kafka import Consumer, KafkaError, KafkaException, Message, TopicPartition
from opentelemetry import propagate, trace
from opentelemetry.context import Context
from opentelemetry.trace import SpanKind

from log import get
from pipeline.handler import EventProcessingError, Tagger

# Same poll -> handle -> commit loop as apps/processor/src/kafka_loop.py, without the claim
# reaper. Copied on purpose: the two services may change their loops independently.
logger = get("kafka_loop")
tracer = trace.get_tracer("tagger")

POLL_TIMEOUT_SECONDS = 1.0
TRANSIENT_ERRORS = (KafkaError._TRANSPORT, KafkaError._ALL_BROKERS_DOWN, KafkaError.UNKNOWN_TOPIC_OR_PART)


def run(consumer: Consumer, tagger: Tagger) -> None:
    """Poll → handle → commit, one message at a time, forever.

    At-least-once: the offset is committed only after the message was handled (or sent to
    retry/DLQ). A model call can take many seconds, but that only delays this consumer
    group; uploads never wait on it. max.poll.interval.ms (5 min) bounds one message.
    """
    while True:
        msg = consumer.poll(POLL_TIMEOUT_SECONDS)
        if msg is None:
            continue
        if msg.error():
            _raise_unless_transient(msg)
            continue
        _handle_message(msg, tagger)
        consumer.commit(message=msg, asynchronous=False)


def log_assignment(_consumer: Consumer, partitions: list[TopicPartition]) -> None:
    logger.info("partitions assigned", extra={"ctx": {"partitions": _names(partitions)}})


def log_revocation(_consumer: Consumer, partitions: list[TopicPartition]) -> None:
    logger.info("partitions revoked", extra={"ctx": {"partitions": _names(partitions)}})


def _names(partitions: list[TopicPartition]) -> list[str]:
    return [f"{p.topic}/{p.partition}" for p in partitions]


def _raise_unless_transient(msg: Message) -> None:
    code = msg.error().code()
    if code == KafkaError._PARTITION_EOF:
        return
    if code in TRANSIENT_ERRORS:
        logger.warning("kafka transient issue, poll will retry", extra={"ctx": {"code": str(msg.error())}})
        return
    raise KafkaException(msg.error())


def _handle_message(msg: Message, tagger: Tagger) -> None:
    """Handles one message. Never raises: whatever happens, the caller commits the offset."""
    if msg.value() is None:
        return
    try:
        envelope = json.loads(msg.value())
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.error(
            "poison message dropped", extra={"ctx": {"topic": msg.topic(), "partition": msg.partition()}}
        )
        return

    # Continues the trace of whoever produced the message (the processor's `file.ready`),
    # so upload -> processing -> tagging is one trace.
    with tracer.start_as_current_span(
        f"handle {envelope.get('eventType')}",
        context=_producer_trace_context(msg),
        kind=SpanKind.CONSUMER,
    ):
        try:
            result = tagger.handle(envelope)
            logger.info(
                "event handled",
                extra={
                    "ctx": {
                        "eventId": envelope.get("eventId"),
                        "eventType": envelope.get("eventType"),
                        "topic": msg.topic(),
                        "partition": msg.partition(),
                        "offset": msg.offset(),
                        "result": result,
                    }
                },
            )
        except EventProcessingError as exc:
            tagger.handle_failure(envelope, exc)
        except Exception:
            logger.exception("unexpected handler error")


def _producer_trace_context(msg: Message) -> Context:
    headers = {key: value.decode() for key, value in (msg.headers() or []) if value is not None}
    return propagate.extract(headers)
