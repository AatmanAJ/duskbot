import assert from "node:assert/strict";
import test from "node:test";
import { appPermissionHandlers } from "./app-permissions.mjs";
import { createAddedCloudNotice } from "./cloud-rail.mjs";
import { createCloudReadyNotice } from "./cloud-buy.mjs";
import { installDesktopNotifications } from "./desktop-notifications.mjs";
import { systemNotification, systemNotificationsAllowed } from "./system-notifications.mjs";

class Posted {
  static shown = [];
  static isSupported() { return true; }
  constructor(options) { this.options = options; }
  on() { return this; }
  show() { Posted.shown.push(this.options); }
  close() {}
}

test("a Mac never gets a system notification; Windows and Linux keep theirs", () => {
  assert.equal(systemNotificationsAllowed("darwin"), false);
  assert.equal(systemNotificationsAllowed("win32"), true);
  assert.equal(systemNotificationsAllowed("linux"), true);
  assert.equal(systemNotification(Posted, "win32"), Posted);
  const mac = systemNotification(Posted, "darwin");
  assert.equal(mac.isSupported(), false);
  assert.throws(() => new mac({ title: "x" }));
});

test("every main-process notice turns away on a Mac", async () => {
  Posted.shown = [];
  const Notification = systemNotification(Posted, "darwin");
  const handlers = new Map();
  const contents = { isDestroyed: () => false, isLoadingMainFrame: () => false, getURL: () => "http://127.0.0.1:8799/", mainFrame: {}, send() {} };
  const win = { isDestroyed: () => false, webContents: contents };
  installDesktopNotifications({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
    Notification, nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, fetch: async () => ({ ok: false }),
    window: () => win, mayNotify: () => true, reveal() {}, openPlace() {},
  });
  const shown = await handlers.get("desktop-notifications:show")({ sender: contents, senderFrame: { ...contents.mainFrame, url: "http://127.0.0.1:8799/" } }, { title: "Nova", body: "hi", botId: "b1", threadId: "t1" });
  assert.equal(shown, false);
  const ready = { status: "connected", checkout: { startedAt: 1 }, machine: { status: "ready" } };
  const added = { status: "connected", adding: { cloudId: "c1", done: false }, clouds: [{ id: "c1", name: "Cloud", status: "ready", origin: "https://c1.example" }] };
  const notices = (N) => [
    createCloudReadyNotice({ Notification: N, focused: () => false, sheetOpen: () => false, name: () => "Cloud", open() {} })(ready),
    createAddedCloudNotice({ Notification: N, focused: () => false, sheetOpen: () => false, open() {} })(added),
  ];
  assert.deepEqual(notices(Notification), [false, false]);
  assert.deepEqual(Posted.shown, []);
  assert.deepEqual(notices(systemNotification(Posted, "linux")), [true, true]);
  assert.equal(Posted.shown.length, 2);
});

test("a page may not post one either on a Mac", () => {
  const main = { id: "main" };
  const ask = (systemNotifications) => {
    const handlers = appPermissionHandlers({ rendererOrigin: () => "http://127.0.0.1:8799", mainContents: () => main, cloudHomeOrigin: () => null, systemNotifications });
    return handlers.check(main, "notifications", "http://127.0.0.1:8799", { isMainFrame: true });
  };
  assert.equal(ask(true), true);
  assert.equal(ask(false), false);
});
