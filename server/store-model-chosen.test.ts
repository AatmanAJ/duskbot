import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";

beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });
const free = { instanceId: "opencodeGo", model: "opencode/deepseek-v4-free" };
const fallback = () => ({ instanceId: "claude", model: "claude-sonnet-5" });

it("remembers across a restart that the person picked a bot's AI, and forgets it when the app moves the bot", () => {
  const store = new Store(fallback);
  const bot = store.createBot({}, { seedMessages: false });
  store.switchTaskModel(bot.id, bot.threadId, free, true, false, { modelChosen: true });
  const reloaded = new Store(fallback);
  expect(reloaded.bot(bot.id)).toMatchObject({ modelSelection: free, modelChosen: true });
  reloaded.applyModelDefault(bot.id, fallback());
  expect(reloaded.bot(bot.id)?.modelChosen).toBeUndefined();
});

it("marks a conversation's own pick, and an app switch (a limit takeover) leaves it unmarked", () => {
  const store = new Store(fallback);
  const bot = store.createBot({}, { seedMessages: false });
  const second = store.createTask(bot.id, "Second")!;
  store.switchTaskModel(bot.id, second.threadId, free, false, false, { modelChosen: true });
  expect(store.taskByThread(bot.id, second.threadId)).toMatchObject({ modelSelection: free, modelChosen: true });
  expect(store.bot(bot.id)?.modelChosen).toBeUndefined();
  store.switchTaskModel(bot.id, second.threadId, { instanceId: "codex", model: "gpt" }, false, false);
  expect(store.taskByThread(bot.id, second.threadId)?.modelChosen).toBeUndefined();
  store.switchTaskModel(bot.id, second.threadId, free, false, false, { modelChosen: true });
  store.followBotModel(bot.id, [second.threadId]);
  expect(store.taskByThread(bot.id, second.threadId)).toMatchObject({ modelSelection: undefined, modelChosen: undefined });
});
