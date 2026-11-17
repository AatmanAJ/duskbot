import openBlip from "../assets/sounds/open-blip.wav";
import tick from "../assets/sounds/tick.wav";
import doubleTick from "../assets/sounds/double-tick.wav";
import chimeA from "../assets/sounds/chime-a.wav";
import chimeB from "../assets/sounds/chime-b.wav";
import { notificationSoundsEnabled } from "./notification-preferences";

export const UI_SOUNDS = {
  "open-blip": openBlip,
  tick,
  "double-tick": doubleTick,
  "chime-a": chimeA,
  "chime-b": chimeB,
} as const;

export type UiSoundName = keyof typeof UI_SOUNDS;

export const UI_SOUND_NAMES = Object.keys(UI_SOUNDS) as UiSoundName[];
export const DEFAULT_UI_SOUND: UiSoundName = "chime-b";
/** pings play at half volume: a soft nudge, not an alarm */
export const DEFAULT_UI_VOLUME = 0.5;
export const UI_SOUND_KEY = "dusk-notification-sound";

let audio: HTMLAudioElement | null = null;

function isSoundName(value: unknown): value is UiSoundName {
  return typeof value === "string" && value in UI_SOUNDS;
}

export function chosenSound(): UiSoundName {
  try {
    const saved = globalThis.localStorage?.getItem(UI_SOUND_KEY);
    return isSoundName(saved) ? saved : DEFAULT_UI_SOUND;
  } catch {
    return DEFAULT_UI_SOUND;
  }
}

/** The OS banner's own sound instead of a chime: the OS holds it back under its Do Not Disturb or Focus. */
export const SYSTEM_SOUND = "system";
export type SoundChoice = UiSoundName | typeof SYSTEM_SOUND;

/** Only the desktop app shows its banners through the OS, so only there can the OS play the sound. */
export function systemSoundAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.duskDesktop?.desktopNotifications);
}

/** macOS and Windows play a banner's sound and mute it under Focus or Do Not Disturb, so there it is the default; a
 * Linux notification server may play none, so Linux keeps the chime unless the person picks the system's. */
const systemSoundByDefault = () => window.duskDesktop?.platform === "darwin" || window.duskDesktop?.platform === "win32";

export function soundChoice(): SoundChoice {
  let saved: string | null | undefined;
  try {
    saved = globalThis.localStorage?.getItem(UI_SOUND_KEY);
  } catch {
    saved = undefined;
  }
  if (isSoundName(saved)) return saved;
  if (!systemSoundAvailable()) return DEFAULT_UI_SOUND;
  return saved === SYSTEM_SOUND || systemSoundByDefault() ? SYSTEM_SOUND : DEFAULT_UI_SOUND;
}

export function chooseSound(name: SoundChoice): void {
  try {
    globalThis.localStorage?.setItem(UI_SOUND_KEY, name);
  } catch {
  }
}

export function play(name: UiSoundName = chosenSound(), { force = false, volume = DEFAULT_UI_VOLUME }: { force?: boolean; volume?: number } = {}): void {
  if (!force && !notificationSoundsEnabled()) return;
  if (typeof Audio === "undefined") return;
  audio ??= new Audio();
  audio.pause();
  audio.src = UI_SOUNDS[name];
  audio.volume = volume;
  audio.play().catch(() => {});
}
