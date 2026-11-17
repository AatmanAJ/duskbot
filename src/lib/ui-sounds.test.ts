import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseSound, DEFAULT_UI_SOUND, soundChoice, SYSTEM_SOUND, systemSoundAvailable, UI_SOUND_KEY } from "./ui-sounds";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});

afterEach(() => vi.unstubAllGlobals());

const desktop = (platform: string) => vi.stubGlobal("window", { duskDesktop: { platform, desktopNotifications: { show: vi.fn() } } });

describe("which sound a notice plays", () => {
  it.each(["darwin", "win32"])("uses the system's banner sound by default on the %s desktop app, which follows Do Not Disturb", (platform) => {
    desktop(platform);
    expect(systemSoundAvailable()).toBe(true);
    expect(soundChoice()).toBe(SYSTEM_SOUND);
  });

  it("keeps the chime by default on Linux, whose notification server may play nothing", () => {
    desktop("linux");
    expect(soundChoice()).toBe(DEFAULT_UI_SOUND);
    chooseSound(SYSTEM_SOUND);
    expect(soundChoice()).toBe(SYSTEM_SOUND);
  });

  it("keeps a chime the person picked, over the system's default", () => {
    desktop("darwin");
    chooseSound("tick");
    expect(values.get(UI_SOUND_KEY)).toBe("tick");
    expect(soundChoice()).toBe("tick");
  });

  it("never offers the system's sound in a browser, which shows no OS banner of its own", () => {
    vi.stubGlobal("window", {});
    values.set(UI_SOUND_KEY, SYSTEM_SOUND);
    expect(systemSoundAvailable()).toBe(false);
    expect(soundChoice()).toBe(DEFAULT_UI_SOUND);
  });
});
