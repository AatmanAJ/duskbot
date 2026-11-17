// Show it once, as the app drives it: Record while the person holds control, the list of steps as it is edited, and
// the save as a skill or a routine. The draft itself reaches the app's windows over the events feed.
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";

import { DEMO_BLANK_NAME_MAX, DEMO_TITLE_MAX, DEMO_VALUE_MAX_WIRE } from "../../shared/demo-recording.ts";
import type { ShowItOnce } from "../host/show-it-once.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface DemoRecorderRouteDeps {
  recorder: Pick<ShowItOnce, "draft" | "start" | "stop" | "discard" | "save" | "patchStep" | "renameBlank" | "deleteStep" | "setTitle">;
  botExists(botId: string): boolean;
}

/** A folder a routine may name: one that exists on the computer the bot works on. */
function isFolder(path: string): boolean {
  try { return isAbsolute(path) && statSync(path).isDirectory(); } catch { return false; }
}

const BASE = /^\/api\/bots\/([\w-]+)\/demo-recording(?:\/(start|stop|discard|save|title|blanks)|\/steps\/(s\d{1,9}))?$/u;

const startSchema = z.object({ place: z.enum(["browser", "computer"]) });
const patchSchema = z.union([
  z.strictObject({ blank: z.union([z.string().max(DEMO_BLANK_NAME_MAX), z.null()]) }),
  z.strictObject({ value: z.string().max(DEMO_VALUE_MAX_WIRE) }),
]);
const renameSchema = z.object({ from: z.string().max(DEMO_BLANK_NAME_MAX), to: z.string().max(DEMO_BLANK_NAME_MAX) });
const titleSchema = z.object({ title: z.string().max(DEMO_TITLE_MAX * 4) });
const saveSchema = z.object({ as: z.enum(["skill", "routine"]), folder: z.string().max(1_024).optional() });

export function createDemoRecorderRoutes(deps: DemoRecorderRouteDeps): RouteHandler {
  const { recorder } = deps;
  return async ({ req, res, path, method, json, readBody }) => {
    const m = BASE.exec(path);
    if (!m) return PASS;
    const botId = m[1]!;
    const action = m[2];
    const stepId = m[3];
    if (!deps.botExists(botId)) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "no-store");
    const answer = (result: object) => ("error" in result ? json(res, 409, result) : json(res, 200, { draft: result }));
    const body = async <T>(schema: z.ZodType<T>): Promise<T | null> => {
      const parsed = schema.safeParse(await readBody(req));
      if (parsed.success) return parsed.data;
      json(res, 400, { error: "The request is not one this route reads.", code: "invalid" });
      return null;
    };

    if (stepId) {
      if (method === "DELETE") return answer(recorder.deleteStep(botId, stepId));
      if (method !== "PATCH") return json(res, 405, { error: "method not allowed" });
      const patch = await body(patchSchema);
      return patch ? answer(recorder.patchStep(botId, stepId, patch)) : undefined;
    }
    if (!action) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      return json(res, 200, { draft: recorder.draft(botId) });
    }
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (action === "start") {
      const input = await body(startSchema);
      return input ? answer(await recorder.start(botId, input.place)) : undefined;
    }
    if (action === "stop") return answer(await recorder.stop(botId));
    if (action === "discard") return answer(recorder.discard(botId));
    if (action === "title") {
      const input = await body(titleSchema);
      return input ? answer(recorder.setTitle(botId, input.title)) : undefined;
    }
    if (action === "blanks") {
      const input = await body(renameSchema);
      return input ? answer(recorder.renameBlank(botId, input.from, input.to)) : undefined;
    }
    const input = await body(saveSchema);
    if (!input) return;
    const folder = input.folder?.trim();
    if (folder && !isFolder(folder)) return json(res, 400, { error: "That folder does not exist on this computer.", code: "no-folder" });
    const saved = await recorder.save(botId, input.as, folder ? { folder } : {});
    return "error" in saved ? json(res, 409, saved) : json(res, 201, saved);
  };
}
