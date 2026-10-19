# Read by scripts/aws.sh and CI, so nothing from here is copied into the repository.

resource "aws_ssm_parameter" "domain" {
  name  = "/pdp/prod/domain"
  type  = "String"
  value = var.domain
}

resource "aws_ssm_parameter" "zone_id" {
  name  = "/pdp/prod/zone-id"
  type  = "String"
  value = aws_route53_zone.main.zone_id
}
