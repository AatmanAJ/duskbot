#!/bin/zsh
# Re-shoot: REPO=<checkout> OUT=<dir> zsh recipe.sh   (run once on origin/main for "before", once on the branch for "after")
# Launches a fake-engine `ui launch` fixture, plays two turns (a well-formed file link, then the unclosed form a real
# reply wrote), asks the server for both files, screenshots at 2x, and stops the fixture.
set -eu
HERE=${0:A:h}; cd "$REPO"; mkdir -p "$OUT"; LOG="$OUT/launch.log"
printf '' > "$OUT/reply.md"
FAKE_CLAUDE_REPLY_FILE="$OUT/reply.md" node --experimental-strip-types scripts/control-dusk.ts ui launch > "$LOG" 2>&1 &
LAUNCHER=$!
until grep -q '"previewUrl"' "$LOG"; do kill -0 $LAUNCHER || { cat "$LOG"; exit 1; }; sleep 1; done
UI=$(sed -n 's/.*"ui": "\(.*\)".*/\1/p' "$LOG"); URL=$(sed -n 's/.*"url": "\(.*\)".*/\1/p' "$LOG")
BOT=$(sed -n 's/.*"botId": "\(.*\)".*/\1/p' "$LOG"); HOMEDIR=$(dirname "$UI"); WS="$HOMEDIR/workspaces/$BOT"
curl -s -X PATCH -H 'content-type: application/json' -d '{"color":"red"}' "$URL/api/bots/$BOT" >/dev/null
mkdir -p "$WS/Fernhill"
printf 'Fernhill website rebuild\n' > "$WS/Fernhill/Fernhill proposal.docx"
printf 'Fernhill budget\n' > "$WS/Fernhill/Fernhill budget.docx"
say() {
  printf '%s' "$2" > "$OUT/reply.md"
  pnpm -s control:dusk ui type --ui "$UI" --name "Message Pepper" --text "$1" >/dev/null
  pnpm -s control:dusk ui press --ui "$UI" --keys Enter >/dev/null
  pnpm -s control:dusk ui wait-settle --ui "$UI" --timeout 60 >/dev/null
}
say "Draft the Fernhill proposal" "Done. Here it is: [Fernhill proposal.docx](<$WS/Fernhill/Fernhill proposal.docx>)"
say "And the budget?" "Done. Here it is: [Fernhill budget.docx](<$WS/Fernhill/Fernhill budget.docx)"
THREAD=$(curl -s "$URL/api/bots" | python3 -c "import json,sys;d=json.load(sys.stdin);bs=d if isinstance(d,list) else d['bots'];print([b for b in bs if b['id']=='$BOT'][0]['threadId'])")
for name in proposal budget; do
  MID=$(curl -s "$URL/api/threads/$THREAD/messages?limit=20" | python3 -c "import json,sys;d=json.load(sys.stdin);ms=d if isinstance(d,list) else d['messages'];print([m['id'] for m in ms if m.get('role')=='bot' and 'Fernhill $name.docx' in (m.get('text') or '')][-1])")
  printf '%s: ' $name; curl -s -w ' (%{http_code})\n' -X POST -H 'content-type: application/json' \
    -d "{\"path\":\"$WS/Fernhill/Fernhill $name.docx\"}" "$URL/api/threads/$THREAD/messages/$MID/file" | head -c 160; echo
done | tee "$OUT/file-requests.txt"
node --experimental-strip-types "$HERE/ab.ts" "$UI" set viewport 1100 760 2 >/dev/null; sleep 1
node --experimental-strip-types "$HERE/ab.ts" "$UI" screenshot "$OUT/full.png" >/dev/null
pnpm -s control:dusk ui console --ui "$UI" > "$OUT/console.json" || true
kill -INT $LAUNCHER; wait $LAUNCHER || true
# Crop (2x px): before -c 510 1606 --cropOffset 800 594; after -c 420 1606 --cropOffset 888 594 (sips), then
# node scripts/brand-studio/frame.mjs --in before.raw.png --in after.raw.png --out pair.png --label before --label after --arrange stack
# "before" ran with server/message-file.ts, src/components/ChatMarkdown.tsx, src/components/AttachmentGallery.tsx at origin/main.
