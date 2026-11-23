#!/bin/zsh
# Re-shoot: a fake-engine fixture with the regular Vite UI (which mounts <StrictMode>), a CSV attached, "Preview table" clicked.
# 1. node --experimental-strip-types scripts/control-dusk.ts launch            # prints URL (harness port P)
# 2. DUSK_PORT=P DUSK_UI_PORT=20790 node node_modules/vite/bin/vite.js --port 20790 --strictPort
# 3. pnpm control:dusk new-bot --url http://127.0.0.1:P --name Pepper; open http://127.0.0.1:20790 at 1440x900, scale 2,
#    Get started, pick the found Claude (the fake engine), attach q3-hours.csv (invented sample), send "Here are my Q3 hours."
# 4. click the card's "Preview table: q3-hours.csv", wait 1.2 s, screenshot. Before: the dialog is added and removed at once.
# 5. node scripts/brand-studio/frame.mjs --in preview-dialog.before.raw.png --in preview-dialog.after.raw.png \
#      --out preview-dialog.pair.png --label "before: Preview table opens nothing" --label "after: the table preview stays open" --arrange stack
