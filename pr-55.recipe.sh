#!/bin/zsh
# PR #55: a screen picture that can't be shown always ends in Retry preview, not endless Connecting.
# The computer preview fixture: Screenshot response → corrupt, then Reconnect panel, then watch for 45 s.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-55.recipe.sh
# Needs the agent-browser download that `scripts/control-dusk.ts ui launch` makes in REPO (run it once).
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
PICK='(()=>{const s=[...document.querySelectorAll("select")].find(s=>[...s.options].some(o=>o.value==="corrupt"||o.text==="corrupt"));const o=[...s.options].find(o=>o.value==="corrupt"||o.text==="corrupt");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,o.value);s.dispatchEvent(new Event("change",{bubbles:true}));return "Screenshot response: "+s.value})()'
STATE='(()=>{const alert=document.querySelector("[role=alert]"),status=[...document.querySelectorAll("[role=status]")].map(e=>e.innerText.trim()).filter(Boolean)[0];return alert?"alert: "+alert.innerText.replace(/\s+/g," ").trim():"status: "+(status??"(none)")})()'
capture() { # NAME ROOT FILE
  fx_run $1 $2 '"previewUrl"' scripts/verify-cloud-preview.ts
  pin_colours $(fx_get $1 url)
  viewer $1-view 1440 900 "$(fx_get $1 previewUrl)"
  sleep 6
  js $1-view $PICK
  click $1-view 'button "Reconnect panel"'
  for at in 5 15 25 35 45; do sleep $(( at == 5 ? 5 : 10 )); echo "$1, ${at} s after Reconnect panel: $(js $1-view $STATE)"; done
  # the panel's column, from its top down to the space under its last line
  shot $1-view $3 520 0 400 430
}
capture before $BASE pr-55.before.raw.png
fx_stop before-view; fx_stop before
capture after $REPO pr-55.after.raw.png
