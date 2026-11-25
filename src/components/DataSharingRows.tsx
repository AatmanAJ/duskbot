import { t } from "@/lib/i18n";
import { PRIVACY_SUMMARY_URL, openExternalLink } from "@/lib/app-links";
import { useHelpImprove } from "@/lib/help-improve";
import { useSubPage } from "./ListRows";
import { SettingRow, Switch } from "./SettingsPrimitives";

export const SHARED_DATA_PAGE = "shared-data";

/** Privacy: usage counts and crash reports, session notes (only while the first is on), and what's been shared. */
export function DataSharingRows() {
  const { signals, failed, set } = useHelpImprove("settings");
  const sub = useSubPage();
  if (signals === null) return failed ? <p className="px-3 py-2 text-[13px] text-ink/60">{t("settings.dataSharing.unavailable")}</p> : null;
  const counts = signals.enabled && !signals.askUsage;
  const notes = counts && signals.notes === true;
  return (
    <>
      <SettingRow icon="chart" title={t("settings.dataSharing.improve")} subtitle={<>
        {t("settings.dataSharing.improveHint")}
        {signals.askUsage && <span className="block">{t("settings.dataSharing.improveAsk")}</span>}
        <span className="mt-1 block">{t("settings.dataSharing.improveNote")}{" "}
          <button type="button" onClick={() => void openExternalLink(PRIVACY_SUMMARY_URL)}
            className="rounded-sm text-ink-secondary underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {t("settings.dataSharing.whatsShared")}
          </button>
        </span>
      </>}
        message={failed ? <p role="alert" className="text-danger">{t("settings.dataSharing.error")}</p> : null}>
        <Switch checked={counts} data-help-improve="" aria-label={t("settings.dataSharing.improve")} onClick={() => void set({ enabled: !counts })} />
      </SettingRow>
      <SettingRow icon="bubble" title={t("settings.dataSharing.notes")} subtitle={<>
        {t("settings.dataSharing.notesHint")}
        <span className="mt-1 block">{counts ? t("settings.dataSharing.notesFacts") : t("settings.dataSharing.notesNeedsImprove")}</span>
      </>}>
        <Switch checked={notes} disabled={!counts} data-session-notes="" aria-label={t("settings.dataSharing.notes")} onClick={() => void set({ notes: !notes })} />
      </SettingRow>
      <SettingRow icon="shield" title={t("settings.dataSharing.shared")} subtitle={t("settings.dataSharing.sharedHint")}>
        <button type="button" data-panel-page={SHARED_DATA_PAGE} className="ui-button" onClick={() => sub.open(SHARED_DATA_PAGE, t("settings.dataSharing.shared"))}>
          {t("settings.dataSharing.open")}
        </button>
      </SettingRow>
    </>
  );
}
