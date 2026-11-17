// Every screen of the first run, numbered, for the free path (bots on this computer) and the dusk cloud path (this
// computer's window, then the new cloud's own first run), on an isolated fake-engine server
// (scripts/testing/ai-once-preview.tsx). A screen is photographed only when the run lands on it, so the numbers are the
// screens the person sees. Run: node --experimental-strip-types scripts/verify-ai-once.ts <dir>
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchVerificationServer } from "./control-dusk.ts";
import { openHeadlessChrome } from "./testing/headless-chrome.ts";
import { mountPreview } from "./testing/preview-fixture.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: verify-ai-once.ts <dir>");

let signedIn = ["codex", "claude", "grok"];
async function instances(url: string, req: IncomingMessage, res: ServerResponse) {
  const response = await fetch(`${url}${req.url}`, { headers: { accept: "application/json", cookie: req.headers.cookie ?? "" } });
  const body = await response.json() as { instances: Array<Record<string, any>> };
  const base = body.instances.find((instance) => instance.instanceId === "claude") ?? body.instances[0]!;
  const mine = (id: string, driverKind: string, displayName: string) => body.instances.find((instance) => instance.instanceId === id)
    ?? { ...base, instanceId: id, driverKind, displayName };
  const listed = [mine("codex", "codex", "ChatGPT"), mine("claude", "claudeAgent", "Claude"), mine("grok", "grokAgent", "Grok")]
    .map((instance) => ({ ...instance, enabled: true, snapshot: { ...instance.snapshot, state: "available", authenticated: signedIn.includes(instance.instanceId) } }));
  const rest = body.instances.filter((instance) => !["codex", "claude", "grok"].includes(instance.instanceId))
    .map((instance) => ({ ...instance, snapshot: { ...instance.snapshot, authenticated: false } }));
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ...body, instances: [...listed, ...rest] }));
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const fixture = await launchVerificationServer();
const ui = await mountPreview(fixture, {
  entry: "/scripts/testing/ai-once-preview.tsx", route: "/__ai-once.html", title: "First run", logLevel: "warn", hmr: false,
  extraRoutes: [{ path: "/api/instances", method: "GET", handler: (req, res) => instances(fixture.info.url, req, res) }],
});
const profile = mkdtempSync(join(tmpdir(), "dusk-ai-once-"));
const page = await openHeadlessChrome(profile);

/** One journey: each [side, beat, cloud picked] the run might show, in order; the ones it lands on, numbered. */
async function journey(name: string, beats: Array<[side: string, beat: string, cloud: boolean]>) {
  mkdirSync(join(out!, name), { recursive: true });
  let n = 0;
  const seen: string[] = [];
  for (const [side, beat, cloud] of beats) {
    signedIn = side === "cloud" ? ["codex", "grok"] : ["codex", "claude", "grok"];
    await page.send("Page.navigate", { url: `${ui.previewUrl}?side=${side}&beat=${beat}${cloud ? "&cloud=1" : ""}` });
    await page.until(`document.querySelector('[data-welcome]') !== null`, 60_000);
    await pause(1800);
    if (await page.evaluate(`document.querySelector('[data-welcome]').dataset.welcome`) !== beat) continue;
    const file = `${String(++n).padStart(2, "0")}-${side === "cloud" ? "on-cloud-" : ""}${beat}.png`;
    writeFileSync(join(out!, name, file), await page.capture());
    seen.push(file);
  }
  console.log(name, seen.join(" "), `| AI screens: ${seen.filter((file) => file.endsWith("-ai.png")).length}`);
}

try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 2, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  const desktopBeats = ["welcome", "account", "place", "checkout", "ai", "bring", "phone", "making", "permissions"];
  await journey("free", desktopBeats.map((beat) => ["desktop", beat, false]));
  await journey("cloud", [
    ...desktopBeats.map((beat): [string, string, boolean] => ["desktop", beat, !["welcome", "account", "place"].includes(beat)]),
    ...desktopBeats.map((beat): [string, string, boolean] => ["cloud", beat, false]),
  ]);
} finally {
  page.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await ui.close();
  await fixture.close();
}
