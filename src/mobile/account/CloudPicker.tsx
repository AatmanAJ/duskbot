import { useEffect, useRef, useState } from "react";
import { ChevronRight, Cloud, RotateCw } from "../../icons";
import { LoadingMascot } from "../Illustration";
import { t } from "@/lib/i18n";
import type { TypedPairing } from "../connection/pair";
import { haptic } from "../haptics";
import { ErrorLine } from "../onboarding/parts";
import { useMobileAccount } from "./AccountGate";
import type { CloudPairResult, MobileCloud } from "./account-client";
import { cloudPairing, cloudPairingPayload } from "./cloud-pair";
import { useConnections } from "../connection/connections";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";

type Problem = { outcome: Exclude<CloudPairResult["outcome"], "paired">; name: string };

/** an asleep cloud is woken by the tap that opens it, so it reads as ready like any other */
function statusLine(cloud: MobileCloud): string {
  if (cloud.status === "ready" || cloud.status === "offline") return t("mobile.clouds.ready");
  if (cloud.status === "setting_up") return t("mobile.clouds.settingUp");
  return t("mobile.clouds.stopped");
}

export const pairable = (cloud: MobileCloud) => Boolean(cloud.origin) && (cloud.status === "ready" || cloud.status === "offline");

type SavedLink = Pick<MobileConnectionRecord, "origin" | "via">;

/** a cloud this phone already links to, by any of the saved links' addresses */
export function linkedHere(cloud: MobileCloud, records: readonly SavedLink[]): boolean {
  return Boolean(cloud.origin) && records.some((record) => record.origin === cloud.origin || (record.via ?? []).some((route) => route.kind === "https" && route.url === cloud.origin));
}

/** the one cloud to open without asking: only on a phone that links nothing yet */
export function autoPickCloud(clouds: readonly MobileCloud[], records: readonly SavedLink[]): MobileCloud | null {
  const ready = clouds.filter((cloud) => pairable(cloud) && !linkedHere(cloud, records));
  return ready.length === 1 && records.length === 0 ? ready[0]! : null;
}

/** The signed-in account's own clouds: one tap pairs this phone with one, and with only one it pairs on its own. */
export function CloudPicker({ busy, onPairing, autoPick = false, onNone }: {
  busy: boolean;
  onPairing(payload: TypedPairing): Promise<void>;
  autoPick?: boolean;
  /** the list came back empty */
  onNone?(): void;
}) {
  const account = useMobileAccount();
  const signedIn = Boolean(account?.account);
  const { connections, loaded } = useConnections();
  const [clouds, setClouds] = useState<MobileCloud[] | null | undefined>(undefined);
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [reload, setReload] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const picked = useRef(false);

  useEffect(() => {
    if (!signedIn || !account) return;
    let active = true;
    setClouds(undefined);
    void account.clouds().then((list) => { if (active) setClouds(list); });
    return () => { active = false; };
  }, [account, signedIn, reload]);
  useEffect(() => () => abort.current?.abort(), []);

  const pick = async (cloud: MobileCloud) => {
    if (!account || working || busy) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null);
    setWorking(cloud.id);
    try {
      const result = await cloudPairing(account, cloud, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.outcome !== "paired") { haptic("error"); setProblem({ outcome: result.outcome, name: cloud.name }); return; }
      await onPairing(cloudPairingPayload(cloud, result.grant));
    } finally {
      if (abort.current === controller) setWorking(null);
    }
  };

  useEffect(() => {
    if (!clouds || !loaded) return;
    if (clouds.length === 0) { onNone?.(); return; }
    const only = autoPick && !picked.current ? autoPickCloud(clouds, connections) : null;
    if (only) { picked.current = true; void pick(only); }
  }, [clouds, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!signedIn || !account || clouds?.length === 0) return null;

  return (
    <section aria-label={t("mobile.clouds.title")} data-testid="mobile-cloud-picker" className="mt-7 w-full text-left">
      <h2 className="mb-2 px-1 text-[15px] font-semibold text-ink-secondary">{t("mobile.clouds.title")}</h2>
      {clouds === undefined && <p role="status" className="flex min-h-16 items-center gap-2.5 rounded-[18px] bg-ink/[0.04] px-4 text-[16px] text-ink-secondary"><LoadingMascot size={24} />{t("mobile.clouds.loading")}</p>}
      {clouds === null && (
        <ErrorLine action={<button type="button" onClick={() => setReload((n) => n + 1)} className="mobile-press mt-1 flex min-h-11 items-center gap-1.5 font-semibold text-ink"><RotateCw size={15} />{t("mobile.onboarding.retry")}</button>}>
          {t("mobile.clouds.loadFailed")}
        </ErrorLine>
      )}
      {clouds && clouds.length > 0 && (
        <ul className="flex flex-col gap-2">
          {clouds.map((cloud) => {
            const mine = working === cloud.id;
            const here = linkedHere(cloud, connections);
            const can = pairable(cloud) && !here;
            return (
              <li key={cloud.id}>
                <button type="button" data-testid="mobile-cloud-connect" data-cloud-id={cloud.id} disabled={busy || Boolean(working) || !can}
                  aria-label={t("mobile.clouds.connect", { name: cloud.name })} aria-busy={mine || undefined} onClick={() => void pick(cloud)}
                  className="mobile-press flex min-h-16 w-full items-center gap-3 rounded-[18px] bg-ink/[0.05] px-4 py-3 text-left text-ink disabled:opacity-100">
                  <Cloud size={22} className={can ? "text-ink" : "text-ink-tertiary"} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[17px] font-semibold ${can ? "" : "text-ink-secondary"}`}>{cloud.name}</span>
                    <span className="mt-0.5 block text-[14px] text-ink-secondary">{mine ? t("mobile.clouds.connecting") : here ? t("mobile.clouds.linked") : statusLine(cloud)}</span>
                  </span>
                  {mine ? <LoadingMascot size={24} /> : can && <ChevronRight size={18} className="text-ink-tertiary" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {problem && <ErrorLine>{t(`mobile.clouds.err.${problem.outcome}` as Parameters<typeof t>[0], { name: problem.name })}</ErrorLine>}
    </section>
  );
}
