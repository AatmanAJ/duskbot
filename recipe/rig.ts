import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
const R = process.cwd();
const { launchRestartableServer } = await import(R + "/server/testing/restartable-server.ts");
const { mountPreview } = await import(R + "/scripts/testing/preview-fixture.ts");
const ui = await import(R + "/scripts/testing/control-dusk-ui.ts");
const ctl = process.argv[2]!;
const server = await launchRestartableServer({ dataDirRoot: "/tmp" });
const api = async (method: string, path: string, body?: unknown) => (await fetch(server.url + path, { method, headers: { origin: server.url, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })).json() as any;
await api("PATCH", "/api/config", { language: "en" });
for (const bot of (await api("GET", "/api/bots")).bots.filter((b: any) => b.defaultBot)) await api("PATCH", `/api/bots/${bot.id}`, { welcomed: true });
const created = (await (await fetch(server.url + "/api/bots", { method: "POST", headers: { origin: server.url, "content-type": "application/json" }, body: JSON.stringify({ name: "Pepper", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) })).json()) as any;
const preview = await mountPreview({ info: { url: server.url } }, { entry: "/scripts/testing/threads-preview.tsx", route: "/__threads.html", title: "Isolated dusk bot Chat", logLevel: "warn", hmr: false });
const { binary, chrome } = await ui.ensureUiBrowser(process.env, (l: string) => process.stderr.write(l + "\n"));
const session = { home: server.dataDir, session: `dusk-ui-${server.port}`, chrome };
const env = ui.sessionEnv(session, process.env);
await ui.agentBrowser(binary, env, ["open", preview.previewUrl], 120_000);
const handle = { url: server.url, previewUrl: preview.previewUrl, session: session.session, binary, home: server.dataDir, botId: created.bot.id, logPath: server.logPath, chrome };
writeFileSync(join(server.dataDir, "ui.json"), JSON.stringify(handle, null, 2));
console.log(JSON.stringify({ ...handle, ui: join(server.dataDir, "ui.json") }));
const pid = () => execSync(`lsof -ti tcp:${server.port} -sTCP:LISTEN || true`).toString().trim();
let running = true;
for (;;) {
  await new Promise((r) => setTimeout(r, 300));
  if (!existsSync(ctl)) continue;
  const cmd = readFileSync(ctl, "utf8").trim(); rmSync(ctl);
  try {
    if (cmd === "kill") { const p = pid(); if (p) process.kill(Number(p), "SIGKILL"); console.log("killed", p); }
    else if (cmd === "term") { await server.stop(); console.log("stopped"); }
    else if (cmd === "start") { await server.start(); console.log("started", pid()); }
    else if (cmd === "quit") {
      try { await ui.agentBrowser(binary, env, ["close"], 15_000); } catch {}
      await preview.close(); const p = pid(); if (p) process.kill(Number(p), "SIGKILL");
      await new Promise((r) => setTimeout(r, 500)); rmSync(server.dataDir, { recursive: true, force: true }); console.log("quit"); process.exit(0);
    }
  } catch (e) { console.log("error", String(e)); }
}
