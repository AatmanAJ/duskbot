// Renders the motion lab: every scene at speeds a, b and c side by side, frame by frame at 60 fps in headless Chrome,
// into mp4 clips, a live page and an index. Run: node scripts/motion-lab/record.mjs <out dir> [scene ...]
// Needs ffmpeg on PATH; Chrome is DUSK_CDP_CHROME, else the installed Google Chrome, in a throwaway profile.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { writeIndex } from "./index-page.mjs";

const out = resolve(process.argv[2] ?? "motion-lab-out");
const only = process.argv.slice(3);
const CHROME = process.env.DUSK_CDP_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FPS = 60;
const SCENES = [
  ["push", ["phone"], "Open and close a chat"],
  ["sheet", ["phone"], "A sheet opening and closing"],
  ["overlay", ["desktop"], "A menu, then a dialog, opening and closing"],
  ["reply", ["phone", "desktop"], "The working line giving way to the reply"],
  ["error", ["phone", "desktop"], "The error card coming in and leaving"],
  ["send", ["phone", "desktop"], "Sending: the bubble out of the composer"],
  ["sidebar", ["desktop"], "The sidebar closing to avatars and opening again"],
].filter(([name]) => !only.length || only.includes(name));

mkdirSync(out, { recursive: true });
const bundle = await build({ entryPoints: [new URL("./entry.ts", import.meta.url).pathname], bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error" });
const page = `<!doctype html><meta charset="utf-8"><title>motion lab</title><body><script>${bundle.outputFiles[0].text.replace(/<\/script/g, "<\\/script")}</script>`;
const live = join(out, "live.html");
writeFileSync(live, page);

const profile = mkdtempSync(join(tmpdir(), "motion-lab-"));
const chrome = spawn(CHROME, ["--headless=new", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic",
  "--allow-file-access-from-files", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
try {
  let port = "";
  for (let i = 0; i < 100 && !port; i++) {
    await delay(100);
    try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0].trim(); } catch {}
  }
  if (!port) throw new Error("Chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let next = 0;
  const waiting = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    const call = waiting.get(message.id);
    if (!call) return;
    waiting.delete(message.id);
    if (message.error) call.fail(new Error(message.error.message)); else call.done(message.result);
  };
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = ++next;
    waiting.set(id, { done, fail });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  await send("Page.enable");

  const clips = [];
  for (const [scene, sizes, title] of SCENES) {
    for (const size of sizes) {
      const scale = size === "phone" ? 2 : 1.5;
      await send("Emulation.setDeviceMetricsOverride", { width: 2400, height: 1100, deviceScaleFactor: scale, mobile: false });
      await send("Page.navigate", { url: `${pathToFileURL(live).href}?scene=${scene}&size=${size}&capture=1` });
      let lab = null;
      for (let i = 0; i < 100 && !lab; i++) { await delay(50); lab = await evaluate("window.lab && { duration: lab.duration, width: lab.width, height: lab.height }").catch(() => null); }
      if (!lab) throw new Error(`${scene} ${size} never mounted`);
      await send("Emulation.setDeviceMetricsOverride", { width: lab.width, height: lab.height, deviceScaleFactor: scale, mobile: false });
      const frames = join(out, `.frames-${scene}-${size}`);
      rmSync(frames, { recursive: true, force: true });
      mkdirSync(frames);
      const count = Math.ceil((lab.duration / 1000) * FPS);
      for (let i = 0; i <= count; i++) {
        await evaluate(`lab.seek(${(i * 1000) / FPS})`);
        const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: lab.width, height: lab.height, scale: 1 } });
        writeFileSync(join(frames, `${String(i).padStart(4, "0")}.png`), Buffer.from(shot.data, "base64"));
      }
      const file = `${scene}-${size}.mp4`;
      const encoded = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "%04d.png"),
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", join(out, file)], { stdio: ["ignore", "inherit", "inherit"] });
      if (encoded.status !== 0) throw new Error(`ffmpeg failed on ${file}`);
      rmSync(frames, { recursive: true, force: true });
      clips.push({ scene, size, title, file, frames: count + 1 });
      console.log(`${file}: ${count + 1} frames, ${Math.round(lab.duration)} ms`);
    }
  }
  writeFileSync(join(out, "clips.json"), JSON.stringify(clips, null, 2));
  if (!only.length) writeIndex(out, clips);
  socket.close();
} finally {
  const exited = new Promise((done) => chrome.once("exit", done));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
