import { engineReady } from "@/components/EngineLibrary";
import { offersSignIn } from "@/components/EngineSetup";
import { aiTileOf } from "@/components/onboarding/funnel";
import { t } from "@/lib/i18n";
import { failurePreviewLine } from "@/lib/failed-reply";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { failedTurnCause } from "../../shared/failed-turn";
import { toolStepLabel } from "@/lib/tool-step-label";
import { isClientCancellation, isStoppedTurnName } from "../../shared/client-cancel";

export const STATUS_MARKER = /^(?:recovery|notice):\s*/;

export { failedTurnCause };

type ActivityTool = NonNullable<Message["tool"]>;

export function engineSignedOut(engine: InstanceInfo | undefined): boolean {
  return Boolean(engine?.snapshot) && offersSignIn(engine);
}

export function signedOutEngine(tool: ActivityTool, engine: InstanceInfo | undefined): InstanceInfo | undefined {
  return tool.setup && !tool.claudeUpdate && engineSignedOut(engine) ? engine : undefined;
}

export function claudeUpdateTarget(engine: InstanceInfo | undefined): InstanceInfo | undefined {
  return engine?.driverKind === "claudeAgent" && !engine.readOnly ? engine : undefined;
}

type Backup = { instanceId: string; model: string };

/** The bot's AI when it is signed out and no backup that is signed in would take the turn instead. */
export function signedOutWithoutBackup(bot: Bot, instances: InstanceInfo[], recovery?: { enabled: boolean; backup?: Backup }): InstanceInfo | undefined {
  const engine = botEngine(bot, instances);
  if (!engineSignedOut(engine)) return undefined;
  const backups = bot.fallback?.length ? bot.fallback : recovery?.enabled && recovery.backup ? [recovery.backup] : [];
  const answers = (backup: Backup) => {
    const instance = instances.find((candidate) => candidate.instanceId === backup.instanceId);
    return instance?.snapshot.state === "available" && instance.snapshot.authenticated !== false;
  };
  return backups.some(answers) ? undefined : engine;
}

/** The other ChatGPT account when the bot's is signed out and that one is signed in (Codex's own login and the ChatGPT
 * plan), with the bot's model there: the same one when it is offered, else the nearest by name, else its default. */
export function signedInChatGpt(engine: InstanceInfo | undefined, instances: readonly InstanceInfo[], model: string): { instance: InstanceInfo; model: string } | undefined {
  if (!engine || !engineSignedOut(engine) || aiTileOf(engine) !== "chatgpt") return undefined;
  const instance = instances.find((other) => other !== engine && other.access !== "api" && aiTileOf(other) === "chatgpt" && engineReady(other));
  const options = instance?.models.options.filter((option) => !option.custom && option.id.trim()) ?? [];
  if (!instance || options.length === 0) return undefined;
  return { instance, model: nearestModel(options.map((option) => option.id), model, instance.models.default) };
}

const bareModel = (id: string) => id.slice(id.lastIndexOf("/") + 1).toLowerCase();

function nearestModel(ids: readonly string[], wanted: string, fallback: string): string {
  const bare = bareModel(wanted);
  const same = ids.find((id) => id === wanted) ?? ids.find((id) => bareModel(id) === bare);
  if (same) return same;
  const shared = (id: string) => { const other = bareModel(id); let n = 0; while (n < other.length && other[n] === bare[n]) n += 1; return n; };
  const best = ids.reduce((top, id) => shared(id) > shared(top) ? id : top, ids[0]!);
  return shared(best) > 0 ? best : ids.includes(fallback) ? fallback : ids[0]!;
}

export function botEngine(bot: Bot | undefined, instances: InstanceInfo[]): InstanceInfo | undefined {
  return bot && instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
}

export function activityPreview(tool: ActivityTool, engine: InstanceInfo | undefined, dataResult?: Message["dataResult"]): string {
  if (dataResult) return dataResult.title;
  if (isStoppedTurnName(tool.name)) return t("chat.turnStopped");
  const cause = failedTurnCause(tool.name);
  if (cause !== null && isClientCancellation(cause)) return t("chat.turnStopped");
  if (cause !== null && tool.partial) return t("chat.error.partialPreview");
  if (cause !== null && tool.reason === "timeout") return t("failedReply.timeout");
  if (cause === null) return STATUS_MARKER.test(tool.name) ? tool.name.replace(STATUS_MARKER, "") : toolStepLabel(tool);
  return failurePreviewLine(tool, engine);
}
