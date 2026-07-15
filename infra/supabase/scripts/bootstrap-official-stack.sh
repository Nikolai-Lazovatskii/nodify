#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${1:-supabase-project}"
SUPABASE_REPO="${SUPABASE_REPO:-https://github.com/supabase/supabase.git}"
SUPABASE_REF="${SUPABASE_REF:-}"

if [ -f "$DEPLOY_DIR/docker-compose.yml" ]; then
  echo "Supabase Docker stack already exists in: $DEPLOY_DIR"
  exit 0
fi

mkdir -p "$DEPLOY_DIR"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

clone_args=(--depth 1 --filter=blob:none --sparse)
if [ -n "$SUPABASE_REF" ]; then
  clone_args+=(--branch "$SUPABASE_REF")
fi

git clone "${clone_args[@]}" "$SUPABASE_REPO" "$TMP_DIR/supabase"
git -C "$TMP_DIR/supabase" sparse-checkout set docker

cp -R "$TMP_DIR/supabase/docker/." "$DEPLOY_DIR/"

if [ ! -f "$DEPLOY_DIR/.env" ] && [ -f "$DEPLOY_DIR/.env.example" ]; then
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
fi

echo "Supabase Docker stack copied to: $DEPLOY_DIR"
echo "Next steps:"
echo "  1. Edit $DEPLOY_DIR/.env"
echo "  2. cd $DEPLOY_DIR"
echo "  3. sh run.sh start"
echo "  4. Run infra/supabase/scripts/apply-nodify-schema.sh $DEPLOY_DIR from the Nodify repository"
