import { useEffect, useState } from "react";
import { Loader2 } from "../../icons";
import { track } from "@/lib/analytics";
import { moveOfferBridge, offerAsk } from "@/lib/cloud-move-offer";
import { t } from "@/lib/i18n";
import { useCloudSendNotice } from "../CloudSendStrip";
import { CloudMoveScene } from "../CloudMoveScene";
import { WhatMovesLine } from "../WhatMoves";
import { PRIMARY, SECONDARY, StepFrame } from "./FunnelSteps";

/** The computer that set this cloud up has bots or chats the move would carry. */
export function useCloudBringOffered(enabled: boolean): boolean {
  const [notice] = useCloudSendNotice(enabled ? moveOfferBridge() : undefined);
  const now = enabled && Boolean(moveOfferBridge()?.moveOfferAccept) && offerAsk(notice) !== null;
  // stays a step once offered, so answering it doesn't pull the step out from under the person
  const [offered, setOffered] = useState(now);
  useEffect(() => { if (now) setOffered(true); }, [now]);
  return now || offered;
}

/** The first run's bring step on a new cloud: the same move the computer offers, asked here as one of the steps. The move
 * runs on after the step; its All moved line says when it is done. */
export function CloudBringStep({ onNext }: { onNext: () => void }) {
  const bridge = moveOfferBridge();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const move = () => {
    if (!bridge?.moveOfferAccept || busy) return;
    setBusy(true); setFailed(false);
    track("onboarding_bring", { action: "move", place: "cloud" });
    void bridge.moveOfferAccept("prompt").then(onNext, () => { setFailed(true); setBusy(false); });
  };
  const later = () => {
    track("onboarding_bring", { action: "later", place: "cloud" });
    void bridge?.moveOfferDismiss?.("prompt").catch(() => {});
    onNext();
  };
  return (
    <StepFrame title={t("funnel.cloudBring.title")} sub={t("cloudMoveOffer.ask")}
      footer={<>
        <button type="button" data-primary="" data-funnel-cloud-move="" disabled={busy} aria-busy={busy || undefined} onClick={move} className={PRIMARY}>
          {busy && <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{t("cloudMoveOffer.move")}
        </button>
        <button type="button" data-funnel-later="" disabled={busy} onClick={later} className={SECONDARY}>{t("cloudMoveOffer.later")}</button>
      </>}>
      <CloudMoveScene progress={0} done={false} className="mb-4 w-full max-w-[380px] rounded-[18px] pt-3" />
      <WhatMovesLine />
      {failed && <p role="alert" className="mt-3 text-[13px] text-danger">{t("cloudMoveOffer.failed")}</p>}
    </StepFrame>
  );
}
