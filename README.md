Before/after for "settings: sign-in and setup messages name Settings → Models".
Re-shoot from a dusk bot checkout (brand studio from feat/brand-screen-studio):
  git worktree add --detach ../base origin/main
  FAKE_CLAUDE_MODE=not-logged-in node --experimental-strip-types scripts/brand-studio/capture.ts \
    --recipe settings-models-path.capture.json --app before=../base --app after=.
  node --experimental-strip-types scripts/brand-studio/capture.ts --recipe settings-rail.capture.json --state after
  node scripts/brand-studio/frame.mjs --in settings-models-path.before.raw.png --in settings-models-path.after.raw.png \
    --out settings-models-path.pair.png --label before --label after
