import type { Notification } from "../../shared/notification";
import { chatInFront } from "./chat-in-front";
import { finishedNotificationsEnabled, notificationDings } from "./notification-preferences";
import { play, soundChoice, SYSTEM_SOUND } from "./ui-sounds";

export type NotifyFrame = Notification;

export type NotificationTarget = Pick<NotifyFrame, "botId" | "threadId">;

/** Banners that wait on the person: the desktop closes them once the ask is answered anywhere. */
const ASKS = new Set<NotifyFrame["kind"]>(["approval", "question", "sign-in", "secret"]);

/** On a team's page in the desktop app, its name: notifications then say which place they come from ("Acme · Scout"). */
let placeName: string | null = null;
export function setNotificationPlace(name: string | null) {
  placeName = name;
}

/** Call from the click: browsers may reject a permission request made later from an SSE frame. Resolves to the permission now in force. */
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  if (typeof Notification === "undefined") return null;
  try {
    return Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  } catch {
    return Notification.permission;
  }
}

export interface NotificationBotIdentity {
  id: string;
  avatarUrl?: string | null;
}

export function buildNotificationOptions(bot: NotificationBotIdentity): NotificationOptions {
  return { tag: `duskbot:${bot.id}`, icon: bot.avatarUrl ?? undefined };
}

export function showNotification(
  frame: NotifyFrame,
  onOpen: (target: NotificationTarget) => void,
  avatarUrl?: string | null,
  visibleThreadId?: string | null,
) {
  if (typeof Notification === "undefined") return;
  if (frame.kind === "done" && !finishedNotificationsEnabled()) return;
  const spend = frame.kind === "spend";
  if (!spend && chatInFront() && visibleThreadId === frame.threadId) return;
  if (Notification.permission !== "granted") return;

  const title = placeName ? `${placeName} · ${frame.title}` : frame.title;
  const ding = notificationDings(frame);
  const options: NotificationOptions = {
    body: frame.body,
    ...buildNotificationOptions({ id: frame.botId, avatarUrl }),
    ...(spend ? { tag: "duskbot:spend", icon: undefined } : {}),
    silent: true,
  };
  const shownByPage = () => {
    if (ding) play();
    new Notification(title, options).onclick = () => {
      window.focus();
      onOpen({ botId: frame.botId, threadId: frame.threadId });
    };
  };
  const desktop = window.duskDesktop?.desktopNotifications;
  if (!desktop) return shownByPage();
  const systemSound = ding && soundChoice() === SYSTEM_SOUND;
  const chime = ding && !systemSound;
  void desktop.show({
    title, body: frame.body, tag: options.tag, silent: !systemSound, chime, picture: options.icon, botId: frame.botId, threadId: frame.threadId,
    ...(ASKS.has(frame.kind) ? { ask: true } : {}),
  }).then((shown) => { if (shown === true && chime) play(); else if (!shown) shownByPage(); }, shownByPage);
}
