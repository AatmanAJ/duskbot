// On a new cloud whose AIs didn't come along from the computer that set it up: one quiet line in the first chat, named
// for the AI that is missing, with its sign-in one tap away. The cloud's first run never has an AI screen of its own.
import { useState } from "react";
import { engineReady } from "@/components/EngineLibrary";
import { t } from "@/lib/i18n";
import { computerAiIds } from "@/lib/onboarding";
import { useStore, type InstanceInfo } from "@/state/store";
import { AiConnect, inAppConnect } from "./AiCards";
import { computerTiles } from "./AiStep";
import { aiTiles, type AiTile } from "./funnel";
import { useConnectFlow } from "./SignInPill";

/** The first AI used on the computer that isn't signed in here, while no AI of the person's own works here; else null. */
export function missingCloudAi<Instance extends InstanceInfo>(tiles: readonly AiTile<Instance>[], used: readonly string[], ownAiWorks: boolean): AiTile<Instance> | null {
  if (ownAiWorks) return null;
  return tiles.find((tile) => used.includes(tile.id) && !engineReady(tile.instance)) ?? null;
}

export function useMissingCloudAi(on: boolean, ownAiWorks: boolean): AiTile<InstanceInfo> | null {
  const { state } = useStore();
  if (!on) return null;
  const tiles = aiTiles(state.instances, engineReady, inAppConnect);
  return missingCloudAi(tiles, computerTiles(computerAiIds(state.config?.onboarding), state.instances), ownAiWorks);
}

export function CloudSignInLine({ tile }: { tile: AiTile<InstanceInfo> }) {
  const flow = useConnectFlow();
  const [open, setOpen] = useState(false);
  const start = () => {
    setOpen(true);
    if (tile.candidates.some(inAppConnect)) flow.start({ tile: tile.id, candidates: tile.candidates.map((candidate) => candidate.instanceId) });
  };
  return (
    <div data-cloud-sign-in={tile.id} className="mt-2 flex w-full max-w-[520px] flex-col items-start gap-2">
      <p className="text-[14px] leading-5 text-ink-secondary">{t("cloudSignIn.line", { name: tile.label })}</p>
      {open
        ? <AiConnect tile={tile} flow={{ ...flow, cancel: () => { flow.cancel(); setOpen(false); } }} />
        : <button type="button" data-cloud-sign-in-start="" onClick={start} className="ui-button ui-button-pill ui-button-sm">{t("cloudSignIn.action", { name: tile.label })}</button>}
    </div>
  );
}
