# qa-assets: codex-own-refused-model

Before/after for "Codex's own ChatGPT sign-in: a refused model leaves the list".

- `fake-codex-fixture.sh`: an isolated dusk bot (temporary HOME and data dir) whose Codex is the repository's fake,
  signed in to a synthetic ChatGPT account that refuses `$REFUSE` (default gpt-6-luna).
- `recipe.sh <before|after>`: two messages to a Writer bot on the refused model, then a Researcher bot's model list.
- `shoot.mjs`: headless Chrome screenshot at 2x (SHOOT_CHROME overrides the browser path).
- Framed with `scripts/brand-studio/frame.mjs` (fork branch feat/brand-screen-studio):
  `--crop 0,0,1280,330` for the chat pair, `--crop 900,340,380,330 --arrange row` for the picker pair.
