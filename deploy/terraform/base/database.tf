# RDS bills by the hour even when idle, so it is created only once the cluster is about to
# run (database_enabled). Afterwards it stays and is stopped between sessions; turning the
# flag back off is refused by deletion_protection instead of dropping the data.

resource "aws_db_subnet_group" "main" {
  name       = "pdp"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "database" {
  name        = "pdp-database"
  description = "PostgreSQL from the EKS nodes only"
  vpc_id      = module.vpc.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_nodes" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.nodes.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_parameter_group" "main" {
  name   = "pdp-postgres17"
  family = "postgres17"

  # A static parameter: AWS stores it as pending-reboot whatever is asked for.
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  count = var.database_enabled ? 1 : 0

  identifier     = "pdp"
  engine         = "postgres"
  engine_version = "17"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "metadata"
  username = "pdp"
  password = random_password.database.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 1
  auto_minor_version_upgrade = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "pdp-final"
}

# The cluster layer turns this into the `postgres-app` Secret (key `uri`), the name
# CloudNativePG gives it locally.
resource "aws_ssm_parameter" "database_uri" {
  count = var.database_enabled ? 1 : 0

  name  = "/pdp/prod/postgres-uri"
  type  = "SecureString"
  value = "postgresql://pdp:${random_password.database.result}@${aws_db_instance.main[0].endpoint}/metadata?sslmode=verify-full&sslrootcert=/etc/rds/ca.pem"
}
