import { test } from "node:test";
import assert from "node:assert/strict";
import { createCloudMac } from "./cloud-mac.mjs";

test("a fresh install with no saved prefs file starts from the defaults instead of throwing", () => {
  const missing = () => { throw Object.assign(new Error("ENOENT: no such file or directory, open 'cloud-mac.json'"), { code: "ENOENT" }); };
  const mac = createCloudMac({
    fetch: async () => new Response("{}"), name: () => "test mac", prefs: { read: missing, write: () => {} },
    cloud: () => ({ origin: null, awake: false }), linkKey: async () => null,
  });
  assert.ok(mac);
});
