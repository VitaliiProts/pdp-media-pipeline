# The whole domain lives in Route 53; the registrar (GoDaddy) only points at these name
# servers. external-dns and cert-manager write the host records from the cluster.

resource "aws_route53_zone" "main" {
  name    = var.domain
  comment = "PDP Media Pipeline"
}

# Only these two may issue certificates: Let's Encrypt for cert-manager, Amazon for the ACM
# fallback on the NLB.
resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"letsencrypt.org\"",
    "0 issue \"amazon.com\"",
  ]
}
