#!/bin/zsh
# PR #54: when the live desktop can't connect, the Computer panel says so and offers a retry.
# The computer preview fixture: its /computer/join answers 409, so the panel falls back to pictures.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-54.recipe.sh
# Needs the agent-browser download that `scripts/control-dusk.ts ui launch` makes in REPO (run it once).
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
STATE='JSON.stringify({controls:[...document.querySelectorAll("button")].filter(b=>/Take control|Full screen|Retry live view|live desktop/.test(b.innerText+(b.getAttribute("aria-label")??""))).map(b=>(b.innerText.trim()||b.getAttribute("aria-label"))+(b.disabled?" [off]":" [on]")+" «"+b.title+"»"),says:[...document.querySelectorAll("[role=status]")].map(e=>e.innerText.split("\n")[0]).filter(Boolean)})'
capture() { # NAME ROOT FILE
  fx_run $1 $2 '"previewUrl"' scripts/verify-cloud-preview.ts
  pin_colours $(fx_get $1 url)
  viewer $1-view 1440 900 "$(fx_get $1 previewUrl)"
  sleep 25
  echo "$1, 25 s in: $(js $1-view $STATE)"
  # the panel's column, from its top down to the space under its last line
  shot $1-view $3 520 0 400 430
}
capture before $BASE pr-54.before.raw.png
click before-view 'button "Full screen"'; sleep 1
echo "before, Full screen pressed: fullscreen element $(js before-view 'String(!!document.fullscreenElement)'), dialogs $(js before-view 'document.querySelectorAll("[role=dialog]").length')"
fx_stop before-view; fx_stop before
capture after $REPO pr-54.after.raw.png
js after-view '(()=>{window.joins=0;const f=window.fetch.bind(window);window.fetch=(u,i)=>{if(String(u).includes("/computer/join"))window.joins++;return f(u,i)};return "counting joins"})()' >/dev/null
click after-view 'button "Retry live view"'; sleep 3
echo "after, Retry live view pressed: $(js after-view 'window.joins') new /computer/join request(s); then $(js after-view $STATE)"
