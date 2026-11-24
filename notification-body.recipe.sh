#!/bin/zsh
# Re-shoot: zsh recipe.sh <outdir> <label>   (run from a dusk bot checkout)
set -u
OUT=$1; LABEL=$2; mkdir -p $OUT
cdk() { node --experimental-strip-types scripts/control-dusk.ts "$@"; }
export FAKE_CLAUDE_TOOL_CALLS='[]'
export FAKE_CLAUDE_REPLIES='["Created and ran [count.sh](/srv/dusk/task-workspaces/685db5dd-c011-4d0e-ac3e-1e8fc27cccde/366c29de-e61a-4dc9-a70d-3b591c2af7f0/count.sh): **there are 3 `.md` files** in the folder."]'
node --experimental-strip-types scripts/control-dusk.ts launch > $OUT/$LABEL-launch.log 2>&1 &
LP=$!
until grep -qo 'http://127.0.0.1:[0-9]*' $OUT/$LABEL-launch.log; do sleep 1; kill -0 $LP 2>/dev/null || { cat $OUT/$LABEL-launch.log; exit 1; }; done
U=$(grep -o 'http://127.0.0.1:[0-9]*' $OUT/$LABEL-launch.log | head -1)
B=$(cdk new-bot --name Pip --url $U | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).bot.id))')
cdk run --bot $B --text "Count the .md files" --wait turn --url $U > /dev/null
sleep 1
curl -s $U/api/notifications | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const n of JSON.parse(s).notifications)console.log(JSON.stringify({kind:n.kind,title:n.title,body:n.body}))})' > $OUT/$LABEL-notifications.jsonl
cat $OUT/$LABEL-notifications.jsonl
kill -INT $LP; wait $LP
