const RETRY_LOAD_MS = 2000;

/** The background server could not come back by itself: says so, where its log is, and one button restarts dusk bot. */
export function offerRestart({ dialog, app, logFile = "", home = "" }) {
  const log = home && logFile.startsWith(home) ? `~${logFile.slice(home.length)}` : logFile;
  return dialog.showMessageBox({
    type: "error",
    message: "The bot server stopped",
    detail: `Automatic recovery could not restart the background server. Restart dusk bot to bring it back. Interrupted chat turns were not resent.${log ? `\n\nServer log: ${log}` : ""}`,
    buttons: ["Restart dusk bot", "Not now"],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response !== 0) return;
    app.relaunch();
    app.quit();
  });
}

/** Loads `url` in `win`, trying once more by itself before `failedPage(why, url)` says what failed and what to press.
 * Electron fires did-fail-load for a rejected loadURL too, so that event alone decides. */
export function loadWithOneRetry(win, url, failedPage, log = () => {}) {
  let retried = false;
  win.webContents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 || win.isDestroyed() || failedUrl.startsWith("data:")) return;
    log(`load failed: ${code} ${description}`);
    if (retried) return void win.loadURL(failedPage(description || `error ${code}`, url)).catch(() => {});
    retried = true;
    setTimeout(() => { if (!win.isDestroyed()) void win.loadURL(url).catch(() => {}); }, RETRY_LOAD_MS);
  });
  void win.loadURL(url).catch(() => {});
}
