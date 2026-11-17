// Show it once in the real Browser panel on dusk bot's own Chrome driver, always in a disposable fixture home. The
// fake expense portal and its receipts are served beside the panel, so a task can be shown and done again by hand.
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchVerificationServer } from "./control-dusk.ts";
import { mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";

const executablePath = process.env.DUSK_VERIFY_BROWSER_CHROME;
if (!executablePath) throw new Error("Set DUSK_VERIFY_BROWSER_CHROME to an installed Chrome or Chrome for Testing binary.");
const PORTAL = fileURLToPath(new URL("../server/demo-recorder/fixtures/expense-portal/", import.meta.url));

/** The new engine drives Chrome itself, but the app still asks for agent-browser before it shows a browser: this stands in for it. */
function standInEngine(): string {
  const dir = mkdtempSync(join(tmpdir(), "duskbot-verify-engine-"));
  const path = join(dir, process.platform === "win32" ? "agent-browser.cmd" : "agent-browser");
  writeFileSync(path, process.platform === "win32" ? "@echo agent-browser 0.0.0\r\n" : "#!/bin/sh\necho agent-browser 0.0.0\n");
  chmodSync(path, 0o755);
  return path;
}

const fixture = await launchVerificationServer(process.env, undefined, undefined, { binaryPath: process.env.DUSK_VERIFY_BROWSER_BINARY ?? standInEngine(), executablePath });
const send = (path: string, method: string, body: unknown) => fetch(`${fixture.info.url}${path}`, { method, headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify(body) });
let ui: MountedPreview | undefined;
try {
  const { bots } = await (await fetch(`${fixture.info.url}/api/bots`)).json() as { bots: Array<{ id: string }> };
  await send(`/api/bots/${bots[0]!.id}`, "PATCH", { browser: true });
  ui = await mountPreview(fixture, {
    entry: "/scripts/testing/browser-preview.tsx", route: "/__browser-preview.html", title: "Show it once, isolated",
    extraRoutes: [
      { path: "/__harbor/portal.html", handler(_req, res) { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(readFileSync(join(PORTAL, "portal.html"))); } },
      { path: /^\/__harbor\/receipts\/([\w.-]+)$/, handler(_req, res, match) {
        const name = readdirSync(join(PORTAL, "receipts")).find((each) => each === match?.[1]);
        if (!name) { res.statusCode = 404; res.end("not here"); return; }
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(readFileSync(join(PORTAL, "receipts", name)));
      } },
    ],
  });
  // A bot's browser reaches nothing on this computer unless it is named: only the page served beside the panel.
  await send("/api/config", "PATCH", { features: { browser: true }, browserEngine: { engine: "chrome", egress: { allow: [`127.0.0.1:${new URL(ui.previewUrl).port}`] } } });
  console.log(JSON.stringify({
    ...fixture.info,
    botId: bots[0]!.id,
    previewUrl: ui.previewUrl,
    portal: `${new URL("/__harbor/portal.html", ui.previewUrl).href}?signedIn=1`,
    rearrangedPortal: `${new URL("/__harbor/portal.html", ui.previewUrl).href}?signedIn=1&layout=shifted`,
    receipts: join(PORTAL, "receipts"),
    wholeApp: `DUSK_PORT=${new URL(fixture.info.url).port} DUSK_UI_PORT=5399 pnpm dev`,
  }, null, 2));
  await parkUntilSignal();
} finally {
  await ui?.close();
  await fixture.close();
}
