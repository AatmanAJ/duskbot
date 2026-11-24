# palette-grok-words captures

Fake-engine fixture (`node --experimental-strip-types scripts/control-dusk.ts ui launch`), seeded bot Pepper open,
1280 × 760 at 2x. One fixture for both states: `before-*` with the branch's palette files checked out from
origin/main, `after-*` and `opened-*` with the branch's own, the page reloaded between.

- `recipe.sh <ui.json> <outdir> <before|after>`: opens ⌘K, types routines, automations, memories, pages, auto-review,
  prints the result rows and screenshots each.
- `opened-*`: ⌘K, the word, Enter, then 5 s for the panel to settle (routines → Routines page, memories → What it
  remembers, pages → Library).
- Framed with `scripts/brand-studio/frame.mjs --crop 360,152,560,456 --arrange row` (the palette's own box).
