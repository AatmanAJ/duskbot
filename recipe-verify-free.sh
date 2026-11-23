#!/bin/zsh
# usage: verify-free.sh <repo> <state> <scenario none|downloading> <port>
S=$SCRATCH
REPO=$1 STATE=$2 SC=$3 PORT=$4; UI=$((PORT+50)); NAME=fnu-v-$STATE-$SC-$RANDOM
AB=$REPO_ROOT/.dusk-scratch/verify-tools/tools/agent-browser/0.37.0/agent-browser
Q=$REPO_ROOT/.dusk-scratch/qa-free; mkdir -p $Q
[ $SC = downloading ] && export DUSK_PREINSTALL_FREE_BACKUP=1
REPO=$REPO NAME=$NAME PORT=$PORT zsh $S/no-engine-fixture.sh > $S/$NAME.out 2>&1 &
FX=$!
for i in {1..120}; do curl -sf http://127.0.0.1:$PORT/api/health >/dev/null && curl -sf http://127.0.0.1:$UI/ >/dev/null && break; sleep 0.25; done
export AGENT_BROWSER_SESSION=v-$STATE-$SC
$AB set viewport 1280 800 2 >/dev/null
$AB open http://127.0.0.1:$UI/ >/dev/null 2>&1
$AB wait --text "Get started" >/dev/null 2>&1
$AB find role button click --name "Get started" >/dev/null 2>&1
$AB wait --text "Pick the AI" >/dev/null 2>&1; sleep 0.7
$AB screenshot $Q/$SC-ai-$STATE.png >/dev/null
echo "[$STATE/$SC] ai step: $($AB eval "[...document.querySelectorAll('[data-funnel-free],[data-funnel-plan]')].map(b=>b.dataset.funnelFree!==undefined?'free:'+(b.disabled?'disabled:':'')+b.innerText.replace(/\n/g,' | '):'plan').join(' || ')" 2>/dev/null)"
if [ $SC = downloading ]; then
  for i in {1..120}; do d=$($AB eval "document.querySelector('[data-funnel-free]')?.disabled===false" 2>/dev/null); [ "$d" = "true" ] && break; sleep 0.5; done
  echo "[$STATE/$SC] free tile pickable after ${i}x0.5s: $($AB eval "document.querySelector('[data-funnel-free]')?.innerText.replace(/\n/g,' | ')" 2>/dev/null)"
  $AB screenshot $Q/$SC-ready-$STATE.png >/dev/null
fi
$AB eval "document.querySelector('[data-funnel-free]')?.click(); !!document.querySelector('[data-funnel-free]')" >/dev/null 2>&1
sleep 3
echo "[$STATE/$SC] chat: $($AB eval "document.querySelector('[role=log]')?.innerText.replace(/\n/g,' | ').slice(0,300)" 2>/dev/null)"
$AB screenshot $Q/$SC-chat-$STATE.png >/dev/null
$AB close >/dev/null 2>&1
kill $FX; sleep 1; for p in $PORT $UI; do pid=$(lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null); [ -n "$pid" ] && kill $pid; done
