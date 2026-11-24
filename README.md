Before/after for "chat: an off Read this aloud says why under its name".
Re-shoot from a dusk bot checkout (brand studio from feat/brand-screen-studio):
  git worktree add --detach ../base origin/main
  node --experimental-strip-types scripts/brand-studio/capture.ts \
    --recipe read-aloud-disabled-reason.capture.json --app before=../base --app after=.
  node scripts/brand-studio/frame.mjs --in read-aloud-disabled-reason.before.raw.png --in read-aloud-disabled-reason.after.raw.png \
    --out read-aloud-disabled-reason.pair.png --label before --label after
