/** dusk bot's page colours (dusk.bot/brand), in an order where neighbouring series differ in hue. */
export const BRAND_SERIES: readonly string[] = ["#2f7bf2", "#ff7d1f", "#1fb866", "#8d5cf0", "#ff5c9d", "#29a9f2", "#f8c623", "#f75e51"];
const BRAND_INK = "#131316";

export interface DiagramTokens {
  scheme: "light" | "dark";
  font: string;
  ground: string;
  card: string;
  /** The opaque colour right under the diagram. */
  surface: string;
  ink: string;
  muted: string;
  hairline: string;
  accent: string;
  warning: string;
  danger: string;
}

const TOKEN_VARS = {
  ground: "--color-app",
  card: "--color-card",
  ink: "--color-ink",
  muted: "--color-ink-secondary",
  hairline: "--color-hairline",
  accent: "--color-accent",
  warning: "--color-warning",
  danger: "--color-danger",
} as const satisfies Record<string, string>;

const FALLBACK: Record<DiagramTokens["scheme"], Omit<DiagramTokens, "scheme" | "font">> = {
  dark: { ground: "#121014", card: "#231f27", surface: "#231f27", ink: "#f4eff6", muted: "#b9afbd", hairline: "#403847", accent: "#765683", warning: "#d0a35d", danger: "#db727a" },
  light: { ground: "#fdfdfd", card: "#efefef", surface: "#efefef", ink: "#1c1c1c", muted: "#5e5e5e", hairline: "#c8c8c8", accent: "#126fd4", warning: "#b8741a", danger: "#c53340" },
};

const FALLBACK_FONT = '"Geist Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const HEX = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

const toHex = (rgb: readonly number[]) => `#${rgb.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0")).join("")}`;

/** `amount` of `top` over `base`, both #rrggbb. */
export function mixHex(top: string, base: string, amount: number): string {
  const a = channels(top), b = channels(base);
  return toHex(a.map((value, index) => value * amount + b[index]! * (1 - amount)));
}

/** Mermaid derives its other colours with khroma, so every value here is an opaque #rrggbb. */
export function mermaidThemeVariables(tokens: DiagramTokens): Record<string, unknown> {
  const { surface: plate, ink, muted, hairline, accent, warning, danger } = tokens;
  const node = mixHex(accent, plate, 0.3);
  const nodeBorder = mixHex(accent, plate, 0.85);
  const series = BRAND_SERIES;
  const tint = (colour: string) => mixHex(colour, plate, 0.3);
  const scale = Object.fromEntries(series.flatMap((colour, index) => [
    [`cScale${index}`, tint(colour)],
    [`cScaleLabel${index}`, ink],
    [`cScalePeer${index}`, mixHex(colour, plate, 0.6)],
  ]));
  const pie = Object.fromEntries(series.map((colour, index) => [`pie${index + 1}`, colour]));
  return {
    darkMode: tokens.scheme === "dark",
    background: plate,
    fontFamily: tokens.font,
    fontSize: "14px",
    dropShadow: `drop-shadow(0px 1px 2px rgba(0, 0, 0, ${tokens.scheme === "dark" ? 0.45 : 0.12}))`,
    primaryColor: node,
    primaryBorderColor: nodeBorder,
    primaryTextColor: ink,
    secondaryColor: mixHex(series[1]!, plate, 0.18),
    secondaryBorderColor: mixHex(series[1]!, plate, 0.6),
    secondaryTextColor: ink,
    tertiaryColor: plate,
    tertiaryBorderColor: hairline,
    tertiaryTextColor: ink,
    mainBkg: node,
    nodeBorder,
    nodeTextColor: ink,
    textColor: ink,
    titleColor: ink,
    lineColor: muted,
    clusterBkg: mixHex(ink, plate, 0.08),
    clusterBorder: hairline,
    edgeLabelBackground: plate,
    noteBkgColor: mixHex(warning, plate, 0.2),
    noteBorderColor: mixHex(warning, plate, 0.6),
    noteTextColor: ink,
    actorBkg: node,
    actorBorder: nodeBorder,
    actorTextColor: ink,
    actorLineColor: hairline,
    signalColor: muted,
    signalTextColor: ink,
    labelBoxBkgColor: plate,
    labelBoxBorderColor: hairline,
    labelTextColor: ink,
    loopTextColor: ink,
    activationBkgColor: mixHex(accent, plate, 0.32),
    activationBorderColor: nodeBorder,
    sequenceNumberColor: "#ffffff",
    errorBkgColor: mixHex(danger, plate, 0.2),
    errorTextColor: ink,
    ...scale,
    ...pie,
    pieStrokeColor: plate,
    pieStrokeWidth: "2px",
    pieOuterStrokeColor: hairline,
    pieOuterStrokeWidth: "1px",
    pieTitleTextColor: ink,
    pieSectionTextColor: BRAND_INK,
    pieLegendTextColor: ink,
    pieOpacity: "1",
    xyChart: {
      backgroundColor: plate,
      titleColor: ink,
      xAxisLabelColor: muted,
      xAxisTitleColor: muted,
      xAxisTickColor: hairline,
      xAxisLineColor: hairline,
      yAxisLabelColor: muted,
      yAxisTitleColor: muted,
      yAxisTickColor: hairline,
      yAxisLineColor: hairline,
      plotColorPalette: series.join(", "),
    },
  };
}

/** A canvas resolves any CSS colour, color-mix() and translucent tokens included, to the pixel it paints on `ground`. */
function solidColour(context: CanvasRenderingContext2D, value: string, ground: string): string | null {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = ground;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return toHex([r ?? 0, g ?? 0, b ?? 0]);
}

let canvasContext: CanvasRenderingContext2D | null | undefined;

/** The skin `element` is drawn in, read from its tokens. */
export function readDiagramTokens(element: HTMLElement, scheme: DiagramTokens["scheme"]): DiagramTokens {
  const fallback = FALLBACK[scheme];
  const styles = window.getComputedStyle(element);
  canvasContext ??= (() => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      return canvas.getContext("2d", { willReadFrequently: true });
    } catch {
      return null;
    }
  })();
  const token = (name: string) => styles.getPropertyValue(name).trim();
  const resolve = (value: string, ground: string, otherwise: string) => {
    if (HEX.test(value)) return value.toLowerCase();
    if (!value || !canvasContext) return otherwise;
    try {
      return solidColour(canvasContext, resolveVars(value, token), ground) ?? otherwise;
    } catch {
      return otherwise;
    }
  };
  const ground = resolve(token(TOKEN_VARS.ground), "#808080", fallback.ground);
  const read = (key: Exclude<keyof typeof TOKEN_VARS, "ground">) => resolve(token(TOKEN_VARS[key]), ground, fallback[key]);
  const card = read("card");
  return {
    scheme,
    font: token("--font-sans") || FALLBACK_FONT,
    ground,
    card,
    surface: canvasContext ? surfaceUnder(canvasContext, element, ground) ?? card : card,
    ink: read("ink"),
    muted: read("muted"),
    hairline: read("hairline"),
    accent: read("accent"),
    warning: read("warning"),
    danger: read("danger"),
  };
}

/** The backgrounds from `element` up to the first opaque one, painted in order. */
function surfaceUnder(context: CanvasRenderingContext2D, element: HTMLElement, ground: string): string | null {
  const layers: string[] = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const colour = window.getComputedStyle(node).backgroundColor;
    if (!colour || colour === "transparent" || /^rgba\([^)]*,\s*0\)$/.test(colour)) continue;
    layers.push(colour);
    if (colour.startsWith("rgb(")) break;
  }
  if (!layers.length) return null;
  try {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = ground;
    context.fillRect(0, 0, 1, 1);
    for (const colour of layers.reverse()) {
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
    }
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return toHex([r ?? 0, g ?? 0, b ?? 0]);
  } catch {
    return null;
  }
}

/** A canvas cannot read custom properties, so a token that names others (color-mix of var(...)) has them filled in. */
function resolveVars(value: string, token: (name: string) => string, depth = 0): string {
  if (depth > 4 || !value.includes("var(")) return value;
  return resolveVars(value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_match, name: string, otherwise?: string) => token(name) || otherwise || "transparent"), token, depth + 1);
}

export function diagramThemeKey(tokens: DiagramTokens): string {
  return [tokens.scheme, tokens.font, tokens.ground, tokens.card, tokens.surface, tokens.ink, tokens.muted, tokens.hairline, tokens.accent, tokens.warning, tokens.danger].join("|");
}
