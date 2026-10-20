variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "domain" {
  type    = string
  default = "pdp-media-pipeline.online"
}

variable "database_enabled" {
  description = "RDS; between cluster sessions `aws.sh down` stops it rather than destroying it."
  type        = bool
  default     = true
}

variable "github_repositories" {
  description = <<-EOT
    Repositories whose `aws` environment may deploy, as their OIDC subject prefix: immutable
    subjects carry the owner and repository IDs (gh api repos/<owner>/<repo>/actions/oidc/customization/sub).
  EOT
  type        = list(string)
  default     = ["repo:VitaliiProts@25710612/pdp-media-pipeline@1409444046"]
}

variable "budget_usd" {
  description = "Monthly cost budget of the whole account, alerts only: AWS has no hard cap."
  type        = number
  default     = 15
}

variable "budget_email" {
  description = "Where the budget alerts go; kept out of the repository in terraform.tfvars."
  type        = string
}
