# Roles for pods through EKS Pod Identity. The ServiceAccount names are those of the Helm releases
# that `aws.sh up` installs; an association may exist before its ServiceAccount does.

locals {
  # ListBucket turns a missing key into 404 rather than 403; boto3 uploads large files in parts.
  media_statements = [
    {
      actions   = ["s3:ListBucket"]
      resources = [local.bucket_arn]
    },
    {
      actions   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"]
      resources = ["${local.bucket_arn}/*"]
    },
  ]

  media_service_accounts = ["api-gateway", "video-frames", "video-transcode", "video-dub", "audio-separate"]
  # The workers also purge deleted assets.
  purge_service_accounts = ["worker-priority", "worker-cpu", "worker-io"]
}

module "media_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.10.0"

  name                 = "pdp-media"
  attach_custom_policy = true
  policy_statements    = local.media_statements

  association_defaults = { cluster_name = module.eks.cluster_name, namespace = "pdp" }
  associations         = { for sa in local.media_service_accounts : sa => { service_account = sa } }
}

module "media_purge_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.10.0"

  name                 = "pdp-media-purge"
  attach_custom_policy = true
  policy_statements = concat(local.media_statements, [{
    actions   = ["s3:DeleteObject"]
    resources = ["${local.bucket_arn}/*"]
  }])

  association_defaults = { cluster_name = module.eks.cluster_name, namespace = "pdp" }
  associations         = { for sa in local.purge_service_accounts : sa => { service_account = sa } }
}

module "lb_controller_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.10.0"

  name                            = "pdp-lb-controller"
  attach_aws_lb_controller_policy = true

  associations = {
    controller = {
      cluster_name    = module.eks.cluster_name
      namespace       = "kube-system"
      service_account = "aws-load-balancer-controller"
    }
  }
}

module "external_dns_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.10.0"

  name                          = "pdp-external-dns"
  attach_external_dns_policy    = true
  external_dns_hosted_zone_arns = [local.zone_arn]

  associations = {
    controller = {
      cluster_name    = module.eks.cluster_name
      namespace       = "external-dns"
      service_account = "external-dns"
    }
  }
}

module "cert_manager_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.10.0"

  name                          = "pdp-cert-manager"
  attach_cert_manager_policy    = true
  cert_manager_hosted_zone_arns = [local.zone_arn]

  associations = {
    controller = {
      cluster_name    = module.eks.cluster_name
      namespace       = "cert-manager"
      service_account = "cert-manager"
    }
  }
}

# Associated through the addon itself, in eks.tf.
module "ebs_csi_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.10.0"

  name                      = "pdp-ebs-csi"
  attach_aws_ebs_csi_policy = true
}
