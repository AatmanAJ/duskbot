import type { SkillReplayArgs } from "../host/skill-replay-turn.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

/** Only dispatch inside the internal capability gate, with its guarded body reader. The global route table must never
 * register this endpoint. */
export function createInternalSkillReplayRoutes(deps: {
  readBody(): ReturnType<RouteContext["readBody"]>;
  replay(args: SkillReplayArgs): Promise<{ ok: boolean; text: string }>;
  /** Throws when the turn that asked has ended: such a run gets no answer. */
  stillActive(): void;
}): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (method !== "POST" || path !== "/api/internal/skill-replay") return PASS;
    const body = await deps.readBody();
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "request body must be a JSON object" });
    const outcome = await deps.replay({ skill: body.skill, inputs: body.inputs, folder: body.folder, skip: body.skip, from_step: body.from_step });
    deps.stillActive();
    return json(res, 200, outcome);
  };
}
