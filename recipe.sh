#!/bin/zsh
# Re-shoot: REPO=<checkout of main (before) or fix/library-empty-scope (after)> zsh recipe.sh OUT.png
set -eu
cd "$REPO"
HERE=${0:A:h}
LOG=$(mktemp)
node --experimental-strip-types scripts/control-dusk.ts ui launch > "$LOG" 2>&1 &
LAUNCHER=$!
until grep -q '"ui":' "$LOG"; do sleep 1; done
H=$(sed -n 's/.*"ui": "\(.*\)".*/\1/p' "$LOG")
HOMEDIR=$(sed -n 's/.*"dataDir": "\(.*\)".*/\1/p' "$LOG")
SESSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['session'])" "$H")
BIN=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['binary'])" "$H")
U() { node --experimental-strip-types scripts/control-dusk.ts ui "$@" --ui "$H"; }
U type --name "Message Pepper" --text "make me a dashboard of q3 hours"
U press --keys Enter
U wait-settle --timeout 60
U eval --js "$(cat "$HERE/new-conversation.js")"
sleep 2
U snapshot --interactive > /dev/null
U click --name "Open Pepper's profile, New conversation"
sleep 1.5
U eval --js "[...document.querySelectorAll('[role=tab]')].find(t=>t.innerText.trim()==='Advanced')?.click(); 1"
HOME=$HOMEDIR AGENT_BROWSER_SESSION=$SESSION "$BIN" set viewport 1280 800 2
sleep 1
U screenshot --out "${1:A}.full.png"
sips -c 1000 1590 --cropOffset 0 970 "${1:A}.full.png" --out "${1:A}"
kill -INT $LAUNCHER
