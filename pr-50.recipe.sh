#!/bin/zsh
# PR #50: at phone width a read row keeps room beside its time for the ••• button. Test bots, 390x844, bot list open.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-50.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
# per row: the gap in px from the end of its time to the ••• glyph (negative = drawn over the time)
GAPS='JSON.stringify([...document.querySelectorAll("[data-sidebar-bot-row]")].map(r=>{const time=r.querySelector("[data-row-words] > div > :last-child");const glyph=r.parentElement.querySelector("[data-bot-actions] svg");return time&&glyph&&/\d/.test(time.textContent)?r.getAttribute("aria-label").split(",")[0]+" "+Math.round(glyph.getBoundingClientRect().left-time.getBoundingClientRect().right):null}).filter(Boolean))'
capture() { # NAME ROOT FILE
  ui_start $1 $2 390 844
  local url=$(fx_get $1 url)
  ( cd $2 && HOME=$(fx_get $1 dataDir) node scripts/demo/test-bots.mjs --url $url ) >/dev/null
  # every row read except the two the seed leaves unread, the same on both sides
  pin_colours $url
  load $1
  click $1 'button "Open bot list"'; sleep 1.5
  echo "$1: $(js $1 $GAPS)"
  shot $1 $3
}
capture before $BASE pr-50.before.raw.png
fx_stop before
capture after $REPO pr-50.after.raw.png
