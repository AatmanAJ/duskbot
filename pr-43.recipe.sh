#!/bin/zsh
# PR #43: the log doctor says why a failed turn stopped. Three fixtures, one failed turn each, one joined trail.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-43.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
mkdir -p $RUN/three-failed-turns
for mode in api-error usage-limit not-logged-in; do
  FAKE_CLAUDE_MODE=$mode fx_start $mode $REPO launch
  url=$(fx_get $mode url)
  bot=$(dusk new-bot --name Pepper --url $url | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).bot.id))')
  dusk send --bot $bot --text hello --url $url >/dev/null
  dusk wait --bot $bot --url $url --timeout 60 | grep '"status"'
  sleep 2
  cat "$(fx_get $mode dataDir)/logs/trail-server.jsonl" >> $RUN/three-failed-turns/trail-server.jsonl
  fx_stop $mode
done
for side in before after; do
  root=$BASE; [[ $side == after ]] && root=$REPO
  { echo '$ node scripts/log-doctor.mjs --dir ./three-failed-turns --no-save'; node $root/scripts/log-doctor.mjs --dir $RUN/three-failed-turns --no-save; } > $RUN/$side.txt
  cat $RUN/$side.txt
  term $RUN/$side.txt pr-43.$side.raw.png
done
