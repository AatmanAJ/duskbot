#!/bin/zsh
# PR #45: a taken port says so in plain words. A second server is started on a running fixture's port, with the
# fixture's own environment and a new empty data directory (pr-45.second-server.ts).
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-45.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
fx_start fixture $REPO launch
url=$(fx_get fixture url); port=${url##*:}
for side in before after; do
  root=$BASE; [[ $side == after ]] && root=$REPO
  { echo "\$ DUSK_PORT=$port node --experimental-strip-types server/index.ts"; node --experimental-strip-types $LIB/pr-45.second-server.ts $root $port 2>&1; } > $RUN/$side.txt
  cat $RUN/$side.txt
  term $RUN/$side.txt pr-45.$side.raw.png --cols 110
done
echo "the first fixture still answers: $(dusk doctor --url $url | jq .ok)"
