#!/bin/zsh
# PR #49: the open bot's sidebar row scrolls into view. 48 bots, Pepper (the open chat) last in the list.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-49.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}

ROW='(()=>{const row=[...document.querySelectorAll("[data-sidebar-bot-row]")].find(r=>/^Pepper/.test(r.textContent));const list=row.closest(".overflow-y-auto");return {rowTop:Math.round(row.getBoundingClientRect().top),listScrollTop:list.scrollTop,windowHeight:innerHeight}})()'

capture() { # NAME ROOT FILE
  ui_start $1 $2 1440 900
  local url=$(fx_get $1 url)
  for i in {01..46}; do dusk new-bot --name "Extra $i" --url $url >/dev/null; done
  pin_colours $url
  load $1
  echo "$1 after a reload: $(js $1 $ROW)"
  shot $1 $3 $(rect $1 aside)
}
capture before $BASE pr-49.before.raw.png
fx_stop before
capture after $REPO pr-49.after.raw.png

# the person's own scroll position survives a list change, and another chat opening is revealed in turn
url=$(fx_get after url)
js after '(()=>{const l=document.querySelector("[data-sidebar-bot-row]").closest(".overflow-y-auto");l.scrollTop=0;return "scrolled the list to the top"})()'
dusk new-bot --name "Later arrival" --url $url >/dev/null; sleep 2
echo "after another bot is added: $(js after $ROW)"
