import boto3
from moto import mock_aws

from audio_separate.storage import S3Storage


def test_without_keys_goes_to_aws_with_credentials_boto3_finds_itself():
    # mock_aws puts fake credentials into the environment, where the default chain looks first.
    with mock_aws():
        boto3.client("s3", region_name="eu-central-1").create_bucket(
            Bucket="media", CreateBucketConfiguration={"LocationConstraint": "eu-central-1"}
        )
        storage = S3Storage(
            endpoint=None, region="eu-central-1", bucket="media", force_path_style=False
        )

        storage.write_json("results/j1/dub/analysis.json", {"speakers": 2})

        assert storage.read_json("results/j1/dub/analysis.json") == {"speakers": 2}
        assert storage.client.meta.endpoint_url == "https://s3.eu-central-1.amazonaws.com"
