import { z } from "zod";

import type { DemoChange, DemoRecording } from "../../shared/demo-recording.ts";
import type { DemoHost, Refusal } from "../demo-recorder/host.ts";
import type { DemoRecorder } from "../demo-recorder/recorder.ts";
import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface DemoRecordingRouteDeps {
  host: DemoHost<RequestAuth>;
  recorder: DemoRecorder;
  botExists(botId: string): boolean;
  /** Which of a bot's screens a task can be shown on here. */
  surfaces(botId: string): Promise<{ browser: boolean; computer: boolean }>;
  changed(change: DemoChange): void;
}

const BOT = /^\/api\/bots\/([\w-]+)\/demos(?:\/(stop|cancel))?$/;
const ONE = /^\/api\/demos\/(demo-[a-f0-9-]{36})(?:\/(plan|skill|routine|replay|replay\/stop))?$/;
const FRAME = /^\/api\/demos\/(demo-[a-f0-9-]{36})\/frames\/(f[a-f0-9]{20})$/;
const FILES_MAX = 200;
const FILE_MAX_CHARS = 200_000;
const FILES_MAX_CHARS = 2_000_000;

const startBody = z.object({ surface: z.enum(["browser", "computer"]), threadId: z.string().min(1).max(200).optional() });
const skillBody = z.object({ name: z.string().trim().min(1).max(120).optional() });
const routineBody = z.object({ name: z.string().trim().min(1).max(120).optional(), source: z.string().trim().min(1).max(600) });
const replayBody = z.object({ files: z.array(z.object({ name: z.string().min(1).max(260), content: z.string().max(FILE_MAX_CHARS) })).min(1).max(FILES_MAX) });

const isRefusal = (value: DemoRecording | Refusal | object): value is Refusal => "status" in value && "error" in value && !("id" in value);

export function createDemoRecordingRoutes(deps: DemoRecordingRouteDeps): RouteHandler {
  const { host, recorder } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/demos/") && !BOT.test(path)) return PASS;
    // Security: a recording shows its maker's screen and becomes a skill the bot runs, so only the owner or an admin reads or changes one.
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the owner or an admin can show a bot a task." });
    const frame = FRAME.exec(path);
    if (frame && method === "GET") {
      const picture = recorder.frame(frame[1]!, frame[2]!);
      if (!picture) return json(res, 404, { error: "no such picture" });
      // Security: a recording's pictures show a person's screen, so they are never cached and never sniffed as anything else.
      res.writeHead(200, { "Content-Type": picture.type, "Content-Length": picture.data.length, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      res.end(picture.data);
      return;
    }

    const bot = BOT.exec(path);
    if (bot) {
      const botId = bot[1]!;
      if (!deps.botExists(botId)) return json(res, 404, { error: "no such bot" });
      if (!bot[2] && method === "GET") {
        return json(res, 200, { recordings: recorder.list(botId), recording: recorder.recording(botId), surfaces: await deps.surfaces(botId) });
      }
      if (method !== "POST") return PASS;
      if (bot[2] === "cancel") {
        const live = recorder.list(botId).find((each) => each.status === "recording");
        await host.cancel(botId);
        if (live) deps.changed({ botId, removed: live.id });
        return json(res, 200, { ok: true });
      }
      if (bot[2] === "stop") {
        const stopped = await host.stop(botId);
        return isRefusal(stopped) ? json(res, stopped.status, { error: stopped.error }) : json(res, 200, { recording: stopped });
      }
      const body = startBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Say where the task will be shown: the browser or the computer." });
      const started = await host.start(botId, body.data.surface, body.data.threadId ?? null, auth);
      return isRefusal(started) ? json(res, started.status, { error: started.error }) : json(res, 201, { recording: started });
    }

    const one = ONE.exec(path);
    if (!one) return PASS;
    const id = one[1]!;
    const existing = recorder.get(id);
    if (!existing) return json(res, 404, { error: "That recording is gone." });
    const answer = (result: DemoRecording | { error: string }, status = 200) => ("id" in result ? json(res, status, { recording: result }) : json(res, 422, { error: result.error }));
    if (!one[2]) {
      if (method === "GET") return json(res, 200, { recording: existing, run: host.run(id) });
      if (method === "DELETE") {
        host.stopReplay(id);
        if (existing.status === "recording") await host.cancel(existing.botId);
        recorder.remove(id);
        deps.changed({ botId: existing.botId, removed: id });
        return json(res, 200, { ok: true });
      }
      return PASS;
    }
    if (one[2] === "replay" && method === "GET") return json(res, 200, { run: host.run(id) });
    if (one[2] === "plan" && method === "PUT") {
      const body = await readBody(req) as { plan?: unknown } | null;
      return answer(recorder.updatePlan(id, body?.plan));
    }
    if (method !== "POST") return PASS;
    if (one[2] === "skill") {
      const body = skillBody.safeParse(await readBody(req) ?? {});
      if (!body.success) return json(res, 400, { error: "That name cannot be used for a skill." });
      return answer(recorder.saveSkill(id, body.data.name ? { name: body.data.name } : {}), 201);
    }
    if (one[2] === "routine") {
      const body = routineBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Say what the routine should run on: a folder, a file, or a list." });
      return answer(recorder.saveRoutine(id, { source: body.data.source, ...(body.data.name ? { name: body.data.name } : {}) }), 201);
    }
    if (one[2] === "replay/stop") return json(res, 200, { stopped: host.stopReplay(id) });
    if (one[2] === "replay") {
      const body = replayBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Choose up to 200 text files to read the inputs from." });
      if (body.data.files.reduce((sum, file) => sum + file.content.length, 0) > FILES_MAX_CHARS) return json(res, 413, { error: "Those files are too large to read together. Choose fewer." });
      const run = await host.replay(id, body.data.files, auth);
      return "status" in run && "error" in run ? json(res, run.status, { error: run.error }) : json(res, 202, { run });
    }
    return PASS;
  };
}
