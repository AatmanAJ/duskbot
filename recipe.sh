#!/bin/zsh
# usage: shoot.sh <ui.json> <outdir> <prefix>; opens ⌘K over the seeded bot and shoots one result list per word
set -e
H=$1; OUT=$2; P=$3; REPO=${REPO:-$PWD}
mkdir -p $OUT
AB=$(node -e "console.log(require('$H').binary)"); SESSION=$(node -e "console.log(require('$H').session)"); HOMEDIR=$(node -e "console.log(require('$H').home)")
ab() { HOME=$HOMEDIR $AB --session $SESSION "$@"; }
ui() { node --experimental-strip-types $REPO/scripts/control-dusk.ts ui "$@" --ui $H; }
ab set viewport 1280 760 2 >/dev/null
for word in routines automations memories pages auto-review; do
  ui press --keys Escape >/dev/null || true
  ui press --keys Meta+k >/dev/null
  sleep 0.6
  ui eval --js "(()=>{const i=document.querySelector('[data-command-palette] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'$word');i.dispatchEvent(new Event('input',{bubbles:true}));return i.value})()" >/dev/null
  sleep 1.2
  ui eval --js "[...document.querySelectorAll('[role=option]')].map(o=>o.textContent).join(' | ') || document.querySelector('[data-command-palette] [role=status]')?.textContent" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('$word =>',JSON.parse(s).result))"
  ui screenshot --out $OUT/$P-$word.png >/dev/null
done
ui press --keys Escape >/dev/null || true
