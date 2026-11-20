// Wires background jobs into the server: the supervisor and its launcher, the bot's tool route, the route a job's
// dusk-notify calls, and what a notify becomes (a run of the bot through the routines' event path, or a line in the
// chat). index.ts builds it once.
import { randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

import type { Notification } from "../../shared/notification.ts";
import { mergeEventBlock } from "../app-events.ts";
import type { json as sendJson } from "../harness/http.ts";
import { buildNotification } from "../notify.ts";
import type { RoutineManager } from "../routines.ts";
import { PASS } from "../routes/table.ts";
import type { BotRecord, Store } from "../store.ts";
import { createJobLauncher, envNameRefusal, JOB_NOTIFY_PATH, nodeScriptCommand, TELEGRAM_WATCH_SCRIPT, type LaunchDeps } from "./launch.ts";
import { DEFAULT_ON_NOTIFY, jobBlock, jobRunPrompt, TELEGRAM_NOTE } from "./prompt.ts";
import { JOB_TOKEN_PREFIX, JobRefusal, JobSupervisor, type JobLimits, type JobNote, type JobRecord, type JobUsage } from "./supervisor.ts";

export const JOBS_PATH = "/api/internal/jobs";
export { JOB_NOTIFY_PATH };

export const JOB_MESSAGES = {
  notYours: "This conversation is not yours.",
  room: "Background jobs are started from a one-to-one chat with the person, not a room.",
  notPerson: "Only the person can have you start or stop a background job, in their own chat with you; work from a routine, an outside event or another bot cannot.",
  guest: "Background jobs run on the owner's computer, so only the owner can have you start one.",
  level: "Starting a background job runs your code on its own, which needs Full access. Ask the person to set you to Full access, or to run it themselves.",
  none: "You have no background jobs.",
  noJob: "None of your background jobs has that id. Use action list.",
} as const;

export interface JobTurn {
  owned: boolean; room: boolean; guest: boolean; depth: number; handedOff: boolean; routineRun: boolean; outsideDriven: boolean; personStarted: boolean; fullAccess: boolean;
}

/** Why this turn may not start (or with `stop`, stop) a job; null when it may. */
export function jobTurnRefusal(turn: JobTurn, action: "start" | "stop" | "read"): string | null {
  if (!turn.owned) return JOB_MESSAGES.notYours;
  if (action === "read") return null;
  if (turn.guest) return JOB_MESSAGES.guest;
  if (turn.room) return JOB_MESSAGES.room;
  if (turn.depth > 0 || turn.handedOff || turn.outsideDriven || (!turn.personStarted && !(action === "stop" && turn.routineRun))) return JOB_MESSAGES.notPerson;
  if (action === "start" && !turn.fullAccess) return JOB_MESSAGES.level;
  return null;
}

const name = z.string().trim().min(1);
const startSchema = z.object({
  action: z.literal("start"),
  label: z.string().trim().min(1).max(80).refine((value) => !/\p{Cc}/u.test(value), "label must be one line"),
  command: z.string().min(1).max(4_000).optional(),
  template: z.enum(["telegram_watch"]).optional(),
  secret: z.string().trim().min(1).max(120).optional(),
  chats: z.array(name.max(120)).max(20).optional(),
  keywords: z.array(name.max(120)).max(40).optional(),
  cwd: z.string().min(1).max(1_024).optional(),
  env: z.record(z.string(), z.string().max(4_000)).optional(),
  secrets: z.record(z.string(), z.string().trim().min(1).max(120)).optional(),
  on_notify: z.string().trim().max(2_000).optional(),
}).strict();
const stopSchema = z.object({ action: z.literal("stop"), id: z.string().min(1).max(128) }).strict();
const logsSchema = z.object({ action: z.literal("logs"), id: z.string().min(1).max(128), bytes: z.number().int().min(200).max(16_000).optional() }).strict();
const listSchema = z.object({ action: z.literal("list") }).strict();
const requestSchema = z.discriminatedUnion("action", [startSchema, stopSchema, logsSchema, listSchema]);

export interface JobsHostDeps extends Omit<LaunchDeps, "secret"> {
  file?: string;
  store: Pick<Store, "bot" | "appendMessage" | "patchTask">;
  secret(label: string, botId: string): string | null;
  /** A one-to-one chat this bot owns. */
  directChat(botId: string, threadId: string): boolean;
  mainThread(botId: string): string | undefined;
  threadBusy(botId: string, threadId: string): boolean;
  wrote(bot: BotRecord, threadId: string): void;
  notify(notification: Notification | null): void;
  routines(): Pick<RoutineManager, "enqueueWebhook" | "mergeIntoQueuedRun">;
  cloudHome: boolean;
  limits?: Partial<JobLimits>;
  now?: () => number;
  log?: (line: string) => void;
}

export interface JobRouteContext {
  method: string; path: string; res: ServerResponse; json: typeof sendJson;
  botId: string; threadId: string;
  readBody: () => Promise<unknown>;
  turn: () => JobTurn;
  /** Folders this conversation may work in: a job's folder must be inside one; the first is the default. */
  folders: () => Promise<string[]>;
}

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : "never");
const inside = (path: string, root: string) => { const rel = relative(resolve(root), resolve(path)); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };

export function describeJob(job: JobRecord): string {
  const state = job.state === "running" ? (job.crashes ? `restarting after ${job.lastExit} (${job.crashes} in a row)` : "running") : job.state === "done" ? "finished by itself" : `stopped (${job.stopReason ?? "stopped"})`;
  return `- ${job.label} (id ${job.id}): ${state}; started ${job.starts} times, last ${iso(job.lastStartAt)}; runs \`${job.command.slice(0, 160)}\` in ${job.cwd}`;
}

/** Process group usage from `ps`, on macOS and Linux alike. */
export function psUsage(pids: readonly number[]): Promise<Map<number, JobUsage>> {
  return new Promise((done) => {
    execFile("ps", ["-A", "-o", "pgid=,rss=,time="], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      const wanted = new Set(pids), usage = new Map<number, JobUsage>();
      if (error) return done(usage);
      for (const line of stdout.split("\n")) {
        const [pgid, rss, time] = line.trim().split(/\s+/);
        const group = Number(pgid);
        if (!wanted.has(group)) continue;
        const sum = usage.get(group) ?? { rssBytes: 0, cpuMs: 0 };
        sum.rssBytes += Number(rss) * 1024;
        sum.cpuMs += cpuTimeMs(time ?? "");
        usage.set(group, sum);
      }
      done(usage);
    });
  });
}

/** `ps` time: [[dd-]hh:]mm:ss[.cc]. */
export function cpuTimeMs(time: string): number {
  const [days, rest] = time.includes("-") ? time.split("-") as [string, string] : ["0", time];
  const parts = rest.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts as [number, number, number];
  const total = ((Number(days) * 24 + h) * 60 + m) * 60 + s;
  return Number.isFinite(total) ? Math.round(total * 1000) : 0;
}

/** Whether a pid an earlier server recorded still runs this job's command line. */
export function leftover(pid: number, job: Pick<JobRecord, "command">): boolean {
  try {
    const args = execFileSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 });
    return args.includes(job.command.slice(0, 200));
  } catch {
    return false;
  }
}

export function createJobsHost(deps: JobsHostDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const launch = createJobLauncher(deps);
  const pendingTells: Array<{ job: JobRecord; text: string; until: number }> = [];

  const chatOf = (job: JobRecord) => (deps.directChat(job.botId, job.threadId) ? job.threadId : deps.mainThread(job.botId));
  const post = (job: JobRecord, text: string): boolean => {
    const bot = deps.store.bot(job.botId), threadId = chatOf(job);
    if (!bot || !threadId) return true;
    if (deps.threadBusy(job.botId, threadId)) return false;
    deps.store.appendMessage(threadId, { role: "bot", kind: "text", text });
    deps.store.patchTask(job.botId, threadId, { unread: true });
    deps.wrote(bot, threadId);
    deps.notify(buildNotification("done", bot, threadId, text, { avatarUrl: bot.avatarUrl }));
    return true;
  };
  const flushTells = () => {
    for (const pending of pendingTells.splice(0)) {
      if (post(pending.job, pending.text)) continue;
      if (now() < pending.until) pendingTells.push(pending);
    }
  };
  const tellTimer = setInterval(flushTells, 5_000);
  tellTimer.unref?.();

  const deliver = (job: JobRecord, note: JobNote) => {
    if (note.tell) {
      if (!post(job, note.text)) pendingTells.push({ job, text: note.text, until: now() + 30 * 60_000 });
      return;
    }
    const delivery = { id: randomUUID(), at: now(), text: note.text };
    const webhookId = `job:${job.id}`;
    const routines = deps.routines();
    const merged = routines.mergeIntoQueuedRun(webhookId, delivery.id, (prompt) => mergeEventBlock(prompt, jobBlock(job, delivery)));
    if (merged) return;
    const chat = !deps.cloudHome && deps.directChat(job.botId, job.threadId) ? job.threadId : undefined;
    routines.enqueueWebhook({
      webhookId, webhookName: job.label, prompt: jobRunPrompt(job, delivery), botId: job.botId, runOn: "maus",
      deliveryId: delivery.id, receivedAt: delivery.at, eventSource: "job", ...(chat ? { resultsThreadId: chat } : {}),
    });
  };

  const supervisor = new JobSupervisor({
    file: deps.file ?? join(deps.dataDir, "jobs.json"),
    logDir: join(deps.dataDir, "job-logs"),
    launch,
    deliver,
    crashing: (job) => {
      const text = `${job.label} keeps stopping (${job.lastExit ?? "an error"}). I'll keep restarting it; ask me to look at it and I'll read its log and fix it.`;
      if (!post(job, text)) pendingTells.push({ job, text, until: now() + 30 * 60_000 });
    },
    usage: psUsage,
    leftover,
    limits: deps.limits,
    now,
    log,
  });

  async function start(ctx: JobRouteContext, body: z.infer<typeof startSchema>): Promise<{ status: number; body: Record<string, unknown> }> {
    const fail = (error: string, status = 400) => ({ status, body: { error } });
    if (!body.command === !body.template) return fail("Give either command (your own program) or template (telegram_watch), not both.");
    const env: Record<string, string> = { ...body.env };
    const secrets: Record<string, string> = { ...body.secrets };
    let command = body.command ?? "";
    if (body.template === "telegram_watch") {
      if (!body.secret) return fail("telegram_watch needs secret: the label the person's Telegram bot token is saved under (request_credential first if you don't have it).");
      secrets.TELEGRAM_BOT_TOKEN = body.secret;
      if (body.chats?.length) env.TELEGRAM_WATCH_CHATS = body.chats.join(",");
      if (body.keywords?.length) env.TELEGRAM_WATCH_KEYWORDS = body.keywords.join(",");
      command = nodeScriptCommand(TELEGRAM_WATCH_SCRIPT, deps.execPath);
    } else if (body.secret || body.chats || body.keywords) {
      return fail("secret, chats and keywords go with a template; for your own command use secrets ({ \"ENV_NAME\": \"Vault label\" }) and env.");
    }
    for (const key of [...Object.keys(body.env ?? {}), ...Object.keys(body.secrets ?? {})]) {
      const refusal = envNameRefusal(key);
      if (refusal) return fail(refusal);
    }
    if (Object.keys(env).length + Object.keys(secrets).length > 24) return fail("At most 24 environment names.");
    for (const label of Object.values(secrets)) {
      if (deps.secret(label, ctx.botId) === null) {
        return fail(`${label} is not in the person's Vault for you. Ask for it with request_credential (label "${label}"), make sure they keep it in their Vault (a value they paste in chat is kept there), then start the job again. Never put a secret in env or the command.`);
      }
    }
    const folders = await ctx.folders();
    const cwd = body.cwd ? resolve(body.cwd) : folders[0];
    if (!cwd || !folders.some((root) => inside(cwd, root))) return fail(`cwd must be inside a folder you work in: ${folders.join(", ")}.`);
    try {
      const { job, replaced } = supervisor.start({
        botId: ctx.botId, threadId: ctx.threadId, label: body.label, command, cwd, env, secrets,
        onNotify: body.on_notify || DEFAULT_ON_NOTIFY,
      });
      const telegram = body.template === "telegram_watch" || /telegram/i.test(`${command} ${Object.keys(secrets).join(" ")} ${Object.keys(env).join(" ")}`);
      const where = deps.cloudHome ? " On this cloud its runs report in a chat of their own named after it." : "";
      const text = [
        `${replaced ? "Replaced and started" : "Started"} background job ${job.label} (id ${job.id}). It keeps running after this turn and starts again by itself if it stops with an error or this computer restarts.`,
        `Each \`dusk-notify "<text>"\` it runs wakes you with that text and your on_notify instructions; \`dusk-notify --tell "<text>"\` posts the text in this chat as is.${where}`,
        "Check it once in a few seconds with action logs, then tell the person in one sentence what it watches and when they'll hear from you; do not keep checking.",
        ...(telegram ? [TELEGRAM_NOTE] : []),
      ].join(" ");
      return { status: 201, body: { text, id: job.id } };
    } catch (error) {
      if (error instanceof JobRefusal) return fail(error.message, error.status);
      log(`jobs: a start failed: ${error instanceof Error ? error.message : String(error)}`);
      return fail(error instanceof Error ? error.message : "The job could not start.", 500);
    }
  }

  /** The bot's tool: POST /api/internal/jobs { action: start | stop | logs | list }. */
  async function internal(ctx: JobRouteContext): Promise<typeof PASS | void> {
    if (ctx.path !== JOBS_PATH) return PASS;
    const { res, json } = ctx;
    if (ctx.method !== "POST") return void json(res, 405, { error: "POST" });
    const parsed = requestSchema.safeParse(await ctx.readBody());
    if (!parsed.success) return void json(res, 400, { error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ") });
    const body = parsed.data;
    const refusal = jobTurnRefusal(ctx.turn(), body.action === "start" ? "start" : body.action === "stop" ? "stop" : "read");
    if (refusal) return void json(res, 403, { error: refusal });
    if (body.action === "start") {
      const answer = await start(ctx, body);
      return void json(res, answer.status, answer.body);
    }
    if (body.action === "list") {
      const mine = supervisor.list(ctx.botId);
      return void json(res, 200, { text: mine.length ? mine.map(describeJob).join("\n") : JOB_MESSAGES.none });
    }
    if (body.action === "stop") {
      const stopped = supervisor.stop(body.id, ctx.botId);
      return void json(res, stopped ? 200 : 404, stopped ? { text: `Stopped ${stopped.label}. It stays stopped until you start it again.` } : { error: JOB_MESSAGES.noJob });
    }
    const job = supervisor.get(body.id, ctx.botId);
    if (!job) return void json(res, 404, { error: JOB_MESSAGES.noJob });
    const tail = supervisor.logs(body.id, ctx.botId, body.bytes) ?? "";
    return void json(res, 200, { text: `${describeJob(job)}\n\nOutput (newest last):\n${tail || "(nothing yet)"}` });
  }

  /** dusk-notify's route: the job's own bearer, never a turn's. */
  async function notifyRoute(req: IncomingMessage, res: ServerResponse, json: typeof sendJson, readBody: () => Promise<unknown>): Promise<void> {
    if (req.method !== "POST") return void json(res, 405, { error: "POST" });
    const header = req.headers.authorization ?? "";
    const token = header.startsWith(`Bearer ${JOB_TOKEN_PREFIX}`) ? header.slice(7) : "";
    if (!token || !supervisor.byToken(token)) return void json(res, 401, { error: "This job's notify token is not valid: it ended or was restarted." });
    const body = await readBody().catch(() => null) as { text?: unknown; tell?: unknown } | null;
    if (!body || typeof body.text !== "string") return void json(res, 400, { error: "Send { \"text\": \"…\" }." });
    try {
      const answer = supervisor.notify(token, { text: body.text, tell: body.tell === true });
      return void json(res, answer.ok ? 202 : answer.status, answer.ok ? { ok: true } : { error: answer.error });
    } catch (error) {
      log(`jobs: a notify failed: ${error instanceof Error ? error.message : String(error)}`);
      return void json(res, 503, { error: "dusk bot could not take this notification now; send it again shortly." });
    }
  }

  return {
    supervisor,
    internal,
    notifyRoute,
    start: () => supervisor.restore(),
    /** A Cloud stays awake while a job should be running. */
    busy: () => supervisor.running() > 0,
    removeForBot: (botId: string) => supervisor.removeForBot(botId),
    stop: () => { clearInterval(tellTimer); supervisor.shutdown(); },
  };
}

export type JobsHost = ReturnType<typeof createJobsHost>;
