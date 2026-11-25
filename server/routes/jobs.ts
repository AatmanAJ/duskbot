// With `wait` and the `version` a previous read returned, the request is held until the job changes or the wait runs out.
import type { RequestAuth } from "../request-auth.ts";
import type { SessionRegistry } from "../sessions.ts";
import type { Viewer, VisibleSet } from "../bot-visibility.ts";
import { queuedChannelSends } from "../channel-queue.ts";
import type { Coordinator } from "../coordinator.ts";
import { jobView, type ConversationState, type JobScope, type JobView } from "../job-view.ts";
import { hasQueuedSteeredMessages } from "../steer-queue.ts";
import type { Assignment } from "../runtime/types.ts";
import type { Store } from "../store.ts";
import { holdUntilChanged, wholeParam } from "./held-read.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Clients ask again with the version they got. */
export const JOB_WAIT_MAX_MS = 25_000;

export interface JobRouteDeps {
  store: Pick<Store, "bot" | "botByThread" | "groupByThread" | "taskByThread" | "groupTaskByThread" | "onChange">;
  coordinator: Pick<Coordinator, "job">;
  groupThreadIsWorking(groupId: string, threadId: string): boolean;
  viewerFor(auth: RequestAuth): Viewer;
  visibleTo(viewer: Viewer): VisibleSet;
  /** A held read outlives its start: the session is asked again before it answers. */
  sessions: Pick<SessionRegistry, "isLive">;
  now?: () => number;
  recheckMs?: number;
}

export type JobReaderDeps = Pick<JobRouteDeps, "store" | "coordinator" | "groupThreadIsWorking" | "now">;

export interface JobRead {
  view: JobView;
  rows: readonly Assignment[];
}

export type JobReader = (threadId: string, scope: JobScope, since: number, full: boolean, visible: VisibleSet) => JobRead | null;

export function createJobReader(deps: JobReaderDeps): JobReader {
  const { store, coordinator } = deps;
  const now = deps.now ?? Date.now;

  const conversationOf = (threadId: string): ConversationState | null => {
    const bot = store.botByThread(threadId);
    if (bot) {
      const task = store.taskByThread(bot.id, threadId);
      return {
        kind: "bot", busy: task?.busy === true || task?.activity === "working" || task?.activity === "parked.computer",
        ...(task?.activity ? { activity: task.activity } : {}), queued: hasQueuedSteeredMessages(bot.id, threadId) ? 1 : 0,
      };
    }
    const group = store.groupByThread(threadId);
    return group ? { kind: "room", busy: deps.groupThreadIsWorking(group.id, threadId), queued: queuedChannelSends(threadId) } : null;
  };

  return (threadId, scope, since, full, visible) => {
    const conversation = conversationOf(threadId);
    if (!conversation) return null;
    const owner = store.botByThread(threadId);
    const { scopes, rows } = coordinator.job(threadId, since, owner?.id);
    const view = jobView({
      threadId, scope, since, now: now(), scopes, rows, conversation, full,
      activityOf: (row) => row.assignee.destination.groupId
        ? store.bot(row.assignee.botId)?.activity
        : store.taskByThread(row.assignee.botId, row.assignee.destination.threadId)?.activity,
      nameOf: (botId) => store.bot(botId)?.name,
      titleOf: (row) => row.assignee.destination.groupId
        ? store.groupTaskByThread(row.assignee.destination.groupId, row.assignee.destination.threadId)?.title
        : store.taskByThread(row.assignee.botId, row.assignee.destination.threadId)?.title,
      visible: (thread) => visible.thread(thread),
    });
    return { view, rows };
  };
}

export function createJobRoutes(deps: JobRouteDeps): RouteHandler {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const reader = createJobReader(deps);
  const read = (threadId: string, scope: JobScope, since: number, full: boolean, visible: VisibleSet): JobView | null =>
    reader(threadId, scope, since, full, visible)?.view ?? null;

  return async ({ res, url, path, method, auth, json }) => {
    const m = /^\/api\/threads\/([\w-]+)\/job$/.exec(path);
    if (!m || method !== "GET") return PASS;
    const threadId = m[1]!;
    const params = url.searchParams;
    const scope = params.get("scope") ?? "job";
    if (scope !== "job" && scope !== "turn") return json(res, 400, { error: "scope must be job or turn" });
    const sinceParam = wholeParam(params, "since", Number.MAX_SAFE_INTEGER);
    const wait = wholeParam(params, "wait", JOB_WAIT_MAX_MS);
    if (sinceParam === null) return json(res, 400, { error: "since must be a server time in milliseconds" });
    if (wait === null) return json(res, 400, { error: `wait must be 0 to ${JOB_WAIT_MAX_MS} milliseconds` });
    // No `since`: the work open now. A waiter passes back the since it got, so its job does not move under it.
    const since = params.has("since") ? sinceParam : now();
    const full = params.get("full") === "1";
    const known = params.get("version") ?? "";
    const visible = deps.visibleTo(deps.viewerFor(auth));
    if (!visible.thread(threadId)) return json(res, 404, { error: "no such conversation" });
    const view = read(threadId, scope, since, full, visible);
    if (!view) return json(res, 404, { error: "no such conversation" });
    if (!wait || view.version !== known) return json(res, 200, view);

    const held = await holdUntilChanged({
      res, store, known, wait, recheckMs: deps.recheckMs, read: () => read(threadId, scope, since, full, visible),
    });
    if (res.writableEnded || res.destroyed) return;
    if ("error" in held) throw held.error;
    if (!held.view) return json(res, 404, { error: "no such conversation" });
    // The hold may have outlived a sign-out or an audience change: authorize again.
    if (auth.kind === "session" && !deps.sessions.isLive(auth.session.id)) {
      return json(res, 401, { error: "unauthorized: this session has expired or was revoked" });
    }
    const visibleNow = deps.visibleTo(deps.viewerFor(auth));
    const fresh = visibleNow.thread(threadId) ? read(threadId, scope, since, full, visibleNow) : null;
    if (!fresh) return json(res, 404, { error: "no such conversation" });
    return json(res, 200, fresh);
  };
}
