#!/bin/zsh
# PR #51: test bots seeded while the app is open show their history at once; an empty chat says so on screen.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-51.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
bot_id() { api $1 GET /api/bots | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).bots.find(b=>b.name===process.argv[1]).id))' $2; }
capture() { # NAME ROOT SEEDED_FILE EMPTY_FILE
  ui_start $1 $2 1440 900
  local url=$(fx_get $1 url)
  # the app is open and stays open: no reload from here on
  ( cd $2 && HOME=$(fx_get $1 dataDir) node scripts/demo/test-bots.mjs --url $url ) >/dev/null
  pin_colours $url; sleep 2
  click $1 'button "Nova'; sleep 2
  echo "$1: Nova's chat shows $(js $1 'document.querySelectorAll("[data-mid]").length') messages; sidebar rows with a preview line: $(js $1 '[...document.querySelectorAll("[data-sidebar-bot-row]")].filter(r=>r.getAttribute("aria-description")).length') of $(js $1 'document.querySelectorAll("[data-sidebar-bot-row]").length')"
  shot $1 $3
  api $url POST /api/bots/$(bot_id $url Quill)/tasks '{}' >/dev/null; sleep 1
  click $1 'button "Quill'; sleep 2
  echo "$1: Quill's new conversation reads: $(js $1 '(document.querySelector("[data-empty-chat]")?.innerText ?? "").split("\n").filter(Boolean).join(" / ") || "(nothing on screen)"')"
  shot $1 $4 $(rect $1 main)
}
capture before $BASE pr-51.before.raw.png pr-51.f01-before-empty-chat.raw.png
fx_stop before
capture after $REPO pr-51.after.raw.png pr-51.f02-after-empty-chat.raw.png
