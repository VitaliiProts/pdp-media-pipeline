# Created by hand in Stage 0; imported, not recreated, so its history and alerts stay.
import {
  to = aws_budgets_budget.monthly
  id = "${data.aws_caller_identity.current.account_id}:pdp-monthly"
}

resource "aws_budgets_budget" "monthly" {
  name         = "pdp-monthly"
  budget_type  = "COST"
  limit_amount = format("%.1f", var.budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
