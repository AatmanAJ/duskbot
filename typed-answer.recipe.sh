#!/bin/zsh
# Re-shoot: zsh recipe.sh <outdir> <label>   (run from a dusk bot checkout)
set -u
OUT=$1; LABEL=$2; mkdir -p $OUT
cdk() { node --experimental-strip-types scripts/control-dusk.ts "$@"; }
export FAKE_CLAUDE_TOOL_CALLS='[{"server":"dusk","name":"ask_user","input":{"question":"Should I include Ridgeway in the comparison?","choices":["Yes","No"]}}]'
export FAKE_CLAUDE_REPLIES='["Added Ridgeway to the comparison."]'
node --experimental-strip-types scripts/control-dusk.ts ui launch > $OUT/launch.json 2> $OUT/launch.err &
LP=$!
until grep -q '"ui"' $OUT/launch.json 2>/dev/null; do sleep 1; kill -0 $LP 2>/dev/null || { wait $LP; echo "launch exited $?"; cat $OUT/launch.err; exit 1; }; done
H=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).ui)' $OUT/launch.json)
U=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).url)' $OUT/launch.json)
B=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).botId)' $OUT/launch.json)
HOMEDIR=$(node -e 'const h=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(h.home)' $H)
SESSION=$(node -e 'const h=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(h.session)' $H)
BIN=$(node -e 'const h=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(h.binary)' $H)
curl -s -X PATCH -H 'content-type: application/json' -d '{"color":"teal"}' $U/api/bots/$B >/dev/null
HOME=$HOMEDIR TMPDIR=$HOMEDIR/tmp AGENT_BROWSER_SESSION=$SESSION $BIN set viewport 1100 640 2 >/dev/null
sleep 1
cdk ui type --ui $H --name "Message Pepper" --text "Add one more competitor to the Kestrel list" >/dev/null
cdk ui press --ui $H --keys Enter >/dev/null
for i in {1..30}; do sleep 1; curl -s $U/api/needs-you | grep -q question && break; done
sleep 1
cdk ui screenshot --ui $H --out $OUT/$LABEL-1-asked.png >/dev/null
cdk ui type --ui $H --name "Message Pepper" --text "Yes, include Ridgeway" >/dev/null
cdk ui press --ui $H --keys Enter >/dev/null
sleep 6
cdk ui screenshot --ui $H --out $OUT/$LABEL-2-typed.png >/dev/null
curl -s $U/api/needs-you > $OUT/$LABEL-needs-you.json
cdk messages --bot $B --limit 8 --url $U > $OUT/$LABEL-messages.json
cdk ui console --ui $H > $OUT/$LABEL-console.json
kill -INT $LP; wait $LP
