import { encodeGif } from "./gif.mjs";
import { ACCENT, INK, cropPixels, planLayout, planTimeline } from "./layout.mjs";

const LABEL_FONT = "studio-label";

const load = async (url) => createImageBitmap(await (await fetch(url)).blob());

function roundedPath(ctx, { x, y, width, height }, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawBackground(ctx, background, width, height) {
  const scale = Math.max(width / background.width, height / background.height);
  const drawn = { width: background.width * scale, height: background.height * scale };
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(background, (width - drawn.width) / 2, (height - drawn.height) / 2, drawn.width, drawn.height);
}

function drawShot(ctx, shot, source, rect, layout) {
  const { density, radius } = layout;
  for (const shadow of [
    { blur: 90, offset: 36, alpha: 0.3 },
    { blur: 14, offset: 4, alpha: 0.16 },
  ]) {
    ctx.save();
    ctx.shadowColor = `rgba(19, 19, 22, ${shadow.alpha})`;
    ctx.shadowBlur = shadow.blur * density;
    ctx.shadowOffsetY = shadow.offset * density;
    ctx.fillStyle = INK;
    roundedPath(ctx, rect, radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  roundedPath(ctx, rect, radius);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(shot, source.x, source.y, source.width, source.height, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(19, 19, 22, 0.14)";
  ctx.lineWidth = density;
  roundedPath(ctx, { x: rect.x - density / 2, y: rect.y - density / 2, width: rect.width + density, height: rect.height + density }, radius + density / 2);
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx, text, label, layout, lit) {
  const { density } = layout;
  const dot = 8 * density;
  const inset = 15 * density;
  const dotGap = 8 * density;
  ctx.save();
  ctx.font = `500 ${15 * density}px "${LABEL_FONT}", ui-monospace, monospace`;
  ctx.textBaseline = "middle";
  const textWidth = Math.ceil(ctx.measureText(text).width);
  const width = inset * 2 + textWidth + (lit ? dot + dotGap : 0);
  const x = label.anchor === "center" ? Math.round(label.x - width / 2) : label.x;
  ctx.fillStyle = INK;
  roundedPath(ctx, { x, y: label.y, width, height: label.height }, label.height / 2);
  ctx.fill();
  let cursor = x + inset;
  const middle = label.y + label.height / 2;
  if (lit) {
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(cursor + dot / 2, middle, dot / 2, 0, Math.PI * 2);
    ctx.fill();
    cursor += dot + dotGap;
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cursor, middle + density / 2);
  ctx.restore();
}

function canvasOf(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) };
}

async function toBase64(bytes) {
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes]));
  });
  return url.slice(url.indexOf(",") + 1);
}

/**
 * Renders one job and answers the encoded file as base64.
 *
 * A "still" puts every shot on one PNG, side by side or stacked; an
 * "animation" gives each shot a frame of a looping GIF.
 */
async function render(job) {
  const font = new FontFace(LABEL_FONT, `url(${job.fontUrl})`);
  document.fonts.add(await font.load());
  const background = await load(job.backgroundUrl);
  const shots = await Promise.all(job.shotUrls.map(load));
  const labelled = job.labels.length > 0;
  const animated = job.kind === "animation";
  const sources = shots.map((shot, index) => cropPixels(job.crops[index], shot, job.density));
  const layout = planLayout({
    shots: sources,
    density: job.density,
    arrange: animated ? "overlay" : job.arrange,
    labelled,
    pad: job.pad ?? undefined,
  });
  const lastIndex = shots.length - 1;
  const paint = (ctx, indexes) => {
    drawBackground(ctx, background, layout.width, layout.height);
    for (const index of indexes) {
      const placed = layout.shots[index];
      drawShot(ctx, shots[index], sources[index], placed.rect, layout);
      if (labelled && job.labels[index]) drawLabel(ctx, job.labels[index], placed.label, layout, animated || index === lastIndex);
    }
  };

  if (!animated) {
    const { canvas, ctx } = canvasOf(layout.width, layout.height);
    paint(ctx, shots.map((_, index) => index));
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { width: layout.width, height: layout.height, arrange: layout.arrange, columnScale: layout.columnScale, base64: await toBase64(png) };
  }

  const scale = Math.min(1, job.gifWidth / layout.width);
  const width = Math.round(layout.width * scale);
  const height = Math.round(layout.height * scale);
  const states = shots.map((_, index) => {
    const full = canvasOf(layout.width, layout.height);
    paint(full.ctx, [index]);
    const small = canvasOf(width, height);
    small.ctx.imageSmoothingQuality = "high";
    small.ctx.drawImage(full.canvas, 0, 0, width, height);
    return small.canvas;
  });
  const mixer = canvasOf(width, height);
  const frames = planTimeline({ count: shots.length, holdMs: job.holdMs, fadeMs: job.fadeMs }).map(({ from, to, mix, delayMs }) => {
    mixer.ctx.globalAlpha = 1;
    mixer.ctx.drawImage(states[from], 0, 0);
    mixer.ctx.globalAlpha = mix;
    mixer.ctx.drawImage(states[to], 0, 0);
    return { rgba: mixer.ctx.getImageData(0, 0, width, height).data, delayMs };
  });
  const gif = encodeGif({ width, height, frames });
  return { width, height, frames: frames.length, base64: await toBase64(gif) };
}

window.brandStudio = { render };
