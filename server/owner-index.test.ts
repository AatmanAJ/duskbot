import { describe, expect, it } from "vitest";

import { OwnerIndex } from "./owner-index.ts";

type Owner = { id: string; threadId: string; tasks?: Array<{ threadId: string; title?: string }> };

const owner = (id: string, threads: string[]): Owner => ({ id, threadId: threads[0]!, tasks: threads.map((threadId) => ({ threadId })) });
const search = (list: Owner[], threadId: string) => list.find((o) => o.threadId === threadId || o.tasks?.some((t) => t.threadId === threadId));

describe("OwnerIndex", () => {
  it("answers what a front-to-back search answers through every way the store changes its lists", () => {
    let list: Owner[] = [owner("a", ["a1", "a2"]), owner("b", ["b1"]), owner("c", ["c1", "c2", "c3"])];
    const index = new OwnerIndex(() => list);
    const agree = () => {
      for (const o of list) expect(index.byId(o.id)).toBe(o);
      for (const threadId of ["a1", "a2", "a3", "b1", "b2", "c1", "c2", "c3", "d1", "missing"]) {
        const hit = index.thread(threadId);
        expect(hit?.owner).toBe(search(list, threadId));
        if (hit && hit.task >= 0) expect(hit.owner.tasks![hit.task]!.threadId).toBe(threadId);
      }
      expect(index.byId("missing")).toBeUndefined();
    };
    agree();
    list[0]!.tasks!.unshift({ threadId: "a3" }); // in place, longer
    agree();
    list[2]!.tasks!.splice(1, 1); // in place, shorter
    agree();
    list[1]!.tasks = [...list[1]!.tasks!, { threadId: "b2" }]; // a new list
    agree();
    list.unshift(owner("d", ["d1"])); // a new owner in front
    agree();
    list.splice(0, list.length, list[3]!, list[2]!, list[1]!, list[0]!); // reordered in place
    agree();
    list = list.filter((o) => o.id !== "b"); // removed
    agree();
    list[0]!.threadId = "c3"; // another open thread
    agree();
    const [first, second] = list[0]!.tasks!;
    list[0]!.tasks!.splice(0, 2, second!, first!); // same length, swapped
    agree();
  });

  it("finds an open thread an owner does not list", () => {
    const list: Owner[] = [{ id: "a", threadId: "open", tasks: [{ threadId: "other" }] }];
    const index = new OwnerIndex(() => list);
    expect(index.thread("open")).toEqual({ owner: list[0], task: -1 });
    list[0]!.tasks!.push({ threadId: "open" });
    expect(index.thread("open")).toEqual({ owner: list[0], task: 1 });
  });

  it("rebuilds at most once per change, not once per lookup", () => {
    const list: Owner[] = Array.from({ length: 50 }, (_, i) => owner(`o${i}`, Array.from({ length: 50 }, (_, t) => `o${i}-t${t}`)));
    let reads = 0;
    const index = new OwnerIndex(() => { reads++; return list; });
    const rebuilds = () => (index as unknown as { owners: Owner[] }).owners;
    index.byThread("o0-t0");
    const built = rebuilds();
    for (let i = 0; i < 1000; i++) index.byThread(`o${i % 50}-t${i % 50}`);
    for (let i = 0; i < 1000; i++) index.byThread(`missing-${i}`);
    expect(rebuilds()).toBe(built);
    expect(reads).toBe(2001);
  });
});
