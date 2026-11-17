import type { Notification, NotificationSound, NotifyKind } from "../shared/notification.ts";

/** News the person never asked to hear about at once: shown without a sound unless the bot asked for one. */
const QUIET_KINDS: ReadonlySet<NotifyKind> = new Set(["notice"]);

export interface NotificationSoundContext {
  /** A run nobody was watching: a routine, a scheduled run or a webhook. */
  routine?: boolean;
  /** What the bot chose with set_notification_sound for the turn the notice is about. */
  choice?: NotificationSound;
}

/** Whether a notice goes without a sound. Only a turn's finished reply follows the bot's choice; every other kind keeps
 * its own rule, so an ask, a failure or a mention always dings. */
export function silentNotification(kind: NotifyKind, context: NotificationSoundContext = {}): boolean {
  if (kind === "done") return context.choice ? context.choice === "quiet" : context.routine === true;
  return QUIET_KINDS.has(kind);
}

export function withNotificationSound(notification: Notification, context: NotificationSoundContext = {}): Notification {
  const { silent: _silent, ...rest } = notification;
  return silentNotification(notification.kind, context) ? { ...rest, silent: true } : rest;
}
