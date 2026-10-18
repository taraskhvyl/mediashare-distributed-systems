import boto3
from botocore.config import Config as BotoConfig

from config import Config


class Storage:
    """Adapter around S3. The tagger may only read thumbnails (its identity in compose/data.yml)."""

    def __init__(self, cfg: Config):
        self._thumbnails_bucket = cfg.s3_thumbnails_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=cfg.s3_endpoint,
            aws_access_key_id=cfg.s3_access_key,
            aws_secret_access_key=cfg.s3_secret_key,
            region_name="us-east-1",
            config=BotoConfig(
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    def get_thumbnail(self, key: str) -> bytes:
        obj = self._client.get_object(Bucket=self._thumbnails_bucket, Key=key)
        return obj["Body"].read()
