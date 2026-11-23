#!/bin/zsh
# Re-shoot for "site: grok bot pages and docs point at today's import and routine runs".
# Site pair: build the site on origin/main (before) and on the fix branch (after), serve each public/landing with
#   python3 -m http.server, open /guides/move-from-grok-bot/ at 1100x760 @2x, scroll the .seo-answer to the top, screenshot.
# App shot: a fake-engine fixture (launchVerificationServer + the bot-move preview, as scripts/verify-bot-move.ts) whose
#   temporary home holds the invented Grok Bot profile (grok-bot-export-*.json in Downloads, the roster cache);
#   Get started → use the Claude already signed in → App settings → General → Start import, 1280x820 @2x.
# Frame (fork branch feat/brand-screen-studio, scripts/brand-studio/frame.mjs):
#   frame.mjs --in grok-site-paths.before.raw.png --in grok-site-paths.after.raw.png --out grok-site-paths.pair.png \
#     --label before --label after --crop 250,58,820,184 --arrange stack
#   frame.mjs --in grok-site-paths.app-import.raw.png --out grok-site-paths.app-import.png --crop 190,62,900,270
