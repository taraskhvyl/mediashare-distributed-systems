from psycopg import connect
from psycopg.errors import ForeignKeyViolation

from config import Config


class TaggingStore:
    """Repository for what the tagger touches in Postgres.

    Its role may INSERT into `file_ai_metadata` and read four columns of `files` (the gate
    below), nothing else.
    """

    def __init__(self, cfg: Config):
        self._conn = connect(cfg.database_url, autocommit=True)

    def published_thumbnail_key(self, file_id: str) -> str | None:
        """The thumbnail to tag, or None if the file may not be sent to a model.

        Only a Published file (public AND ready, CONTEXT.md) passes. Read fresh on every
        event, never taken from the event: visibility can change between the event and now
        (ADR 0008). The same rule as IS_PUBLISHED_SQL in apps/api/src/files/repository.ts;
        copied because the two services may change independently, keep them in step.
        """
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT thumbnail_key FROM files "
                "WHERE id = %s AND visibility = 'public' AND status = 'ready'",
                (file_id,),
            )
            row = cur.fetchone()
        return row[0] if row else None

    def insert_once(self, file_id: str, caption: str, tags: list[str], model: str) -> bool:
        """True if this call wrote the row, False if one existed or the file is gone.

        The primary key decides, not an earlier read, so two replicas handling the same
        event can't both write (ADR 0007: the first caption wins).

        `ON CONFLICT DO NOTHING` without a target on purpose: naming (file_id) makes Postgres
        need SELECT on that column to infer the index, and this role is insert-only.
        """
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO file_ai_metadata (file_id, caption, tags, model) "
                    "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    (file_id, caption, tags, model),
                )
                return cur.rowcount == 1
        except ForeignKeyViolation:
            # The owner deleted the file while we were waiting on the model. Nothing to tag.
            return False
