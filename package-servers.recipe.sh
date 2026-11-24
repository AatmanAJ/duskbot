#!/bin/zsh
# Move the invented Grok Bot profile's four bots (Settings → Bring in from other apps → Grok Bot), turn Stripe and GitHub
# on, then open Ada's Tools → MCP servers. Ada's export named only Linear.
#   REPO=<branch checkout> BASE=<checkout of the base commit> PLANT=<profile/plant.sh> OUT=./out zsh package-servers.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE} ${PLANT:?set PLANT to the invented profile plant.sh}
export PLANT AB_BIN=$(print -l $TOOLS/tools/agent-browser/*/agent-browser | head -1)
export AB_CHROME=$(print -l $TOOLS/.agent-browser/browsers/chrome-*/**/MacOS/Google\ Chrome\ for\ Testing(N) | head -1)
capture() { # NAME ROOT FILE
  mkdir -p $2/.dusk-scratch/qa && cp $LIB/desk-fixture.ts $2/.dusk-scratch/qa/desk-fixture.ts
  ( cd $2 && TMPDIR=/tmp exec node --experimental-strip-types .dusk-scratch/qa/desk-fixture.ts ) > "$RUN/$1.out" 2> "$RUN/$1.err" &
  echo $! > "$RUN/$1.pid"
  for i in {1..240}; do grep -q '"ok": true' "$RUN/$1.out" 2>/dev/null && break; sleep 0.5; done
  local url=$(fx_get $1 url) dir=$(fx_get $1 dataDir); local owner=$(<$dir/owner)
  ab $1 set viewport 1280 800 2 >/dev/null
  load $1
  click $1 'button "Get started"'; sleep 1.5
  click $1 "button \"Use the Claude you're already signed into"; sleep 3
  click $1 'button "Close panel"' || true
  click $1 'button "App settings"'; sleep 1
  click $1 'button "Start import"'; sleep 2
  click $1 'button "Import from Grok Bot"'
  for i in {1..60}; do ab $1 snapshot | grep -q 'Imported' && break; sleep 0.5; done
  for s in stripe github; do curl -fsS -X PATCH "$url/api/mcp/servers/$s" -H 'content-type: application/json' -H "origin: $url" -H "x-dusk-desktop-owner: $owner" -d '{"enabled":true}' >/dev/null; done
  curl -fsS "$url/api/bots" -H "x-dusk-desktop-owner: $owner" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const b of JSON.parse(s).bots)console.log("'$1'", b.name, JSON.stringify(b.mcpServers??null))})'
  ab $1 press Escape >/dev/null; sleep 1
  click $1 'button "Ada"'; sleep 1
  click $1 "button \"Open Ada's profile\""; sleep 1
  click $1 'tab "Advanced"'; sleep 1
  click $1 'button "Tools"'; sleep 1.5
  click $1 'button "MCP servers'; sleep 1.5
  shot $1 $3 190 47 900 330
}
capture before $BASE package-servers.before.raw.png
fx_stop before
capture after $REPO package-servers.after.raw.png
