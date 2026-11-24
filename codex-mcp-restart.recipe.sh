#!/bin/zsh
# A Codex bot uses a command MCP server added in Plugins → MCP servers (Add bumps the server's restart count).
#   REPO=<branch checkout> BASE=<checkout of the base commit> OUT=./out zsh codex-mcp-restart.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
capture() { # NAME ROOT FILE
  ui_start $1 $2 1280 800 --engine codex
  local url=$(fx_get $1 url) bot=$(fx_get $1 botId)
  ( cd $2 && node --experimental-strip-types scripts/control-dusk.ts set-model --bot $bot --instance codex --model gpt-fake-default --url $url >/dev/null )
  click $1 'button "Connect apps"'; sleep 1.5
  click $1 'button "Your plugins"'; sleep 1
  click $1 'button "Open Custom MCP"'; sleep 1.5
  click $1 'button "Add MCP server"'; sleep 1
  local box=$(ab $1 snapshot -i | grep -F 'textbox "Server link or setup command"' | sed -n 's/.*ref=\(e[0-9]*\).*/@\1/p')
  ab $1 fill $box "claude mcp add notes -- node $2/server/testing/fake-mcp-server.ts" >/dev/null; sleep 1
  click $1 'button "Add" ['
  for i in {1..40}; do ab $1 snapshot | grep -q 'Connected: 1 tool' && break; sleep 0.5; done
  echo "$1: $(ab $1 snapshot | grep -o 'Connected: [0-9]* tool' | head -1)"
  click $1 'button "Close"'; sleep 1
  local box2=$(ab $1 snapshot -i | grep -F 'textbox "Message Pepper"' | sed -n 's/.*ref=\(e[0-9]*\).*/@\1/p')
  ab $1 fill $box2 "What's in my notes?" >/dev/null; ab $1 press Enter >/dev/null
  ( cd $2 && node --experimental-strip-types scripts/control-dusk.ts wait --bot $bot --timeout 60 --url $url >/dev/null 2>&1 || true ); sleep 2
  ( cd $2 && node --experimental-strip-types scripts/control-dusk.ts messages --bot $bot --limit 4 --url $url ) > $OUT/${3:r}.messages.json 2>&1 || true
  shot $1 $3 288 440 992 360
}
capture before $BASE codex-mcp-restart.before.raw.png
fx_stop before
capture after $REPO codex-mcp-restart.after.raw.png
