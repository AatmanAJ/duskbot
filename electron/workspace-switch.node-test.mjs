import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createWorkspaceSwitch, HANDED_LOOK_MS, handedLook, installWorkspaceSwitchIpc } from "./workspace-switch.mjs";

function fakeWindow() {
  const contents = new EventEmitter();
  contents.sent = [];
  contents.send = (channel, value) => contents.sent.push([channel, value]);
  return { webContents: contents, destroyed: false, isDestroyed() { return this.destroyed; } };
}
const LOOK = { crew: "kit", color: "blue", mood: "searching", elapsed: 0 };

test("a switch covers the page at the click and uncovers it when it ends without a new page", async () => {
  const win = fakeWindow();
  const sw = createWorkspaceSwitch({ window: () => win });
  const answer = await sw.around(async () => {
    assert.deepEqual(win.webContents.sent, [["workspaces:switching", true]], "covered before the switch does anything");
    return "done";
  });
  assert.equal(answer, "done");
  assert.deepEqual(win.webContents.sent, [["workspaces:switching", true], ["workspaces:switching", false]]);
  assert.equal(win.webContents.listenerCount("did-start-navigation"), 0);
});

test("a switch that opens a new page leaves the cover to that page", async () => {
  const win = fakeWindow();
  const sw = createWorkspaceSwitch({ window: () => win });
  await sw.around(async () => { win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false }); });
  assert.deepEqual(win.webContents.sent, [["workspaces:switching", true]]);
});

test("a hash change or a frame's navigation is no new page", async () => {
  const win = fakeWindow();
  const sw = createWorkspaceSwitch({ window: () => win });
  await sw.around(async () => {
    win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    win.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  });
  assert.deepEqual(win.webContents.sent.at(-1), ["workspaces:switching", false]);
});

test("a switch that throws still uncovers the page", async () => {
  const win = fakeWindow();
  const sw = createWorkspaceSwitch({ window: () => win });
  await assert.rejects(sw.around(async () => { throw new Error("no"); }));
  assert.deepEqual(win.webContents.sent.at(-1), ["workspaces:switching", false]);
});

test("a switch inside another is one switch", async () => {
  const win = fakeWindow();
  const sw = createWorkspaceSwitch({ window: () => win });
  await sw.around(() => sw.around(async () => {}));
  assert.deepEqual(win.webContents.sent, [["workspaces:switching", true], ["workspaces:switching", false]]);
});

test("no window: nothing is sent", async () => {
  const sw = createWorkspaceSwitch({ window: () => null });
  assert.equal(await sw.around(async () => 1), 1);
});

test("the mascot handed on is taken once, while fresh, and dropped when the switch ends in place", async () => {
  let now = 1_000;
  const win = fakeWindow();
  const sw = createWorkspaceSwitch({ window: () => win, now: () => now });
  sw.hand({ ...LOOK, elapsed: 300 });
  now += 500;
  assert.deepEqual(sw.take(), { ...LOOK, elapsed: 800 });
  assert.equal(sw.take(), null, "once");
  sw.hand(LOOK);
  now += HANDED_LOOK_MS + 1;
  assert.equal(sw.take(), null, "stale");
  await sw.around(async () => { sw.hand(LOOK); });
  assert.equal(sw.take(), null, "the switch ended on the same page");
});

test("only a well-formed mascot is kept", () => {
  assert.equal(handedLook(null), null);
  assert.equal(handedLook({ ...LOOK, crew: "<img>" }), null);
  assert.equal(handedLook({ ...LOOK, elapsed: -1 }), null);
  assert.equal(handedLook({ ...LOOK, elapsed: Number.NaN }), null);
  assert.equal(handedLook({ ...LOOK, elapsed: 1e9 }).elapsed, HANDED_LOOK_MS);
});

test("the ink and ground go along only as plain colours", () => {
  assert.deepEqual(handedLook({ ...LOOK, ink: "#2fd27a", ground: "rgb(253, 253, 253)" }), { ...LOOK, ink: "#2fd27a", ground: "rgb(253, 253, 253)" });
  assert.deepEqual(handedLook({ ...LOOK, ink: "#2fd27a", ground: "url(https://x)" }), LOOK);
  assert.deepEqual(handedLook({ ...LOOK, ink: "red;position:absolute", ground: "#fff" }), LOOK);
});

test("only the window's own page hands on or takes a mascot", () => {
  const win = fakeWindow(), other = fakeWindow();
  const handlers = new Map();
  const sw = createWorkspaceSwitch({ window: () => win });
  installWorkspaceSwitchIpc({ ipcMain: { on: (channel, fn) => handlers.set(channel, fn) }, workspaceSwitch: sw, window: () => win });
  handlers.get("workspaces:switch-look")({ sender: other.webContents }, LOOK);
  const nothing = { sender: win.webContents };
  handlers.get("workspaces:switch-look-take")(nothing);
  assert.equal(nothing.returnValue, null, "another page's mascot was never kept");
  handlers.get("workspaces:switch-look")({ sender: win.webContents }, LOOK);
  const fromOther = { sender: other.webContents };
  handlers.get("workspaces:switch-look-take")(fromOther);
  assert.equal(fromOther.returnValue, null);
  const own = { sender: win.webContents };
  handlers.get("workspaces:switch-look-take")(own);
  assert.equal(own.returnValue.crew, "kit");
});

test("the page a switch opened knows it, for a while; a switch that stays on its page opens none", async () => {
  const win = fakeWindow();
  let clock = 1_000;
  const handlers = new Map();
  const sw = createWorkspaceSwitch({ window: () => win, now: () => clock });
  installWorkspaceSwitchIpc({ ipcMain: { on: (channel, fn) => handlers.set(channel, fn) }, workspaceSwitch: sw, window: () => win });
  const ask = (sender = win.webContents) => { const event = { sender }; handlers.get("workspaces:switch-arrived")(event); return event.returnValue; };
  await sw.around(async () => {});
  assert.equal(ask(), false);
  await sw.around(async () => { win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false }); });
  assert.equal(ask(), true);
  assert.equal(ask(fakeWindow().webContents), false, "only the window's own page");
  clock += HANDED_LOOK_MS + 1;
  assert.equal(ask(), false);
});
