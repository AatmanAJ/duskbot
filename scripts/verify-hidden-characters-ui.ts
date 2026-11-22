// Real renderer, server and native Claude permission socket against an explicit control-dusk UI fixture handle
// launched with `--mode hang`. No response is substituted.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runControlDusk } from "./control-dusk.ts";

const handle = process.argv[2];
if (!handle) throw new Error("Usage: node --experimental-strip-types scripts/verify-hidden-characters-ui.ts /path/to/fixture/ui.json");
const ui = (verb: string, ...args: string[]) => runControlDusk(["ui", verb, "--ui", handle, ...args]) as Promise<Record<string, any>>;
const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
const snapshot = async () => (await ui("snapshot")).snapshot as string;
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
const visible = (text: string) => poll(async () => (await snapshot()).includes(text), true, text);
const evidenceDir = resolve(".dusk-scratch/verify-evidence/hidden-characters");
mkdirSync(evidenceDir, { recursive: true });
const screenshot = (name: string) => ui("screenshot", "--out", resolve(evidenceDir, `${name}.png`));
const api = (path: string, init?: { method: string; body: unknown }) => evaluate(`fetch(${JSON.stringify(path)}, ${init
  ? `{ method: ${JSON.stringify(init.method)}, headers: { "content-type": "application/json" }, body: ${JSON.stringify(JSON.stringify(init.body))} }`
  : "undefined"}).then(async (r) => ({ status: r.status, body: await r.json() }))`);

await visible("Message Pepper");
const info = JSON.parse(readFileSync(handle, "utf8")) as { botId: string; home: string; logPath: string };
const rulesPath = `/api/bots/${info.botId}/command-allowlist`;
assert.equal((await api(rulesPath)).body.rules.length, 0, "run this recipe against a fresh UI fixture");
assert.equal((await api(`/api/bots/${info.botId}`, { method: "PATCH", body: { approvalMode: "ask" } })).status, 200);

const dump = join(info.home, "fake-claude-dump.json");
rmSync(dump, { force: true });
await ui("type", "--name", "Message Pepper", "--text", "Tidy the build folder, please.");
await ui("press", "--keys", "Enter");
await poll(async () => existsSync(dump), true, "the fake engine started a turn");
const socketPath = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.dusk.args.at(-1) as string;

const disguised = "rm -rf ./build\u2066 ~/\u2069 # clean\u200b";
const socket = connect(socketPath);
await new Promise<void>((done, fail) => { socket.once("connect", done); socket.once("error", fail); });
const id = randomUUID();
const reply = new Promise<{ behavior: string }>((done, fail) => {
  let buffer = "";
  socket.once("error", fail);
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.includes("\n")) done(JSON.parse(buffer.split("\n")[0]!));
  });
});
socket.write(JSON.stringify({ t: "ask", id, tool: "Bash", input: { command: disguised } }) + "\n");

await visible('image "Hidden character: Left-to-right isolate (U+2066)"');
const tree = await snapshot();
for (const mark of ["Pop directional isolate (U+2069)", "Zero-width space (U+200B)"]) assert.ok(tree.includes(`image "Hidden character: ${mark}"`), mark);
assert.ok(tree.includes("This has 3 hidden characters, marked above."));
const marks = await evaluate("[...document.querySelectorAll('[data-ask-card=approval] [data-hidden-char]')].map((e) => e.textContent)");
assert.deepEqual(marks, ["U+2066", "U+2069", "U+200B"]);
const rawShown = await evaluate("[...document.querySelectorAll('[data-ask-card=approval], [data-approval-row]')].some((e) => /[\\u2066\\u2069\\u200b]/.test(e.textContent))");
assert.equal(rawShown, false, "no hidden character reaches the card's text");
assert.ok(!/Always allow this (?:command|session)/.test(tree), "a disguised command is never offered a saved rule or a session grant");
const threadId = (await api("/api/bots")).body.bots.find((bot: { id: string }) => bot.id === info.botId).threadId as string;
const card = (await api(`/api/threads/${threadId}/messages?limit=50`)).body.messages
  .find((message: { card?: { requestId?: string } }) => message.card?.requestId === id)?.card;
assert.ok(card, "the server holds the card");
assert.equal(card.commandAllowlist, undefined, "the server gave the card no rule to remember");
assert.equal(card.allowSession, undefined, "the server gave the card no session grant");
await screenshot("approval-card");
console.log("PASS the approval card marks each hidden character by name, warns with the count, and offers no saved rule");

const allow = await evaluate("[...document.querySelectorAll('[data-ask-card=approval] button')].map((b) => b.textContent.trim())");
assert.ok(Array.isArray(allow) && allow.includes("Allow once"), `answers: ${JSON.stringify(allow)}`);
await ui("click", "--name", "Allow once");
assert.equal((await reply).behavior, "allow");
socket.destroy();
assert.equal((await api(rulesPath)).body.rules.length, 0);
console.log("PASS Allow runs it once through the real permission socket and saves no rule");

const refused = await api(rulesPath, { method: "POST", body: { command: "git status\u200b --short", cwd: (await api(rulesPath)).body.context.cwd,
  providerInstanceId: (await api(rulesPath)).body.context.providerInstanceId } });
assert.equal(refused.status, 400);
assert.match(refused.body.error, /hidden characters cannot be saved/);
assert.equal((await api(rulesPath)).body.rules.length, 0);
console.log("PASS the allowlist API refuses a hand-entered command with a hidden character, saying why");

const consoleResult = await ui("console");
assert.deepEqual((consoleResult.messages as Array<{ type: string }>).filter((message) => message.type === "error"), [], "renderer console has no errors");
console.log(JSON.stringify({ ok: true, handle, evidenceDir, logPath: info.logPath, note: "Fixture remains running for inspection." }, null, 2));
