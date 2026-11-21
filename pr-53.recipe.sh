#!/bin/zsh
# PR #53: a browser view that gave up reads Disconnected in the pill and the address field, not Connecting….
# The live browser fixture with Chrome for Testing: its view never opens here, so after about 33 s the panel gives up.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-53.recipe.sh
# Needs the agent-browser download that `scripts/control-dusk.ts ui launch` makes in REPO (run it once).
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
STATE='JSON.stringify({pill:document.querySelector("[data-pill]")?.getAttribute("aria-label"),pillSpins:!!document.querySelector("[data-pill] .animate-spin"),address:document.querySelector("input[placeholder]")?.placeholder,page:[...document.querySelectorAll(".absolute.inset-0 span, .absolute.inset-0 button")].map(e=>e.textContent).join(" / ")})'
capture() { # NAME ROOT FILE
  tools
  DUSK_VERIFY_BROWSER_BINARY=$DUSK_AGENT_BROWSER_PATH DUSK_VERIFY_BROWSER_CHROME=$AGENT_BROWSER_EXECUTABLE_PATH \
    fx_run $1 $2 '"previewUrl"' scripts/verify-browser-live.ts
  viewer $1-view 920 520 "$(fx_get $1 previewUrl)"
  for i in {1..40}; do sleep 2; [[ $(js $1-view $STATE) == *"Browser disconnected"* ]] && break; done
  echo "$1, once the view has given up: $(js $1-view $STATE)"
  # the panel's card with 12 px around it
  shot $1-view $3 12 12 896 496
}
capture before $BASE pr-53.before.raw.png
fx_stop before-view; fx_stop before
capture after $REPO pr-53.after.raw.png
click after-view 'button "Reconnect"'; sleep 1
echo "after, Reconnect pressed: $(js after-view $STATE)"
