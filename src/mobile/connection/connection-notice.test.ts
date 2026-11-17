import { describe, expect, it } from "vitest";
import { connectionNotice, isCloudOrigin, placeKind, STUCK_AFTER_MS, WAKE_SLOW_AFTER_MS, type NoticeInput } from "./connection-notice";

const base: NoticeInput = { hydrated: true, connected: false, offline: false, waking: false, resuming: false, downSince: 0, wakingSince: null, now: 0 };

describe("what the phone says about its live connection", () => {
  it("says nothing before the chats load, while connected, or in the quiet moment after a resume", () => {
    expect(connectionNotice({ ...base, hydrated: false })).toBeNull();
    expect(connectionNotice({ ...base, connected: true, downSince: null })).toBeNull();
    expect(connectionNotice({ ...base, resuming: true, now: STUCK_AFTER_MS * 10 })).toBeNull();
  });

  it("never reconnects forever: after the time box it is a problem with an action", () => {
    expect(connectionNotice({ ...base, now: STUCK_AFTER_MS - 1 })).toBe("reconnecting");
    expect(connectionNotice({ ...base, now: STUCK_AFTER_MS })).toBe("stuck");
  });

  it("says offline first, and a slow wake once a cloud has taken too long", () => {
    expect(connectionNotice({ ...base, offline: true, now: STUCK_AFTER_MS })).toBe("offline");
    expect(connectionNotice({ ...base, waking: true, downSince: null, wakingSince: 0, now: WAKE_SLOW_AFTER_MS - 1 })).toBe("waking");
    expect(connectionNotice({ ...base, waking: true, downSince: null, wakingSince: 0, now: WAKE_SLOW_AFTER_MS })).toBe("wake-slow");
  });
});

describe("which kind of place a link is", () => {
  it("names a managed dusk cloud by its address, everything else a computer", () => {
    expect(isCloudOrigin("https://db8dd36a8c78f9624d31d.dusk.bot")).toBe(true);
    expect(isCloudOrigin("https://dusk.bot")).toBe(false);
    expect(isCloudOrigin("https://db8dd36a8c78f9624d31d.dusk.bot.evil.example")).toBe(false);
    expect(placeKind({ origin: undefined, via: [{ kind: "https", url: "https://dbe8ba878381340a6f57a.dusk.bot" }] })).toBe("cloud");
    expect(placeKind({ origin: "https://192.168.1.4:5331" })).toBe("computer");
    expect(placeKind(undefined)).toBe("computer");
  });
});
