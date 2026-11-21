#!/bin/zsh
# Shared helpers for the pr-<n>.recipe.sh files beside this one. Every fixture is the repo's own isolated,
# fake-engine verification server (docs/verification/README.md): a temporary data directory and home, never the
# live app or its data.
#
#   REPO  a checkout of the PR's branch, with `pnpm install` done          (required)
#   BASE  a checkout of the commit the branch starts from, same install    (required for "before")
#   OUT   where the PNGs go                                                (default: ./out)
#
# `git worktree add --detach "$BASE" <base sha>` and a symlink to REPO's node_modules is enough for BASE.
set -e
: ${REPO:?set REPO to a checkout of the PR branch} ${OUT:=$PWD/out}
LIB=${0:A:h}; RUN=$(mktemp -d); mkdir -p "$OUT"
TOOLS="$REPO/.dusk-scratch/verify-tools"

# fx_start NAME ROOT <control-dusk args...> : start a fixture in the background and wait for its handle
fx_start() {
  local name=$1 root=$2; shift 2
  ( cd "$root" && exec node --experimental-strip-types scripts/control-dusk.ts "$@" ) > "$RUN/$name.out" 2> "$RUN/$name.err" &
  echo $! > "$RUN/$name.pid"
  for i in {1..360}; do
    grep -q '"ok": true' "$RUN/$name.out" 2>/dev/null && return 0
    kill -0 $(<"$RUN/$name.pid") 2>/dev/null || { tail -20 "$RUN/$name.err" >&2; return 1; }
    sleep 0.5
  done; return 1
}
fx_get() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]])' "$RUN/$1.out" $2; }
fx_stop() { kill -INT $(<"$RUN/$1.pid") 2>/dev/null || true; for i in {1..60}; do kill -0 $(<"$RUN/$1.pid") 2>/dev/null || break; sleep 0.25; done }
fx_stop_all() { for f in "$RUN"/*.pid(N); do fx_stop ${f:t:r}; done }
trap fx_stop_all EXIT

api() { curl -fsS -X $2 "$1$3" -H 'content-type: application/json' -H "origin: $1" ${4:+-d} ${4:+"$4"}; }
dusk() { ( cd "$REPO" && node --experimental-strip-types scripts/control-dusk.ts "$@" ); }

# New bots get a random colour. Pin every bot's by name, so "before" and "after" draw the same bots the same way.
PINNED=(blue green orange pink teal purple coral cyan yellow red brown)
pin_colours() {
  local url=$1 i=0 id name
  api $url GET /api/bots | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const b of JSON.parse(s).bots.filter(b=>!b.defaultBot).sort((a,b)=>a.name.localeCompare(b.name)))console.log(b.id+"\t"+b.name)})' |
  while IFS=$'\t' read -r id name; do
    if [[ $name == Pepper ]]; then api $url PATCH /api/bots/$id '{"color":"blue"}' >/dev/null
    else i=$((i+1)); api $url PATCH /api/bots/$id "{\"color\":\"${PINNED[$((i % ${#PINNED[@]} + 1))]}\"}" >/dev/null; fi
  done
}

# ab NAME <agent-browser args...> : the fixture's own headless browser session
ab() {
  local name=$1; shift
  local h=$(fx_get $name ui)
  local bin=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).binary)' $h)
  local home=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).home)' $h)
  local ses=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).session)' $h)
  local chrome=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).chrome)' $h)
  env -i HOME="$home" TMPDIR="$home/tmp" PATH="$PATH" AGENT_BROWSER_SESSION="$ses" AGENT_BROWSER_HEADLESS=1 AGENT_BROWSER_NO_WEBMCP=1 AGENT_BROWSER_EXECUTABLE_PATH="$chrome" "$bin" "$@"
}
js() { local name=$1; shift; ab $name eval "$*" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v=s.trim();try{v=JSON.parse(v)}catch{};console.log(typeof v==="string"?v:JSON.stringify(v))})'; }
# click NAME 'role "accessible name"' : the first control whose snapshot line holds that text, waiting up to 20 s
click() {
  local ref
  for i in {1..40}; do
    ref=$(ab $1 snapshot -i 2>/dev/null | grep -F -- "$2" | head -1 | sed -n 's/.*ref=\(e[0-9]*\).*/@\1/p')
    [[ -n $ref ]] && ab $1 click $ref >/dev/null && return 0
    sleep 0.5
  done; echo "click: not found: $2" >&2; return 1
}
load() { ab $1 open "$(fx_get $1 previewUrl)" >/dev/null; for i in {1..80}; do [[ $(js $1 'document.querySelectorAll("textarea").length') != 0 ]] && break; sleep 0.5; done; sleep 1.5; }

# ui_start NAME ROOT WIDTH HEIGHT [ui launch args...] : a UI fixture at 2x with pinned colours, the app loaded
ui_start() {
  local name=$1 root=$2 w=$3 h=$4; shift 4
  # one verified agent-browser download serves both checkouts
  if [[ -d $TOOLS/tools ]]; then
    export DUSK_AGENT_BROWSER_PATH=$(print -l $TOOLS/tools/agent-browser/*/agent-browser | head -1)
    export AGENT_BROWSER_EXECUTABLE_PATH=$(print -l $TOOLS/.agent-browser/browsers/chrome-*/**/MacOS/Google\ Chrome\ for\ Testing(N) $TOOLS/.agent-browser/browsers/chrome-*/**/chrome(N) | head -1)
  fi
  fx_start $name $root ui launch "$@"
  pin_colours $(fx_get $name url)
  ab $name set viewport $w $h 2 >/dev/null
  load $name
}
# shot NAME FILE [x y w h] : a 2x screenshot, cropped to CSS pixels when a box is given
shot() {
  local name=$1 file=$2; shift 2
  ab $name screenshot "$RUN/full.png" >/dev/null
  if (( $# == 4 )); then python3 "$LIB/crop.py" "$RUN/full.png" "$OUT/$file" "$@" >/dev/null; else cp "$RUN/full.png" "$OUT/$file"; fi
  echo "wrote $OUT/$file"
}
# rect NAME 'css selector' : "x y w h" of the first match, rounded outwards
rect() { js $1 "(()=>{const r=document.querySelector(${(qqq)2}).getBoundingClientRect();return [Math.floor(r.x),Math.floor(r.y),Math.ceil(r.width),Math.ceil(r.height)].join(' ')})()"; }
# term TEXTFILE FILE [--cols N] : real terminal output drawn as an image, for changes with no screen
term() { local t=$1 f=$2; shift 2; python3 "$LIB/term.py" "$t" "$OUT/$f" "$@" >/dev/null; echo "wrote $OUT/$f"; }
