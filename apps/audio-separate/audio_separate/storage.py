"""S3 through boto3, the same bucket and credentials as the workers (S3_* env)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


class Storage(Protocol):
    def exists(self, key: str) -> bool: ...
    def download(self, key: str, path: Path) -> None: ...
    def upload(self, key: str, path: Path, content_type: str) -> None: ...
    def read_json(self, key: str) -> Any: ...
    def write_json(self, key: str, value: Any) -> None: ...


class MissingObject(Exception):
    """An input key that is not in the bucket: the request cannot succeed as it is."""


class S3Storage:
    def __init__(
        self,
        *,
        endpoint: str | None,
        region: str,
        bucket: str,
        force_path_style: bool,
        access_key: str | None = None,
        secret_key: str | None = None,
    ) -> None:
        # Without keys boto3 finds credentials itself; in EKS — the pod's role (Pod Identity).
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(
                s3={"addressing_style": "path" if force_path_style else "auto"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def download(self, key: str, path: Path) -> None:
        try:
            self.client.download_file(self.bucket, key, str(path))
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                raise MissingObject(key) from err
            raise

    def upload(self, key: str, path: Path, content_type: str) -> None:
        self.client.upload_file(
            str(path), self.bucket, key, ExtraArgs={"ContentType": content_type}
        )

    def read_json(self, key: str) -> Any:
        body = self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        return json.loads(body)

    def write_json(self, key: str, value: Any) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=json.dumps(value).encode(),
            ContentType="application/json",
        )
