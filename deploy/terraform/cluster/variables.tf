variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "kubernetes_version" {
  description = "The newest version in EKS standard support; `aws eks describe-cluster-versions` lists them."
  type        = string
  default     = "1.37"
}

variable "node_count" {
  description = "m7i.xlarge nodes; the vCPU quota of 16 leaves room for one more during an upgrade."
  type        = number
  default     = 2
}
