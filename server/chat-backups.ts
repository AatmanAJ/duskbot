import type { ProviderAdapter } from "./contracts.ts";
import type { ChatBackup } from "./drivers/chat-fallback.ts";
import type { ModelSelection } from "../shared/wire.ts";

type Engine = { instanceId: string; driverKind: string; enabled?: boolean; adapter: Pick<ProviderAdapter, "chatCompletion"> };

/** The bot's backup AIs, in its order, that can carry a chat engine's own messages on mid-turn: the enabled
 * chat-completions engines among them other than `from`, and none a managed policy `refuses`. */
export function chatBackups(selections: readonly Pick<ModelSelection, "instanceId" | "model">[], engine: (instanceId: string) => Engine | null | undefined,
  name: (instanceId: string) => string, from: string, refuses: (engine: Engine) => unknown = () => undefined): ChatBackup[] {
  return selections.flatMap((selection) => {
    const found = selection.instanceId === from ? undefined : engine(selection.instanceId);
    const complete = found && found.enabled !== false && !refuses(found) ? found.adapter.chatCompletion : undefined;
    return complete && selection.model.trim() ? [{ name: name(selection.instanceId), model: selection.model, complete }] : [];
  });
}
