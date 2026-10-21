# Images of the e2e stack for CI, from the layers the `docker` job caches under the same scopes.
# Locally `scripts/e2e.sh up --build` builds them through compose instead.
group "default" {
  targets = ["app"]
}

target "app" {
  name       = app
  matrix     = { app = ["api-gateway", "metadata", "scheduler", "worker", "video-worker", "web"] }
  context    = "."
  dockerfile = "apps/${app}/Dockerfile"
  tags       = ["pdp/${app}:dev"]
  cache-from = ["type=gha,scope=${app}"]
  output     = ["type=docker"]
}
