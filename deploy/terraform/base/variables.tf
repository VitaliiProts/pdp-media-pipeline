variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "domain" {
  type    = string
  default = "pdp-media-pipeline.online"
}

variable "database_enabled" {
  description = "Create RDS; it bills by the hour, so this waits for the first cluster session."
  type        = bool
  default     = false
}

variable "github_repositories" {
  description = "Repositories whose `aws` environment may deploy."
  type        = list(string)
  default     = ["VitaliiProts/pdp-media-pipeline"]
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
