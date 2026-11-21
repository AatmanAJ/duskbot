#!/bin/zsh
# PR #48: Cmd-K finds every Settings pane and common settings, in the active language.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-48.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
CLEAR='(()=>{const i=document.querySelector("[role=dialog] input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,"");i.dispatchEvent(new Event("input",{bubbles:true}));i.focus();return 1})()'
ROWS='JSON.stringify([...document.querySelectorAll("[role=dialog] [role=option]")].slice(0,3).map(o=>o.textContent).concat([...document.querySelectorAll("[role=dialog] [role=status]")].map(o=>o.textContent)))'
palette() { ab $1 press Meta+k >/dev/null; sleep 1.5; }
query() { # NAME QUERY FILE
  js $1 $CLEAR >/dev/null; ab $1 keyboard type "$2" >/dev/null; sleep 1.2
  echo "$1: $2 → $(js $1 $ROWS)"
  shot $1 $3 $(rect $1 '[role=dialog]')
}
ui_start before $BASE 1280 800; palette before
query before vault pr-48.before.raw.png
query before invite pr-48.f01-before-invite.raw.png
query before archive pr-48.f03-before-archive.raw.png
fx_stop before
ui_start after $REPO 1280 800; palette after
query after vault pr-48.after.raw.png
query after invite pr-48.f02-after-invite.raw.png
query after archive pr-48.f04-after-archive.raw.png
ab after press Escape >/dev/null
api $(fx_get after url) PATCH /api/config '{"language":"es"}' >/dev/null
load after; palette after
query after idioma pr-48.f05-after-spanish-idioma.raw.png
