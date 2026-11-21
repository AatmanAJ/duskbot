import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createAmbientWindow } from "./ambient-window.mjs";

function window() {
  const made = [];
  class BrowserWindow {
    constructor(options) {
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.destroyed = false; this.visible = false; this.inputs = [];
      this.webContents = Object.assign(new EventEmitter(), { send() {}, setWindowOpenHandler() {}, sendInputEvent: (event) => this.inputs.push(event) });
      this.events = new EventEmitter();
      made.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(ignore) { this.ignore = ignore; }
    loadURL() { queueMicrotask(() => this.webContents.emit("did-finish-load")); return Promise.resolve(); }
    on(event, fn) { this.events.on(event, fn); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    destroy() { this.destroyed = true; this.events.emit("closed"); }
  }
  return { BrowserWindow, made };
}

const DOCK_AT = { x: 1400, y: 40, width: 112, height: 900 };

test("on linux the dock page hears the pointer over its window, since Electron forwards no moves there", async () => {
  const { BrowserWindow, made } = window();
  let point = { x: 10, y: 10 };
  const dock = createAmbientWindow({ BrowserWindow, surface: "dock", url: () => "http://127.0.0.1:5199/dock", level: "floating",
    platform: "linux", onMessage() {}, hoverKey: false, cursor: () => point, feedEveryMs: 5 });
  dock.place(DOCK_AT);
  await sleep(30);
  const win = made[0];
  assert.deepEqual(win.inputs, [], "nothing while the pointer is elsewhere");
  point = { x: 1500, y: 300 };
  await sleep(30);
  assert.deepEqual(win.inputs.at(-1), { type: "mouseMove", x: 100, y: 260 });
  // over the shape the page takes the pointer itself: the window hears it, so main stops feeding
  win.webContents.emit("ipc-message", {}, "ambient:pointer", true);
  const fed = win.inputs.length;
  await sleep(30);
  assert.equal(win.inputs.length, fed);
  win.webContents.emit("ipc-message", {}, "ambient:pointer", false);
  point = { x: 600, y: 300 };
  await sleep(30);
  assert.equal(win.inputs.filter((event) => event.type === "mouseLeave").length, 0, "the window heard the pointer leave itself");
  point = { x: 1500, y: 300 };
  await sleep(30);
  point = { x: 600, y: 300 };
  await sleep(30);
  assert.equal(win.inputs.at(-1).type, "mouseLeave");
  const total = win.inputs.length;
  dock.close();
  await sleep(30);
  assert.equal(win.inputs.length, total, "a closed dock is not fed");
});

test("macOS and Windows forward the pointer themselves: nothing is fed", async () => {
  for (const platform of ["darwin", "win32"]) {
    const { BrowserWindow, made } = window();
    const dock = createAmbientWindow({ BrowserWindow, surface: "dock", url: () => "http://127.0.0.1:5199/dock", level: "floating",
      platform, onMessage() {}, cursor: () => ({ x: 1500, y: 300 }), feedEveryMs: 5 });
    dock.place(DOCK_AT);
    await sleep(30);
    assert.deepEqual(made[0].inputs, []);
    dock.close();
  }
});
