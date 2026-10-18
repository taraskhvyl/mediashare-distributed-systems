import uuid

from adapters.db import TaggingStore
from adapters.events import EventPublisher, now_iso
from adapters.llm import ImageDescriber
from adapters.s3 import Storage
from config import Config
from log import get

logger = get("tagger")

THUMBNAIL_CONTENT_TYPE = "image/webp"  # what the processor always writes

# A file is tagged once it is Published (public AND ready). Those two facts arrive as two
# events in either order, so both trigger the same check; whichever comes second proceeds.
TRIGGER_EVENTS = ("file.ready", "file.made_public")


class EventProcessingError(Exception):
    """Tagging failed in a way a retry may fix (model rate-limited, storage down, ...)."""


class Tagger:
    """What happens to one event. Knows nothing about polling or offsets (kafka_loop.py)."""

    def __init__(
        self,
        cfg: Config,
        store: TaggingStore,
        storage: Storage,
        describer: ImageDescriber,
        events: EventPublisher,
    ):
        self._cfg = cfg
        self._store = store
        self._storage = storage
        self._describer = describer
        self._events = events

    def handle(self, envelope: dict) -> dict:
        if envelope.get("eventType") not in TRIGGER_EVENTS:
            return {"outcome": "ignored", "eventType": envelope.get("eventType")}

        file_id = envelope["payload"]["fileId"]
        try:
            # The privacy gate (ADR 0008): a private file's pixels never leave the system.
            # Not published yet is not an error: the other trigger event is still to come.
            thumbnail_key = self._store.published_thumbnail_key(file_id)
            if thumbnail_key is None:
                return {"outcome": "skipped", "fileId": file_id, "reason": "not published, or no thumbnail"}

            image = self._storage.get_thumbnail(thumbnail_key)
            description = self._describer.describe(image, THUMBNAIL_CONTENT_TYPE)
            # No claim, no lease: a duplicate delivery calls the model again and the insert
            # loses (ADR 0007). Tagging is cheap enough to repeat, and nothing else is at stake.
            written = self._store.insert_once(
                file_id, description.caption, description.tags, self._describer.model
            )
        except Exception as exc:
            raise EventProcessingError(str(exc)) from exc

        logger.info(
            "file tagged" if written else "caption kept, nothing written",
            extra={"ctx": {"fileId": file_id, "tags": description.tags}},
        )
        return {"outcome": "tagged" if written else "not_written", "fileId": file_id}

    def handle_failure(self, envelope: dict, exc: Exception) -> None:
        """Retry topic until max_attempts, then DLQ. The file itself is left alone: it stays
        `ready`, just untagged. Same shape as the processor's handle_failure, minus the
        status change and the failure event; the two may drift apart."""
        attempt = int(envelope.get("attempt", 0)) + 1
        payload = envelope.get("payload", {})
        file_id = payload.get("fileId", "unknown")

        if attempt < self._cfg.max_attempts:
            logger.warning(
                "tagging scheduled for retry",
                extra={"ctx": {"fileId": file_id, "attempt": attempt, "error": str(exc)}},
            )
            self._events.send_to_retry(file_id, {**envelope, "attempt": attempt})
            return

        logger.error(
            "tagging moved to DLQ after max attempts, file stays untagged",
            extra={"ctx": {"fileId": file_id, "attempt": attempt, "error": str(exc)}},
        )
        self._events.send_to_dlq(
            file_id,
            {
                "eventId": str(uuid.uuid4()),
                "eventType": envelope.get("eventType"),
                "aggregateId": file_id,
                "payload": payload,
                "attempt": attempt,
                "error": str(exc),
                "failedAt": now_iso(),
            },
        )
