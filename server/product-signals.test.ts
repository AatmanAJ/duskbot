import { describe, expect, it } from "vitest";

import { SIGNALS, attachmentKind, cleanSignal, localeOf, screenBucket, sizeBucket } from "../shared/product-signals.ts";
import { USAGE_RUN_KEYS, USAGE_TURN_KEYS, appAction, cleanUsageReport, cleanUsageRun, cleanUsageSnapshot, modelFamily, runEvery } from "../shared/usage-signals.ts";
import { parseWorkspaceReport } from "../shared/dashboard-protocol.ts";
import { cleanProps } from "../apps/dashboard/server/analytics/events.ts";
import { createUsageOutbox, hashId, turnRecord } from "./usage-signals.ts";
import { crashProps } from "../electron/experience-relay.mjs";

const NOW = Date.now();
const SECRET = "Email jane.doe@acme.com /Users/jane/Plan.xlsx https://acme.com";
const valid: Record<string, Record<string, string | number | boolean>> = {
  env: { os: "darwin", arch: "arm64", locale: "pt_br", screen: "m", theme: "dark", skin: "grok_dark", notifications: "granted", hour: 9 },
  account_sign_in: { step: "error", method: "email", via: "code", code: "wrong_code" },
  engine_sign_in: { engine: "claude", outcome: "failed", reason: "auth" },
  attachment: { kind: "pdf", size: "lt1m" },
  setting_changed: { key: "newBotDefaults" },
  chat_deleted: {},
  turn_failed: { engine: "claude", reason: "rate_limit", from: "app", room: false },
  turn_stopped: { engine: "codex", from: "app", ms: 4200 },
  tool_failed: { tool: "app", app: "gmail", engine: "claude", reason: "auth" },
  turn_done: { engine: "claude", tools: 2, category: "email", from: "routine", room: true },
  routine_done: { outcome: "failed", trigger: "schedule", reason: "timeout" },
  approval: { decision: "granted", about: "user" },
  talk_change: { about: "model" },
  refused: { by: "request", code: "bot_limit", status: 409 },
  confused: { kind: "rephrase", after: "reply" },
  engine_sign_in_failed: { engine: "gemini", reason: "network" },
  devs_report: { outcome: "sent" },
  created: { what: "room" },
  file_made: { kind: "sheet" },
  browser_download_failed: { reason: "checksum" },
  crash: { kind: "utility", reason: "crashed", service: "network_service", exit: "xc0000005" },
  update_failed: { stage: "download" },
  app_updated: { how: "self" },
  settings_closed: { changed: false, ms: 12000 },
};

describe("product signal catalogue", () => {
  it("has a valid example for every signal, and keeps exactly its keys", () => {
    expect(Object.keys(valid).sort()).toEqual(Object.keys(SIGNALS).sort());
    for (const [name, props] of Object.entries(valid)) {
      const clean = cleanSignal(name, props)!;
      expect(clean).toEqual(props);
      expect(Object.keys(clean).every(key => key in SIGNALS[name as keyof typeof SIGNALS].props)).toBe(true);
    }
  });

  it("drops a signal with any unknown key, free text or out-of-range value", () => {
    for (const [name, props] of Object.entries(valid)) {
      expect(cleanSignal(name, { ...props, text: SECRET })).toBeNull();
      expect(cleanSignal(name, { ...props, message: "hi" })).toBeNull();
      for (const key of Object.keys(props)) expect(cleanSignal(name, { ...props, [key]: SECRET })).toBeNull();
    }
    expect(cleanSignal("env", { ...valid.env, hour: 24 })).toBeNull();
    expect(cleanSignal("setting_changed", { key: "Bob's key" })).toBeNull();
    expect(cleanSignal("nope", {})).toBeNull();
    expect(cleanSignal("env", valid.env, "workspace")).toBeNull();
    expect(cleanSignal("attachment", valid.attachment, "app")).toBeNull();
  });

  it("every allowed value is a short word or a small number, never text", () => {
    for (const [name, props] of Object.entries(valid)) for (const value of Object.values(cleanSignal(name, props)!)) {
      expect(typeof value === "boolean" || (typeof value === "number" ? Number.isInteger(value) && value < 1e6 : typeof value === "string" && /^[a-zA-Z0-9_]{1,32}$/.test(value))).toBe(true);
    }
  });

  it("an app signal fits the apps' limit of 8 extra keys on an app action", () => {
    for (const spec of Object.values(SIGNALS)) if (spec.source === "app") expect(Object.keys(spec.props).length).toBeLessThanOrEqual(8);
  });

  it("an app action named as a signal keeps only the catalogue's keys on the service", () => {
    expect(cleanProps("app_action", { name: "env", ...valid.env, note: "x" })).toEqual({ name: "env" });
    expect(cleanProps("app_action", { name: "env", ...valid.env })).toEqual({ name: "env", ...valid.env });
    expect(cleanProps("app_action", { name: "bot_created", source: "template", template: "writer" })).toEqual({ name: "bot_created", source: "template", template: "writer" });
  });

  it("a crash the desktop reports keeps its process, reason and exit code on the service", () => {
    for (const props of [crashProps("Utility", "crashed", { name: "Audio Service", exitCode: -36861 }), crashProps("server", "crashed", { exitCode: 3 }),
      crashProps("GPU", "launch-failed"), { kind: "utility", reason: "companion_exit", service: "companion", exit: "1" }]) {
      expect(cleanProps("app_action", { name: "crash", ...props })).toEqual({ name: "crash", ...props });
    }
    expect(cleanSignal("crash", { kind: "server", reason: "crashed", exit: "-3" })).toBeNull();
  });

  it("buckets and folds raw values into words", () => {
    expect([sizeBucket(50_000), sizeBucket(500_000), sizeBucket(5_000_000), sizeBucket(50_000_000)]).toEqual(["lt100k", "lt1m", "lt10m", "gte10m"]);
    expect([screenBucket(390), screenBucket(1440), screenBucket(2560)]).toEqual(["xs", "l", "xl"]);
    expect([attachmentKind("image/png"), attachmentKind("application/pdf"), attachmentKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), attachmentKind("x/y")]).toEqual(["image", "pdf", "sheet", "other"]);
    expect([localeOf("pt-BR"), localeOf("zh-TW"), localeOf("en-US"), localeOf("xx")]).toEqual(["pt_br", "zh_tw", "en", "other"]);
  });
});

describe("the richer turn and run records", () => {
  it("keeps public model families only, and catalog action names of curated apps only", () => {
    expect(modelFamily("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5");
    expect(modelFamily("openai/gpt-5.1-codex")).toBe("gpt-5.1-codex");
    expect(modelFamily("gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(modelFamily("janes-private-finetune")).toBe("other");
    expect(appAction("mcp__composio__GMAIL_SEND_EMAIL")).toBe("gmail_send_email");
    expect(appAction("ACMECRM_LIST_DEALS")).toBeNull();
    expect(runEvery({ type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } as never)).toBe("weekdays");
    expect(runEvery({ type: "interval", everyMinutes: 30 } as never)).toBe("minutes");
    expect(runEvery(undefined, true)).toBe("event");
  });

  it("a turn record carries only allowed keys and no text", () => {
    const salt = "s".repeat(24);
    const record = turnRecord({ driverKind: "claudeAgent", status: "ok", startedAt: NOW - 9000, endedAt: NOW, toolNames: ["mcp__composio__GMAIL_SEND_EMAIL", "Bash", `Read ${SECRET}`],
      failedNames: ["Bash"], firstStepAt: NOW - 6000, model: "claude-opus-4-1", trigger: { kind: "owner" }, room: false, bot: hashId(salt, "bot_secret"), chat: hashId(salt, "thread_secret") }, "desktop", NOW)!;
    expect(Object.keys(record).every(key => (USAGE_TURN_KEYS as readonly string[]).includes(key))).toBe(true);
    expect(record).toMatchObject({ firstMs: 3000, model: "claude-opus-4-1", failedTools: ["terminal"], actions: ["gmail_send_email"] });
    expect(record.bot).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(JSON.stringify(record)).not.toMatch(/jane|acme|secret|xlsx/i);
  });

  it("a run carries duration, frequency and a hashed routine, nothing else", () => {
    const outbox = createUsageOutbox({ now: () => NOW });
    outbox.run({ id: "run_1", status: "completed", startedAt: NOW - 4000, finishedAt: NOW, error: SECRET }, { every: "daily", routine: hashId("s".repeat(24), "routine_1") });
    const [run] = outbox.take()!.runs;
    expect(Object.keys(run!).every(key => (USAGE_RUN_KEYS as readonly string[]).includes(key))).toBe(true);
    expect(run).toMatchObject({ ms: 4000, every: "daily", outcome: "ok" });
    expect(cleanUsageRun({ ...run, every: "fortnightly" }, NOW)!.every).toBeUndefined();
  });

  it("workspace signals pass the dashboard parser only when the catalogue allows them", () => {
    const outbox = createUsageOutbox({ now: () => NOW });
    outbox.signal("attachment", valid.attachment!, (name, props) => cleanSignal(name, props, "workspace"));
    outbox.signal("attachment", { kind: "pdf", size: "lt1m", name: SECRET }, (name, props) => cleanSignal(name, props, "workspace"));
    outbox.signal("env", valid.env!, (name, props) => cleanSignal(name, props, "workspace"));
    const usage = outbox.take()!;
    expect(usage.signals).toHaveLength(1);
    const parsed = parseWorkspaceReport({ v: 1, seq: 1, at: NOW, workspace: { name: "w", kind: "mac", version: "1", platform: "darwin" },
      usage: { ...usage, signals: [...usage.signals!, { id: "sig0000001", at: NOW, name: "setting_changed", props: { key: SECRET } }] } })!;
    expect(parsed.usage!.signals).toEqual(usage.signals);
    expect(cleanUsageReport({ turns: [], runs: [], signals: usage.signals }, NOW)).toBeNull();
  });

  it("a snapshot keeps its extra counts and engine names only", () => {
    expect(cleanUsageSnapshot({ bots: 2, rooms: 0, routines: 1, webhooks: 0, appEvents: 0, skills: 3, chats: 12, archived: 4, memory: 3, botEngines: { claude: 1, codex: 1, "my-endpoint": 1 }, names: ["x"] }))
      .toEqual({ bots: 2, rooms: 0, routines: 1, webhooks: 0, appEvents: 0, skills: 3, chats: 12, archived: 4, memory: 3, botEngines: { claude: 1, codex: 1 } });
  });
});
