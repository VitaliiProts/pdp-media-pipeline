# Read by scripts/aws.sh and CI, so nothing from here is copied into the repository.

locals {
  parameters = {
    domain          = var.domain
    zone-id         = aws_route53_zone.main.zone_id
    media-bucket    = aws_s3_bucket.media.bucket
    releases-bucket = aws_s3_bucket.releases.bucket
    ecr-registry    = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
    vpc-id          = module.vpc.vpc_id
    public-subnets  = join(",", module.vpc.public_subnets)
    nodes-sg        = aws_security_group.nodes.id
    deploy-role-arn = aws_iam_role.deploy.arn
  }
}

resource "aws_ssm_parameter" "base" {
  for_each = local.parameters

  name  = "/pdp/prod/${each.key}"
  type  = "String"
  value = each.value
}

moved {
  from = aws_ssm_parameter.domain
  to   = aws_ssm_parameter.base["domain"]
}

moved {
  from = aws_ssm_parameter.zone_id
  to   = aws_ssm_parameter.base["zone-id"]
}

# The tags of the current release (releases.tf), written by `aws.sh release` and `rollback` once
# it runs. `aws.sh up` deploys them while no release is recorded yet.
resource "aws_ssm_parameter" "deployed_tag" {
  for_each = local.services

  name  = "/pdp/prod/deployed-tag/${each.key}"
  type  = "String"
  value = "none"

  lifecycle {
    ignore_changes = [value]
  }
}

# The value never passes through Terraform or its state: put it with
#   aws ssm put-parameter --name /pdp/prod/openai-api-key --type SecureString --overwrite \
#     --value "$(read -rs k; echo "$k")"
resource "aws_ssm_parameter" "openai_api_key" {
  name  = "/pdp/prod/openai-api-key"
  type  = "SecureString"
  value = "unset"

  lifecycle {
    ignore_changes = [value]
  }
}
