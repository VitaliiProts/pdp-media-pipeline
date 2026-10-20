# What the base layer published in SSM; the cluster layer never reads its state.

data "aws_ssm_parameter" "base" {
  for_each = toset(["vpc-id", "public-subnets", "nodes-sg", "media-bucket", "zone-id", "deploy-role-arn"])

  name = "/pdp/prod/${each.key}"
}

# Identity Center roles carry a path, but an access entry wants the ARN without it.
data "aws_iam_roles" "sso_admin" {
  name_regex  = "^AWSReservedSSO_AdministratorAccess_"
  path_prefix = "/aws-reserved/sso.amazonaws.com/"
}

locals {
  base = { for k, p in data.aws_ssm_parameter.base : k => p.insecure_value }

  account_id     = data.aws_caller_identity.current.account_id
  public_subnets = split(",", local.base["public-subnets"])
  bucket_arn     = "arn:aws:s3:::${local.base["media-bucket"]}"
  zone_arn       = "arn:aws:route53:::hostedzone/${local.base["zone-id"]}"
  sso_admin_arn  = "arn:aws:iam::${local.account_id}:role/${one(data.aws_iam_roles.sso_admin.names)}"
}
