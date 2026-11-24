// CDP helper for the dev app page (--remote-debugging-port=20460). node cdp.mjs list | shot <match> <out.png> | eval <match> <js> | click <match> <text> | key <match> <key>
import fs from "node:fs";
const base = "http://127.0.0.1:20460";
const [cmd, match, ...rest] = process.argv.slice(2);
const pages = await (await fetch(base + "/json/list")).json();
if (cmd === "list") { for (const p of pages) console.log(p.id.slice(0, 8), p.type, JSON.stringify(p.title), p.url.slice(0, 90)); process.exit(0); }
const page = pages.find((p) => p.type === "page" && (p.id.startsWith(match) || p.url.includes(match) || p.title === match));
if (!page) { console.error("no page", match); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description } : r.result?.result?.value; };
if (cmd === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(rest[0], Buffer.from(r.result.data, "base64")); console.log("saved", rest[0]);
} else if (cmd === "eval") {
  console.log(JSON.stringify(await evalJs(rest.join(" ")), null, 1));
} else if (cmd === "click") {
  const text = rest.join(" ");
  console.log(JSON.stringify(await evalJs(`(() => { const want = ${JSON.stringify(text)}; const els = [...document.querySelectorAll('button,[role=button],a,[role=menuitem],[role=tab],label,[role=option],[role=switch]')].filter(e => e.offsetParent !== null || e.getClientRects().length); const el = els.find(e => (e.innerText||e.getAttribute('aria-label')||'').trim() === want) || els.find(e => (e.innerText||e.getAttribute('aria-label')||'').trim().startsWith(want)) || els.find(e => (e.innerText||e.getAttribute('aria-label')||'').includes(want)); if (!el) return 'not found: ' + els.map(e => (e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,40)).filter(Boolean).join(' | '); el.click(); return 'clicked ' + (el.innerText||el.getAttribute('aria-label')).trim().slice(0,80); })()`)));
} else if (cmd === "text") {
  console.log(await evalJs(`document.body.innerText`));
} else if (cmd === "type") {
  await send("Input.insertText", { text: rest.join(" ") }); console.log("typed");
} else if (cmd === "key") {
  const key = rest[0]; const code = { Enter: 13, Escape: 27, Tab: 9 }[key] ?? 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code, code: key });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code, code: key }); console.log("key", key);
}
ws.close(); process.exit(0);
