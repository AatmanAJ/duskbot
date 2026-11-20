import { test } from "node:test";
import assert from "node:assert/strict";
import { appForPid, createCloudMac, screenJobRefusal } from "./cloud-mac.mjs";

test("a fresh install with no saved prefs file starts from the defaults instead of throwing", () => {
  const missing = () => { throw Object.assign(new Error("ENOENT: no such file or directory, open 'cloud-mac.json'"), { code: "ENOENT" }); };
  const mac = createCloudMac({
    fetch: async () => new Response("{}"), name: () => "test mac", prefs: { read: missing, write: () => {} },
    cloud: () => ({ origin: null, awake: false }), linkKey: async () => null,
  });
  assert.ok(mac);
});

test("cloud bots are on by default, but an unreadable settings file turns them off", () => {
  const base = { fetch: async () => new Response("{}"), name: () => "test mac", cloud: () => ({ origin: null, awake: false }), linkKey: async () => null };
  const missing = () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
  assert.deepEqual(pick(createCloudMac({ ...base, prefs: { read: missing, write: () => {} } }).view()), { enabled: true, screen: true });
  assert.deepEqual(pick(createCloudMac({ ...base, prefs: { read: () => { throw new SyntaxError("Unexpected token"); }, write: () => {} } }).view()), { enabled: false, screen: false });
  assert.deepEqual(pick(createCloudMac({ ...base, prefs: { read: () => ({ enabled: false }), write: () => {} } }).view()), { enabled: false, screen: true });
});

function pick(view) { return { enabled: view.enabled, screen: view.screen }; }

test("the app behind a pid, from list_apps as structured content or JSON text", () => {
  const apps = [{ pid: 42, name: "Notes", bundle_id: "com.apple.Notes" }, { pid: 66, name: "Terminal", bundle_id: "com.apple.Terminal" }];
  assert.equal(appForPid({ structuredContent: { apps } }, 66), "Terminal com.apple.Terminal");
  assert.equal(appForPid({ content: [{ type: "text", text: JSON.stringify({ apps }) }] }, 42), "Notes com.apple.Notes");
  assert.equal(appForPid({ content: [{ type: "text", text: "ran list_apps" }] }, 42), null);
});

test("a screen job the Mac will not run without a card says so, so the cloud can ask", () => {
  const job = { tool: "mac_screen", arguments: { name: "type_text", arguments: { pid: 66, text: "ls" } } };
  assert.deepEqual(screenJobRefusal(job, { screen: true, ready: true, mode: "auto", home: "/Users/sid", target: { app: "Terminal" } })?.ask, "works in an app that can run commands, change the system or hold passwords");
  assert.equal(screenJobRefusal({ ...job, approved: true }, { screen: true, ready: true, mode: "auto", home: "/Users/sid", target: { app: "Terminal" } }), null);
  assert.equal(screenJobRefusal({ tool: "mac_screen_access", arguments: {} }, { screen: true, ready: false, mode: "ask", home: "/Users/sid" })?.ask, "asks before every action");
  assert.equal(screenJobRefusal({ tool: "mac_screen_access", arguments: {} }, { screen: true, ready: false, mode: "auto", home: "/Users/sid" }), null);
});
