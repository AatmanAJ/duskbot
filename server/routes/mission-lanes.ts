import type { Viewer, VisibleSet } from "../bot-visibility.ts";
import { laneDiff, ownLaneFolder, probeRepo, removeLaneWorktree, type WorktreeHost } from "../mission-worktrees.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Store, TaskRecord } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface MissionLaneRouteDeps {
  store: Pick<Store, "botByThread" | "taskByThread">;
  host: WorktreeHost;
  viewerFor(auth: RequestAuth): Viewer;
  visibleTo(viewer: Viewer): VisibleSet;
}

export function createMissionLaneRoutes(deps: MissionLaneRouteDeps): RouteHandler {
  const lane = (auth: RequestAuth, missionId: string, threadId: string): (TaskRecord & { cwd: string }) | null => {
    const bot = deps.store.botByThread(threadId);
    const task = bot ? deps.store.taskByThread(bot.id, threadId) : undefined;
    if (!task?.mission?.worktree || task.mission.id !== missionId || !task.cwd || !ownLaneFolder(deps.host, task.cwd)) return null;
    return deps.visibleTo(deps.viewerFor(auth)).thread(threadId) ? task as TaskRecord & { cwd: string } : null;
  };

  return async ({ res, url, path, method, auth, json }) => {
    if (path === "/api/mission-repo" && method === "GET") {
      return json(res, 200, await probeRepo(deps.host, url.searchParams.get("path") ?? ""));
    }
    const m = /^\/api\/missions\/([\w-]+)\/lanes\/([\w-]+)\/(diff|worktree)$/.exec(path);
    if (!m) return PASS;
    const [, missionId, threadId, what] = m as unknown as [string, string, string, "diff" | "worktree"];
    if (!(what === "diff" ? method === "GET" : method === "DELETE")) return PASS;
    const task = lane(auth, missionId, threadId);
    if (!task?.mission?.worktree) return json(res, 404, { error: "no such lane worktree" });
    const { worktree } = task.mission;
    if (what === "worktree" && task.busy) return json(res, 409, { error: "Stop the lane before removing its folder" });
    try {
      if (what === "diff") return json(res, 200, await laneDiff(deps.host, { path: task.cwd, base: worktree.base, branch: worktree.branch }));
      await removeLaneWorktree(deps.host, { path: task.cwd, repo: worktree.repo });
      return json(res, 200, { ok: true, branch: worktree.branch });
    } catch (error) {
      return json(res, 409, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
