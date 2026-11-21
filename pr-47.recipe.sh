#!/bin/zsh
# PR #47: the partly translated note follows real coverage. Settings in German, with the language picker closed and open.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-47.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
capture() { # NAME ROOT CLOSED_FILE OPEN_FILE
  ui_start $1 $2 1440 900
  api $(fx_get $1 url) PATCH /api/config '{"language":"de"}' >/dev/null
  load $1
  click $1 'button "Du"'; click $1 'menuitem "Einstellungen"'; sleep 2
  echo "$1: rail labels wider than their box: $(js $1 'JSON.stringify([...document.querySelectorAll(".settings-nav-item > span")].filter(s=>s.scrollWidth>s.clientWidth).map(s=>s.textContent))')"
  # the dialog from its top edge down to the note under the Appearance card, where a gap falls
  local box=($(rect $1 '[role=dialog]')); box[4]=642
  shot $1 $3 $box
  click $1 'combobox "Sprache"'; sleep 1
  echo "$1: picker: $(js $1 'JSON.stringify([...document.querySelectorAll("[role=listbox] [role=option]")].map(o=>o.textContent))')"
  shot $1 $4 $box
}
capture before $BASE pr-47.f01-before-settings-german.raw.png pr-47.before.raw.png
fx_stop before
capture after $REPO pr-47.f02-after-settings-german.raw.png pr-47.after.raw.png
