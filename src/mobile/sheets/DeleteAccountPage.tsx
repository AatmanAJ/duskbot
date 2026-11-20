import { useState } from "react";
import { t } from "@/lib/i18n";
import { WorkingDots } from "@/components/WorkingIndicator";
import { haptic } from "../haptics";
import { Sheet } from "../Sheet";
import { SettingsSection } from "./SettingsRow";

/** Settings' delete step (App Store 5.1.1(v)): says what goes and that a plan is cancelled, then deletes the account with
 * the service's own app route. Pushed in the Settings stack, so back or Cancel leaves everything as it was. */
export function DeleteAccountPage({ email, onDelete, onCancel, onDone }: {
  email: string;
  /** false when the account could not be deleted (nothing changed) */
  onDelete: () => Promise<boolean>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setFailed(false);
    const deleted = await onDelete().catch(() => false);
    setDeleting(false);
    if (!deleted) { haptic("error"); setFailed(true); return; }
    haptic("success");
    onDone();
  };
  return (
    <Sheet open onClose={onCancel} title={t("mobile.settings.deleteAccount")}>
      <SettingsSection card>
        <div className="px-4 py-4" aria-busy={deleting}>
          <p className="text-[16px] font-semibold text-ink">{t("mobile.settings.deleteTitle")}</p>
          <p className="mt-1 text-[14px] leading-5 text-ink-secondary">{t("mobile.settings.deleteNow", { email })}</p>
          {failed && <p role="alert" className="mt-2 text-[14px] leading-5 text-danger">{t("mobile.settings.deleteFailed")}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={deleting} onClick={onCancel} className="mobile-press flex min-h-11 flex-1 items-center justify-center rounded-full bg-ink/[0.06] px-4 text-[15px] font-semibold text-ink">{t("mobile.settings.cancel")}</button>
            <button type="button" data-delete-account-confirm disabled={deleting} onClick={() => void remove()} className="mobile-press flex min-h-11 flex-1 items-center justify-center rounded-full bg-danger px-4 text-[15px] font-semibold text-[var(--color-danger-ink)] disabled:opacity-60">
              {deleting ? <WorkingDots /> : t("mobile.settings.deleteConfirm")}
            </button>
          </div>
        </div>
      </SettingsSection>
    </Sheet>
  );
}
