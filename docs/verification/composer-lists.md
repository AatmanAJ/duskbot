# Lists and quotes in the message box

A line in the message box that starts with `- `, `* `, a number with `.` or `)`
and a space, or `> ` is a list item or a quote line. On such a line:

- The key that adds a line (Shift+Enter, or Enter when **Send with** is set to
  another key) continues it: the same bullet, the next number, or `> `. Where
  the caret splits an item, the rest moves to the new one.
- Adding a line on an empty item ends the list or quote; a nested empty item
  steps out one level first.
- Tab nests a list item two spaces in, a nested number starting at 1;
  Shift+Tab steps it back out. On any other line Tab moves focus as before.
- Backspace right after a marker lifts the line out (a nested item steps out
  one level first).

Lines inside a fenced code block are left alone, a selection is never
rewritten, and every change goes through the browser's own typing, so undo
takes it back. Enter (or the chosen send key) still sends.

Launch a fixture and run the recipe against the printed handle:

```sh
node --experimental-strip-types scripts/control-dusk.ts ui launch \
  --script '[{"text":"Looks complete. Pack an adapter for the chargers too."}]'
node --experimental-strip-types scripts/verify-composer-lists-ui.ts /tmp/duskbot-verify-data-XXXXXX/ui.json
```

It types an invented packing list into the real composer and proves each rule
above by the field's value and caret, the browser's own undo taking a
continued marker back, and Enter still sending the whole message. It saves
`composer.png` and `sent.png` under `.dusk-scratch/verify-evidence/composer-lists/`
and asserts an error-free renderer console. `control-dusk` sends keys over
CDP, which carries no macOS editing command, so the recipe calls the browser's
undo command directly rather than pressing ⌘Z.

```sh
pnpm exec vitest run src/lib/composer-markdown.test.ts src/lib/composer-markdown.dom.test.ts
```
