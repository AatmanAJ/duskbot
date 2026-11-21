import assert from "node:assert/strict";
import test from "node:test";
import { installCloudPlanIpc, PHONE_SIGN_IN_RENEW_MS } from "./cloud-plan-ipc.mjs";

function install({ present = true, allowed = true } = {}) {
  const handlers = new Map(), asked = [], minted = [];
  let time = 1_000_000;
  installCloudPlanIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    pageSender: (channel, handler) => () => { if (!allowed) throw new Error(`${channel} is only available in this app's window`); return handler(true); },
    account: () => null, notices: () => ({}), homePage: () => false,
    client: () => ({ phoneSignIn: async () => { minted.push(time); return { outcome: "code", code: "ABCD-EFGH", expiresAt: time + 600_000, email: "owner@example.test" }; } }),
    presence: async () => { asked.push(time); return typeof present === "function" ? present() : present; },
    now: () => time,
  });
  const ask = renew => handlers.get("cloud-plan:phone-sign-in")({}, renew);
  return { ask, asked, minted, advance: ms => { time += ms; } };
}

test("a phone sign-in code is only made after main's own presence check, and renewals of a checked screen skip it for a while", async () => {
  const f = install();
  assert.equal((await f.ask(false)).outcome, "code");
  assert.equal(f.asked.length, 1);
  f.advance(9 * 60_000);
  assert.equal((await f.ask(true)).code, "ABCD-EFGH");
  assert.equal(f.asked.length, 1, "a renewal inside the window asks nobody");
  assert.equal((await f.ask(false)).outcome, "code");
  assert.equal(f.asked.length, 2, "a new code the person asked for is checked again");
  f.advance(PHONE_SIGN_IN_RENEW_MS + 1);
  await f.ask(true);
  assert.equal(f.asked.length, 3, "past the window even a renewal asks");
  assert.equal(f.minted.length, 4);
});

test("no code without the person: a failed or cancelled check makes none, and a renew flag never stands in for it", async () => {
  const f = install({ present: false });
  assert.deepEqual(await f.ask(true), { outcome: "canceled" });
  assert.deepEqual(await f.ask(false), { outcome: "canceled" });
  assert.equal(f.minted.length, 0);
});

test("only this app's own pages may ask", async () => {
  const f = install({ allowed: false });
  assert.throws(() => f.ask(false), /only available/);
  assert.equal(f.asked.length, 0);
});
