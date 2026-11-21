#!/bin/zsh
# PR #46: a broken config.json starts from its last good copy and the app says so.
# Both sides: cut config.json in half, save one setting through the app's API, reload.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-46.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}

capture() { # NAME ROOT FILE
  ui_start $1 $2 1280 800
  local url=$(fx_get $1 url) data=$(fx_get $1 dataDir)
  python3 -c 'import sys; p=sys.argv[1]; s=open(p).read(); open(p,"w").write(s[:len(s)//2])' $data/config.json
  cp $data/config.json $RUN/broken.json
  load $1
  api $url PATCH /api/config '{"computerName":"Fixture Mac"}' >/dev/null
  load $1
  echo "$1: configFile = $(api $url GET /api/config | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).configFile)))')"
  echo "$1: config.json $(cmp -s $data/config.json $RUN/broken.json && echo "is byte-identical to the broken file" || echo "was rewritten: $(tr -d '\n' < $data/config.json | cut -c1-80)")"
  echo "$1: files: $(ls $data | grep '^config' | sed 's/[0-9]\{6,\}/<ts>/' | tr '\n' ' ')"
  grep 'config:' "$(fx_get $1 logPath)" | tail -1 | sed "s|$data|DATA|g"
  shot $1 $3
}
capture before $BASE pr-46.before.raw.png
fx_stop before
capture after $REPO pr-46.after.raw.png
