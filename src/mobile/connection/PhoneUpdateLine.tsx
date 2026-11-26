import { t } from "@/lib/i18n";
import { usePlatform } from "../platform";
import { storeUrl, usePhoneTooOld } from "./phone-update";
import { ApkUpdateLine } from "./ApkUpdateLine";

/** one short line over the app when this computer needs a newer phone app, with the way to the store; otherwise, on
 * Android, the line that a newer APK is out (closable) */
export function PhoneUpdateLine({ connection }: { connection: string | null }) {
  const platform = usePlatform();
  const old = usePhoneTooOld(connection);
  if (!old) return <ApkUpdateLine hidden={!connection} />;
  return (
    <div role="status" data-phone-update className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+8px)] z-40 flex items-center gap-3 rounded-[16px] bg-raised px-4 py-2.5 shadow-[0_2px_12px_rgb(28_28_28/0.12)]">
      <p className="min-w-0 flex-1 text-[15px] text-ink">{t("mobile.update.line")}</p>
      <button type="button" className="shrink-0 rounded-full bg-ink px-3.5 py-1.5 text-[15px] font-semibold text-app" onClick={() => void platform.openExternal(storeUrl(platform.kind))}>
        {t("mobile.update.button")}
      </button>
    </div>
  );
}
