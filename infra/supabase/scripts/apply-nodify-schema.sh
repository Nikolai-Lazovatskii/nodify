#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

DEPLOY_DIR="${1:-$REPO_ROOT/supabase-project}"
MIGRATION="${2:-$REPO_ROOT/supabase/migrations/001_initial_schema.sql}"
DB_SERVICE="${SUPABASE_DB_SERVICE:-db}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"

if [ ! -f "$MIGRATION" ]; then
  echo "Migration file not found: $MIGRATION" >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/docker-compose.yml" ]; then
  echo "docker-compose.yml not found in: $DEPLOY_DIR" >&2
  echo "Run bootstrap-official-stack.sh first, or pass the existing Supabase Docker directory." >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo ".env not found in: $DEPLOY_DIR" >&2
  echo "Copy .env.example to .env and configure production secrets before applying the schema." >&2
  exit 1
fi

docker compose \
  --env-file "$DEPLOY_DIR/.env" \
  --project-directory "$DEPLOY_DIR" \
  -f "$DEPLOY_DIR/docker-compose.yml" \
  exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" \
  < "$MIGRATION"

echo "Nodify schema applied from: $MIGRATION"
