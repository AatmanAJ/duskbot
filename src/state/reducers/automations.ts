import type { Action, AppState } from "../store";
import { olderRunsSince, trimRoutineRuns, withOlderRoutineRuns } from "../routine-runs";

type Reduce = (state: AppState, action: Action) => AppState;

const AUTOMATION_ACTIONS = new Set<Action["type"]>([
  "openRoutine",
  "routinesHydrated",
  "routinesLoadFailed",
  "routinePatched",
  "routineDeleted",
  "routineRunPatched",
  "routineRunsLoaded",
  "webhooksHydrated",
  "webhookPatched",
  "webhookDeleted",
  "webhookAttempted",
] as const satisfies ReadonlyArray<Action["type"]>);

export type AutomationAction = Extract<Action, { type: "openRoutine" | "routinesHydrated" | "routinesLoadFailed" | "routinePatched" | "routineDeleted" | "routineRunPatched" | "routineRunsLoaded" | "webhooksHydrated" | "webhookPatched" | "webhookDeleted" | "webhookAttempted" }>;

export const isAutomationAction = (action: Action): action is AutomationAction => AUTOMATION_ACTIONS.has(action.type);

export function reduceAutomations(state: AppState, action: AutomationAction, reduce: Reduce): AppState {
  switch (action.type) {
    case "openRoutine": {
      // a routine lives in its bot's panel: open it there, on the Details tab
      const botId = action.botId ?? state.routines.find((routine) => routine.id === action.routineId)?.botId ?? state.webhooks.find((webhook) => webhook.id === action.routineId)?.botId;
      if (!botId) return state;
      const focused = { ...state, activeView: "chat" as const, routinesFocus: { routineId: action.routineId, edit: action.edit, nonce: state.routinesFocus.nonce + 1 } };
      return reduce(focused, { type: "toggleSettings", open: true, section: "routines", botId });
    }
    case "routinesHydrated":
      return { ...state, routines: action.routines, routineRuns: trimRoutineRuns(action.runs), routineRunsSince: action.since ?? null, routinesLoadState: "ready" };
    case "routinesLoadFailed":
      return { ...state, routinesLoadState: "error" };
    case "routinePatched": {
      const existing = state.routines.find((routine) => routine.id === action.routine.id);
      // A PATCH's answer and the server's broadcast of it can arrive in either order: never step back to an older edit.
      if (existing && existing.updatedAt > action.routine.updatedAt) return state;
      return {
        ...state,
        routines: existing
          ? state.routines.map((routine) => (routine.id === action.routine.id ? action.routine : routine))
          : [action.routine, ...state.routines],
      };
    }
    case "routineDeleted":
      return { ...state, routines: state.routines.filter((routine) => routine.id !== action.routineId) };
    case "routineRunPatched": {
      const exists = state.routineRuns.some((run) => run.id === action.run.id);
      const runs = exists
        ? state.routineRuns.map((run) => (run.id === action.run.id ? action.run : run))
        : [action.run, ...state.routineRuns];
      return { ...state, routineRuns: trimRoutineRuns(runs) };
    }
    case "routineRunsLoaded":
      return { ...state, routineRuns: withOlderRoutineRuns(state.routineRuns, action.runs), routineRunsSince: olderRunsSince(state.routineRunsSince, action) };
    case "webhooksHydrated":
      return { ...state, webhooks: action.webhooks, webhookAttempts: action.attempts, webhookIngress: action.ingress };
    case "webhookPatched": {
      const exists = state.webhooks.some((webhook) => webhook.id === action.webhook.id);
      return {
        ...state,
        webhooks: exists
          ? state.webhooks.map((webhook) => (webhook.id === action.webhook.id ? action.webhook : webhook))
          : [action.webhook, ...state.webhooks],
      };
    }
    case "webhookDeleted":
      return {
        ...state,
        webhooks: state.webhooks.filter((webhook) => webhook.id !== action.webhookId),
        webhookAttempts: state.webhookAttempts.filter((attempt) => attempt.webhookId !== action.webhookId),
      };
    case "webhookAttempted": {
      const attempts = state.webhookAttempts.some((attempt) => attempt.id === action.attempt.id)
        ? state.webhookAttempts.map((attempt) => attempt.id === action.attempt.id ? action.attempt : attempt)
        : [...state.webhookAttempts, action.attempt];
      return { ...state, webhookAttempts: attempts.slice(-2_000) };
    }
  }
}
