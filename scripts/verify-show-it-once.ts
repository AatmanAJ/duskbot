// Show it once in the real app, always in a disposable fixture: the app's own renderer, a real browser, the fake
// expense portal and a folder of twelve expenses. The fake model's one turn calls skill_replay over that folder, so the
// whole feature can be seen without an AI account: record one expense, save it, ask for the other eleven.
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ExpensePortal } from "../server/demo-recorder/testing/expense-portal.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";
import { launchVerificationServer, runControlDusk } from "./control-dusk.ts";
import { mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";

const binaryPath = process.env.DUSK_VERIFY_BROWSER_BINARY;
const executablePath = process.env.DUSK_VERIFY_BROWSER_CHROME;
if (!binaryPath || !executablePath) throw new Error("Set DUSK_VERIFY_BROWSER_BINARY and DUSK_VERIFY_BROWSER_CHROME to explicit installed binaries.");
const engine = process.argv.includes("--new-browser") ? "chrome" : "agent-browser";
const SKILL = "file-an-expense-report";

const portal = await ExpensePortal.start({ port: Number(process.env.DUSK_VERIFY_PORTAL_PORT) || 0, password: "harbor-demo-2026" });
// Under /tmp like the fixture's own data: the bot's working folder holds the inbox the skill is run over.
const work = mkdtempSync(join(process.platform === "win32" ? process.env.TEMP ?? "." : "/tmp", "duskbot-verify-expenses-"));
const inbox = join(work, "Expenses");
cpSync(fileURLToPath(new URL("../server/testing/fixtures/expense-portal/inbox/", import.meta.url)), inbox, { recursive: true });

// The fake model's turn does what a real one would for each message: first it opens the portal, and once the skill is
// saved it runs the skill over the folder.
const toolsFile = join(work, "fake-model-tools.json");
const OPEN_PORTAL = [{ server: "browser", tool: "agent_browser_open", arguments: { url: portal.url("/login") } }];
const RUN_SKILL = [{ tool: "skill_replay", arguments: { skill: SKILL, folder: inbox, skip: ["expense-01.json"] } }];
writeFileSync(toolsFile, JSON.stringify(OPEN_PORTAL));
const fixture = await launchVerificationServer({
  ...process.env,
  FAKE_CLAUDE_MCP_TOOLS_FILE: toolsFile,
  FAKE_CLAUDE_REPLIES: JSON.stringify([
    "The expense portal is open in my browser. Show me one and I will learn it.",
    "Done. I filed the other 11 expenses from that folder, each from its own file. All 12 reports are in the portal now.",
  ]),
  FAKE_CLAUDE_REPLY_STATE: join(work, "fake-model-replies.state"),
  FAKE_CLAUDE_TOOL_CALLS: "[]",
}, undefined, undefined, { binaryPath, executablePath });
let ui: MountedPreview | undefined;
try {
  const api = (path: string, method: string, body: unknown) => fetch(`${fixture.info.url}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await runControlDusk(["new-bot", "--name", "Tally", "--url", fixture.info.url]);
  const { bots } = await (await fetch(`${fixture.info.url}/api/bots`)).json() as { bots: Array<{ id: string }> };
  const botId = bots[0]!.id;
  // A bot's browser reaches no service on this computer unless it is allowed by name: the portal is this fixture's own.
  await api("/api/config", "PATCH", { language: "en", features: { browser: true }, browserEngine: { engine, egress: { allow: [`127.0.0.1:${portal.port}`] } } });
  await api(`/api/bots/${botId}`, "PATCH", { browser: true, computer: "browser", cwd: work });
  ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__threads.html", title: "Show it once" });
  console.log(JSON.stringify({
    ...fixture.info, botId, engine, previewUrl: ui.previewUrl,
    portal: portal.url("/login"), user: portal.user, password: portal.password, inbox, skill: SKILL,
    say: ["Open the expense portal", "Do the other 11 from this folder"],
  }, null, 2));
  const watch = setInterval(() => {
    void fetch(`${fixture.info.url}/api/bots/${botId}/skills`).then((response) => response.json()).then((body: { skills?: Array<{ name: string }> }) => {
      if (body.skills?.some((skill) => skill.name === SKILL)) writeFileSync(toolsFile, JSON.stringify(RUN_SKILL));
    }).catch(() => undefined);
  }, 1_000);
  await parkUntilSignal();
  clearInterval(watch);
  console.log(JSON.stringify({ filed: portal.filed.map((expense) => `${expense.id} ${expense.merchant} ${expense.amount}`) }, null, 2));
} finally {
  await ui?.close();
  // close --all is scoped to this fixture's HOME, never the operator's.
  await promisify(execFile)(binaryPath, ["close", "--all"], { env: { HOME: fixture.info.dataDir, USERPROFILE: fixture.info.dataDir, PATH: process.env.PATH }, timeout: 15_000 }).catch(() => {});
  await fixture.close();
  await portal.close();
  await removeTempDir(work);
}
