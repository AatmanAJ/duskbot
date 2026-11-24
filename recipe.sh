# Re-shoot from the checkout under test (main for before, the fix branch for after):
#   node --experimental-strip-types scripts/control-dusk.ts ui launch   # prints ui.json and the fixture url
#   sh recipe.sh <ui.json> <fixture url>
set -eu
H=$1; U=$2
# a moved bot's Stripe: saved at Stripe's own address and switched off, as the Grok Bot move leaves it
curl -s -X POST $U/api/mcp/servers -H 'content-type: application/json' -d '{"name":"stripe","type":"http","url":"https://mcp.stripe.com","enabled":false}' >/dev/null
curl -s -X POST $U/api/mcp/servers -H 'content-type: application/json' -d '{"name":"companies-house","type":"http","url":"https://mcp.companies-house.invalid/mcp","enabled":false}' >/dev/null
B=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['binary'])" $H)
HOME=$(dirname $H) $B --session "dusk-ui-${U##*:}" set viewport 1280 820 2 >/dev/null
pnpm -s control:dusk ui eval --ui $H --js "location.reload(); 1" >/dev/null; sleep 5
pnpm -s control:dusk ui click --ui $H --name "Connect apps"; sleep 2.5
pnpm -s control:dusk ui click --ui $H --name "Your plugins"; sleep 2
pnpm -s control:dusk ui screenshot --ui $H --out shot.raw.png
# frame.mjs ... --crop 210,120,880,360
