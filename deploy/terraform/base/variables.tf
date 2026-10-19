variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "domain" {
  type    = string
  default = "pdp-media-pipeline.online"
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
