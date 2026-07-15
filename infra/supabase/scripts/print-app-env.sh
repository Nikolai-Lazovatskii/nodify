#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${1:-supabase-project}"
ENV_FILE="$DEPLOY_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo ".env not found in: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

base_url="${SUPABASE_PUBLIC_URL:-}"
if [ -z "$base_url" ] && [ -n "${API_EXTERNAL_URL:-}" ]; then
  base_url="${API_EXTERNAL_URL%/auth/v1}"
fi

anon_key="${SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-${ANON_KEY:-}}}"

if [ -z "$base_url" ]; then
  echo "SUPABASE_PUBLIC_URL or API_EXTERNAL_URL is missing in: $ENV_FILE" >&2
  exit 1
fi

if [ -z "$anon_key" ]; then
  echo "SUPABASE_PUBLISHABLE_KEY, SUPABASE_ANON_KEY, or ANON_KEY is missing in: $ENV_FILE" >&2
  exit 1
fi

cat <<EOF
EXPO_PUBLIC_SUPABASE_URL=$base_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=$anon_key
EOF
