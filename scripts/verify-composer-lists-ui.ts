// Real renderer and server against an explicit control-dusk UI fixture handle (a plain `ui launch` is enough).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runControlDusk } from "./control-dusk.ts";

const handle = process.argv[2];
if (!handle) throw new Error("Usage: node --experimental-strip-types scripts/verify-composer-lists-ui.ts /path/to/fixture/ui.json");
const ui = (verb: string, ...args: string[]) => runControlDusk(["ui", verb, "--ui", handle, ...args]) as Promise<Record<string, any>>;
const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
const field = `document.querySelector('textarea[aria-label="Message Pepper"]')`;
const value = () => evaluate(`${field}.value`);
const caret = () => evaluate(`${field}.selectionStart`);
const type = (text: string) => ui("type", "--name", "Message Pepper", `--text=${text}`);
const press = (keys: string) => ui("press", "--keys", keys);
const expectValue = async (expected: string, label: string) => {
  const end = Date.now() + 5_000;
  let current;
  do {
    current = await value();
    if (current === expected) return;
    await delay(100);
  } while (Date.now() < end);
  assert.equal(current, expected, label);
};
const evidenceDir = resolve(".dusk-scratch/verify-evidence/composer-lists");
mkdirSync(evidenceDir, { recursive: true });
const info = JSON.parse(readFileSync(handle, "utf8")) as { logPath: string };

await ui("click", "--name", "Message Pepper");
await evaluate(`(() => { const f = ${field}; f.focus(); f.setSelectionRange(0, f.value.length); return true; })()`);
await press("Backspace");
await expectValue("", "the message box starts empty");
await type("Packing list:");
await press("Shift+Enter");
await type("- passport");
await press("Shift+Enter");
await expectValue("Packing list:\n- passport\n- ", "Shift+Enter continues a bullet");
await type("chargers");
await press("Shift+Enter");
await press("Tab");
await expectValue("Packing list:\n- passport\n- chargers\n  - ", "Tab nests the new item");
await type("laptop");
await press("Shift+Enter");
await press("Shift+Enter");
await expectValue("Packing list:\n- passport\n- chargers\n  - laptop\n- ", "an empty nested item steps out a level");
await press("Shift+Enter");
await expectValue("Packing list:\n- passport\n- chargers\n  - laptop\n", "an empty top item ends the list");
console.log("PASS bullets continue, Tab nests, an empty item steps out and then ends the list");

await type("1. book the hotel");
await press("Shift+Enter");
await expectValue("Packing list:\n- passport\n- chargers\n  - laptop\n1. book the hotel\n2. ", "numbers count up");
// CDP key events carry no macOS editing command, so the browser's own undo is called directly.
assert.equal(await evaluate(`(() => { ${field}.focus(); return document.execCommand("undo"); })()`), true);
await expectValue("Packing list:\n- passport\n- chargers\n  - laptop\n1. book the hotel", "undo takes the continued marker back");
await press("Shift+Enter");
await press("Backspace");
await expectValue("Packing list:\n- passport\n- chargers\n  - laptop\n1. book the hotel\n", "Backspace after a marker lifts the line out");
await type("> leave by 7");
await press("Shift+Enter");
await expectValue("Packing list:\n- passport\n- chargers\n  - laptop\n1. book the hotel\n> leave by 7\n> ", "quotes continue too");
assert.equal(await caret(), (await value()).length);
await press("Shift+Enter");
await type("Anything missing?");
await ui("screenshot", "--out", resolve(evidenceDir, "composer.png"));
console.log("PASS numbers count up, undo works, Backspace lifts a marker, quotes continue and end");

const before = await evaluate("document.querySelectorAll('[data-own-row]').length");
await press("Enter");
await ui("wait-settle", "--timeout", "60");
const sent = await evaluate("[...document.querySelectorAll('[data-own-row]')].at(-1)?.textContent ?? ''");
assert.ok((await evaluate("document.querySelectorAll('[data-own-row]').length")) > before, "Enter still sends");
assert.match(sent, /laptop/);
assert.equal(await value(), "");
await ui("screenshot", "--out", resolve(evidenceDir, "sent.png"));
console.log("PASS Enter still sends the whole message");

const consoleResult = await ui("console");
assert.deepEqual((consoleResult.messages as Array<{ type: string }>).filter((message) => message.type === "error"), [], "renderer console has no errors");
console.log(JSON.stringify({ ok: true, handle, evidenceDir, logPath: info.logPath, note: "Fixture remains running for inspection." }, null, 2));
