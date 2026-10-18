import os
from dataclasses import dataclass


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


@dataclass(frozen=True)
class Config:
    database_url: str
    kafka_brokers: str
    s3_endpoint: str
    s3_access_key: str
    s3_secret_key: str
    s3_thumbnails_bucket: str
    topic_main: str
    topic_retry: str
    topic_dlq: str
    openai_api_key: str
    openai_model: str
    # Langfuse is optional: without keys the tagger still works, it just isn't observed there.
    langfuse_host: str
    langfuse_public_key: str
    langfuse_secret_key: str
    max_attempts: int = 3
    # The SDK's own retries (429, 5xx, timeouts) with exponential backoff, inside one attempt.
    # Past that the event goes to the retry topic, which has no delay (roadmap Phase 4).
    openai_max_retries: int = 3
    openai_timeout_seconds: float = 60.0


def load() -> Config:
    return Config(
        database_url=_required("DATABASE_URL"),
        kafka_brokers=_required("KAFKA_BROKERS"),
        s3_endpoint=_required("S3_ENDPOINT"),
        s3_access_key=_required("S3_ACCESS_KEY"),
        s3_secret_key=_required("S3_SECRET_KEY"),
        s3_thumbnails_bucket=os.environ.get("S3_THUMBNAILS_BUCKET", "media-thumbnails"),
        topic_main=os.environ.get("TOPIC_MAIN", "file-events"),
        topic_retry=os.environ.get("TOPIC_RETRY", "file-tagging-retry"),
        topic_dlq=os.environ.get("TOPIC_DLQ", "file-tagging-dlq"),
        openai_api_key=_required("OPENAI_API_KEY"),
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-5.4-nano"),
        langfuse_host=os.environ.get("LANGFUSE_HOST", ""),
        langfuse_public_key=os.environ.get("LANGFUSE_PUBLIC_KEY", ""),
        langfuse_secret_key=os.environ.get("LANGFUSE_SECRET_KEY", ""),
    )
