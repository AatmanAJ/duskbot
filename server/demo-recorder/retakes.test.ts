import { afterEach, describe, expect, it } from "vitest";

import type { DemoRecording } from "../../shared/demo-recording.ts";
import { DemoRecorder } from "./recorder.ts";
import { replayDemo } from "./replay.ts";
import { ExpensePortal } from "./testing/expense-portal.ts";
import { FakeBrowser } from "./testing/fake-browser.ts";

const BOT = "bot-ada";
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

async function atLogin(scripts: boolean) {
  const portal = await ExpensePortal.start();
  const browser = new FakeBrowser({ scriptsOnNewDocuments: scripts });
  cleanup.push(() => portal.close(), () => browser.close());
  await browser.goto(portal.url("/login"));
  const recorder = new DemoRecorder({ port: async () => browser.port(), held: () => true, saveSkill: (_botId, skill) => ({ name: skill.name }), pollMs: 60_000 });
  const shown = async () => (await recorder.sync(BOT)).steps.map((step) => `${step.kind}${step.value === undefined ? "" : ` ${step.value}`}`);
  return { portal, browser, recorder, shown };
}

describe.each([{ scripts: true }, { scripts: false }])("recording again (scripts on new documents: $scripts)", ({ scripts }) => {
  it("starts a second recording with nothing done before it, in the same page", async () => {
    const { browser, recorder, shown, portal } = await atLogin(scripts);
    await recorder.start(BOT, "browser");
    await browser.person.type("[name=uid]", "ada");
    expect(await shown()).toEqual(["open", "fill ada"]);
    await recorder.stop(BOT);
    recorder.discard(BOT);

    await browser.person.type("[name=uid]", "not for the recording");
    await browser.person.click("a, [type=submit]");

    await recorder.start(BOT, "browser");
    const again = await recorder.sync(BOT);
    expect(again.steps.map((step) => step.kind)).toEqual(["open"]);
    expect(again.startUrl).toContain(portal.url("/"));
    expect(JSON.stringify(again)).not.toContain("not for the recording");
  });

  it("brings a deleted step back when the person does it again with something else", async () => {
    const { browser, recorder, shown } = await atLogin(scripts);
    await recorder.start(BOT, "browser");
    await browser.person.type("[name=uid]", "ada");
    const draft = await recorder.sync(BOT);
    recorder.deleteStep(BOT, draft.steps.find((step) => step.kind === "fill")!.id);
    expect(await shown()).toEqual(["open"]);
    await browser.person.type("[name=uid]", "grace");
    const back = await shown();
    expect(back).toHaveLength(2);
    expect(back[1]).toContain("grace");
  });
});

describe("a person who takes the browser back", () => {
  it("stops the run before its next step and says where to carry on", async () => {
    const { browser, portal } = await atLogin(false);
    const recording: DemoRecording = {
      v: 1, title: "Look up a user", startUrl: portal.url("/login"), blanks: [],
      steps: [
        { id: "s1", kind: "open", url: portal.url("/login") },
        { id: "s2", kind: "fill", target: { role: "textbox", name: "", label: "User ID" }, value: "ada" },
        { id: "s3", kind: "fill", target: { role: "textbox", name: "", label: "User ID" }, value: "grace" },
      ],
    };
    let asked = 0;
    const outcome = await replayDemo(browser.port(), recording, {}, { yielded: () => ++asked > 2 });
    expect(outcome.ok).toBe(false);
    expect(outcome.done).toEqual(["s1", "s2"]);
    expect(outcome.stoppedAt).toMatchObject({ index: 2, step: { id: "s3" } });
    expect(outcome.text).toContain("Stopped before step 3 of 3");
    expect(outcome.text).toContain("The person took the browser, so the run stopped here.");
    expect(outcome.text).toContain('from_step "s3"');
  });
});
