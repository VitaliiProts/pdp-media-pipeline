#!/usr/bin/env bash
# Browser tests (e2e/) against the compose stack as the separate `pdp-e2e` project, so a local
# `docker compose up` keeps running. Uses the pdp/*:dev images; `up --build` builds them first.
#
#   scripts/e2e.sh                 # up, test, down
#   scripts/e2e.sh up [--build]    # then: scripts/e2e.sh test [playwright args], scripts/e2e.sh down
#   scripts/e2e.sh logs            # compose logs of the stack, e.g. after a failure in CI
set -euo pipefail

cd "$(dirname "$0")/.."

# What the three flows reach: images go to the worker, a translation to video-dub.
SERVICES=(web api-gateway metadata scheduler worker video-dub)

compose() {
  docker compose -p pdp-e2e --env-file e2e/.env -f docker-compose.yml -f e2e/compose.yaml "$@"
}

up() {
  local build=(--no-build)
  [[ "${1:-}" == --build ]] && build=(--build)
  compose up -d "${build[@]}" --wait --wait-timeout 300 "${SERVICES[@]}"
}

run_tests() {
  # shellcheck disable=SC1091
  set -a && source e2e/.env && set +a
  E2E_BASE_URL="http://localhost:${WEB_HOST_PORT}" pnpm exec playwright test -c e2e "$@"
}

down() { compose down -v --remove-orphans; }

case "${1:-all}" in
  up) shift && up "$@" ;;
  test) shift && run_tests "$@" ;;
  down) down ;;
  logs) compose logs --no-color --timestamps ;;
  all)
    trap down EXIT
    up
    run_tests
    ;;
  *)
    echo "usage: $0 [all | up [--build] | test [args] | down | logs]" >&2
    exit 2
    ;;
esac
