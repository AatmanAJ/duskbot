export const BACKGROUNDS = { 1: "1-sky.webp", 2: "2-dunes.webp", 3: "3-birches.webp" };

export const INK = "#131316";
export const ACCENT = "#ff3b30";

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

/**
 * Where every shot and label sits on the canvas, in output pixels.
 *
 * `shots` are the raw screenshots' pixel sizes; they are never resampled, so
 * every other measure is given in points and multiplied by `density` (the raw
 * captures' pixels per point).
 *
 * `arrange` "row" puts the shots side by side; "stack" gives them all the same
 * slot, one per animation frame.
 */
export function planLayout({ shots, density = 2, arrange = "row", labelled = false, pad }) {
  if (!shots.length) throw new Error("planLayout needs at least one shot");
  const px = (points) => Math.round(points * density);
  const stacked = arrange === "stack";
  const slotHeight = Math.max(...shots.map((shot) => shot.height));
  const slotWidths = stacked ? [Math.max(...shots.map((shot) => shot.width))] : shots.map((shot) => shot.width);
  const gap = px(POINTS.gap);
  const contentWidth = slotWidths.reduce((sum, width) => sum + width, 0) + gap * (slotWidths.length - 1);
  const labelBlock = labelled ? px(POINTS.labelGap + POINTS.labelHeight) : 0;
  const contentHeight = slotHeight + labelBlock;
  const padding = pad === undefined
    ? Math.min(px(POINTS.maxPad), Math.max(px(POINTS.minPad), Math.round(contentWidth * POINTS.padShare)))
    : px(pad);
  const height = contentHeight + padding * 2;
  const width = Math.max(contentWidth + padding * 2, Math.round(height * POINTS.minAspect));

  let x = Math.round((width - contentWidth) / 2);
  const slots = slotWidths.map((slotWidth) => {
    const slot = { x, width: slotWidth };
    x += slotWidth + gap;
    return slot;
  });
  const placed = shots.map((shot, index) => {
    const slot = slots[stacked ? 0 : index];
    const rect = {
      x: slot.x + Math.round((slot.width - shot.width) / 2),
      y: padding + Math.round((slotHeight - shot.height) / 2),
      width: shot.width,
      height: shot.height,
    };
    const label = labelled
      ? { centerX: slot.x + Math.round(slot.width / 2), y: padding + slotHeight + px(POINTS.labelGap), height: px(POINTS.labelHeight) }
      : null;
    return { rect, label };
  });
  return { width, height, density, radius: px(POINTS.radius), shots: placed };
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
