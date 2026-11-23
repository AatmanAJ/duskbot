#!/bin/zsh
# Isolated dusk bot with a REAL engine (Codex on AJ's ChatGPT subscription), for dogfooding chat.
# Usage: REPO=<checkout> NAME=<slug> PORT=<harness port, even, e.g. 19100> zsh real-engine-fixture.sh
# Prints the UI URL. Ctrl-C stops both processes. Data lives in $ROOT and is kept for inspection.
# Guarantees: HOME, DUSK_DATA_DIR and every XDG/TMP dir are temporary, so ~/.duskbot, ~/Downloads,
# ~/.grokbot and ~/Library/Application Support/Grok Bot are never seen. Only CODEX_HOME points at the
# real ~/.codex, so the codex CLI is signed in (it adds session logs there; it never touches dusk data).
set -eu
: ${REPO:?set REPO to a checkout} ${NAME:?set NAME} ${PORT:?set PORT}
UI_PORT=$((PORT + 50))
ROOT=${ROOT:-/private/tmp/claude-501/dusk-real/$NAME}
mkdir -p "$ROOT/home/Downloads" "$ROOT/data" "$ROOT/tmp" "$ROOT/bin"
for tool in node git; do ln -sf "$(command -v $tool)" "$ROOT/bin/$tool"; done
export HOME="$ROOT/home" USERPROFILE="$ROOT/home"
export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache" XDG_DATA_HOME="$HOME/.local/share"
export TMPDIR="$ROOT/tmp" TEMP="$ROOT/tmp" TMP="$ROOT/tmp"
export PATH="$ROOT/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DUSK_ALLOW_REAL_ENGINES=1
export DUSK_DATA_DIR="$ROOT/data" DUSK_PORT=$PORT DUSK_WEBHOOK_PORT=$((PORT + 1)) DUSK_UI_PORT=$UI_PORT
export DUSK_ANALYTICS=0 DUSK_ZEN_LIVE_MODELS=0 DUSK_DEV_SERVER_WATCH=0
export DUSK_NO_TEST_BOTS=${DUSK_NO_TEST_BOTS:-1}
export DUSK_BUG_REPORT_URL=http://127.0.0.1:9/api/bug-reports
cd "$REPO"
node --experimental-strip-types server/dev-server.ts > "$ROOT/server.log" 2>&1 &
SERVER=$!
node node_modules/vite/bin/vite.js --port $UI_PORT --strictPort > "$ROOT/ui.log" 2>&1 &
UI=$!
trap 'kill $SERVER $UI 2>/dev/null; wait 2>/dev/null' INT TERM EXIT
for i in {1..90}; do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
echo "{\"ui\":\"http://127.0.0.1:$UI_PORT\",\"harness\":\"http://127.0.0.1:$PORT\",\"root\":\"$ROOT\",\"serverLog\":\"$ROOT/server.log\"}"
wait
