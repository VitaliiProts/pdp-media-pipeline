# Nodes sit in public subnets with a security group instead of private ones behind a NAT
# Gateway (~$35 a month); only RDS is private. S3 traffic stays on the gateway endpoint.

locals {
  azs = ["${var.region}a", "${var.region}b"]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.7.3"

  name = "pdp"
  cidr = "10.40.0.0/16"
  azs  = local.azs

  public_subnets  = ["10.40.0.0/20", "10.40.16.0/20"]
  private_subnets = ["10.40.128.0/24", "10.40.129.0/24"]

  enable_nat_gateway      = false
  map_public_ip_on_launch = true
  enable_dns_hostnames    = true

  # Where the AWS Load Balancer Controller places the internet-facing NLB.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(module.vpc.public_route_table_ids, module.vpc.private_route_table_ids)
}

# Attached to the node group by the cluster layer. RDS refers to this group rather than to the
# cluster's own, which disappears with every `aws.sh down`.
resource "aws_security_group" "nodes" {
  name        = "pdp-nodes"
  description = "EKS nodes of PDP; RDS admits only this group"
  vpc_id      = module.vpc.vpc_id
}
