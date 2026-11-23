import { useEffect, useState } from "react";
import { useLimitReached } from "@/lib/allowance-notice";
import { t } from "@/lib/i18n";
import { resetWhen, setSaver } from "@/lib/spend";

/** Whether a send failed only because the week's limit is reached (the server's refusal, in any language it has). */
export function isLimitRefusal(text: string | null | undefined): boolean {
  if (!text) return false;
  const pattern = t("server.allowance.refused").split(/\{\w+\}/).map((part) => part.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&")).join("[\\s\\S]+");
  return new RegExp(`^${pattern}$`).test(text);
}

/** One small line above the message box while the week's limit is reached: "Weekly limit reached · Saver mode". No
 * amounts here; they live in Usage & Billing. While it shows, a send the limit refused says nothing more: the draft
 * stays in the box and this line already says why. */
export function WeeklyLimitLine({ onSeeUsage, error, clearError }: { onSeeUsage: () => void; error?: string | null; clearError?: () => void }) {
  const limit = useLimitReached();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const refused = Boolean(limit) && isLimitRefusal(error);
  useEffect(() => { if (refused) clearError?.(); }, [refused, clearError]);
  const reached = Boolean(limit);
  useEffect(() => { if (!reached) setFailed(false); }, [reached]);
  if (!limit) return null;
  const { report } = limit;
  return (
    <div role="status" data-weekly-limit={report.saver ? "saver" : "waiting"} className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-[12px] bg-(--color-notice) px-3 py-2 text-[12px] leading-4 text-ink-secondary">
      <span className="whitespace-nowrap">{t("composer.limit.reached")}</span>
      <span aria-hidden="true">·</span>
      {report.saver
        ? <button type="button" onClick={onSeeUsage} className="cursor-pointer whitespace-nowrap text-ink-secondary hover:text-ink">{t("composer.limit.saverOn")}</button>
        : (
          <button type="button" disabled={busy} title={t("composer.limit.until", { when: resetWhen(report.resetAt) })}
            onClick={() => { setBusy(true); setFailed(false); void setSaver(true).then(limit.update, () => setFailed(true)).finally(() => setBusy(false)); }}
            className="cursor-pointer whitespace-nowrap text-ink hover:underline disabled:opacity-50">
            {t("composer.limit.saver")}
          </button>
        )}
      {failed && !report.saver && <span role="alert" className="ms-auto text-danger">{t("composer.limit.saverFailed")}</span>}
    </div>
  );
}
