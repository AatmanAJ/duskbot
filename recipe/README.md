# Re-shoot: the next turn's working line

1. Start the restartable rig from a dusk bot checkout (fake engine only, temporary home):
   `node --experimental-strip-types recipe/rig.ts /tmp/ctl` (prints the ui.json handle; `echo term > /tmp/ctl`,
   `echo start > /tmp/ctl`, `echo quit > /tmp/ctl` control it).
2. Script the fake engine in the rig's `config.json`: `instances.claude.environment.FAKE_CLAUDE_SCRIPT =
   [{"waitMs":5000},{"tool":{"name":"Bash","input":{"command":"node scripts/export_invoices.js"}}},{"waitMs":3000},{"text":"Exported."}]`,
   then `term` and `start`.
3. `node --experimental-strip-types recipe/ab.ts <ui.json> set viewport 1100 640 2`.
4. In Pepper's chat send "Export the January invoices", wait for "Exported.", send "Now the February ones" and
   screenshot 1.2 s later (`control-dusk ui screenshot`). Before: the line reads "Running export_invoices.js";
   after: "Thinking".
5. Frame: `node scripts/brand-studio/frame.mjs --in before.raw.png --in after.raw.png --out pair.png
   --label before --label after --crop 268,330,832,240`.
