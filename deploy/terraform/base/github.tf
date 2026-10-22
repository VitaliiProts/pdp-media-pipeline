# CI assumes this role through OIDC, without stored keys. A job that runs in a GitHub
# environment gets the subject `<repository prefix>:environment:<name>`, not the branch, so
# the trust is on the environment, and the environment admits only `main`. The prefix is
# immutable (`repo:<owner>@<id>/<repo>@<id>`): a renamed or re-created repository of the
# same name does not inherit the role.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for prefix in var.github_repositories : "${prefix}:environment:aws"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "pdp-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for repo in aws_ecr_repository.service : repo.arn]
  }

  # Whether the cluster runs, and its endpoint for kubectl; Kubernetes rights come from the
  # access entry the cluster layer creates, limited to the `pdp` namespace.
  statement {
    sid       = "EksDescribe"
    actions   = ["eks:DescribeCluster"]
    resources = ["arn:aws:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/pdp"]
  }

  # By name only: GetParametersByPath is authorised on the path, so the Deny below would not
  # keep the secrets out of it.
  statement {
    sid     = "ReadParameters"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/pdp/prod/*",
    ]
  }

  statement {
    sid     = "WriteDeployedTags"
    actions = ["ssm:PutParameter"]
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/pdp/prod/deployed-tag/*",
    ]
  }

  # Releases are written, never deleted: a rollback needs the old ones.
  statement {
    sid       = "ListReleases"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.releases.arn]
  }

  statement {
    sid       = "ReadWriteReleases"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.releases.arn}/*"]
  }

  # The secrets live under the same path; the deploy role never needs them.
  statement {
    sid     = "NoSecrets"
    effect  = "Deny"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [
      aws_ssm_parameter.openai_api_key.arn,
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/pdp/prod/postgres-uri",
      # Written by `aws.sh down`, outside Terraform.
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/pdp/prod/tls-key",
    ]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
