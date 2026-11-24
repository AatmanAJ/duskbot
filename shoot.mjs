// node shoot.mjs <url> <out.png> [<js act run in page>] [<ready selector or js condition>]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const [url, out, act = "", ready = "true", dump = ""] = process.argv.slice(2);
const CHROME = process.env.SHOOT_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "shoot-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
let port = "";
for (let i = 0; i < 100 && !port; i++) { await delay(100); try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0].trim(); } catch {} }
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((d, f) => { socket.onopen = d; socket.onerror = f; });
let next = 0; const waiting = new Map();
socket.onmessage = (e) => { const m = JSON.parse(String(e.data)); const c = waiting.get(m.id); if (!c) return; waiting.delete(m.id); m.error ? c.f(new Error(m.error.message)) : c.d(m.result); };
const send = (method, params = {}) => new Promise((d, f) => { const id = ++next; waiting.set(id, { d, f }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const until = async (cond, what) => { const end = Date.now() + 30000; while (!(await evaluate(cond).catch(() => false))) { if (Date.now() > end) throw new Error(`${what} never showed`); await delay(250); } };
try {
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url });
  await until(`document.readyState === "complete" && document.querySelectorAll('[data-sidebar-bot-row]').length > 0`, "bot rows");
  await delay(1500);
  if (act) await evaluate(`(async () => { const pause = (ms) => new Promise((d) => setTimeout(d, ms)); ${act}; })()`);
  await until(ready, "ready");
  await delay(900);
  if (dump) console.log(await evaluate(dump));
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(data, "base64"));
  console.log("wrote", out);
} finally { socket.close(); chrome.kill(); await delay(300); rmSync(profile, { recursive: true, force: true }); }
