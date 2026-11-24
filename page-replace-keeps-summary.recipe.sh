#!/bin/zsh
# Re-shoot: a fake-engine fixture where the bot shows a page with fallback_text, then replaces it (app_id) with a new one.
# Run from a checkout of the state to shoot (origin/main for before, the fix branch for after).
set -eu
DIR=$(mktemp -d); CALLS=$DIR/calls.json
echo '[{"server":"agents","name":"show_html","input":{"title":"Q3 client hours","html":"<h1>Q3 client hours</h1><p>Northwind Freight 121.5 h</p>","fallback_text":"Q3 client hours: 217.5 total, Northwind Freight leads."}}]' > $CALLS
FAKE_CLAUDE_TOOL_CALLS_FILE=$CALLS node --experimental-strip-types scripts/control-dusk.ts launch > $DIR/launch.json &
sleep 15; U=$(python3 -c "import json;print(json.load(open('$DIR/launch.json'))['url'])")
CD() { node --experimental-strip-types scripts/control-dusk.ts "$@" --url $U; }
B=$(CD new-bot --name Ada | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('bot',d)['id'])")
T=$(CD run --bot $B --text "make me a dashboard" --wait turn --timeout 60 | python3 -c "import json,sys; print(json.load(sys.stdin)['taskId'])")
A=$(CD messages --bot $B --task $T | python3 -c "import json,sys; print([m['id'] for m in json.load(sys.stdin)['messages'] if m.get('kind')=='app'][0])")
echo "[{\"server\":\"agents\",\"name\":\"show_html\",\"input\":{\"app_id\":\"$A\",\"title\":\"Q3 client hours\",\"html\":\"<h1>Q3 and October client hours</h1><p>Northwind Freight 151.5 h</p>\",\"fallback_text\":\"Q3 and October client hours: 273.5 total, Northwind Freight leads.\"}}]" > $CALLS
CD run --bot $B --task $T --text "update the dashboard with October" --wait turn --timeout 60 > /dev/null
curl -s "$U/api/threads/$T/export"   # the page row: [App] scrape (before) or the bot's summary (after)
kill -INT %1
