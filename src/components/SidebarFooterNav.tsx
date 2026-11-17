import { useAppTriggers } from "@/lib/app-triggers";
import { automationsFrom, hasUnseenProblemRun, type AutomationKind } from "@/lib/automations";
import { useStoreShallow } from "@/state/store";

export interface AutomationNeedingYou {
  kind: AutomationKind;
  id: string;
  botId: string;
}

/** The first automation the account's dot is raised for: an unseen failed run of one the bot panels list (opening it
 * there clears the dot), or an app trigger in trouble. */
export function useAutomationNeedingYou(): AutomationNeedingYou | null {
  const appTriggers = useAppTriggers();
  const routinesOnly = typeof window !== "undefined" && window.duskDesktop?.remoteClient?.active === true;
  return useStoreShallow((state) => {
    const unseen = automationsFrom({
      routines: state.routines, webhooks: routinesOnly ? [] : state.webhooks, appTriggers: appTriggers.triggers, runs: state.routineRuns, bots: state.bots,
    }).find((automation) => hasUnseenProblemRun([automation]));
    const trouble = unseen ? null : appTriggers.triggers.find((trigger) => trigger.enabled && trigger.problem);
    const found = unseen ?? (trouble ? { kind: "app" as const, id: trouble.id, botId: trouble.botId } : null);
    return found ? { kind: found.kind, id: found.id, botId: found.botId } : null;
  });
}
