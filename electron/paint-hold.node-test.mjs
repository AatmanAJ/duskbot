import assert from "node:assert/strict";
import test from "node:test";

import { holdUntilPainted } from "./paint-hold.mjs";

function clock() {
  let at = 0;
  return { now: () => at, wait: async (ms) => { at += ms; } };
}

test("the picture stays up until the next page has drawn, then comes down", async () => {
  const steps = [];
  let looks = 0;
  const c = clock();
  const drawn = await holdUntilPainted({ ...c, timeoutMs: 20_000,
    cover: async () => { steps.push("cover"); return () => steps.push("uncover"); },
    load: async () => { steps.push("load"); return true; },
    painted: async () => { looks++; return looks >= 3; } });
  assert.equal(drawn, true);
  assert.deepEqual(steps, ["cover", "load", "uncover"]);
  assert.equal(looks, 3);
});

test("a failed load, a page that never draws, or no picture at all: the cover comes down and the answer is false or the load goes on", async () => {
  const steps = [];
  const uncover = () => steps.push("uncover");
  assert.equal(await holdUntilPainted({ ...clock(), cover: async () => uncover, load: async () => false, painted: async () => true }), false);
  assert.equal(await holdUntilPainted({ ...clock(), cover: async () => uncover, load: async () => { throw new Error("aborted"); }, painted: async () => true }), false);
  assert.equal(await holdUntilPainted({ ...clock(), timeoutMs: 1_000, cover: async () => uncover, load: async () => true, painted: async () => false }), false);
  assert.deepEqual(steps, ["uncover", "uncover", "uncover"]);
  assert.equal(await holdUntilPainted({ ...clock(), cover: async () => { throw new Error("no picture"); }, load: async () => true, painted: async () => true }), true,
    "no picture: the page still loads");
});
