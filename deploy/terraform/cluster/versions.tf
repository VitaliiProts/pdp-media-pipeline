# The on-demand layer: everything that bills by the hour. `aws.sh up` creates it and `aws.sh down`
# destroys it; what must survive between sessions lives in `base`.

terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
  }

  backend "s3" {
    bucket       = "pdp-tfstate-186712718120"
    key          = "cluster/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "pdp-media-pipeline"
      ManagedBy = "terraform"
      Layer     = "cluster"
    }
  }
}

data "aws_caller_identity" "current" {}
