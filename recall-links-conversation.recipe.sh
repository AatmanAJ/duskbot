#!/bin/zsh
# Re-shoot (deterministic part): a fake-engine fixture where the bot's second conversation calls session_search.
# Its tool output lists the earlier conversation with "link [#title](duskbot://thread/ID)" after the fix, none before.
# The screenshots came from a real-engine (Codex) fixture asking "link me to the conversation where you built the dashboard".
set -eu
DIR=$(mktemp -d); CALLS=$DIR/calls.json; echo '[]' > $CALLS
FAKE_CLAUDE_TOOL_CALLS_FILE=$CALLS node --experimental-strip-types scripts/control-dusk.ts launch > $DIR/launch.json &
sleep 15; U=$(python3 -c "import json;print(json.load(open('$DIR/launch.json'))['url'])")
CD() { node --experimental-strip-types scripts/control-dusk.ts "$@" --url $U; }
B=$(CD new-bot --name Ada | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('bot',d)['id'])")
CD run --bot $B --text "make me a dashboard of q3 hours" --wait turn --timeout 60 > /dev/null
echo '[{"server":"agents","name":"session_search","input":{"query":"dashboard"}}]' > $CALLS
T=$(CD run --bot $B --text "where is the dashboard?" --wait turn --timeout 60 | python3 -c "import json,sys; print(json.load(sys.stdin)['taskId'])")
curl -s "$U/api/threads/$T/export?format=json" | python3 -c "import json,sys; [print(m['tool']['output']) for m in json.load(sys.stdin)['messages'] if (m.get('tool') or {}).get('name')=='session_search']"
kill -INT %1
