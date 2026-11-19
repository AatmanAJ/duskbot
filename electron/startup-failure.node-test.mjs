import assert from "node:assert/strict";
import test from "node:test";
import { plainStartupFailure, STARTUP_TRY_AGAIN } from "./startup-screen.mjs";

test("the startup card says a plain failure as it is", () => {
  assert.equal(plainStartupFailure(new Error("Another copy of dusk bot is already open.")), "Another copy of dusk bot is already open.");
});

test("the startup card never shows a path, an error class, a code or a stack", () => {
  for (const raw of [
    new Error("EACCES: permission denied, open '/Users/sam/Library/Application Support/duskbot/lease'"),
    new Error("TypeError: Cannot read properties of undefined (reading 'port')"),
    "server exited with code 1",
    new Error("listen EADDRINUSE: address already in use 127.0.0.1:8799"),
    "",
  ]) assert.equal(plainStartupFailure(raw), STARTUP_TRY_AGAIN);
});
