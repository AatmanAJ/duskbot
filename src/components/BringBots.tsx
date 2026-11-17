import { useCallback, useEffect, useState } from "react";

import { BOTS_LOOK_TIME_BOX_MS, lookForOtherBots, planBotMove, type BotMovePlan } from "@/lib/bot-move";
import { api } from "@/state/store";
import { useStoreRef } from "@/state/store-ref";

/** Looks for other agent apps' bots on this computer and plans their move; the plan is null while looking, and stays
 * empty when nothing is here. The bringing in itself is bringChosen's (BringIn). */
/** `downloads: false`: Grok bot exports in Downloads are not looked for (the first run, where macOS must not ask yet). */
/** `ms`: how long the look may take before it counts as nothing found (BOTS_LOOK_TIME_BOX_MS by default). */
export function useBotMove(options: { look?: boolean; downloads?: boolean; ms?: number } = {}) {
  const store = useStoreRef();
  const [plan, setPlan] = useState<BotMovePlan | null>(null);

  const look = useCallback(async () => {
    const [found, servers] = await Promise.all([
      lookForOtherBots(options.ms, { downloads: options.downloads !== false }),
      api<{ servers?: Array<{ name: string }> }>("/api/mcp/servers", { timeoutMs: options.ms ?? BOTS_LOOK_TIME_BOX_MS }).then((answer) => answer.servers ?? [], () => []),
    ]);
    const next = planBotMove(found, { bots: store.state().bots, servers: new Set(servers.map((server) => server.name)), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    setPlan(next);
    return next;
  }, [options.downloads, options.ms]);

  useEffect(() => {
    if (options.look !== false) void look();
  }, [look, options.look]);

  return { plan, look };
}
