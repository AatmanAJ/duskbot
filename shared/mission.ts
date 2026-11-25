/** One brief run by several bots at once, each in a new conversation of its own (a lane), watched and steered from
 * Mission control. A mission is a view over those conversations: it has no record of its own. */
export interface MissionTag {
  id: string;
  title: string;
  /** The lane's place on the board, from 0. */
  lane: number;
  launchedAt: number;
  /** What the lane was first sent, so a lane whose first message never went out, or that failed, can be run again. */
  brief?: string;
}

/** A conversation's mission, set when the conversation is made and never changed. */
export interface MissionMember {
  mission?: MissionTag;
}

export const MISSION_MAX_LANES = 8;
export const MISSION_TITLE_MAX = 80;
export const MISSION_BRIEF_MAX = 8_000;

/** `idle`: nothing has run in the lane since its mission launched (its first message did not go out). */
export type LaneState = "queued" | "working" | "waiting" | "needs-input" | "done" | "failed" | "stopped" | "idle";

export type MissionState = "running" | "needs-input" | "done" | "partly-done" | "failed" | "stopped" | "idle";

export interface MissionLane {
  lane: number;
  botId: string;
  botName: string;
  threadId: string;
  title: string;
  state: LaneState;
  /** What the lane is doing or how it ended, in words. */
  reason: string;
  /** The question it waits on the person for, when it does, and the answer it would take if left to choose. */
  question?: string;
  suggested?: string;
  startedAt?: number;
  finishedAt?: number;
  /** Teammate tasks the lane handed out, and how many of them are still open. */
  teammates: number;
  teammatesOpen: number;
  /** The lane's latest finished reply, whole. */
  reply?: string;
  /** What the lane's turns did to files in its folder, newest change last. */
  files: LaneFile[];
  cwd?: string;
  brief?: string;
}

export interface LaneFile {
  path: string;
  change: "added" | "changed" | "deleted";
}

export type SpanState = "queued" | "working" | "waiting" | "needs-input" | "done" | "failed" | "stopped";

/** One stretch of one piece of work on the mission's clock: a lane's own turn, or a teammate's part of it. */
export interface MissionSpan {
  laneThreadId: string;
  assignmentId: string;
  parentId?: string;
  depth: number;
  botId: string;
  botName: string;
  state: SpanState;
  from: number;
  /** Absent while it is still the work's current state. */
  to?: number;
}

export type MissionMarkKind = "handoff" | "asked" | "answered" | "done" | "failed" | "stopped" | "stalled";

export interface MissionMark {
  laneThreadId: string;
  assignmentId: string;
  botName: string;
  at: number;
  kind: MissionMarkKind;
  detail?: string;
}

export type LaneCounts = Record<LaneState, number>;

export interface MissionSummary {
  id: string;
  title: string;
  launchedAt: number;
  state: MissionState;
  lanes: number;
  counts: LaneCounts;
  /** When the last lane ended; absent while any lane is open. */
  finishedAt?: number;
}

export interface MissionView extends MissionSummary {
  now: number;
  /** Changes whenever anything the page shows changes; pass it back as `version` to wait for the next change. */
  version: string;
  board: MissionLane[];
  spans: MissionSpan[];
  marks: MissionMark[];
}

export const OPEN_LANE_STATES: ReadonlySet<LaneState> = new Set(["queued", "working", "waiting", "needs-input"]);

export function emptyLaneCounts(): LaneCounts {
  return { queued: 0, working: 0, waiting: 0, "needs-input": 0, done: 0, failed: 0, stopped: 0, idle: 0 };
}

export function missionStateOf(states: readonly LaneState[]): MissionState {
  if (!states.length) return "idle";
  if (states.includes("needs-input")) return "needs-input";
  if (states.some((state) => OPEN_LANE_STATES.has(state))) return "running";
  if (states.every((state) => state === "done")) return "done";
  if (states.every((state) => state === "idle")) return "idle";
  if (states.every((state) => state === "stopped" || state === "idle")) return "stopped";
  return states.includes("done") ? "partly-done" : "failed";
}

/** The `mission` a new conversation is made with: a person's request, so every field is checked. */
export function parseMissionTag(raw: unknown, now: number): { ok: true; tag: MissionTag } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "mission must be an object" };
  const { id, title, lane, launchedAt, brief } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !/^[\w-]{6,64}$/.test(id)) return { ok: false, error: "mission.id must be 6 to 64 letters, digits, - or _" };
  if (typeof title !== "string" || !title.trim()) return { ok: false, error: "mission.title is required" };
  if (!Number.isInteger(lane) || (lane as number) < 0 || (lane as number) >= MISSION_MAX_LANES) {
    return { ok: false, error: `mission.lane must be a whole number from 0 to ${MISSION_MAX_LANES - 1}` };
  }
  const at = launchedAt === undefined ? now : launchedAt;
  if (typeof at !== "number" || !Number.isSafeInteger(at) || at <= 0 || at > now + 60_000) {
    return { ok: false, error: "mission.launchedAt must be a server time in milliseconds, not in the future" };
  }
  if (brief !== undefined && (typeof brief !== "string" || brief.length > MISSION_BRIEF_MAX)) {
    return { ok: false, error: `mission.brief must be text of at most ${MISSION_BRIEF_MAX} characters` };
  }
  return { ok: true, tag: { id, title: title.trim().slice(0, MISSION_TITLE_MAX), lane: lane as number, launchedAt: at, ...(brief?.trim() ? { brief: brief.trim() } : {}) } };
}
