// Grok's cards answer in ink whoever asks: a bot's colour stays in its face and an answered letter, never a card's
// primary. Deny, Cancel and the quiet actions stay neutral.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn() };
});
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { computerControl: {} }, dispatch: fixture.dispatch }),
}))(importOriginal)));

const { BOT_BUTTON } = await import("@/lib/bot-button");
const { t } = await import("@/lib/i18n");
const { pendingApprovals, PendingApprovalActions } = await import("./PendingApproval");
const { QuestionCard } = await import("./QuestionCard");
const { SecretRequestCard } = await import("./SecretRequestCard");
const { SignInRequestCard } = await import("./SignInRequestCard");
const { ConnectorCard } = await import("./ConnectorCard");

afterAll(() => vi.unstubAllGlobals());

function button(html: string, label: string): string {
  const found = (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).find((one) => one.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").trim() === label);
  expect(found, label).toBeDefined();
  return found!;
}
const classes = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");

function expectInk(tag: string) {
  expect(classes(tag)).toContain("ui-button-primary");
  expect(classes(tag)).not.toContain(BOT_BUTTON);
  expect(tag).not.toContain("--bot-button");
}
function expectPlain(tag: string) {
  expect(classes(tag)).not.toContain(BOT_BUTTON);
  expect(tag).not.toContain("--bot-button");
}

const approval = (bot?: Bot) => {
  const message: Message = {
    id: "approval-1", at: 1, role: "bot", kind: "options",
    card: { title: "Approval needed", subtitle: "rm -rf ./build", options: ["Allow", "Deny"], tool: "Bash", requestId: "request-1", allowSession: true },
  };
  return renderToStaticMarkup(PendingApprovalActions({ pending: pendingApprovals([message])[0]!, bot, threadId: "thread-1", onCancelTurn: vi.fn() }));
};

const question: Message = {
  id: "question-1", role: "bot", kind: "options", at: 1,
  card: {
    title: "Your bot has a question", subtitle: "", options: [], requestId: "request-2",
    questionRequest: { version: 1, questions: [
      { question: "Which page?", header: "Page", options: [{ label: "Home" }, { label: "Pricing" }] },
      { question: "Which tone?", header: "Tone", options: [{ label: "Calm" }, { label: "Bold" }] },
    ] },
  },
};

describe("a bot's cards answer in grok's ink", () => {
  it("paints Allow once in ink like grok, while Deny is bare text and Always allow a quiet fill", () => {
    const html = approval({ id: "scout", name: "Scout", color: "pink" } as Bot);
    expectInk(button(html, t("approval.action.allowOnce")));
    const deny = button(html, t("approval.action.deny"));
    expectPlain(deny);
    expect(classes(deny)).toEqual(expect.arrayContaining(["text-ink-secondary", "enabled:hover:bg-ink/[0.06]"]));
    expect(classes(deny).some((name) => name.includes("danger"))).toBe(false);
    const always = button(html, t("approval.action.alwaysAllow"));
    expectPlain(always);
    expect(classes(always)).toContain("bg-(--card-fill)");
    expect(classes(button(approval(), t("approval.action.allowOnce")))).toContain("ui-button-primary");
  });

  it("sends a question's answers in ink, whatever colour the bot is", () => {
    const own = renderToStaticMarkup(createElement(QuestionCard, { threadId: "thread-1", asker: { name: "Scout", color: "yellow" }, message: question }));
    const submit = button(own, t("question.submitAll"));
    expectInk(submit);
    expect(submit).toContain("disabled");
    expectPlain(button(renderToStaticMarkup(createElement(QuestionCard, { threadId: "thread-1", message: question })), t("question.submitAll")));
  });

  it("saves a key, takes over a sign-in and connects an app in ink", () => {
    const secret: Message = {
      id: "secret-1", role: "bot", kind: "secret", at: 1, text: "",
      secret: { target: "openaiImageApiKey", label: "OpenAI API key", description: "", placeholder: "sk-…", requestKey: "key-1" } as Message["secret"],
    };
    expectInk(button(renderToStaticMarkup(createElement(SecretRequestCard, { botId: "scout", color: "blue", threadId: "t", message: secret })), "Save securely"));

    const signIn: Message = {
      id: "signin-1", role: "bot", kind: "signin", at: 1, text: "",
      signIn: { url: "https://example.com/login", site: "example.com", place: "browser" } as Message["signIn"],
    };
    const signInHtml = renderToStaticMarkup(createElement(SignInRequestCard, { botId: "scout", botName: "Scout", color: "green", threadId: "t", message: signIn }));
    expectInk(button(signInHtml, t("signIn.takeOver")));
    expectPlain(button(signInHtml, t("computer.done")));
    expectPlain(button(signInHtml, t("signIn.skip")));

    const connector: Message = {
      id: "connector-1", role: "bot", kind: "connector", at: 1,
      connector: { slug: "github", label: "GitHub", description: "", status: "required", resumeKey: "resume-1" },
    };
    // grok's connector card keeps its action in ink whatever the bot's colour
    for (const color of ["silver", undefined] as const) {
      const action = button(renderToStaticMarkup(createElement(ConnectorCard, { botId: "scout", color, threadId: "t", message: connector })), t("connectors.card.connect"));
      expectPlain(action);
      expect(classes(action)).toContain("bg-ink");
    }
  });
});
