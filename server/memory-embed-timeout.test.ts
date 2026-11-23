import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const workers: FakeWorker[] = [];

class FakeWorker extends EventEmitter {
  killed = false;
  channel = { ref() {}, unref() {} };
  readonly answers: boolean;
  constructor(answers: boolean) {
    super();
    this.answers = answers;
  }
  unref() {}
  send(message: { id: number; texts: string[] }, done: (error: Error | null) => void) {
    done(null);
    if (this.answers) setTimeout(() => this.emit("message", { id: message.id, ok: true, value: message.texts.map(() => new Float32Array([1, 0])) }), 1);
  }
  kill() {
    this.killed = true;
    setTimeout(() => this.emit("exit", null, "SIGTERM"), 1);
    return true;
  }
}

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  fork: () => {
    const next = new FakeWorker(workers.length > 0);
    workers.push(next);
    return next;
  },
}));

const { embedIn, stopEmbedder } = await import("./memory-embed.ts");

afterEach(() => {
  stopEmbedder();
  workers.length = 0;
});

describe("local embedding worker", () => {
  it("gives up on a worker that never answers, so the recall goes on without vectors and the next one gets a fresh worker", async () => {
    const hung = embedIn("/models", ["what is my sister's email?"], 50);
    const queued = embedIn("/models", ["the gym on Fridays"], 1_000);
    expect(await hung).toBeNull();
    expect(workers[0]?.killed).toBe(true);
    expect(await queued).toEqual([new Float32Array([1, 0])]);
    expect(workers).toHaveLength(2);
  });
});
