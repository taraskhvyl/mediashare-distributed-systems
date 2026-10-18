import json
from datetime import UTC, datetime

from confluent_kafka import Producer

from config import Config

FLUSH_TIMEOUT_SECONDS = 10


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


class EventPublisher:
    """Adapter around the Kafka producer. The tagger only writes to its own retry and DLQ
    topics; it announces nothing (ADR 0007: no dual write).

    Messages are produced inside the caller's span, so a retry continues the same trace.
    Sends are synchronous: the offset is committed only after they succeed.
    """

    def __init__(self, cfg: Config, producer: Producer):
        self._cfg = cfg
        self._producer = producer

    def send_to_retry(self, key: str, envelope: dict) -> None:
        self._send(self._cfg.topic_retry, key, envelope)

    def send_to_dlq(self, key: str, message: dict) -> None:
        self._send(self._cfg.topic_dlq, key, message)

    def _send(self, topic: str, key: str, message: dict) -> None:
        # The key is the file id, so all events of one file stay in one partition.
        self._producer.produce(topic, key=key, value=json.dumps(message))
        self._producer.flush(FLUSH_TIMEOUT_SECONDS)
