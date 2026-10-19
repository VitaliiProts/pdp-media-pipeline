output "name_servers" {
  description = "Set these as custom name servers of the domain at the registrar."
  value       = aws_route53_zone.main.name_servers
}

output "zone_id" {
  value = aws_route53_zone.main.zone_id
}
