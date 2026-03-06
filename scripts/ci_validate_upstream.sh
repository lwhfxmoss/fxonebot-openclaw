#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM_REPO="${OPENCLAW_UPSTREAM_REPO:-https://github.com/openclaw/openclaw.git}"
UPSTREAM_REF="${OPENCLAW_UPSTREAM_REF:-main}"

if [[ -z "${RUNNER_TEMP:-}" ]]; then
  WORK_BASE="$ROOT/.tmp"
else
  WORK_BASE="$RUNNER_TEMP"
fi

WORK_DIR="$WORK_BASE/openclaw-upstream-strong-validate"
UPSTREAM_DIR="$WORK_DIR/openclaw"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "[ci] clone upstream: $UPSTREAM_REPO @ $UPSTREAM_REF"
git clone --depth 1 --branch "$UPSTREAM_REF" "$UPSTREAM_REPO" "$UPSTREAM_DIR"

echo "[ci] install upstream dependencies"
cd "$UPSTREAM_DIR"
corepack enable
pnpm install --frozen-lockfile

echo "[ci] patch upstream for onebot plugin-sdk routing"
node "$ROOT/scripts/patch_openclaw_for_onebot_ci.mjs" "$UPSTREAM_DIR"

echo "[ci] overlay onebot extension"
mkdir -p "$UPSTREAM_DIR/extensions/onebot"
cp "$ROOT/index.ts" "$UPSTREAM_DIR/extensions/onebot/index.ts"
cp "$ROOT/openclaw.plugin.json" "$UPSTREAM_DIR/extensions/onebot/openclaw.plugin.json"
cp "$ROOT/package.json" "$UPSTREAM_DIR/extensions/onebot/package.json"
cp -R "$ROOT/src/." "$UPSTREAM_DIR/extensions/onebot/src/"

echo "[ci] run focused onebot tests"
pnpm vitest run \
  extensions/onebot/src/ws-server.test.ts \
  extensions/onebot/src/inbound-internal.test.ts

echo "[ci] run upstream build"
pnpm build

echo "[ci] run upstream checks"
pnpm check

echo "[ci] strong validation completed"
