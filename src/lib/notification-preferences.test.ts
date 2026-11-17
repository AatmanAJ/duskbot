import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((listener: () => void) => () => void),
  snapshot: undefined as undefined | (() => unknown),
  serverSnapshot: undefined as undefined | (() => unknown),
}));

vi.mock("react", () => ({
  useSyncExternalStore: (
    subscribe: (listener: () => void) => () => void,
    snapshot: () => unknown,
    serverSnapshot: () => unknown,
  ) => {
    Object.assign(hook, { subscribe, snapshot, serverSnapshot });
    return snapshot();
  },
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

let local: ReturnType<typeof memoryStorage>;
let browser: EventTarget;

function storageEvent(key: string | null, storageArea: unknown = local) {
  browser.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea }));
}

beforeEach(() => {
  vi.resetModules();
  local = memoryStorage();
  browser = new EventTarget();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", browser);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notification sounds preference", () => {
  it("defaults on and ignores malformed values without writing anything", async () => {
    const preference = await import("./notification-preferences");
    expect(preference.useNotificationSounds()).toBe(true);
    expect(preference.notificationSoundsEnabled()).toBe(true);
    expect(hook.serverSnapshot!()).toBe("bot");
    for (const value of ["", "false", "broken", "1"]) {
      local.setItem(preference.NOTIFICATION_SOUNDS_KEY, value);
      expect(preference.useNotificationSounds()).toBe(true);
    }
    local.setItem.mockClear();
    preference.useNotificationSounds();
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("persists both choices through a renderer reload", async () => {
    let preference = await import("./notification-preferences");
    preference.setNotificationSoundMode("never");
    expect(local.getItem(preference.NOTIFICATION_SOUNDS_KEY)).toBe("0");
    expect(preference.useNotificationSounds()).toBe(false);
    expect(preference.notificationSoundsEnabled()).toBe(false);

    vi.resetModules();
    preference = await import("./notification-preferences");
    expect(preference.notificationSoundsEnabled()).toBe(false);
    preference.setNotificationSoundMode("bot");
    expect(local.getItem(preference.NOTIFICATION_SOUNDS_KEY)).toBe("1");
    vi.resetModules();
    preference = await import("./notification-preferences");
    expect(preference.useNotificationSounds()).toBe(true);
  });

  it("notifies mounted consumers immediately and unsubscribes cleanly", async () => {
    const preference = await import("./notification-preferences");
    preference.useNotificationSounds();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = hook.subscribe!(first);
    const unsubscribeSecond = hook.subscribe!(second);
    preference.setNotificationSoundMode("never");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(hook.snapshot!()).toBe("never");

    unsubscribeFirst();
    preference.setNotificationSoundMode("bot");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribeSecond();
    preference.setNotificationSoundMode("never");
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("follows cross-window changes and clear, ignoring other storage", async () => {
    const preference = await import("./notification-preferences");
    preference.useNotificationSounds();
    const listener = vi.fn();
    const unsubscribe = hook.subscribe!(listener);
    local.setItem(preference.NOTIFICATION_SOUNDS_KEY, "0");
    storageEvent(preference.NOTIFICATION_SOUNDS_KEY);
    expect(listener).toHaveBeenCalledOnce();
    expect(hook.snapshot!()).toBe("never");

    storageEvent("other-key");
    storageEvent(preference.NOTIFICATION_SOUNDS_KEY, memoryStorage());
    expect(listener).toHaveBeenCalledOnce();

    local.clear();
    storageEvent(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(hook.snapshot!()).toBe("bot");
    unsubscribe();
    storageEvent(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("follows another window's choice after Settings has unmounted", async () => {
    const preference = await import("./notification-preferences");
    preference.setNotificationSoundMode("never");
    expect(preference.notificationSoundsEnabled()).toBe(false);
    local.setItem(preference.NOTIFICATION_SOUNDS_KEY, "1");
    expect(preference.notificationSoundsEnabled()).toBe(true);
  });

  it.each(["getter", "read", "write", "missing"])("keeps the choice usable when storage fails at %s", async (failure) => {
    if (failure === "getter") {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    } else if (failure === "missing") {
      vi.stubGlobal("localStorage", undefined);
    } else {
      if (failure === "write") local.setItem.mockImplementation(() => { throw new Error("blocked"); });
      if (failure === "read") local.getItem.mockImplementation(() => { throw new Error("blocked"); });
    }
    const preference = await import("./notification-preferences");
    expect(preference.useNotificationSounds()).toBe(true);
    preference.setNotificationSoundMode("never");
    expect(preference.useNotificationSounds()).toBe(false);
    expect(preference.notificationSoundsEnabled()).toBe(false);
    preference.setNotificationSoundMode("bot");
    expect(preference.useNotificationSounds()).toBe(true);
  });
});

describe("whose call a notice's sound is", () => {
  it("lets the bot decide by default: a quiet notice plays nothing, any other plays", async () => {
    const preference = await import("./notification-preferences");
    expect(preference.notificationSoundMode()).toBe("bot");
    expect(preference.notificationDings({ silent: true })).toBe(false);
    expect(preference.notificationDings({})).toBe(true);
  });

  it("always plays, quiet notices included, and never plays nothing, and both survive a reload", async () => {
    let preference = await import("./notification-preferences");
    preference.setNotificationSoundMode("always");
    expect(local.getItem(preference.NOTIFICATION_SOUNDS_KEY)).toBe("always");
    vi.resetModules();
    preference = await import("./notification-preferences");
    expect(preference.notificationSoundMode()).toBe("always");
    expect(preference.notificationDings({ silent: true })).toBe(true);
    expect(preference.notificationSoundsEnabled()).toBe(true);
    preference.setNotificationSoundMode("never");
    expect(preference.notificationDings({})).toBe(false);
    expect(preference.notificationDings({ silent: true })).toBe(false);
    expect(preference.notificationSoundsEnabled()).toBe(false);
  });

  it("reads the old switch's stored values as before: on lets the bot decide, off is never", async () => {
    const preference = await import("./notification-preferences");
    local.setItem(preference.NOTIFICATION_SOUNDS_KEY, "1");
    expect(preference.notificationSoundMode()).toBe("bot");
    local.setItem(preference.NOTIFICATION_SOUNDS_KEY, "0");
    expect(preference.notificationSoundMode()).toBe("never");
  });
});

describe("finished-work notifications preference", () => {
  it("defaults on and persists changes", async () => {
    let preference = await import("./notification-preferences");
    expect(preference.finishedNotificationsEnabled()).toBe(true);
    preference.setFinishedNotifications(false);
    expect(local.getItem(preference.FINISHED_NOTIFICATIONS_KEY)).toBe("0");
    expect(preference.useFinishedNotifications()).toBe(false);
    vi.resetModules();
    preference = await import("./notification-preferences");
    expect(preference.finishedNotificationsEnabled()).toBe(false);
    preference.setFinishedNotifications(true);
    expect(local.getItem(preference.FINISHED_NOTIFICATIONS_KEY)).toBe("1");
    expect(preference.finishedNotificationsEnabled()).toBe(true);
  });
});
