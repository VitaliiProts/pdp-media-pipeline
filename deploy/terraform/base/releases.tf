# Every release CI or a rollback deploys (docs/plan/stage-7.1.md): its manifest and the packaged
# chart. Helm keeps its own history in the cluster, which `aws.sh down` removes; this outlives it.
#
#   releases/<id>/manifest.json   tags of every image, commit, chart digest, previous release
#   releases/<id>/pdp.tgz         `helm package` of the umbrella chart with its subcharts
#   current.json                  the release that runs, or that the next `up` deploys

resource "aws_s3_bucket" "releases" {
  bucket = "pdp-releases-${data.aws_caller_identity.current.account_id}"
}

# current.json is overwritten by every release: its old versions say what ran before.
resource "aws_s3_bucket_versioning" "releases" {
  bucket = aws_s3_bucket.releases.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    id     = "noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  depends_on = [aws_s3_bucket_versioning.releases]
}

#trivy:ignore:AWS-0132 a customer managed KMS key costs $1 a month plus requests
resource "aws_s3_bucket_server_side_encryption_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "releases" {
  bucket                  = aws_s3_bucket.releases.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "releases" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.releases.arn,
      "${aws_s3_bucket.releases.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "releases" {
  bucket = aws_s3_bucket.releases.id
  policy = data.aws_iam_policy_document.releases.json

  depends_on = [aws_s3_bucket_public_access_block.releases]
}
