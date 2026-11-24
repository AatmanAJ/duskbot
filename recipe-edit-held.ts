// node --experimental-strip-types recipe-edit.ts REPO OUTDIR — the last message edited with its POST held in the page while
// the server restarts, so the reconnect snapshot (old answer as leaf) lands first: is the edit ever drawn under the old answer before its server copy lands?
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
const [R, OUT] = process.argv.slice(2) as [string, string];
mkdirSync(OUT, { recursive: true });
const { launchRestartableServer } = await import(R + "/server/testing/restartable-server.ts");
const { mountPreview } = await import(R + "/scripts/testing/preview-fixture.ts");
const ui = await import(R + "/scripts/testing/control-dusk-ui.ts");
const server = await launchRestartableServer({ dataDirRoot: "/tmp" });
const api = async (method: string, path: string, body?: unknown) => (await fetch(server.url + path, { method, headers: { origin: server.url, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).json() as any;
await api("PATCH", "/api/config", { language: "en" });
for (const bot of (await api("GET", "/api/bots")).bots.filter((b: any) => b.defaultBot)) await api("PATCH", `/api/bots/${bot.id}`, { welcomed: true });
const created = await api("POST", "/api/bots", { name: "Pepper", color: "orange", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
await api("PATCH", `/api/bots/${created.bot.id}`, { color: "orange" });
const preview = await mountPreview({ info: { url: server.url } }, { entry: "/scripts/testing/threads-preview.tsx", route: "/__threads.html", title: "Isolated dusk bot Chat", logLevel: "warn", hmr: false });
const { binary, chrome } = await ui.ensureUiBrowser(process.env, (l: string) => process.stderr.write(l + "\n"));
const env = ui.sessionEnv({ home: server.dataDir, session: `de-${server.port}`, chrome }, process.env);
const ab = (args: string[], ms = 60_000) => ui.agentBrowser(binary, env, args, ms);
const t0 = Date.now();
const log = (line: string) => { const s = `${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`; console.log(s); appendFileSync(join(OUT, "timeline.txt"), s + "\n"); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ASK = "Export last month's invoices";
const EDIT = "Export this month's invoices instead";
const probe = `(() => {
  const rows = [...document.querySelectorAll('[data-mid]')];
  const edit = rows.filter((el) => el.textContent.includes(${JSON.stringify(EDIT)}));
  const old = rows.some((el) => el.textContent.includes(${JSON.stringify(ASK)}));
  const kind = edit.length ? edit.map((el) => el.getAttribute("data-mid").startsWith("optimistic-") ? "pending" : "server copy").join("+") : "MISSING";
  return "edit " + kind + (old ? ", old question shown" : ", old question hidden") + (edit.length && old ? " (UNDER OLD ANSWER)" : "");
})()`;
const shown = async () => String((await ab(["eval", probe])).result);
const slug = (state: string) => state.replace(/[^a-z]+/gi, "-");
try {
  await ab(["set", "viewport", "1280", "800", "2"]);
  await ab(["open", preview.previewUrl], 120_000);
  await sleep(4000);
  await ab(["type", '[aria-label="Message Pepper"]', ASK]);
  await ab(["press", "Enter"]);
  await sleep(6000);
  log("busy: " + (await api("GET", "/api/bots")).bots.find((b: any) => b.id === created.bot.id).busy + "; " + await shown());
  await ab(["eval", `(() => { const real = window.fetch.bind(window); window.fetch = (input, init) => (init && init.method === "POST" && String(input).includes("/messages")) ? new Promise((r) => setTimeout(r, 10000)).then(() => real(input, init)) : real(input, init); return "held"; })()`]);
  await ab(["click", '[aria-label="Message Pepper"]']);
  await ab(["press", "ArrowUp"]);
  await sleep(500);
  await ab(["fill", "textarea:not([aria-label])", EDIT]);
  await ab(["press", "Enter"]); log("edit sent (its POST held 10 s in the page)");
  await sleep(500); log(await shown());
  await ab(["screenshot", join(OUT, "e01-sending.png")]);
  const pid = execSync(`lsof -ti tcp:${server.port} -sTCP:LISTEN || true`).toString().trim();
  process.kill(Number(pid), "SIGKILL"); log("server killed");
  await sleep(1500);
  await server.start(); log("server started");
  let shot = 2, last = "";
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const state = await shown();
    log(state);
    if (state !== last && shot < 9) await ab(["screenshot", join(OUT, `e0${shot++}-${slug(state)}.png`)]);
    last = state;
  }
  const out = execSync(`node --experimental-strip-types scripts/control-dusk.ts messages --bot ${created.bot.id} --url ${server.url}`, { cwd: R, encoding: "utf8" });
  const rows = JSON.parse(out).messages as any[];
  writeFileSync(join(OUT, "rows.json"), JSON.stringify(rows, null, 2));
  log(`server rows with the edit: ${rows.filter((m) => m.role === "user" && m.text === EDIT).length}`);
} finally {
  try { await ab(["close"], 15_000); } catch {}
  await preview.close();
  await server.close().catch(() => {});
  process.exit(0);
}
