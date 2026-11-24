#!/bin/zsh
# Re-shoot: a fake-engine `control-dusk ui launch` fixture with a bot named Ada and two conversations, each started
# with POST /api/bots/<id>/tasks: "Invoices for November" then "Kestrel's purchase order is KY-5582; put it on the
# invoice.", and "Kestrel renewal prep" then "Quote PO KY-5582 on the renewal proposal too." Viewport 1280x720 at
# scale 2, open Search, type KY-5582, screenshot. before = origin/main, after = fix/palette-hit-conversation.
# Frame: node scripts/brand-studio/frame.mjs --in palette-before.png --in palette-after.png --out palette-pair.png \
#   --label before --label after --crop 364,138,552,155
