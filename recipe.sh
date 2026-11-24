# Re-shoot: copy move-wren.ts into the checkout's scripts/ (main for before, the fix branch for after), then
#   node --experimental-strip-types scripts/control-dusk.ts ui launch   # prints ui.json and the fixture url
#   sh recipe.sh <ui.json> <fixture url>
# Wren is an invented Grok Bot whose "Laptop setup" skill pipes curl into sh. The move goes through the
# same package import (POST /api/teams/import?mode=add) the app's Grok Bot move uses.
set -eu
H=$1; U=$2
node --experimental-strip-types scripts/move-wren.ts grok-bot-export-wren.json $U
B=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['binary'])" $H)
HOME=$(dirname $H) $B --session "dusk-ui-${U##*:}" set viewport 1280 820 2 >/dev/null
pnpm -s control:dusk ui eval --ui $H --js "location.reload(); 1" >/dev/null; sleep 5
# click the bot row named Wren (the last "Wren" button; the first is its sidebar section), then:
pnpm -s control:dusk ui click --ui $H --name "Open Wren's profile"; sleep 1.5
pnpm -s control:dusk ui click --ui $H --name "Advanced"; sleep 1.5
pnpm -s control:dusk ui click --ui $H --name "Skills 1 on"; sleep 1.5
pnpm -s control:dusk ui click --ui $H --name "Installed 1 on"; sleep 1.5
pnpm -s control:dusk ui screenshot --ui $H --out row.raw.png
pnpm -s control:dusk ui eval --ui $H --js "document.querySelector('[data-panel-row=\"skill:laptop-setup\"] [role=switch]').click(); 1"; sleep 1.5
pnpm -s control:dusk ui screenshot --ui $H --out sheet.raw.png
# frame.mjs ... --crop 296,76,688,560
