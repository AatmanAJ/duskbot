import { engineReady } from "@/components/EngineLibrary";
import type { Bot, InstanceInfo } from "@/state/store";
import { backupOrder, SUBSCRIPTION_DRIVERS } from "../../shared/ai-ranking";
import { supportsWorkspaceFiles } from "../../shared/workspace-files";

type Backup = NonNullable<Bot["fallback"]>[number];

/** The backups a bot set to Automatic is carried on by, in the order the server tries them: the other AIs the person
 * has working that keep the bot's files, never another sign-in to the same plan. */
export function automaticBackupList(bot: Pick<Bot, "modelSelection">, instances: readonly InstanceInfo[], max: number): Backup[] {
  const own = instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
  const working = instances.filter((instance) => instance.instanceId !== bot.modelSelection.instanceId && !instance.found && !instance.policy
    && engineReady(instance) && instance.models.default.trim()
    && !(own && supportsWorkspaceFiles(own.driverKind) && !supportsWorkspaceFiles(instance.driverKind))
    && !(own && instance.driverKind === own.driverKind && SUBSCRIPTION_DRIVERS.has(own.driverKind) && instance.access !== "api"));
  return backupOrder(working, own?.driverKind).slice(0, max).map((instance) => ({ instanceId: instance.instanceId, model: instance.models.default }));
}
