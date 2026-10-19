# One entry per deployable image. A new service, or one moved to its own repository, is a line
# here: its ECR repository, its deployed-tag parameter and its push rights follow.

locals {
  services = {
    api-gateway  = { keep_images = 10 }
    metadata     = { keep_images = 10 }
    scheduler    = { keep_images = 10 }
    worker       = { keep_images = 10 }
    video-worker = { keep_images = 10 }
    video-dub    = { keep_images = 10 }
    web          = { keep_images = 10 }
    # Tagged by the content of apps/audio-separate and rebuilt only when it changes; every
    # build is ~2.3 GB of fresh layers.
    audio-separate = { keep_images = 3 }
  }
}

resource "aws_ecr_repository" "service" {
  for_each = local.services

  name                 = "pdp/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = local.services
  repository = aws_ecr_repository.service[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Untagged layers left by failed pushes"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the newest images only"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = each.value.keep_images
        }
        action = { type = "expire" }
      },
    ]
  })
}
