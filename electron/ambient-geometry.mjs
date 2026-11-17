// Where the notch island and the bot dock sit on a display. Pure math on electron's Display shape, so it is tested
// without electron. Electron reports no safe area, so a notch is read from the menu bar: on a notched Mac the menu
// bar is exactly as tall as the notch (37 to 38 pt at the default scale, 24 to 25 pt on a Mac without one).

export const ISLAND_SIZES = Object.freeze({
  small: Object.freeze({ side: 34, pill: 184, pillHeight: 30, tile: 18 }),
  medium: Object.freeze({ side: 42, pill: 208, pillHeight: 34, tile: 20 }),
  large: Object.freeze({ side: 52, pill: 236, pillHeight: 38, tile: 24 }),
});
export const ISLAND_SIZE_IDS = Object.freeze(Object.keys(ISLAND_SIZES));
/** The window holds the panel at its largest, transparent and click-through outside the island's shape. */
export const ISLAND_WINDOW = Object.freeze({ width: 560, height: 680 });
/** A pill floats this far below the top of a display without a notch. */
export const PILL_TOP = 6;
const NOTCH_MIN_MENU_BAR = 30;
const NOTCH_FALLBACK_HEIGHT = 37;
/** Notch width over its height, measured on the 14 and 16 inch MacBook Pro (about 185 x 32 pt at the default scale,
 * with a 37 pt menu bar): erring wide keeps the island from ever being smaller than the notch. */
const NOTCH_ASPECT = 5.2;

/** The bot dock: a column of mascots `column` wide, rows `cell` tall, in a window `open` wide so its chat card fits beside it. Its window runs
 * `overhang` past the screen's edge, so no rounding of the window's place or of the slide ever shows a seam there. */
export const DOCK = Object.freeze({ cell: 56, tile: 36, column: 64, open: 404, pad: 8, ear: 18, sliver: 6, margin: 28, overhang: 4 });
export const DISPLAY_CHOICES = Object.freeze(["active", "built-in", "main"]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rect = value => value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.width) && Number.isFinite(value.height);

/** The camera housing at the top of a built-in display, or null. */
export function notchOf(display, platform) {
  if (platform !== "darwin" || !display || display.internal !== true || !rect(display.bounds) || !rect(display.workArea)) return null;
  const menuBar = Math.max(0, display.workArea.y - display.bounds.y);
  // an auto-hidden menu bar leaves no room to measure: the panel's name says whether it has the notch
  const notched = menuBar >= NOTCH_MIN_MENU_BAR || (menuBar === 0 && /liquid retina/i.test(String(display.label ?? "")));
  if (!notched) return null;
  const height = menuBar >= NOTCH_MIN_MENU_BAR ? menuBar : NOTCH_FALLBACK_HEIGHT;
  return { width: clamp(Math.round(height * NOTCH_ASPECT), 160, 260), height };
}

/** The island window's bounds and the collapsed shape inside it: hugging the notch, or a floating pill. */
export function islandLayout(display, { platform, size = "medium" } = {}) {
  const s = ISLAND_SIZES[size] ?? ISLAND_SIZES.medium;
  const { bounds } = display;
  const notch = notchOf(display, platform);
  const width = ISLAND_WINDOW.width, height = ISLAND_WINDOW.height;
  const window = { x: Math.round(bounds.x + (bounds.width - width) / 2), y: bounds.y, width, height };
  const collapsed = notch
    ? { kind: "notch", width: notch.width + 2 * s.side, height: notch.height, top: 0, notch: notch.width }
    : { kind: "pill", width: s.pill, height: s.pillHeight, top: PILL_TOP, notch: 0 };
  return { window, collapsed, tile: s.tile, size: ISLAND_SIZES[size] ? size : "medium" };
}

/** macOS keeps a few points of the work area free on the side of an auto-hidden Dock (Windows does the same for an
 * auto-hidden taskbar); a Dock that shows is always wider than this. */
const HIDDEN_DOCK_STRIP = 12;

/** Where the dock's column meets the screen: the display's right edge, or the left side of a Dock showing there. */
export function dockEdge(display) {
  const area = display.workArea, screen = display.bounds;
  const right = area.x + area.width;
  if (!rect(screen)) return right;
  const screenRight = screen.x + screen.width;
  return screenRight - right < HIDDEN_DOCK_STRIP ? screenRight : right;
}

/** The dock window: a strip against the right edge of the screen (left of a Dock pinned right), as tall as the work
 * area, so the body grows with what it shows; its page draws the body centred and lets clicks through everywhere else. */
export function dockLayout(display) {
  const area = display.workArea;
  const width = DOCK.open + DOCK.overhang;
  // whole points, rounded outward: the window's right side always lands past the edge, never short of it
  const right = dockEdge(display);
  const y = Math.floor(area.y), height = Math.ceil(area.y + area.height) - y;
  const window = { x: Math.floor(right - DOCK.open), y, width, height };
  const top = DOCK.ear + DOCK.margin;
  return { window, body: Math.max(DOCK.cell * 2, area.height - 2 * top), top };
}

const contains = (bounds, point) => point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;

/** The display the surfaces live on: the one under the pointer, the built-in one, or the main one. */
export function pickDisplay(displays, choice, { primary, cursor } = {}) {
  const list = Array.isArray(displays) ? displays.filter(display => rect(display?.bounds)) : [];
  const main = list.find(display => display.id === primary?.id) ?? primary ?? list[0] ?? null;
  if (choice === "built-in") return list.find(display => display.internal === true) ?? main;
  if (choice === "main") return main;
  if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) return list.find(display => contains(display.bounds, cursor)) ?? main;
  return main;
}
