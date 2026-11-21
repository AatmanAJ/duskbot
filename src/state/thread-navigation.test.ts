import { afterEach, describe, expect, it, vi } from "vitest";
import { setTeamChats } from "./team-chats";
import { markedThread, openBotRow, openRoomThread } from "./thread-navigation";

type Task = { threadId: string; activity?: string; unread?: boolean; busy?: boolean; routineRunId?: string; archivedAt?: number; createdAt?: number; updatedAt?: number };
const chief = (tasks: Task[], threadId = "main", mainThreadId = "main") => ({ id: "cos", threadId, mainThreadId, tasks: [{ threadId: "main", createdAt: 1 }, ...tasks] });
const opened = (bot: ReturnType<typeof chief>, onScreen = false) => {
  const dispatch = vi.fn();
  openBotRow(dispatch, bot, onScreen);
  return dispatch.mock.calls.map(([action]) => action);
};

afterEach(() => setTeamChats(null));

describe("what a bot's row or tile is marked for", () => {

  it("is only a question waiting on the person while threads are hidden, the bot being one conversation", () => {
    const working = { threadId: "work", busy: true }, unread = { threadId: "reply", unread: true }, waiting = { threadId: "ask", activity: "waiting-on-you" };
    expect(markedThread(chief([working, unread]))).toBeNull();
    expect(markedThread(chief([working, unread, waiting]))).toBe("ask");
  });

  it("is the newest of equals, unless the thread the bot opens to is one of them", () => {
    const older = { threadId: "older", activity: "waiting-on-you", updatedAt: 5 }, newer = { threadId: "newer", activity: "waiting-on-you", updatedAt: 9 };
    expect(markedThread(chief([older, newer]))).toBe("newer");
    expect(markedThread({ ...chief([older, newer]), tasks: [{ threadId: "main", activity: "waiting-on-you", createdAt: 1 }, older, newer] })).toBe("main");
  });

  it("is never a routine's run, nor an archived thread unless it waits on the person, as the row's own dot reads them", () => {
    expect(markedThread(chief([{ threadId: "run", busy: true, routineRunId: "r" }]))).toBeNull();
    expect(markedThread(chief([{ threadId: "put-away", unread: true, archivedAt: 1 }]))).toBeNull();
    expect(markedThread(chief([{ threadId: "put-away", activity: "waiting-on-you", archivedAt: 0 }]))).toBe("put-away");
  });

  it("is nothing on a quiet bot", () => {
    expect(markedThread(chief([{ threadId: "quiet" }]))).toBeNull();
    expect(markedThread({ id: "x", threadId: "t" } as unknown as ReturnType<typeof chief>)).toBeNull();
  });
});

describe("a click on a bot's row or tile", () => {
  const work = { threadId: "work", unread: true };

  it("opens the bot's one conversation while threads are hidden, whatever another of its threads is unread for", () => {
    expect(opened(chief([work]))).toEqual([{ type: "select", id: "cos" }]);
  });

  it("opens the conversation the bot is working in, such as a job another bot handed it, not the last one the person wrote in", () => {
    const to = (threadId: string) => [{ type: "switchTask", botId: "cos", threadId }];
    expect(opened(chief([{ threadId: "handoff", busy: true }]))).toEqual(to("handoff"));
    expect(opened(chief([{ threadId: "handoff", activity: "working" }]))).toEqual(to("handoff"));
    expect(opened({ ...chief([]), tasks: [{ threadId: "main", busy: true, createdAt: 1 }, { threadId: "handoff", busy: true }] })).toEqual([{ type: "select", id: "cos" }]);
    expect(opened(chief([{ threadId: "handoff", busy: true }, { threadId: "ask", activity: "waiting-on-you" }]))).toEqual(to("ask"));
    expect(opened(chief([{ threadId: "run", busy: true, routineRunId: "r" }, { threadId: "old", busy: true, archivedAt: 1 }]))).toEqual([{ type: "select", id: "cos" }]);
  });


  it("comes back to the main chat from another thread while threads are hidden", () => {
    expect(opened(chief([{ threadId: "work", busy: true }], "work"), true)).toEqual([{ type: "switchTask", botId: "cos", threadId: "main" }]);
  });

  it("opens the bot as ever when nothing is marked, or when the main chat itself is what is marked", () => {
    expect(opened(chief([{ threadId: "quiet" }]))).toEqual([{ type: "select", id: "cos" }]);
    expect(opened({ ...chief([work]), tasks: [{ threadId: "main", unread: true, createdAt: 1 }, { threadId: "work" }] })).toEqual([{ type: "select", id: "cos" }]);
  });

  it("leaves a team's Cloud alone: there a bot's row is the person's own conversation", () => {
    setTeamChats({ teamId: "acme", member: true });
    const bot = { ...chief([work]), tasks: [{ threadId: "mine", private: true, createdAt: 3 }, work] };
    expect(opened(bot as ReturnType<typeof chief>)).toEqual([{ type: "switchTask", botId: "cos", threadId: "mine" }]);
  });
});

describe("a hand-off's chip for work in a room", () => {
  const room = { id: "room", threadId: "room-now", tasks: [{ threadId: "room-now" }, { threadId: "room-older" }] };
  const clicked = (comm: { groupId: string; threadId?: string }) => {
    const dispatch = vi.fn();
    openRoomThread(dispatch, comm, [room]);
    return dispatch.mock.calls.map(([action]) => action);
  };

  it("lands on the thread it names, not whichever the room is on", () => {
    expect(clicked({ groupId: "room", threadId: "room-older" })).toEqual([{ type: "select", id: "room" }, { type: "switchGroupTask", groupId: "room", threadId: "room-older" }]);
  });

  it("opens the room when it names no thread, or one the room no longer has", () => {
    expect(clicked({ groupId: "room" })).toEqual([{ type: "select", id: "room" }]);
    expect(clicked({ groupId: "room", threadId: "deleted" })).toEqual([{ type: "select", id: "room" }]);
  });
});
