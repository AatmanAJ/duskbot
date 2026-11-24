import type { WireMessage } from "../shared/wire.ts";
import type { CaptureTurn } from "./memory-capture.ts";
import { extractTurnImages } from "./turn-images.ts";

/** A routine that runs every few minutes feeds memory at most once in this long. */
export const ROUTINE_CAPTURE_GAP_MS = 6 * 60 * 60_000;

type PathMessage = Pick<WireMessage, "id" | "role" | "kind" | "text" | "turnId" | "tool" | "sender" | "peerAsk" | "quietRun">;

export interface LearningOriginsDeps {
  path: (threadId: string) => readonly PathMessage[];
  routineRun: (threadId: string) => { routineId: string; routineName: string; dryRun?: true } | null;
  /** The day watch and other proactive check-ins: they read and report, never teach. */
  heartbeat: (threadId: string) => boolean;
  internal: (threadId: string) => boolean;
  unattended: (botId: string, threadId: string) => boolean;
  now?: () => number;
}

export interface LearningOrigins {
  /** A finished 1:1 turn as memory capture reads it, or null when it may not feed memory. */
  captureTurn(botId: string, threadId: string, turnId: string): CaptureTurn | null;
  /** The turn as capture reads it, whoever opened it, for a turn read back after a restart; no throttle. */
  personTurn(threadId: string, turnId: string): CaptureTurn | null;
  /** Whether a finished turn's tool steps count toward the bot's skill review. */
  countsForSkills(threadId: string): boolean;
  /** The routine a thread runs, for a skill review's transcript. */
  routineName(threadId: string): string | undefined;
}

export function createLearningOrigins(deps: LearningOriginsDeps): LearningOrigins {
  const now = () => deps.now?.() ?? Date.now();
  const lastRoutineCapture = new Map<string, number>();

  const read = (threadId: string, turnId: string) => {
    const path = deps.path(threadId);
    const replyAt = path.findLastIndex((message) => message.role === "bot" && message.kind === "text" && message.turnId === turnId);
    if (replyAt < 0) return null;
    const reply = path[replyAt]!;
    const asked = path.slice(0, replyAt).findLast((message) => message.role === "user" && message.kind === "text");
    const verified = path.some((message) => message.kind === "activity" && message.turnId === turnId && message.tool?.name && !message.tool.setup && message.tool.ok !== false);
    return { reply, asked, verified };
  };

  return {
    captureTurn(botId, threadId, turnId) {
      if (deps.internal(threadId) || deps.heartbeat(threadId)) return null;
      const turn = read(threadId, turnId);
      if (!turn || turn.reply.quietRun) return null;
      const { reply, asked, verified } = turn;
      const run = deps.routineRun(threadId);
      if (run) {
        if (run.dryRun || !verified) return null;
        const last = lastRoutineCapture.get(run.routineId);
        if (last !== undefined && now() - last < ROUTINE_CAPTURE_GAP_MS) return null;
        lastRoutineCapture.set(run.routineId, now());
        return { person: "", bot: reply.text ?? "", owner: false, turnId, ...(asked ? { messageId: asked.id } : {}),
          origin: { kind: "routine", name: run.routineName, asked: asked?.text ?? "" } };
      }
      if (asked?.peerAsk) {
        if (!verified) return null;
        return { person: "", bot: reply.text ?? "", owner: false, turnId, messageId: asked.id,
          origin: { kind: "bot", name: asked.peerAsk.name, asked: asked.text ?? "" } };
      }
      if (!asked || deps.unattended(botId, threadId)) return null;
      return this.personTurn(threadId, turnId);
    },
    personTurn(threadId, turnId) {
      const turn = read(threadId, turnId);
      if (!turn?.asked || turn.asked.peerAsk) return null;
      return { person: extractTurnImages(turn.asked.text ?? "").text, bot: turn.reply.text ?? "", owner: !turn.asked.sender, turnId, messageId: turn.asked.id };
    },
    countsForSkills(threadId) {
      return !deps.internal(threadId) && !deps.heartbeat(threadId) && !deps.routineRun(threadId)?.dryRun;
    },
    routineName(threadId) {
      return deps.routineRun(threadId)?.routineName;
    },
  };
}
