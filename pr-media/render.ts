// Renders the PR's media from pr-media/scenes/*.html on a virtual clock: every frame is stepped, never filmed in real time.
//   node --experimental-strip-types pr-media/render.ts <scene> [--still] [--at SECONDS] [--scale 2]
// An animated scene writes pr-media/out/<scene>.mp4 (silent, 1920x1080) and pr-media/out/<scene>.gif (960 wide);
// --still writes pr-media/out/<scene>.png at --scale (default 2) and the time --at (default the scene's `still`).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { launch } from "./capture/cdp.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  still: { type: "boolean", default: false }, at: { type: "string" }, scale: { type: "string", default: "2" },
  fps: { type: "string", default: "30" }, gifOnly: { type: "boolean", default: false }, hash: { type: "string" }, name: { type: "string" }, gifFps: { type: "string", default: "20" }, gifWidth: { type: "string", default: "960" },
} });
const scene = positionals[0];
if (!scene) throw new Error("name a scene");
const file = join(HERE, "scenes", `${scene}.html`);
const [w, h] = (readFileSync(file, "utf8").match(/<meta name="stage" content="(\d+)x(\d+)"/)?.slice(1) ?? ["1920", "1080"]).map(Number);
const out = join(HERE, "out");
mkdirSync(out, { recursive: true });

const chrome = await launch();
try {
  const scale = values.still ? Number(values.scale) : 1920 / w;
  const tab = await chrome.tab(w, h, scale);
  await tab.goto(pathToFileURL(file).href + (values.hash ? `#${values.hash}` : ""));
  await tab.evaluate("document.fonts.ready.then(() => true)");
  const info = await tab.evaluate<{ duration: number; still?: number } | null>("window.SCENE ? { duration: SCENE.duration, still: SCENE.still } : null");
  if (!info) throw new Error(`${scene} sets no window.SCENE`);
  if (values.still) {
    const at = Number(values.at ?? info.still ?? info.duration);
    await tab.evaluate(`(() => { let t = 0; while (t < ${at * 1000}) { __step(Math.min(1000 / 60, ${at * 1000} - t)); t += 1000 / 60; } return true; })()`);
    const png = join(out, `${values.name ?? scene}.png`);
    await tab.shot(png);
    console.log(JSON.stringify({ png, size: [w * scale, h * scale], at }));
  } else {
    const fps = Number(values.fps), frames = Math.round(info.duration * fps);
    const dir = join(HERE, "frames", scene);
    if (!values.gifOnly) {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      await tab.evaluate("__step(0)");
      for (let i = 0; i < frames; i++) {
        await tab.shot(join(dir, `f${String(i).padStart(5, "0")}.png`));
        await tab.evaluate(`__step(${1000 / fps})`);
      }
    }
    const mp4 = join(out, `${scene}.mp4`), gif = join(out, `${scene}.gif`);
    if (!values.gifOnly) execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(fps), "-i", join(dir, "f%05d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", "16",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
    // Every scene opens and closes on a full dissolve, so the GIF can start on its key frame and still loop without a seam:
    // a paused GIF (reduced motion) then shows that frame, not the dissolve.
    const shots = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    const first = Math.min(shots.length - 1, Math.round((info.still ?? 0) * fps));
    const loop = join(HERE, "frames", `${scene}.gif-order`);
    rmSync(loop, { recursive: true, force: true });
    mkdirSync(loop);
    shots.forEach((_, i) => symlinkSync(join(dir, shots[(first + i) % shots.length]), join(loop, `f${String(i).padStart(5, "0")}.png`)));
    // flat colour and pixel art: no dithering, a palette per clip, only changed rectangles stored
    const gw = Number(values.gifWidth), gfps = Number(values.gifFps);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(fps), "-i", join(loop, "f%05d.png"), "-vf",
      `fps=${gfps},scale=${gw}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, "-loop", "0", gif]);
    rmSync(loop, { recursive: true, force: true });
    const size = (f: string) => Number(execFileSync("stat", ["-f", "%z", f], { encoding: "utf8" }));
    console.log(JSON.stringify({ frames, mp4, mp4Bytes: size(mp4), gif, gifBytes: size(gif) }));
  }
} finally {
  await chrome.close();
}
