import { describe, expect, it } from "vitest";
import type { Notification, NotifyKind } from "../shared/notification.ts";
import { silentNotification, withNotificationSound } from "./notification-sound.ts";

const notice = (kind: NotifyKind, extra: Partial<Notification> = {}): Notification => ({ kind, botId: "b", botName: "Nova", threadId: "t", title: "Nova", body: "x", ...extra });

describe("whether a notice makes a sound", () => {
  it("dings for a reply to the person and stays quiet for a run nobody watched, unless the bot chose", () => {
    expect(silentNotification("done")).toBe(false);
    expect(silentNotification("done", { routine: true })).toBe(true);
    expect(silentNotification("done", { choice: "quiet" })).toBe(true);
    expect(silentNotification("done", { routine: true, choice: "ding" })).toBe(false);
  });

  it.each(["approval", "question", "sign-in", "secret", "routine-failed", "routine-deferred", "turn-failed", "incident", "mention", "spend", "wait", "brief", "delegation-settled"] as const)(
    "always dings for %s, whatever the bot chose or wherever it came from",
    (kind) => {
      expect(silentNotification(kind, { routine: true, choice: "quiet" })).toBe(false);
    },
  );

  it("keeps dusk bot's own one-time notices quiet", () => {
    expect(silentNotification("notice")).toBe(true);
  });

  it("stamps silent on the wire only when it goes quietly, and never keeps a stale one", () => {
    expect(withNotificationSound(notice("done"), { routine: true })).toEqual({ ...notice("done"), silent: true });
    expect(withNotificationSound(notice("done", { silent: true }), { choice: "ding" })).not.toHaveProperty("silent");
    expect(withNotificationSound(notice("question", { silent: true }), { routine: true })).not.toHaveProperty("silent");
  });
});
