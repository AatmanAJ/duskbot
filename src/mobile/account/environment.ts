export const PRODUCTION_ORIGIN = "https://dusk.bot";
export const PREVIEW_ORIGIN = "https://preview.dusk.bot";
const KEY = "dusk.mobile.environment";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storage = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The account service a store build signs in to: dusk.bot, or the preview stack when someone testing chose it. */
export function chosenAccountOrigin(store: Store | null = storage()): string {
  return store?.getItem(KEY) === "preview" ? PREVIEW_ORIGIN : PRODUCTION_ORIGIN;
}

export function chooseAccountOrigin(origin: string, store: Store | null = storage()): void {
  if (origin === PREVIEW_ORIGIN) store?.setItem(KEY, "preview");
  else store?.removeItem(KEY);
}

/** A short name for any account service but dusk.bot itself, so a phone on another stack always says so. */
export function environmentName(origin: string): string | null {
  if (origin === PRODUCTION_ORIGIN) return null;
  if (origin === PREVIEW_ORIGIN) return "Preview";
  try { return new URL(origin).host; } catch { return origin; }
}
