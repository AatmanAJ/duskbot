// The desktop app on a Mac never posts system notifications: the dock, the island and the unread dots carry them.

/** @param {string} platform */
export function systemNotificationsAllowed(platform = process.platform) {
  return platform !== "darwin";
}

/**
 * Electron's Notification where the app may post one; on a Mac a stand-in that is never supported, so every caller's
 * `isSupported()` check turns it away.
 * @template T
 * @param {T} Notification
 * @param {string} platform
 * @returns {T}
 */
export function systemNotification(Notification, platform = process.platform) {
  if (systemNotificationsAllowed(platform)) return Notification;
  function Silenced() { throw new Error("system notifications are off on macOS"); }
  Silenced.isSupported = () => false;
  return /** @type {T} */ (/** @type {unknown} */ (Silenced));
}
