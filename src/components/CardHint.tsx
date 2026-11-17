import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { hintSeen, hintSeenPatch } from "@/lib/onboarding";
import { api, useOptionalStoreActions, useOptionalStoreSelector, type AppState } from "@/state/store";

const COPY = { "spot.approval": "onboarding.hint.approval", "spot.connector": "onboarding.hint.connector" } as const;
const shownHere = new Set<string>();
const selectOnboarding = (state: AppState) => state.config?.onboarding;

/** A one-line hint on an approval or app card, the first time one shows. Seen once it shows, in the onboarding record. */
export function CardHint({ id }: { id: keyof typeof COPY }) {
  const dispatch = useOptionalStoreActions()?.dispatch;
  const record = useOptionalStoreSelector(selectOnboarding, undefined);
  const [show] = useState(() => Boolean(dispatch) && Boolean(record?.completedAt) && !hintSeen(record, id) && !shownHere.has(id));
  useEffect(() => {
    if (!show) return;
    shownHere.add(id);
    const patch = hintSeenPatch(record, id);
    if (!patch) return;
    void api("/api/config", { method: "PUT", body: JSON.stringify(patch) })
      .then((config) => dispatch?.({ type: "configStatus", config }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  if (!show) return null;
  return <p data-card-hint={id} className="text-[12px] leading-4 text-ink-secondary">{t(COPY[id])}</p>;
}
