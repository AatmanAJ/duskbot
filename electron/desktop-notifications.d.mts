export interface DesktopNotificationNote {
  title: string;
  body: string;
  tag?: string;
  /** No sound from the OS banner itself. False only when the person chose the system's sound, which the OS then holds
   * back under its own Do Not Disturb or Focus (macOS, Windows; on Linux the notification server decides). */
  silent?: boolean;
  /** The page means to play its own chime for this banner: main answers "hushed" while the system's Do Not Disturb is
   * on, where it can tell. */
  chime?: boolean;
  /** The bot's picture, on the page's own origin. */
  picture?: string;
  botId: string;
  threadId: string;
  /** An approval or a question: the banner closes once the bot stops waiting on the person. */
  ask?: boolean;
}

export interface DesktopNotificationsBridge {
  /** Resolves false when main shows nothing (no system support, or not this window's page): the page shows its own.
   * "hushed": shown, but the system's Do Not Disturb is on, so the page plays no chime. Before this app had it, true. */
  show(note: DesktopNotificationNote): Promise<boolean | "hushed">;
  /** A click on one of them brought this page up: open that thread. */
  onOpen(cb: (target: { botId: string; threadId: string }) => void): () => void;
  /** Which of this page's loaded bots wait on the person now, and which do not; absent before this app had it. */
  asks?(report: { waiting: string[]; settled: string[] }): void;
}
