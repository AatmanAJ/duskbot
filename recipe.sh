#!/bin/zsh
# Re-shoot: build the site at the base and at the fix, serve each public/landing on 127.0.0.1 (any static server),
# open /download/ and /docs/faq/ at 1100x560 with device scale 2, scroll to #requirements and to the
# "do i need a paid ai plan?" heading, screenshot, then frame each pair:
#   node scripts/brand-studio/frame.mjs --in X-before.png --in X-after.png --out X.pair.png --label before --label after
