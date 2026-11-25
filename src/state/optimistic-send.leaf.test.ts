import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, reducer, visibleMessages, type Bot, type Message } from "./store";

const rows: Message[] = [
  { id: "a", role: "user", kind: "text", text: "hi", at: 1, parentId: null },
  { id: "b", role: "bot", kind: "text", text: "hello", at: 2, parentId: "a" },
];
const bot = (activeLeafId: string | null | undefined): Bot => ({
  id: "bot", threadId: "thread", name: "Nova", title: "", description: "", notifications: true, color: "green", unread: false,
  busy: false, activity: "idle", modelSelection: { instanceId: "default", model: "m" }, approvalMode: "ask", alwaysAllow: [],
  messages: rows, activeLeafId,
} as Bot);
const sent = (activeLeafId: string | null | undefined) => {
  const state = reducer({ ...initialState, bots: [bot(activeLeafId)], selectedId: "bot" }, { type: "send", botId: "bot", threadId: "thread", text: "next", sendId: "s1" });
  return visibleMessages(state.bots[0]!).map((message) => message.id);
};

describe("a send's optimistic row", () => {
  it("joins the conversation on screen when the held leaf is unknown, so the chat never shows the send alone", () => {
    expect(sent(undefined)).toEqual(["a", "b", "optimistic-s1"]);
    expect(sent(null)).toEqual(["a", "b", "optimistic-s1"]);
    // a leaf the transcript does not hold (a pointer that came before its message)
    expect(sent("not-loaded")).toEqual(["a", "b", "optimistic-s1"]);
  });

  it("follows the held leaf when it is a loaded message", () => {
    expect(sent("b")).toEqual(["a", "b", "optimistic-s1"]);
    // an older branch the person switched to
    expect(sent("a")).toEqual(["a", "optimistic-s1"]);
  });
});

describe("a snapshot that left before a send and lands after it", () => {
  // seen on a slow link: the chat's snapshot was asked for just before the send and answered 2.5 s later, with the
  // thread as it was before the send; the send, its server copy and the reply then never showed
  const hydrateBehind = (state: ReturnType<typeof reducer>) => reducer(state, {
    type: "hydrate", bots: [bot("b")], groups: [], computerControl: {}, loadedThreads: ["thread"],
  });
  const ids = (state: ReturnType<typeof reducer>) => visibleMessages(state.bots[0]!).map((message) => message.id);
  const copy: Message = { id: "u1", role: "user", kind: "text", text: "next", at: 3, parentId: "b", sendId: "s1" };
  const reply: Message = { id: "r1", role: "bot", kind: "text", text: "ok", at: 4, parentId: "u1" };

  it("keeps the send on screen, and its server copy and the reply follow it", () => {
    let state = reducer({ ...initialState, bots: [bot("b")], selectedId: "bot" }, { type: "send", botId: "bot", threadId: "thread", text: "next", sendId: "s1" });
    state = hydrateBehind(state);
    expect(ids(state)).toEqual(["a", "b", "optimistic-s1"]);
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: copy });
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: reply });
    expect(ids(state)).toEqual(["a", "b", "u1", "r1"]);
  });

  it("a send's server copy parented on the leaf takes the leaf even when the leaf had left the optimistic row", () => {
    const optimistic: Message = { id: "optimistic-s1", role: "user", kind: "text", text: "next", at: 3, parentId: "b", sendId: "s1" };
    let state = reducer(initialState, { type: "hydrate", bots: [{ ...bot("b"), messages: [...rows, optimistic] }], groups: [], computerControl: {}, loadedThreads: ["thread"] });
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: copy });
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: reply });
    expect(ids(state)).toEqual(["a", "b", "u1", "r1"]);
  });

  it("still takes the server's leaf when it names another branch", () => {
    const other: Message = { id: "c", role: "bot", kind: "text", text: "another answer", at: 2, parentId: "a" };
    const branched = (leaf: string) => ({ ...bot(leaf), messages: [...rows, other] });
    let state = reducer({ ...initialState, bots: [branched("b")], selectedId: "bot" }, { type: "send", botId: "bot", threadId: "thread", text: "next", sendId: "s1" });
    state = reducer(state, { type: "hydrate", bots: [branched("c")], groups: [], computerControl: {}, loadedThreads: ["thread"] });
    expect(state.bots[0]!.activeLeafId).toBe("c");
  });
});

describe("a follow-up typed while the server was down, then a reconnect snapshot whose leaf is a restart row under the follow-up's parent", () => {
  const resumed: Message = { id: "c", role: "bot", kind: "activity", at: 4, parentId: "b", tool: { name: "Resuming after a restart", ok: true } };
  const copy: Message = { id: "u1", role: "user", kind: "text", text: "next", at: 5, parentId: "c", sendId: "s1" };
  const ids = (state: ReturnType<typeof reducer>) => visibleMessages(state.bots[0]!).map((message) => message.id);
  const sentThen = () => reducer({ ...initialState, bots: [bot("b")], selectedId: "bot" }, { type: "send", botId: "bot", threadId: "thread", text: "next", sendId: "s1" });
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(3); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps the send on screen under the server's new leaf from a hydrate, and its server copy takes its place", () => {
    let state = reducer(sentThen(), { type: "hydrate", bots: [{ ...bot("c"), messages: [...rows, resumed] }], groups: [], computerControl: {}, loadedThreads: ["thread"] });
    expect(ids(state)).toEqual(["a", "b", "c", "optimistic-s1"]);
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: copy });
    expect(ids(state)).toEqual(["a", "b", "c", "u1"]);
  });

  it("keeps the send on screen under the server's new leaf from a stale chat's snapshot", () => {
    const sent = sentThen();
    const stale = { ...sent, bots: sent.bots.map((candidate) => ({ ...candidate, transcriptStale: true })) };
    const state = reducer(stale, {
      type: "transcriptSnapshot", threadId: "thread", messages: [...rows, resumed], hasMore: false, activeLeafId: "c",
      generation: stale.transcriptGeneration.thread ?? 0, heldAtStart: stale.bots[0]!.messages, leafAtStart: "optimistic-s1",
    });
    expect(ids(state)).toEqual(["a", "b", "c", "optimistic-s1"]);
  });

  it("keeps two sends in the order they were typed", () => {
    let state = reducer(sentThen(), { type: "send", botId: "bot", threadId: "thread", text: "and this", sendId: "s2" });
    state = reducer(state, { type: "hydrate", bots: [{ ...bot("c"), messages: [...rows, resumed] }], groups: [], computerControl: {}, loadedThreads: ["thread"] });
    expect(ids(state)).toEqual(["a", "b", "c", "optimistic-s1", "optimistic-s2"]);
  });

  it("still takes the server's leaf when it is on another branch", () => {
    const other: Message = { id: "d", role: "bot", kind: "text", text: "another answer", at: 4, parentId: "a" };
    const state = reducer(sentThen(), { type: "hydrate", bots: [{ ...bot("d"), messages: [...rows, other] }], groups: [], computerControl: {}, loadedThreads: ["thread"] });
    expect(state.bots[0]!.activeLeafId).toBe("d");
  });
});

describe("an edit or Try again of the last message, then a snapshot still naming the old answer as the leaf", () => {
  const asked: Message = { id: "c", role: "user", kind: "text", text: "question", at: 3, parentId: "b" };
  const answered: Message = { id: "d", role: "bot", kind: "text", text: "old answer", at: 4, parentId: "c" };
  const thread = [...rows, asked, answered];
  const ids = (state: ReturnType<typeof reducer>) => visibleMessages(state.bots[0]!).map((message) => message.id);
  const edited = (text: string) => reducer({ ...initialState, bots: [{ ...bot("d"), messages: thread }], selectedId: "bot" }, {
    type: "editMessage", botId: "bot", threadId: "thread", messageId: "c", text, sendId: "s1",
  });
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10); });
  afterEach(() => { vi.useRealTimers(); });

  it.each([["an edit", "a better question"], ["Try again", "question"]])("never draws %s under the old answer, and leaves it on its own branch", (_, text) => {
    let state = edited(text);
    expect(ids(state)).toEqual(["a", "b", "optimistic-s1"]);
    state = reducer(state, { type: "hydrate", bots: [{ ...bot("d"), messages: thread }], groups: [], computerControl: {}, loadedThreads: ["thread"] });
    expect(ids(state)).not.toContain("optimistic-s1");
    expect(state.bots[0]!.messages.find((message) => message.id === "optimistic-s1")?.parentId).toBe("b");
  });
});
