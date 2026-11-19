import assert from "node:assert/strict";
import test from "node:test";
import { startupFailureWords } from "./startup-screen.mjs";

test("the startup card says the real error", () => {
  assert.equal(startupFailureWords(new Error("listen EADDRINUSE: address already in use 127.0.0.1:8799")), "listen EADDRINUSE: address already in use 127.0.0.1:8799");
  assert.equal(startupFailureWords("the server exited"), "the server exited");
});

test("the startup card writes a home folder as ~ and keeps a stack's first line", () => {
  assert.equal(startupFailureWords(new Error("EACCES: permission denied, open '/Users/sam/Library/Application Support/duskbot/lease'")),
    "EACCES: permission denied, open '~/Library/Application Support/duskbot/lease'");
  assert.equal(startupFailureWords(Object.assign(new Error("x"), { message: "boom\n    at main (/Users/sam/app.js:1:1)" })), "boom");
});
