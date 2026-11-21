#!/bin/zsh
# PR #52: the first chat lands with the bot panel closed, and a load at phone width opens on the chat.
# The first run is replayed on the fixture's own browser: Dusk not met yet, storage cleared, ?onboarding=1.
#   REPO=<branch checkout> BASE=<checkout of 9b9985c47> OUT=./out zsh pr-52.recipe.sh
source ${0:A:h}/capture-lib.sh
: ${BASE:?set BASE to a checkout of the commit the branch starts from}
STATE='JSON.stringify({composerX:Math.round(document.querySelector("textarea").getBoundingClientRect().x),savedPanelOpen:localStorage.getItem("duskbot.botPanelOpen.v1"),panelShown:!!document.querySelector("[data-bot-sheet], [data-panel-slot] [role=tablist], [data-tour=computer-tabs]")})'
capture() { # NAME ROOT DESKTOP_FILE PHONE_FILE
  ui_start $1 $2 1440 900
  js $1 'fetch("/api/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:{name:"Onboarding fixture"}})}).then(r=>r.ok)' >/dev/null
  js $1 'fetch("/api/bots").then(r=>r.json()).then(d=>Promise.all(d.bots.filter(b=>b.defaultBot).map(b=>fetch("/api/bots/"+b.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({welcomed:false})}).then(r=>r.ok))))' >/dev/null
  js $1 'localStorage.clear(); sessionStorage.clear(); localStorage.setItem("dusk-advanced-mode","0"); setTimeout(()=>{location.search="?onboarding=1"},0); true' >/dev/null
  click $1 'button "Get started"'
  for step in {1..8}; do
    sleep 1.5
    [[ $(js $1 'document.querySelectorAll("[data-welcome]").length') == 0 ]] && break
    echo "$1, welcome screen $step: $(js $1 '[...document.querySelectorAll("[data-welcome] button")].map(b=>b.innerText.trim()).filter(Boolean).join(" | ")')"
    click $1 'button "Continue"'
  done
  sleep 4
  echo "$1, first run just ended: $(js $1 $STATE)"
  shot $1 $3
  # a panel the person left open on a wide window, then a load at phone width
  js $1 'localStorage.setItem("duskbot.botPanelOpen.v1","1"); true' >/dev/null
  ab $1 set viewport 390 844 2 >/dev/null
  ab $1 reload >/dev/null; sleep 5
  echo "$1, loaded at phone width with the panel saved open: $(js $1 'JSON.stringify({chatVisible:(r=>r.width>0&&r.x>=0&&r.x<innerWidth)(document.querySelector("textarea").getBoundingClientRect()),topmostAtCentre:document.elementFromPoint(195,420)?.closest("[role=log],[role=dialog],aside,[data-bot-sheet]")?.getAttribute("role")??"panel",savedPanelOpen:localStorage.getItem("duskbot.botPanelOpen.v1")})')"
  shot $1 $4
}
capture before $BASE pr-52.before.raw.png pr-52.f01-before-phone-reload.raw.png
fx_stop before
capture after $REPO pr-52.after.raw.png pr-52.f02-after-phone-reload.raw.png
