// Security: a password typed while Show it once records must reach nothing but the page it was typed into. These tests
// run the whole feature with one distinctive secret and look for it everywhere the feature writes or sends anything.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DemoDraft } from "../../shared/demo-recording.ts";
import { secretForms } from "../login-store.ts";
import { replayBatch } from "./batch.ts";
import { DemoCapture } from "./capture.ts";
import { compileDemo, demoNamingPrompt } from "./compile.ts";
import { readInputFolder } from "./inputs.ts";
import { normaliseDemo } from "./normalise.ts";
import { DemoRecorder } from "./recorder.ts";
import { DEMO_REFERENCE_PATH, parseDemoReference, renderDemoSkill, type DemoSkillFiles } from "./skill-file.ts";
import { ExpensePortal } from "./testing/expense-portal.ts";
import { FakeBrowser } from "./testing/fake-browser.ts";
import { EXPENSES, INBOX, showOneExpense } from "./testing/scenario.ts";
import { testVault } from "./testing/vault.ts";

const SECRET = "Zebra-Quartz!79&vault<x>";
const BOT = "bot-ada";
const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** The secret as it could appear in text: plain, JSON-escaped, URL-encoded, base64, and every prefix a keystroke log would hold. */
function forms(): string[] {
  const prefixes = Array.from({ length: SECRET.length - 5 }, (_, at) => SECRET.slice(0, at + 6));
  return [...new Set([...secretForms(SECRET), JSON.stringify(SECRET).slice(1, -1), encodeURIComponent(SECRET), Buffer.from(SECRET).toString("base64"), ...prefixes])];
}

function expectNoSecret(what: string, text: string): void {
  for (const form of forms()) expect(text.includes(form), `${what} holds the secret as ${JSON.stringify(form)}`).toBe(false);
}

function filesUnder(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

async function fixture() {
  const portal = await ExpensePortal.start({ password: SECRET });
  cleanup.push(() => portal.close());
  const browser = new FakeBrowser({ scriptsOnNewDocuments: true });
  cleanup.push(() => browser.close());
  const disk = mkdtempSync(join(tmpdir(), "dusk-demo-secrets-"));
  cleanup.push(() => rmSync(disk, { recursive: true, force: true }));
  return { portal, browser, disk };
}

describe("a password typed while recording", () => {
  it("is in nothing the recorder reads from the page, however often the page is read", async () => {
    const { portal, browser } = await fixture();
    const heard: string[] = [];
    const capture = new DemoCapture(browser.port(), { pollMs: 60_000, log: (line) => heard.push(line), onEvents: (events) => heard.push(JSON.stringify(events)) });
    await capture.start();
    await browser.goto(portal.url("/login"));
    await browser.person.type("[name=uid]", portal.user);
    for (const char of SECRET) {
      await browser.person.type("[name=pw]", char);
      heard.push(JSON.stringify(await capture.drain()));
    }
    await browser.person.click("input[type=submit]");
    const events = await capture.stop();
    expect(browser.url).toBe(portal.url("/expenses"));
    expect(events.some((event) => event.target?.sensitive)).toBe(true);
    expectNoSecret("the raw events", JSON.stringify(events));
    expectNoSecret("what the capture logged or announced", heard.join("\n"));
    expectNoSecret("the cleaned steps", JSON.stringify(normaliseDemo(events)));
  });

  it("reaches no draft, log, AI prompt, skill file or file on disk, from Record to the saved skill", async () => {
    const { portal, browser, disk } = await fixture();
    const logs: string[] = [];
    const prompts: string[] = [];
    const drafts: DemoDraft[] = [];
    const saved: DemoSkillFiles[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
    const recorder = new DemoRecorder({
      port: async () => browser.port(),
      held: () => true,
      nameBlanks: () => async (prompt) => { prompts.push(prompt); return JSON.stringify({ title: "File an expense report", blanks: [] }); },
      saveSkill: (botId, skill) => {
        saved.push(skill);
        for (const file of skill.files) {
          const path = join(disk, botId, skill.name, file.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, file.content);
        }
        return { name: skill.name };
      },
      changed: (draft) => drafts.push(structuredClone(draft)),
      log: (line) => logs.push(line),
      pollMs: 60_000,
    });
    await recorder.start(BOT, "browser");
    await showOneExpense(browser, portal, EXPENSES[0]!, { arrived: async () => { await recorder.sync(BOT); } });
    const review = await recorder.stop(BOT);
    expect(portal.filed).toHaveLength(1);
    expect(review.steps.map((step) => step.kind)).toContain("sign-in");
    expect(await recorder.save(BOT, "skill")).toEqual({ skill: "file-an-expense-report" });

    expect(prompts).toHaveLength(1);
    expect(filesUnder(disk).length).toBe(2);
    expectNoSecret("a draft sent to the app", JSON.stringify(drafts));
    expectNoSecret("the review draft", JSON.stringify(review));
    expectNoSecret("a log line", logs.join("\n"));
    expectNoSecret("the AI prompt", prompts.join("\n"));
    expectNoSecret("the saved skill", JSON.stringify(saved));
    for (const path of filesUnder(disk)) expectNoSecret(path, readFileSync(path, "utf8"));
    const username = portal.user;
    expect(JSON.stringify(saved)).not.toContain(username);
    expect(prompts.join("\n")).not.toContain(username);
  });

  it("is taken out of an ordinary field too, when the Vault knows it", async () => {
    const { portal, browser } = await fixture();
    const scrub = (text: string) => text.split(SECRET).join("••••");
    const drafts: DemoDraft[] = [];
    const recorder = new DemoRecorder({ port: async () => browser.port(), held: () => true, saveSkill: (_botId, skill) => ({ name: skill.name }), changed: (draft) => drafts.push(structuredClone(draft)), scrub, pollMs: 60_000 });
    await recorder.start(BOT, "browser");
    await browser.goto(portal.url("/login"));
    await browser.person.type("[name=uid]", SECRET);
    await recorder.sync(BOT);
    await browser.person.clear("[name=uid]");
    await browser.person.type("[name=uid]", portal.user);
    await browser.person.type("[name=pw]", SECRET);
    await browser.person.click("input[type=submit]");
    await browser.person.click('#nav a[href="/expenses/new"]');
    await browser.person.type("[name=notes]", `my password is ${SECRET} do not share`);
    const draft = await recorder.stop(BOT);
    expect(draft.steps.find((step) => step.kind === "fill")?.value).toBe("my password is •••• do not share");
    expectNoSecret("a draft", JSON.stringify([draft, ...drafts]));
  });

  it("is typed by the Vault on replay, and is in nothing the replayer says or asks the page", async () => {
    const { portal, browser } = await fixture();
    const recorder = new DemoRecorder({ port: async () => browser.port(), held: () => true, saveSkill: (_botId, skill) => ({ name: skill.name }), pollMs: 60_000 });
    await recorder.start(BOT, "browser");
    await showOneExpense(browser, portal, EXPENSES[0]!);
    const draft = await recorder.stop(BOT);
    const { recording } = await compileDemo(draft.steps);
    expectNoSecret("the naming prompt", demoNamingPrompt(draft.steps));
    const skill = renderDemoSkill(recording);
    expect(parseDemoReference(skill.files.find((file) => file.path === DEMO_REFERENCE_PATH)!.content)).toEqual(recording);

    portal.signOutAll();
    const replayer = new FakeBrowser();
    cleanup.push(() => replayer.close());
    const vault = testVault(replayer.loginInput(), portal);
    const records = readInputFolder(INBOX, recording.blanks, { except: ["expense-01.json"] }).records.slice(0, 2);
    const outcome = await replayBatch(replayer.port(), recording, records, { signIn: vault.signIn, resolveFile: (value, record) => join(record.folder ?? "", value) });
    expect(outcome.ok).toBe(true);
    expect(portal.filed).toHaveLength(3);
    expect(replayer.typed.filter((text) => text === SECRET)).toHaveLength(1);
    expectNoSecret("what the replayer answered", JSON.stringify(outcome));
    expectNoSecret("an expression the page was asked to evaluate", replayer.evaluated.join("\n"));
    expectNoSecret("an expression the recorder evaluated", browser.evaluated.join("\n"));

    const wrong = new FakeBrowser();
    cleanup.push(() => wrong.close());
    portal.signOutAll();
    const badVault = testVault(wrong.loginInput(), portal, { password: `${SECRET}-old` });
    const refused = await replayBatch(wrong.port(), recording, records, { signIn: badVault.signIn, resolveFile: (value, record) => join(record.folder ?? "", value) });
    expect(refused.ok).toBe(false);
    expect(refused.items[0]!.outcome?.stoppedAt?.step.kind).toBe("sign-in");
    expectNoSecret("what the replayer answered about a refused login", JSON.stringify(refused));
  });
});
