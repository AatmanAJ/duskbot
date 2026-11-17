// Connecting an AI, as one step of the first run: the grid of AIs people already use (AiCards), and the free model or
// later when none is connected yet. More ways opens every other provider and API keys. An AI already signed in here
// that answers its test message is used without asking: the step says so for a moment and goes on, with Continue to go at once
// and Skip while it is still being checked.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "../../icons";
import { engineReady } from "@/components/EngineLibrary";
import { activeLocale, t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { AiCards } from "./AiCards";
import { ConnectAiDialog } from "./ConnectAi";
import { aiName, aiTileOf, aiTiles, freeModel, type AiTileId } from "./funnel";
import { PRIMARY, SECONDARY, StepArt, StepFrame } from "./FunnelSteps";
import type { WelcomeAiNow } from "./welcome-ai";

/** `onNext` says how the person went on (an AI connected, the free model, or later), for the funnel's numbers. `cloud`:
 * the person's dusk cloud is being made meanwhile, which the line says. `auto`: an AI that already works is used without
 * asking; off: the person always picks an AI here, never a "found" screen. */
export function AiStep({ tested, cloud = false, computerAis = [], onNext }: { tested: WelcomeAiNow | null; cloud?: boolean; auto?: boolean;
  /** on a cloud the desktop app set up: the AIs signed in on that computer, by instance id */
  computerAis?: readonly string[]; onNext: (how: "connected" | "free" | "later") => void }) {
  const { state } = useStore();
  const [more, setMore] = useState(false);
  const free = freeModel(state.instances, engineReady);
  const tiles = aiTiles(state.instances, engineReady);
  const connected = tiles.filter((tile) => engineReady(tile.instance));
  const used = computerTiles(computerAis, state.instances);
  const usedLeft = tiles.filter((tile) => used.includes(tile.id) && !engineReady(tile.instance));
  const sub = usedLeft.length
    ? t("funnel.ai.subComputer", { ais: new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(usedLeft.map((tile) => tile.label)) })
    : connected.length ? t("funnel.ai.subMore") : cloud ? t("funnel.ai.subCloud") : t("funnel.ai.sub");
  const { using, goOn, skip } = useFoundAi(null, onNext);

  if (using !== "none") {
    const name = tested ? aiName(tested.instance) : "";
    return (
      <StepFrame art={<StepArt art="plug" />} title={using === "found" ? t("funnel.ai.using", { name }) : t("funnel.ai.looking")}
        footer={using === "found"
          ? <button type="button" data-primary="" data-funnel-ai-continue="" onClick={goOn} className={PRIMARY}>{t("funnel.next")}</button>
          : <button type="button" data-funnel-ai-skip="" onClick={skip} className={SECONDARY}>{t("funnel.skip")}</button>}>
        {using === "checking"
          ? <p role="status" data-ai-checking="" className="flex items-center gap-2 text-[14px] text-ink-secondary">
              <LoaderCircle size={15} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
              {t("onboarding.engines.checkingAnswer", { name })}
            </p>
          : <p role="status" data-ai-found="" className="flex items-center gap-2 text-[14px] text-success">
              <Check size={15} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />
              {t("funnel.ai.usingSub")}
            </p>}
      </StepFrame>
    );
  }

  return (
    <StepFrame art={<StepArt art="plug" />} title={t("funnel.ai.title")} sub={sub} wide
      footer={<>
        <button type="button" data-primary="" data-funnel-ai-continue="" disabled={connected.length === 0} onClick={() => onNext("connected")} className={PRIMARY}>{t("funnel.next")}</button>
        {connected.length === 0 && <button type="button" data-funnel-later="" onClick={() => onNext(free ? "free" : "later")} className={SECONDARY}>{t("funnel.ai.later")}</button>}
      </>}>
      <AiCards tested={tested} onMore={() => setMore(true)} suggested={used} />

      {tested?.state === "testing" && (
        <p role="status" data-ai-checking="" className="mt-5 flex items-center gap-2 text-[14px] text-ink-secondary">
          <LoaderCircle size={15} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
          {t("onboarding.engines.checkingAnswer", { name: aiName(tested.instance) })}
        </p>
      )}
      {tested?.state === "failed" && (
        <div role="alert" data-ai-silent="" className="mt-5 flex flex-col items-center gap-2 text-[13px] leading-5 text-ink">
          <p>{tested.error ?? t("onboarding.engines.noAnswer", { name: tested.instance.displayName })}</p>
          <button type="button" onClick={tested.retry} className="ui-button ui-button-pill ui-button-sm"><RefreshCw size={12} aria-hidden="true" />{t("common.checkAgain")}</button>
        </div>
      )}
      {more && <ConnectAiDialog tested={tested} directory onClose={() => setMore(false)} />}
    </StepFrame>
  );
}

/** The grid's cards for the AIs signed in on the computer that set this cloud up. */
export function computerTiles(ids: readonly string[], instances: readonly { instanceId: string; driverKind: string }[]): AiTileId[] {
  const tiles = ids.map((id) => aiTileOf(instances.find((instance) => instance.instanceId === id) ?? { instanceId: id, driverKind: "" }));
  return [...new Set(tiles.filter((tile): tile is AiTileId => Boolean(tile)))];
}

/** On arriving at the step: "checking" while an AI already signed in here gets its test message, "found" once it
 * answered (then the step goes on by itself, or at once with `goOn`), "none" for the cards, also after `skip`. Only on
 * arrival, so Back to this step stays. */
function useFoundAi(tested: WelcomeAiNow | null, onNext: (how: "connected") => void): { using: "checking" | "found" | "none"; goOn(): void; skip(): void } {
  const decided = useRef<"checking" | "found" | "none">(tested?.state === "testing" || tested?.state === "passed" ? "checking" : "none");
  const [, rerender] = useState(0);
  if (decided.current === "checking") {
    if (tested?.state === "passed") decided.current = "found";
    else if (tested?.state !== "testing") decided.current = "none";
  }
  const found = decided.current === "found";
  const next = useRef(onNext);
  next.current = onNext;
  const gone = useRef(false);
  const goOn = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    next.current("connected");
  }, []);
  useEffect(() => {
    if (!found) return;
    const timer = window.setTimeout(goOn, 1_400);
    return () => window.clearTimeout(timer);
  }, [found, goOn]);
  const skip = useCallback(() => {
    decided.current = "none";
    rerender((n) => n + 1);
  }, []);
  return { using: decided.current, goOn, skip };
}
