import type { Action, AppState } from "../store";
import { currentTaskBot, withMascotMotion } from "./helpers";

const RUNTIME_ACTIONS = new Set<Action["type"]>([
  "instances",
  "configStatus",
  "liveCall",
  "liveCallLookup",
  "profileSaved",
  "browserPart",
  "computerStart",
  "computerControl",
  "dataSheet",
  "modelVariantRuntime",
] as const satisfies ReadonlyArray<Action["type"]>);

export type RuntimeAction = Extract<Action, { type: "instances" | "configStatus" | "liveCall" | "liveCallLookup" | "profileSaved" | "browserPart" | "computerStart" | "computerControl" | "dataSheet" | "modelVariantRuntime" }>;

export const isRuntimeAction = (action: Action): action is RuntimeAction => RUNTIME_ACTIONS.has(action.type);

export function reduceRuntime(state: AppState, action: RuntimeAction): AppState {
  switch (action.type) {
    case "instances":
      return { ...state, instances: action.instances };
    case "configStatus":
      return { ...state, config: action.config };
    case "liveCall":
      return { ...state, liveCall: action.call, liveCallVersion: state.liveCallVersion + 1 };
    case "liveCallLookup":
      return action.since === state.liveCallVersion && action.seq > state.liveCallLookupSeq
        ? { ...state, liveCall: action.call, liveCallLookupSeq: action.seq }
        : state;
    case "profileSaved":
      return state.config ? {
        ...state,
        config: { ...state.config, profile: { name: "", email: "", ...state.config.profile, ...action.profile } },
      } : state;
    case "browserPart":
      return { ...state, browserPart: action.part };
    case "computerStart": {
      const { [action.botId]: _ended, ...others } = state.computerStarts;
      return {
        ...(action.start ? withMascotMotion(state, action.botId, "launch") : state),
        computerStarts: action.start ? { ...others, [action.botId]: action.start } : others,
      };
    }
    case "computerControl":
      return {
        ...state,
        computerControl: {
          ...state.computerControl,
          [action.botId]: { held: action.held, helpReason: action.helpReason, help: action.help ?? null },
        },
      };
    case "modelVariantRuntime": {
      const event = action.event;
      if (!event.turnId) return state;
      const owner = state.bots.find((bot) => bot.threadId === event.threadId || bot.tasks?.some((task) => task.threadId === event.threadId));
      if (!owner) return state;
      const selection = currentTaskBot(owner, event.threadId).modelSelection;
      if (selection.instanceId !== event.providerInstanceId ||
          !state.instances.find((instance) => instance.instanceId === selection.instanceId)?.capabilities?.modelVariants) return state;
      const previous = state.modelVariantSessions[event.threadId];
      if (event.type === "turn.started") {
        if (previous && (previous.turnId === event.turnId || Date.parse(previous.startedAt) > Date.parse(event.createdAt))) return state;
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: {
          instanceId: selection.instanceId, model: selection.model, turnId: event.turnId, startedAt: event.createdAt, acceptingUpdates: true,
        } } };
      }
      if (!previous?.acceptingUpdates || previous.turnId !== event.turnId || previous.instanceId !== selection.instanceId || previous.model !== selection.model) return state;
      if (event.type === "session.model-variants" && event.model === selection.model) {
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: { ...previous, variants: event.variants } } };
      }
      if (event.type === "turn.completed") {
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: { ...previous, acceptingUpdates: false } } };
      }
      return state;
    }
    case "dataSheet":
      return {
        ...state,
        dataSheets: { ...state.dataSheets, [action.sheet.botId]: action.sheet },
        ...(action.tables ? { dataTables: { ...state.dataTables, [action.sheet.botId]: action.tables } } : {}),
      };
  }
}
