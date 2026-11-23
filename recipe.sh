#!/bin/zsh
# Re-shoot: a fake-engine `control-dusk ui launch` fixture, a bot named Ada whose MEMORY.md has two struck-through
# (superseded) lines and four live ones, plus memory/kestrel-health.md, memory/northwind-freight.md and
# memory/grok-bot-event-routines.md written through PUT /api/bots/<id>/memory/file. Viewport 1280x720 at scale 2
# (agent-browser set viewport 1280 720 2), then Ada → profile → Advanced → What it remembers → Notes, screenshot.
# before = origin/main, after = fix/memory-panel-current-notes.
# Frame: node scripts/brand-studio/frame.mjs --in before-notes.png --in after-notes.png --out memory-notes-pair.png \
#   --label before --label after --crop 390,47,700,625
