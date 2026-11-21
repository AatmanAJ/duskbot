// Real renderer and server against an explicit control-dusk UI fixture handle launched with a scripted reply:
//   --script '[{"text":"Plan for the Friday launch: freeze the branch at noon, run the smoke tests, then post the notes."}]'
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runControlDusk } from "./control-dusk.ts";

const handle = process.argv[2];
if (!handle) throw new Error("Usage: node --experimental-strip-types scripts/verify-quote-selection-ui.ts /path/to/fixture/ui.json");
const ui = (verb: string, ...args: string[]) => runControlDusk(["ui", verb, "--ui", handle, ...args]) as Promise<Record<string, any>>;
const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
const poll = async (read: () => Promise<unknown>, expected: unknown, label: string) => {
  const end = Date.now() + 20_000;
  let result;
  do {
    result = await read();
    if (JSON.stringify(result) === JSON.stringify(expected)) return;
    await delay(150);
  } while (Date.now() < end);
  assert.deepEqual(result, expected, label);
};
const evidenceDir = resolve(".dusk-scratch/verify-evidence/quote-selection");
mkdirSync(evidenceDir, { recursive: true });
const screenshot = (name: string) => ui("screenshot", "--out", resolve(evidenceDir, `${name}.png`));
const field = `document.querySelector('textarea[aria-label="Message Pepper"]')`;
const info = JSON.parse(readFileSync(handle, "utf8")) as { logPath: string };

await ui("type", "--name", "Message Pepper", "--text", "What is the plan for Friday?");
await ui("press", "--keys", "Enter");
await ui("wait-settle", "--timeout", "60");
const phrase = "freeze the branch at noon, run the smoke tests";
const select = `(() => {
  const log = document.querySelector('[role=log]');
  const walker = document.createTreeWalker(log, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent.indexOf(${JSON.stringify(phrase)});
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + ${phrase.length});
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  return false;
})()`;
assert.equal(await evaluate(select), true, "the scripted reply holds the phrase");
await poll(() => evaluate("Boolean(document.querySelector('[data-selection-quote]'))"), true, "the Quote pill appears over the selection");
const pill = await evaluate("(() => { const b = document.querySelector('[data-selection-quote]'); const r = b.getBoundingClientRect(); const s = getSelection().getRangeAt(0).getBoundingClientRect(); return { text: b.textContent, label: b.getAttribute('aria-label'), above: r.bottom <= s.top, inside: r.left >= 0 && r.right <= innerWidth }; })()");
assert.equal(pill.label, "Quote in your reply");
assert.match(pill.text, /^Quote(⌘L|Ctrl\+L)$/);
assert.equal(pill.above, true, "the pill sits above the selected words");
assert.equal(pill.inside, true);
await screenshot("pill");
await ui("click", "--name", "Quote in your reply");
await poll(() => evaluate(`${field}.value`), `> ${phrase}\n\n`, "the composer holds the quote and a blank line");
assert.equal(await evaluate(`document.activeElement === ${field}`), true, "the caret is in the message box");
assert.equal(await evaluate("Boolean(document.querySelector('[data-selection-quote]'))"), false);
console.log("PASS selecting reply text shows a Quote pill above it; clicking puts it in the message box as a quote, caret below");

await ui("type", "--name", "Message Pepper", "--text", "Can we do the smoke tests at 11 instead?");
await ui("press", "--keys", "Enter");
await ui("wait-settle", "--timeout", "60");
await poll(() => evaluate("document.querySelector('[data-own-quote]')?.textContent ?? null"), phrase, "the sent bubble draws the quote");
assert.equal(await evaluate("[...document.querySelectorAll('[data-own-row]')].at(-1).textContent.includes('> ')"), false, "no raw quote marker in the bubble");
await screenshot("sent-quote");
console.log("PASS the sent message shows the quoted words as a quote above the answer");

assert.equal(await evaluate(select), true);
await poll(() => evaluate("Boolean(document.querySelector('[data-selection-quote]'))"), true, "the pill comes back for a new selection");
await ui("press", "--keys", (await evaluate("navigator.platform.includes('Mac')")) ? "Meta+l" : "Control+l");
await poll(() => evaluate(`${field}.value`), `> ${phrase}\n\n`, "the chord quotes the selection too");
console.log("PASS Cmd+L / Ctrl+L quotes the selection");

const consoleResult = await ui("console");
assert.deepEqual((consoleResult.messages as Array<{ type: string }>).filter((message) => message.type === "error"), [], "renderer console has no errors");
console.log(JSON.stringify({ ok: true, handle, evidenceDir, logPath: info.logPath, note: "Fixture remains running for inspection." }, null, 2));
