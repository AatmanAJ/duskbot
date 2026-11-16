import { describe, expect, it, vi } from "vitest";
import type { NotificationLogEntry } from "../../../shared/notification";
import { groupNotifications } from "./NotificationsSheet";
import { normalizeSearch, searchSnippetParts } from "./SearchSheet";

vi.mock("@/state/store", async () => (await import("@/testing/store-mock")).withStoreHooks(await (() => ({ api: vi.fn(), useStore: vi.fn(), openBotThread: vi.fn(), openRoomThread: vi.fn() }))()));
vi.mock("@/components/Avatar", () => ({ BotAvatar: vi.fn(), MausAvatar: vi.fn() }));
vi.mock("@/components/GroupAvatar", () => ({ GroupAvatar: vi.fn(), useGroupYou: vi.fn() }));
vi.mock("@/components/sidebar-preview", () => ({ lastPreviewable: vi.fn(), sidebarPreviewMessages: vi.fn() }));
vi.mock("@/lib/focus-message", () => ({ landOnSearchHit: vi.fn() }));

const notification = (id: string, at: number): NotificationLogEntry => ({
  id, at, kind: "done", botId: "bot", botName: "Scout", threadId: "thread", title: "Finished", body: "Ready to read", read: false,
});

describe("notification day groups", () => {
  it("groups local midnight boundaries and sorts newest first without changing the feed", () => {
    const today = new Date(2026, 10, 8);
    const yesterday = new Date(2026, 10, 7);
    const entries = [notification("yesterday", yesterday.getTime()), notification("earlier", yesterday.getTime() - 1), notification("midnight", today.getTime()), notification("latest", today.getTime() + 1000)];
    const grouped = groupNotifications(entries, today.getTime() + 2000);
    expect(grouped.today.map((entry) => entry.id)).toEqual(["latest", "midnight"]);
    expect(grouped.yesterday.map((entry) => entry.id)).toEqual(["yesterday"]);
    expect(grouped.earlier.map((entry) => entry.id)).toEqual(["earlier"]);
    expect(entries.map((entry) => entry.id)).toEqual(["yesterday", "earlier", "midnight", "latest"]);
  });

  it("uses calendar days across the daylight-saving boundary", () => {
    const now = new Date(2026, 10, 2, 0, 30);
    const earlier = new Date(2026, 10, 1, 0, 15);
    expect(groupNotifications([notification("yesterday", earlier.getTime())], now.getTime()).yesterday).toHaveLength(1);
  });
});

describe("search matching", () => {
  it("matches names regardless of accents, case, or accent composition", () => {
    expect(normalizeSearch("CAFÉ")).toBe("cafe");
    expect(normalizeSearch("Cafe\u0301")).toBe("cafe");
    expect(normalizeSearch("Équipe").includes(normalizeSearch("equi"))).toBe(true);
  });

  it("marks all query words and preserves the original snippet", () => {
    const text = "Café notes, then CAFE and résumé";
    const parts = searchSnippetParts(text, "cafe résumé");
    expect(parts.filter((part) => part.matched).map((part) => part.text)).toEqual(["Café", "CAFE", "résumé"]);
    expect(parts.map((part) => part.text).join("")).toBe(text);
  });

  it("preserves emoji and decomposed accents around matches", () => {
    const text = "👋 Cafe\u0301 is ready";
    expect(searchSnippetParts(text, "café")).toEqual([
      { text: "👋 ", matched: false },
      { text: "Cafe\u0301", matched: true },
      { text: " is ready", matched: false },
    ]);
  });

  it("leaves unmatched or empty queries as plain text", () => {
    expect(searchSnippetParts("A short message", "missing")).toEqual([{ text: "A short message", matched: false }]);
    expect(searchSnippetParts("A short message", "  ")).toEqual([{ text: "A short message", matched: false }]);
  });
});
