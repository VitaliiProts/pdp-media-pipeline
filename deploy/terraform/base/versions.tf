# The permanent layer: what lives between cluster sessions and costs little when idle.

terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }

  backend "s3" {
    bucket       = "pdp-tfstate-186712718120"
    key          = "base/terraform.tfstate"
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
      Layer     = "base"
    }
  }
}

data "aws_caller_identity" "current" {}
