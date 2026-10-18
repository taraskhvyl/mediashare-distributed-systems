from confluent_kafka import Consumer, Producer

import kafka_loop
from adapters.db import TaggingStore
from adapters.events import EventPublisher
from adapters.llm import ImageDescriber
from adapters.s3 import Storage
from config import load
from log import get, setup
from pipeline.handler import Tagger
from tracing import export_llm_spans_to_langfuse

logger = get("main")

CONSUMER_GROUP = "tagger"  # its own group: the tagger and the processor each see every event
SESSION_TIMEOUT_MS = 30_000


def main() -> None:
    """Composition root: builds the parts, connects them, runs the loop. No logic."""
    setup()
    cfg = load()
    export_llm_spans_to_langfuse(cfg)

    events = EventPublisher(cfg, Producer({"bootstrap.servers": cfg.kafka_brokers}))
    tagger = Tagger(cfg, TaggingStore(cfg), Storage(cfg), ImageDescriber(cfg), events)

    consumer = Consumer({
        "bootstrap.servers": cfg.kafka_brokers,
        "group.id": CONSUMER_GROUP,
        "enable.auto.commit": False,  # we commit after handling: at-least-once
        "auto.offset.reset": "earliest",
        "session.timeout.ms": SESSION_TIMEOUT_MS,
    })
    consumer.subscribe(
        [cfg.topic_main, cfg.topic_retry],
        on_assign=kafka_loop.log_assignment,
        on_revoke=kafka_loop.log_revocation,
    )
    logger.info(
        "tagger started",
        extra={"ctx": {
            "groupId": CONSUMER_GROUP,
            "topics": [cfg.topic_main, cfg.topic_retry],
            "dlq": cfg.topic_dlq,
            "model": cfg.openai_model,
        }},
    )

    try:
        kafka_loop.run(consumer, tagger)
    except KeyboardInterrupt:
        logger.info("tagger shutting down")
    finally:
        consumer.close()


if __name__ == "__main__":
    main()
