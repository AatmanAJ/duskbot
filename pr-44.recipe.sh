#!/bin/zsh
# PR #44: doctor names the engine a bot uses and why it cannot answer. The Claude CLI is pointed at an invented path.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-44.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
fx_start fixture $REPO launch
url=$(fx_get fixture url)
dusk new-bot --name Pepper --url $url >/dev/null
echo "ready: $(dusk doctor --url $url | jq .ok)"
api $url PATCH /api/instances/claude '{"cli":"/Users/ada/Application Support/missing/claude"}' >/dev/null
sleep 3
FILTER='{ok, claude: (.instances[] | select(.instanceId == "claude") | .snapshot), problems}'
for side in before after; do
  root=$BASE; [[ $side == after ]] && root=$REPO
  { echo "\$ pnpm control:dusk doctor --url $url | jq '{ok, claude: (.instances[]"
    echo '    | select(.instanceId == "claude") | .snapshot), problems}'"'"
    ( cd $root && node --experimental-strip-types scripts/control-dusk.ts doctor --url $url || true ) | jq "$FILTER"; } > $RUN/$side.txt
  cat $RUN/$side.txt
  term $RUN/$side.txt pr-44.$side.raw.png --cols 96
done
