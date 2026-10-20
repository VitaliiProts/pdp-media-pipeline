# Accepted findings: the API is public because there is no NAT or VPN and CI reaches it from
# GitHub's runners; nodes reach ECR, OpenAI and Let's Encrypt; EKS encrypts API data under an
# AWS-owned key without a KMS key of ours.
#trivy:ignore:AVD-AWS-0039
#trivy:ignore:AVD-AWS-0040
#trivy:ignore:AVD-AWS-0041
#trivy:ignore:AVD-AWS-0104
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.29.0"

  name               = "pdp"
  kubernetes_version = var.kubernetes_version

  vpc_id     = local.base["vpc-id"]
  subnet_ids = local.public_subnets

  # No NAT, so the API is public; every request still needs an IAM identity with an access entry.
  endpoint_public_access  = true
  endpoint_private_access = true

  authentication_mode                      = "API"
  enable_cluster_creator_admin_permissions = false
  enable_irsa                              = false

  # The cluster lives for hours: secrets stay under the default AWS-owned key, without a KMS key
  # that would outlive it by its deletion window, and control-plane logs are not shipped.
  create_kms_key              = false
  encryption_config           = null
  enabled_log_types           = []
  create_cloudwatch_log_group = false

  addons = {
    vpc-cni = {
      before_compute       = true
      configuration_values = jsonencode({ enableNetworkPolicy = "true" })
    }
    kube-proxy = {
      before_compute = true
    }
    eks-pod-identity-agent = {
      before_compute = true
    }
    coredns = {}
    aws-ebs-csi-driver = {
      # `aws.sh down` and `status` find volumes left behind by these tags.
      configuration_values = jsonencode({
        controller = { extraVolumeTags = { Project = "pdp-media-pipeline", Layer = "cluster" } }
      })
      pod_identity_association = [{
        role_arn        = module.ebs_csi_identity.iam_role_arn
        service_account = "ebs-csi-controller-sa"
      }]
    }
  }

  eks_managed_node_groups = {
    pdp = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = ["m7i.xlarge"]
      min_size       = var.node_count
      max_size       = var.node_count + 1
      desired_size   = var.node_count

      # RDS admits only `pdp-nodes`, a group that outlives the cluster.
      vpc_security_group_ids = [local.base["nodes-sg"]]

      # The video-dub and audio-separate images unpack to 1.9 and 5.9 GB.
      block_device_mappings = {
        root = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size           = 80
            volume_type           = "gp3"
            encrypted             = true
            delete_on_termination = true
          }
        }
      }
    }
  }

  access_entries = {
    admin = {
      principal_arn = local.sso_admin_arn
      policy_associations = {
        cluster = {
          policy_arn   = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
    # The access policy covers built-in kinds only; the group gets the chart's CRDs
    # (deploy/helm/cluster-aws/templates/rbac.yaml).
    deploy = {
      principal_arn     = local.base["deploy-role-arn"]
      kubernetes_groups = ["pdp-deploy"]
      policy_associations = {
        pdp = {
          policy_arn   = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSAdminPolicy"
          access_scope = { type = "namespace", namespaces = ["pdp"] }
        }
      }
    }
  }
}
