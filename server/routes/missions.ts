import type { MissionSummary, MissionView } from "../../shared/mission.ts";
import { isOwnThreadFolder } from "../../shared/thread-folder.ts";
import type { VisibleSet } from "../bot-visibility.ts";
import type { Coordinator } from "../coordinator.ts";
import { missionSummary, missionView, type LaneSource } from "../missions.ts";
import type { Store } from "../store.ts";
import { holdUntilChanged, wholeParam } from "./held-read.ts";
import { createJobReader, type JobRouteDeps } from "./jobs.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const MISSION_WAIT_MAX_MS = 25_000;
const MISSIONS_LISTED = 50;

export interface MissionRouteDeps extends Omit<JobRouteDeps, "store" | "coordinator"> {
  store: JobRouteDeps["store"] & Pick<Store, "bots" | "onChange" | "messagesFor">;
  coordinator: Pick<Coordinator, "job" | "events">;
}

export function createMissionRoutes(deps: MissionRouteDeps): RouteHandler {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const readJob = createJobReader(deps);

  const lanesById = (visible: VisibleSet, only?: string): Map<string, LaneSource[]> => {
    const missions = new Map<string, LaneSource[]>();
    for (const bot of store.bots) {
      if (!visible.bot(bot.id)) continue;
      for (const task of bot.tasks ?? []) {
        const tag = task.mission;
        if (!tag || (only && tag.id !== only) || task.archivedAt || !visible.thread(task.threadId)) continue;
        const job = readJob(task.threadId, "job", tag.launchedAt, true, visible);
        if (!job) continue;
        const lanes = missions.get(tag.id) ?? [];
        const digests = only ? store.messagesFor(task.threadId)
          .filter((message) => message.kind === "digest" && (message.digest?.at ?? 0) >= tag.launchedAt).map((message) => message.digest?.files) : [];
        lanes.push({ tag, botId: bot.id, botName: bot.name, threadId: task.threadId, title: task.title, ...(task.cwd && !isOwnThreadFolder(task.cwd, bot.id, task.threadId) ? { cwd: task.cwd } : {}), job, digests });
        missions.set(tag.id, lanes);
      }
    }
    return missions;
  };

  const list = (visible: VisibleSet): MissionSummary[] => [...lanesById(visible)]
    .map(([id, lanes]) => missionSummary(id, lanes))
    .sort((a, b) => b.launchedAt - a.launchedAt)
    .slice(0, MISSIONS_LISTED);

  const view = (id: string, visible: VisibleSet): MissionView | null => {
    const lanes = lanesById(visible, id).get(id);
    return lanes?.length ? missionView(id, lanes, (assignment) => deps.coordinator.events(assignment), (botId) => store.bot(botId)?.name ?? "A teammate", now()) : null;
  };

  return async ({ res, url, path, method, auth, json }) => {
    if (method !== "GET") return PASS;
    if (path === "/api/missions") return json(res, 200, { missions: list(deps.visibleTo(deps.viewerFor(auth))) });
    const m = /^\/api\/missions\/([\w-]+)$/.exec(path);
    if (!m) return PASS;
    const id = m[1]!;
    const wait = wholeParam(url.searchParams, "wait", MISSION_WAIT_MAX_MS);
    if (wait === null) return json(res, 400, { error: `wait must be 0 to ${MISSION_WAIT_MAX_MS} milliseconds` });
    const known = url.searchParams.get("version") ?? "";
    const visible = deps.visibleTo(deps.viewerFor(auth));
    const first = view(id, visible);
    if (!first) return json(res, 404, { error: "no such mission" });
    if (!wait || first.version !== known) return json(res, 200, first);
    const held = await holdUntilChanged({ res, store, known, wait, recheckMs: deps.recheckMs, read: () => view(id, visible) });
    if (res.writableEnded || res.destroyed) return;
    if ("error" in held) throw held.error;
    if (auth.kind === "session" && !deps.sessions.isLive(auth.session.id)) {
      return json(res, 401, { error: "unauthorized: this session has expired or was revoked" });
    }
    const fresh = held.view ? view(id, deps.visibleTo(deps.viewerFor(auth))) : null;
    return fresh ? json(res, 200, fresh) : json(res, 404, { error: "no such mission" });
  };
}
