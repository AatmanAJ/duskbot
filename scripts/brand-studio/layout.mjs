export const BACKGROUNDS = { 1: "1-sky.webp", 2: "2-dunes.webp", 3: "3-birches.webp" };

export const INK = "#131316";
export const ACCENT = "#ff3b30";

/** How to place several shots on a still; "auto" picks between the other two. */
export const ARRANGEMENTS = ["auto", "row", "stack"];

/** The width GitHub gives a picture in a pull request's description, in CSS pixels. */
export const COLUMN_POINTS = 900;
/** The least a picture may be scaled down in that column before the app's 13-point text stops being readable. */
export const READABLE_SCALE = 0.66;

const POINTS = {
  radius: 12,
  minPad: 72,
  maxPad: 160,
  padShare: 0.085,
  gap: 48,
  labelHeight: 36,
  labelGap: 22,
  minAspect: 4 / 3,
};

const sum = (values) => values.reduce((total, value) => total + value, 0);

function place(shots, arrange, { px, labelled, pad }) {
  const stacked = arrange === "stack";
  const widths = shots.map((shot) => shot.width);
  const heights = shots.map((shot) => shot.height);
  const widest = Math.max(...widths);
  const tallest = Math.max(...heights);
  const gap = px(POINTS.gap);
  const labelHeight = px(POINTS.labelHeight);
  const labelBlock = labelled ? px(POINTS.labelGap) + labelHeight : 0;
  const contentWidth = arrange === "row" ? sum(widths) + gap * (shots.length - 1) : widest;
  const contentHeight = stacked ? sum(heights) + (labelBlock + gap) * shots.length - gap : tallest + labelBlock;
  const padding = pad === undefined
    ? Math.min(px(POINTS.maxPad), Math.max(px(POINTS.minPad), Math.round(contentWidth * POINTS.padShare)))
    : px(pad);
  const readableWidth = px(COLUMN_POINTS / READABLE_SCALE);
  const naturalWidth = contentWidth + padding * 2;
  const height = contentHeight + padding * 2;
  const width = stacked
    ? naturalWidth
    : Math.max(naturalWidth, Math.min(Math.round(height * POINTS.minAspect), readableWidth));
  const left = Math.round((width - contentWidth) / 2);

  let x = left;
  let y = padding;
  const placed = shots.map((shot) => {
    if (stacked) {
      const rect = { x: left + Math.round((widest - shot.width) / 2), y: y + labelBlock, width: shot.width, height: shot.height };
      const label = labelled ? { anchor: "start", x: rect.x, y, height: labelHeight } : null;
      y = rect.y + shot.height + gap;
      return { rect, label };
    }
    const slotWidth = arrange === "row" ? shot.width : widest;
    const rect = { x: x + Math.round((slotWidth - shot.width) / 2), y: padding + Math.round((tallest - shot.height) / 2), width: shot.width, height: shot.height };
    const label = labelled
      ? { anchor: "center", x: x + Math.round(slotWidth / 2), y: padding + tallest + px(POINTS.labelGap), height: labelHeight }
      : null;
    if (arrange === "row") x += slotWidth + gap;
    return { rect, label };
  });
  return { arrange, width, height, readable: naturalWidth <= readableWidth, shots: placed };
}

/**
 * Where every shot and label sits on the canvas, in output pixels.
 *
 * `shots` are the pixel sizes of what is drawn (a raw screenshot, or the part
 * of one a crop keeps); they are never resampled, so every other measure is
 * given in points and multiplied by `density` (the captures' pixels per point).
 *
 * `arrange`: "row" puts the shots side by side with a label under each;
 * "stack" puts them one above the other with a label over each; "auto" is the
 * row while it stays readable in a pull request's column and the stack
 * otherwise; "overlay" gives them all the same slot, one per animation frame.
 *
 * `columnScale` is how far GitHub shrinks the canvas to fit that column.
 */
export function planLayout({ shots, density = 2, arrange = "auto", labelled = false, pad }) {
  if (!shots.length) throw new Error("planLayout needs at least one shot");
  const measures = { px: (points) => Math.round(points * density), labelled, pad };
  let placed;
  if (arrange === "auto") {
    placed = place(shots, "row", measures);
    if (!placed.readable && shots.length > 1) placed = place(shots, "stack", measures);
  } else {
    placed = place(shots, arrange, measures);
  }
  const { readable: _readable, ...layout } = placed;
  const columnScale = Math.min(1, (COLUMN_POINTS * density) / layout.width);
  return { ...layout, density, radius: measures.px(POINTS.radius), columnScale: Math.round(columnScale * 100) / 100 };
}

/**
 * A crop given as "x,y,width,height" in points from the capture's top left
 * corner; null when the text is not four numbers that name a rectangle.
 */
export function parseCrop(text) {
  const parts = String(text).split(",").map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === "")) return null;
  const [x, y, width, height] = parts.map(Number);
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * The pixels of a `shot` that a crop in points keeps. Throws when the crop
 * reaches outside the shot, since drawing it would stretch or leave a hole.
 */
export function cropPixels(crop, shot, density = 2) {
  if (!crop) return { x: 0, y: 0, width: shot.width, height: shot.height };
  const pixels = {
    x: Math.round(crop.x * density),
    y: Math.round(crop.y * density),
    width: Math.round(crop.width * density),
    height: Math.round(crop.height * density),
  };
  if (pixels.x + pixels.width > shot.width || pixels.y + pixels.height > shot.height) {
    const size = `${shot.width / density} × ${shot.height / density}`;
    throw new Error(`crop ${crop.x},${crop.y},${crop.width},${crop.height} reaches outside a ${size} point capture`);
  }
  return pixels;
}

/**
 * The frames of a looping animation over `count` states: each state holds,
 * then cross-fades into the next, and the last fades back into the first.
 * `mix` is how far the frame has moved from state `from` to state `to`.
 */
export function planTimeline({ count, holdMs = 1400, fadeMs = 320, fadeSteps = 4 }) {
  if (count < 2) throw new Error("an animation needs at least two frames");
  const frames = [];
  const steps = fadeMs > 0 ? fadeSteps : 0;
  for (let from = 0; from < count; from += 1) {
    const to = (from + 1) % count;
    frames.push({ from, to, mix: 0, delayMs: holdMs });
    for (let step = 1; step <= steps; step += 1) {
      frames.push({ from, to, mix: step / (steps + 1), delayMs: Math.round(fadeMs / steps) });
    }
  }
  return frames;
}
