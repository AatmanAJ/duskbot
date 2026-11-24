// Desktop-mode fake-engine fixture (the server runs as the desktop app's own, owner token) with the invented Grok Bot
// profile planted in its temporary home, the whole app mounted, and a handle for the capture helpers' browser.
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVerificationServer, verificationHome } from "../../scripts/control-dusk.ts";
import { mountPreview, parkUntilSignal, type MountedPreview } from "../../scripts/testing/preview-fixture.ts";

const owner = randomBytes(32).toString("base64url");
const env = { ...process.env, DUSK_TEST_DESKTOP_OWNER_TOKEN: owner };
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => realFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-dusk-desktop-owner": owner } });
const fixture = await launchVerificationServer(env);
const home = verificationHome(env, fixture.info.dataDir);
execFileSync("zsh", [process.env.PLANT!, home], { stdio: "ignore" });
await fetch(`${fixture.info.url}/api/config`, { method: "PATCH", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify({ language: "en" }) });
let ui: MountedPreview | undefined;
try {
  ui = await mountPreview(fixture, { entry: "/scripts/testing/bot-move-preview.tsx", route: "/__bot-move.html", title: "Isolated bot move",
    proxyHeaders: { "x-dusk-desktop-owner": owner }, hmr: false, logLevel: "warn" });
  const handle = join(fixture.info.dataDir, "ui.json");
  writeFileSync(handle, JSON.stringify({ binary: process.env.AB_BIN, chrome: process.env.AB_CHROME, home: fixture.info.dataDir,
    session: `dusk-desk-${new URL(fixture.info.url).port}`, previewUrl: ui.previewUrl, url: fixture.info.url }), { mode: 0o600 });
  writeFileSync(join(fixture.info.dataDir, "owner"), owner, { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, ui: handle, url: fixture.info.url, previewUrl: ui.previewUrl, dataDir: fixture.info.dataDir }, null, 2));
  await parkUntilSignal();
} finally {
  await ui?.close();
  await fixture.close();
}
