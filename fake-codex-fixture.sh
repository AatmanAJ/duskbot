#!/bin/zsh
# Isolated dusk bot with the repository's fake Codex signed in to a synthetic ChatGPT account that refuses gpt-6-luna.
# Usage: REPO=<checkout> ROOT=<new temp dir> PORT=<harness port> zsh fake-codex-fixture.sh
set -eu
: ${REPO:?} ${ROOT:?} ${PORT:?}
UI_PORT=$((PORT + 50))
mkdir -p "$ROOT/home/.codex" "$ROOT/data" "$ROOT/tmp" "$ROOT/bin"
ln -sf "$(command -v node)" "$ROOT/bin/node"
echo '{"auth_mode":"chatgpt","tokens":{"refresh_token":"synthetic-fixture"}}' > "$ROOT/home/.codex/auth.json"
FAKE="$REPO/server/testing/fake-codex-app-server.ts"
cat > "$ROOT/data/config.json" <<JSON
{ "features": { "smartSetupChoices": false },
  "instances": {
    "cursor": {"driver":"not-a-real-driver"}, "githubCopilot": {"driver":"not-a-real-driver"}, "qwen": {"driver":"not-a-real-driver"},
    "hermes": {"driver":"not-a-real-driver"}, "pi": {"driver":"not-a-real-driver"}, "claude": {"driver":"not-a-real-driver"},
    "codex": { "driver": "codex", "displayName": "Codex", "config": { "cli": "$FAKE" },
      "environment": { "FAKE_CODEX_LUNA": "1", "FAKE_CODEX_REFUSE_MODELS": "${REFUSE:-gpt-6-luna}", "FAKE_CODEX_REPLY": "Hello from the fake Codex." } } } }
JSON
export HOME="$ROOT/home" USERPROFILE="$ROOT/home" CODEX_HOME="$ROOT/home/.codex"
export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache" XDG_DATA_HOME="$HOME/.local/share"
export TMPDIR="$ROOT/tmp" PATH="$ROOT/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DUSK_DATA_DIR="$ROOT/data" DUSK_PORT=$PORT DUSK_WEBHOOK_PORT=$((PORT + 1)) DUSK_UI_PORT=$UI_PORT
export DUSK_ANALYTICS=0 DUSK_ZEN_LIVE_MODELS=0 DUSK_DEV_SERVER_WATCH=0 DUSK_NO_TEST_BOTS=1 DUSK_BUG_REPORT_URL=http://127.0.0.1:9/api/bug-reports
cd "$REPO"
node --experimental-strip-types server/dev-server.ts > "$ROOT/server.log" 2>&1 &
SERVER=$!
node node_modules/vite/bin/vite.js --port $UI_PORT --strictPort > "$ROOT/ui.log" 2>&1 &
UI=$!
trap 'kill $SERVER $UI 2>/dev/null; wait 2>/dev/null' INT TERM EXIT
for i in {1..90}; do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
echo "{\"ui\":\"http://127.0.0.1:$UI_PORT\",\"harness\":\"http://127.0.0.1:$PORT\",\"root\":\"$ROOT\"}"
wait
