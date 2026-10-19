output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "vpc_id" {
  description = "The LB Controller needs it explicitly: pods cannot reach the instance metadata."
  value       = local.base["vpc-id"]
}
