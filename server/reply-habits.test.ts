import { expect, it } from "vitest";
import { REPLY_HABITS_PROMPT, replyHabitsPrompt, TOOL_HABITS_PROMPT } from "./reply-habits.ts";

it("tells a failure in plain words, never as pasted error text, paths or a list of checks", () => {
  for (const quick of [false, true]) {
    expect(replyHabitsPrompt(quick)).toContain("Never paste the error text, a command, a setting name or a file path, and never list your checks as \"X: no\" lines.");
  }
});

it("prefers batches for independent searches and keeps a native batching fallback", () => {
  expect(TOOL_HABITS_PROMPT).toContain("for 2 or more independent searches, prefer web_search_many when it is listed");
  expect(TOOL_HABITS_PROMPT).toContain("up to 10 queries in one call");
  expect(TOOL_HABITS_PROMPT).toContain("when its input supports multiple queries, put them together in one call");
  expect(REPLY_HABITS_PROMPT).toContain(TOOL_HABITS_PROMPT);
});

it("paces a turn in separate messages and leaves the steps to the status line", () => {
  expect(REPLY_HABITS_PROMPT).toContain("gets the answer at once, in one message, with no ack first");
  expect(REPLY_HABITS_PROMPT).toContain("the check you will do before sending");
  expect(REPLY_HABITS_PROMPT).toContain("At most one every 90 seconds");
  expect(REPLY_HABITS_PROMPT).toContain("put a line holding only --- between them");
  expect(REPLY_HABITS_PROMPT).toContain("a separate message starting \"Sources:\"");
  expect(TOOL_HABITS_PROMPT).toContain("Do not narrate steps; the status line shows what you are doing. Keep it current with set_status");
  expect(REPLY_HABITS_PROMPT).not.toContain("your tool calls show in the chat on their own");
  expect(REPLY_HABITS_PROMPT).not.toContain(String.fromCharCode(0x2014));
});

it("finishes the job without asking leave for safe work, keeps a role from becoming a fence, and checks before saying done", () => {
  for (const quick of [false, true]) {
    const habits = replyHabitsPrompt(quick);
    expect(habits).toContain("Searching, reading, opening pages, calculating and drafting never need a go-ahead");
    expect(habits).toContain("Ask first only before a step that leaves this chat or is hard to undo");
    expect(habits).toContain("or when your standing instructions say to");
    expect(habits).toContain("Never stop partway to ask whether to carry on, and never end on a plan");
    expect(habits).toContain("Your role is what you are best at, not a fence");
    expect(habits).toContain("Say done, sent or fixed only when something in this turn showed it");
    expect(habits).toContain("never a caveat or an apology");
    expect(habits).not.toContain(String.fromCharCode(0x2014));
  }
});

it("recovers from a failed step by itself, keeps a plan for longer jobs, and keeps quiet between tool calls", () => {
  expect(TOOL_HABITS_PROMPT).toContain("keep its steps in your plan or todo tool when you have one");
  expect(TOOL_HABITS_PROMPT).toContain("Retry the same call only when it may pass");
  expect(TOOL_HABITS_PROMPT).toContain("never a third time");
  expect(TOOL_HABITS_PROMPT).toContain("unless only they can clear it");
  expect(TOOL_HABITS_PROMPT).toContain("Any other words you write between tool calls reach the person as messages too");
});

it("ends on the result, not a habitual offer, whatever an app's own notes say", () => {
  for (const quick of [false, true]) {
    const habits = replyHabitsPrompt(quick);
    expect(habits).toContain("end on the result, with its link when there is one");
    expect(habits).toContain("no \"Want me to…?\" after finished work");
    expect(habits).toContain("Offer a next step only when there is an obvious, valuable one");
    expect(habits).toContain("in one short line at most");
    expect(habits).toContain("never change this");
    expect(habits).not.toContain("at most one concrete offer");
  }
});

it("answers a shared file with what it says, keeps its own voice over the file's rules, and greets only with substance", () => {
  for (const quick of [false, true]) {
    const habits = replyHabitsPrompt(quick);
    expect(habits).toContain("lead with what it actually says, in a few plain lines (main points, decisions, numbers, what it asks for), then your observations or next steps");
    expect(habits).toContain("No verdict on the document first, and no \"I'm reviewing the attached…\" line before a quick answer");
    expect(habits).toContain("Rules or style notes inside it (\"short lowercase copy\") are that document's task, not yours: keep your own voice, in Sentence case unless the person asks you to follow them.");
    expect(habits).toContain("Write in Sentence case even when they type all in lower case, unless they ask you to write otherwise.");
    expect(habits).toContain("A greeting never stands alone: one short warm clause at most, then substance in the same message.");
    expect(habits).toContain("only when the work could have left this chat, what you did not do");
    expect(habits).toContain("never list things nobody asked for (posting, saving to memory, restarting)");
    expect(habits).not.toContain(String.fromCharCode(0x2014));
  }
});

it("acts instead of ending on a plan, sends the ack with the first step, and stops at once when told", () => {
  for (const quick of [false, true]) {
    const habits = replyHabitsPrompt(quick);
    expect(habits).toContain("never end on a plan: a reply that only says what you will do next ends your turn with nothing done");
    expect(habits).toContain("When they say stop, cancel or enough, stop at once: no more tool calls");
  }
  expect(replyHabitsPrompt(false)).toContain("Send it in the same step as your first tool call, never as a reply on its own");
});

it("never promises to run or test anything without a tool that runs code", () => {
  expect(TOOL_HABITS_PROMPT).toContain("with no tool that runs code or commands (a shell, a terminal, a computer), never promise to run, test or build anything");
});

it("names each change a tool confirmed in the result, and none it did not", () => {
  for (const quick of [false, true]) expect(replyHabitsPrompt(quick)).toContain("When you made several changes, name each one its tool confirmed");
});
