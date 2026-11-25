import { hasPriorRun } from "./prior-run";

/** Skins with a `[data-skin]` block of their own in styles.css. */
export const BASE_SKIN_IDS = [
  "midnight",
  "atelier",
  "foundry",
  "lagoon",
  "graphite",
  "linen",
  "dusk",
  "daylight",
  "meadow",
  "pop",
  "grok",
  "grok-dark",
  "halloween",
] as const;
export type BaseSkinId = (typeof BASE_SKIN_IDS)[number];

/** dusk bot's own looks. Each wears a base skin's structure (`data-skin`) under its own palette (`data-look`), so every
 * refinement written for the base carries over. */
export const LOOK_BASES = { signal: "grok", "signal-dark": "grok-dark" } as const satisfies Record<string, BaseSkinId>;

export type SkinId = BaseSkinId | keyof typeof LOOK_BASES;
export const SKIN_IDS: readonly SkinId[] = [...BASE_SKIN_IDS, "signal", "signal-dark"];

/** The skin whose stylesheet block and structural rules this one wears. */
export function skinBase(id: SkinId): BaseSkinId {
  return Object.hasOwn(LOOK_BASES, id) ? LOOK_BASES[id as keyof typeof LOOK_BASES] : (id as BaseSkinId);
}

export type Skin = {
  id: SkinId;
  name: string;
  tagline: string;
};

export const SKINS: readonly Skin[] = [
  { id: "signal", name: "Signal", tagline: "dusk bot's own look. Warm white, lit in LED red." },
  { id: "signal-dark", name: "Signal Dark", tagline: "dusk bot after dark: an LED sign switching on." },
  { id: "grok", name: "Grok", tagline: "Near-white and quiet, Geist type, ink-black bubbles." },
  { id: "grok-dark", name: "Grok Dark", tagline: "The same quiet look after dark, in Geist." },
  { id: "midnight", name: "Midnight", tagline: "The original. Cool and dark." },
  { id: "atelier", name: "Atelier", tagline: "Daylight on paper, warm and quiet." },
  { id: "foundry", name: "Foundry", tagline: "Night shift. Dark, warm, lit in brass." },
  { id: "lagoon", name: "Lagoon", tagline: "Cool daylight. Porcelain and deep teal." },
  { id: "graphite", name: "Graphite", tagline: "Quiet charcoal and softened steel blue." },
  { id: "linen", name: "Linen", tagline: "Clean daylight with a restrained navy accent." },
  { id: "dusk", name: "Dusk", tagline: "Muted plum after dark, calm and low-key." },
  { id: "daylight", name: "Daylight", tagline: "Midnight in reverse. Near-white, ink-black bubbles." },
  { id: "meadow", name: "Meadow", tagline: "Fresh white with a calm green. The Dusk look." },
  { id: "pop", name: "Pop", tagline: "Cream paper, thick ink outlines, hard shadows. Chunky and cheerful." },
  { id: "halloween", name: "Halloween", tagline: "Plum after dark, lit in pumpkin orange. Bats optional." },
];

/** Whether a skin is dark or light. The page's root says it as `data-scheme`, which the rules that differ between
 * the two key off, so no stylesheet names the dark skins one by one. */
export const SKIN_SCHEME: Record<SkinId, "light" | "dark"> = {
  midnight: "dark",
  atelier: "light",
  foundry: "dark",
  lagoon: "light",
  graphite: "dark",
  linen: "light",
  dusk: "dark",
  daylight: "light",
  meadow: "light",
  pop: "light",
  grok: "light",
  "grok-dark": "dark",
  halloween: "dark",
  signal: "light",
  "signal-dark": "dark",
};

/** "system" follows the OS between the light and dark skins below; anything else pins one skin. */
export type SkinChoice = SkinId | "system";
export const THEME_SKINS = { light: "signal", dark: "signal-dark" } as const satisfies Record<"light" | "dark", SkinId>;

export const DEFAULT_SKIN_CHOICE: SkinChoice = "system";
export const PRIOR_INSTALL_SKIN: SkinId = "midnight";

const KEY = "dusk-skin";
// set once every install has been moved onto the Grok look; a pick made after that sticks
const GROK_MOVE_KEY = "dusk-skin-grok";
// set once a pinned Light or Dark (Grok's, before Signal took those names) has moved to Signal's
const SIGNAL_MOVE_KEY = "dusk-skin-signal";
const SIGNAL_MOVES: Partial<Record<SkinId, SkinId>> = { grok: THEME_SKINS.light, "grok-dark": THEME_SKINS.dark };
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isSkinId(value: unknown): value is SkinId {
  return SKIN_IDS.includes(value as SkinId);
}

function isSkinChoice(value: unknown): value is SkinChoice {
  return value === "system" || isSkinId(value);
}

function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
  } catch {
    return true;
  }
}

export function resolveSkin(choice: SkinChoice, prefersDark = systemPrefersDark()): SkinId {
  if (choice !== "system") return choice;
  return prefersDark ? THEME_SKINS.dark : THEME_SKINS.light;
}

// With storage blocked the localStorage getter itself throws, and `typeof` alone doesn't shield it.
function getStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readSkinChoice(): SkinChoice {
  try {
    const store = getStore();
    if (store && store.getItem(GROK_MOVE_KEY) == null) {
      store.setItem(GROK_MOVE_KEY, "1");
      store.setItem(SIGNAL_MOVE_KEY, "1");
      store.setItem(KEY, DEFAULT_SKIN_CHOICE);
      return DEFAULT_SKIN_CHOICE;
    }
    if (store && store.getItem(SIGNAL_MOVE_KEY) == null) {
      store.setItem(SIGNAL_MOVE_KEY, "1");
      const moved = SIGNAL_MOVES[store.getItem(KEY) as SkinId];
      if (moved) store.setItem(KEY, moved);
    }
    const stored = store?.getItem(KEY);
    if (isSkinChoice(stored)) return stored;
    return hasPriorRun(store) ? PRIOR_INSTALL_SKIN : DEFAULT_SKIN_CHOICE;
  } catch {
    return PRIOR_INSTALL_SKIN;
  }
}

export function readSkin(): SkinId {
  return resolveSkin(readSkinChoice());
}

let followingSystem: { query: MediaQueryList; onChange: () => void } | null = null;
const listeners = new Set<() => void>();

export function subscribeSkin(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function wear(id: SkinId): void {
  const root = document.documentElement;
  root.dataset.look = id;
  root.dataset.scheme = SKIN_SCHEME[id];
  root.dataset.skin = skinBase(id);
  for (const listener of listeners) listener();
}

function paintSkin(id: SkinId): void {
  wear(id);
  // On Windows the caption buttons sit in a native overlay the main process paints, out of CSS's reach.
  try {
    void window.duskDesktop?.applySkin?.(id)?.catch(() => undefined);
  } catch {
  }
}

function followSystem(follow: boolean): void {
  if (followingSystem && !follow) {
    followingSystem.query.removeEventListener("change", followingSystem.onChange);
    followingSystem = null;
  }
  if (!follow || followingSystem || typeof matchMedia !== "function") return;
  try {
    const query = matchMedia(DARK_QUERY);
    const onChange = () => paintSkin(resolveSkin("system", query.matches));
    query.addEventListener("change", onChange);
    followingSystem = { query, onChange };
  } catch {
  }
}

/** Wears a skin another page chose, without keeping it as this page's own choice or telling the app (the window's rail
 * wearing the skin of the page beside it). */
export function wearSkin(value: unknown): void {
  if (isSkinId(value)) wear(value);
}

export function applySkinChoice(choice: SkinChoice): void {
  try {
    getStore()?.setItem(KEY, choice);
  } catch {
  }
  followSystem(choice === "system");
  paintSkin(resolveSkin(choice));
}

export function applySkin(id: SkinId): void {
  applySkinChoice(id);
}
