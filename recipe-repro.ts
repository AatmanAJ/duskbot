// node --experimental-strip-types repro.ts REPO OUTDIR — a follow-up typed while the bot is busy and the server is down:
// is its bubble on screen from the moment it is typed until the server's copy lands?
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
const [R, OUT] = process.argv.slice(2) as [string, string];
mkdirSync(OUT, { recursive: true });
const release = join(OUT, "release");
process.env.FAKE_CLAUDE_TOOL_CALLS = JSON.stringify([{ name: "Bash", input: { command: "node export_invoices.js" }, hold: true }]);
process.env.FAKE_CLAUDE_RELEASE = release;
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
const env = ui.sessionEnv({ home: server.dataDir, session: `dr-${server.port}`, chrome }, process.env);
const ab = (args: string[], ms = 60_000) => ui.agentBrowser(binary, env, args, ms);
const t0 = Date.now();
const log = (line: string) => { const s = `${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`; console.log(s); appendFileSync(join(OUT, "timeline.txt"), s + "\n"); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FOLLOW = "Also add the VAT column please";
const shown = async () => String((await ab(["eval", `(() => { const hits = [...document.querySelectorAll('[data-mid]')].filter((el) => el.textContent.includes(${JSON.stringify(FOLLOW)})); if (!hits.length) return "MISSING"; return hits.map((el) => el.getAttribute("data-mid").startsWith("optimistic-") ? "pending" : "server copy").join("+"); })()`])).result);
try {
  await ab(["set", "viewport", "1280", "800", "2"]);
  await ab(["open", preview.previewUrl], 120_000);
  await sleep(4000);
  await ab(["type", '[aria-label="Message Pepper"]', "Export last month's invoices"]);
  await ab(["press", "Enter"]);
  await sleep(6000);
  log("busy: " + (await api("GET", "/api/bots")).bots.find((b: any) => b.id === created.bot.id).busy);
  const pid = execSync(`lsof -ti tcp:${server.port} -sTCP:LISTEN || true`).toString().trim();
  process.kill(Number(pid), "SIGKILL"); log("server killed");
  await sleep(14000);
  await ab(["type", '[aria-label="Message Pepper"]', FOLLOW]);
  await ab(["press", "Enter"]); log("follow-up typed");
  await sleep(1500); log("bubble: " + await shown());
  await ab(["screenshot", join(OUT, "f01-sending.png")]);
  await sleep(16500);
  log("bubble before restart: " + await shown());
  await server.start(); log("server started");
  let shot = 2, last = "";
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const state = await shown();
    log("bubble: " + state);
    if (state !== last && shot < 9) await ab(["screenshot", join(OUT, `f0${shot++}-${state.replace(/\W+/g, "-")}.png`)]);
    if (i === 15) await ab(["screenshot", join(OUT, "at-8s.png")]);
    last = state;
  }
  const out = execSync(`node --experimental-strip-types scripts/control-dusk.ts messages --bot ${created.bot.id} --url ${server.url}`, { cwd: R, encoding: "utf8" });
  const rows = JSON.parse(out).messages as any[];
  writeFileSync(join(OUT, "rows.json"), JSON.stringify(rows, null, 2));
  log(`server rows with the follow-up: ${rows.filter((m) => m.role === "user" && m.text === FOLLOW).length}`);
  await ab(["screenshot", join(OUT, "f09-end.png")]);
} finally {
  writeFileSync(release, "go");
  try { await ab(["close"], 15_000); } catch {}
  await preview.close();
  await server.close().catch(() => {});
  process.exit(0);
}
