import { app, BrowserWindow, net, protocol } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const LABEL_FONT = fileURLToPath(new URL("../../apps/site/public/landing/fonts/geist-mono.woff2", import.meta.url));
const PAGE_FILES = ["compositor.html", "compositor.mjs", "gif.mjs", "layout.mjs"];

const [workDir] = process.argv.slice(2);
const { jobs } = JSON.parse(readFileSync(join(workDir, "jobs.json"), "utf8"));
const finish = (result) => {
  writeFileSync(join(workDir, "result.json"), JSON.stringify(result));
  app.exit(result.ok ? 0 : 1);
};
// An uncaught error would open Electron's modal error box and stall the run.
process.on("uncaughtException", (error) => finish({ ok: false, error: String(error?.stack ?? error) }));

app.setPath("userData", join(workDir, "profile"));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: "studio", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

async function run() {
  app.dock?.hide();

  let served = [];
  protocol.handle("studio", (request) => {
    const { pathname } = new URL(request.url);
    const name = pathname.slice(1);
    if (PAGE_FILES.includes(name)) return net.fetch(pathToFileURL(join(HERE, name)).href);
    if (name === "label-font") return net.fetch(pathToFileURL(LABEL_FONT).href);
    const file = served[Number(name.replace(/^file\//, ""))];
    return file ? net.fetch(pathToFileURL(file).href) : new Response("not found", { status: 404 });
  });

  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => { if (event.level === "error") console.error(`compositor: ${event.message}`); });
  await window.loadURL("studio://app/compositor.html");

  const written = [];
  try {
    for (const job of jobs) {
      served = [job.background, ...job.shots];
      const pageJob = {
        kind: job.kind,
        backgroundUrl: "studio://app/file/0",
        shotUrls: job.shots.map((_, index) => `studio://app/file/${index + 1}`),
        fontUrl: "studio://app/label-font",
        labels: job.labels,
        crops: job.crops,
        arrange: job.arrange,
        density: job.density,
        pad: job.pad,
        gifWidth: job.gifWidth,
        holdMs: job.holdMs,
        fadeMs: job.fadeMs,
      };
      const { base64, ...measured } = await window.webContents.executeJavaScript(`window.brandStudio.render(${JSON.stringify(pageJob)})`);
      const bytes = Buffer.from(base64, "base64");
      writeFileSync(job.out, bytes);
      written.push({ out: job.out, kind: job.kind, bytes: bytes.length, ...measured });
    }
    finish({ ok: true, written });
  } catch (error) {
    finish({ ok: false, error: String(error?.stack ?? error), written });
  }
}

app.whenReady().then(run).catch((error) => finish({ ok: false, error: String(error?.stack ?? error) }));
