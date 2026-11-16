import { describe, expect, it } from "vitest";
import { botById, groupById, hasMessage, messageById, messagePosition, messagesByThread, storeIndex } from "./store-index";
import type { Bot, Group, Message, Task } from "./store";

const message = (id: string, extra: Partial<Message> = {}): Message => ({ id, role: "bot", kind: "text", text: id, at: 1, ...extra });
const task = (threadId: string): Task => ({ threadId, title: threadId, createdAt: 1 });
const bot = (id: string, threadId: string, tasks: Task[] = [], messages: Message[] = []): Bot =>
  ({ id, threadId, tasks, messages, name: id, title: "", description: "", notifications: true, color: "blue", unread: false, modelSelection: { instanceId: "i", model: "m" } }) as Bot;
const group = (id: string, threadId: string, tasks: Array<{ threadId: string }> = [], messages: Message[] = []): Group =>
  ({ id, threadId, tasks: tasks.map((entry) => ({ ...entry, title: "", createdAt: 1 })), messages, name: id, memberIds: [], defaultResponder: "all", bulletin: "", unread: false, createdAt: 1 }) as unknown as Group;

describe("storeIndex", () => {
  it("finds bots and groups by id and threads by their owners", () => {
    const a = bot("a", "t-a", [task("t-a"), task("t-shared")]);
    const b = bot("b", "t-b", [task("t-shared")]);
    const room = group("g", "t-g", [{ threadId: "t-g2" }]);
    const state = { bots: [a, b], groups: [room] };
    const index = storeIndex(state);
    expect(botById(state, "b")).toBe(b);
    expect(groupById(state, "g")).toBe(room);
    expect(index.botByOpenThread.get("t-a")).toBe(a);
    expect(index.botsByTaskThread.get("t-shared")).toEqual([a, b]);
    expect(index.groupByThread.get("t-g2")).toBe(room);
    expect(botById(state, undefined)).toBeUndefined();
  });

  it("is reused while bots and groups are the same arrays", () => {
    const state = { bots: [bot("a", "t")], groups: [] };
    expect(storeIndex(state)).toBe(storeIndex({ ...state }));
  });

  it("carries the thread maps over to a patched bot and follows a moved thread", () => {
    const tasks = [task("t1"), task("t2")];
    const first = { bots: [bot("a", "t1", tasks), bot("b", "t3")], groups: [] };
    storeIndex(first);
    const patched = { ...first.bots[0]!, unread: true };
    const second = { bots: [patched, first.bots[1]!], groups: [] };
    expect(storeIndex(second).botByOpenThread.get("t1")).toBe(patched);
    expect(storeIndex(second).botsByTaskThread.get("t2")).toEqual([patched]);
    const moved = { ...patched, threadId: "t2" };
    const third = { bots: [moved, first.bots[1]!], groups: [] };
    expect(storeIndex(third).botByOpenThread.get("t2")).toBe(moved);
    expect(storeIndex(third).botByOpenThread.has("t1")).toBe(false);
  });

  it("matches the reducer's order: the first bot with the thread open wins", () => {
    const state = { bots: [bot("a", "t"), bot("b", "t")], groups: [group("g", "x"), group("h", "y", [{ threadId: "x" }])] };
    expect(storeIndex(state).botByOpenThread.get("t")?.id).toBe("a");
    expect(storeIndex(state).groupByThread.get("x")?.id).toBe("g");
  });

  it("gives a thread's open transcript, a bot's or a group's", () => {
    const rows = [message("m1")];
    const roomRows = [message("r1")];
    const state = { bots: [bot("a", "t", [task("t"), task("u")], rows)], groups: [group("g", "gt", [{ threadId: "gt2" }], roomRows)] };
    expect(messagesByThread(state, "t")).toBe(rows);
    expect(messagesByThread(state, "gt")).toBe(roomRows);
    expect(messagesByThread(state, "u")).toBeUndefined();
    expect(messagesByThread(state, "gt2")).toBeUndefined();
  });
});

describe("message positions", () => {
  const rows = (count: number, prefix = "m") => Array.from({ length: count }, (_, index) => message(`${prefix}${index}`));

  it("matches findIndex on short and long transcripts", () => {
    for (const list of [rows(5), rows(300)]) {
      for (const id of [list[0]!.id, list[list.length - 1]!.id, list[2]!.id, "missing"]) {
        expect(messagePosition(list, id)).toBe(list.findIndex((one) => one.id === id));
      }
    }
  });

  it("extends an indexed transcript on append and still sees every row", () => {
    const base = rows(200);
    expect(hasMessage(base, "m10")).toBe(true);
    const appended = [...base, message("new")];
    expect(messagePosition(appended, "new")).toBe(200);
    expect(messagePosition(appended, "m199")).toBe(199);
    expect(hasMessage(base, "new")).toBe(false);
  });

  it("follows a patched row and an optimistic row swapped for the server's", () => {
    const base = [...rows(100), message("opt-1")];
    expect(messagePosition(base, "opt-1")).toBe(100);
    const patched = base.map((row, index) => index === 50 ? { ...row, text: "patched" } : row);
    expect(messageById(patched, "m50")?.text).toBe("patched");
    const swapped = base.map((row) => row.id === "opt-1" ? message("real-1") : row);
    expect(hasMessage(swapped, "opt-1")).toBe(false);
    expect(messagePosition(swapped, "real-1")).toBe(100);
    const after = [...swapped, message("next")];
    expect(hasMessage(after, "real-1")).toBe(true);
    expect(hasMessage(after, "opt-1")).toBe(false);
  });

  it("is not fooled by a prepend or a removal", () => {
    const base = rows(120);
    expect(hasMessage(base, "m5")).toBe(true);
    const older = [...rows(30, "old"), ...base];
    expect(messagePosition(older, "m0")).toBe(30);
    expect(messagePosition(older, "old0")).toBe(0);
    const removed = base.filter((row) => row.id !== "m60");
    expect(hasMessage(removed, "m60")).toBe(false);
    expect(messagePosition(removed, "m61")).toBe(60);
  });

  it("keeps the first of two rows with one id, as findIndex does", () => {
    const base = [...rows(40), message("dup"), ...rows(40, "n"), message("dup")];
    expect(messagePosition(base, "dup")).toBe(40);
    const appended = [...base, message("dup2")];
    expect(messagePosition(appended, "dup")).toBe(40);
  });
});
