#!/bin/zsh
# Re-shoot: start fake-codex-fixture.sh (REPO, ROOT, PORT=19904), then: zsh recipe.sh <label>
# Writer on gpt-6-luna (refused by the fixture's ChatGPT account) gets two messages; a second bot's model list is opened.
set -eu
S=${0:A:h}; L=$1; U=http://127.0.0.1:19904; UI=http://127.0.0.1:19954; REPO=${REPO:?checkout}
CD() { (cd $REPO && node --experimental-strip-types scripts/control-dusk.ts "$@"); }
curl -s -X PATCH $U/api/config -H "origin: $U" -H 'content-type: application/json' -d "{\"language\":\"en\",\"onboarding\":{\"completedAt\":\"2026-11-23T00:00:00Z\",\"version\":999,\"hintsSeen\":[\"met-chief-v1\"]}}" >/dev/null
W=$(CD new-bot --name "Writer" --url $U | python3 -c "import json,sys;print(json.load(sys.stdin)['bot']['id'])")
R=$(CD new-bot --name "Researcher" --url $U | python3 -c "import json,sys;print(json.load(sys.stdin)['bot']['id'])")
curl -s -X PATCH $U/api/bots/$W -H "origin: $U" -H 'content-type: application/json' -d '{"color":"coral"}' >/dev/null
curl -s -X PATCH $U/api/bots/$R -H "origin: $U" -H 'content-type: application/json' -d '{"color":"teal"}' >/dev/null
CD set-model --bot $W --instance codex --model gpt-6-luna --effort low --url $U >/dev/null
CD set-model --bot $R --instance codex --model gpt-fake-default --effort low --url $U >/dev/null
CD run --bot $W --text "Draft a two-line intro for Hollow Oak Studio" --wait turn --timeout 1m --url $U > $S/shots/$L-turn1.json || true
CD run --bot $W --text "Try again please" --wait turn --timeout 1m --url $U > $S/shots/$L-turn2.json || true
CD models --url $U > $S/shots/$L-models.json
node $S/shoot.mjs $UI $S/shots/$L-chat.png "document.querySelector('[data-sidebar-bot-row=\"$W\"]').click(); await pause(4500)" true
node $S/shoot.mjs $UI $S/shots/$L-picker.png "document.querySelector('[data-sidebar-bot-row=\"$R\"]').click(); await pause(1500); document.querySelector('[aria-label=\"Open Researcher\\'s profile\"]').click(); await pause(1200); [...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.includes('GPT Fake Default')).click(); await pause(1000)" true "document.body.innerText.slice(-500)"
