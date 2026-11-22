# Quoting selected text

Select words in any message of a conversation and a **Quote ⌘L** pill (Ctrl+L
outside macOS) appears above them, or below when they sit at the top of the
window. The pill or the chord puts the selection in that conversation's message
box as a Markdown quote (`> ` per line, outer blank lines and trailing spaces
dropped, at most 4,000 characters), after anything already written, with a blank
line below and the caret on it. A selection inside a button, a field or a dialog,
or one that reaches outside the conversation, shows no pill and leaves the chord
alone. A sent message draws its `> ` lines as a quote above what was written. It
works the same in one-to-one chats and rooms.

Launch a fixture whose fake Claude answers with invented text, then run the
recipe against the printed handle:

```sh
node --experimental-strip-types scripts/control-dusk.ts ui launch \
  --script '[{"text":"Plan for the Friday launch: freeze the branch at noon, run the smoke tests, then post the release notes."}]'
node --experimental-strip-types scripts/verify-quote-selection-ui.ts /tmp/duskbot-verify-data-XXXXXX/ui.json
```

It sends a message through the real composer, selects a phrase of the reply,
and proves: the pill appears above the selection and inside the window; clicking
it fills the message box with the quote and a blank line and focuses it; the
sent bubble draws the quote (`[data-own-quote]`) with no raw `>`; and the chord
quotes a new selection. It saves `pill.png` and `sent-quote.png` under
`.dusk-scratch/verify-evidence/quote-selection/` and asserts an error-free
renderer console. Interrupt the launcher with Ctrl-C when done.

```sh
pnpm exec vitest run src/lib/quote-selection.test.ts src/components/SelectionQuote.dom.test.ts
```

These cover the quote's shape, the pill's placement rules, selections in
buttons and outside the conversation, and the chord with and without a
selection. Native touch selection handles on a phone are not exercised.
