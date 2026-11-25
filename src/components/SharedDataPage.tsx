import { useCallback, useEffect, useState } from "react";
import { activeLocale, t, tFromServer } from "@/lib/i18n";
import { deleteUsageShared, readUsageShared, type SharedCount, type SharedNote, type UsageShared } from "@/lib/help-improve";
import { localizedRelativeTime } from "@/lib/relative-time";
import type { LocaleKey } from "@/locales";
import { SettingRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";

const KIND: Record<SharedNote["kind"], LocaleKey> = {
  bad: "settings.dataSharing.kind.bad",
  big: "settings.dataSharing.kind.big",
  weekly: "settings.dataSharing.kind.weekly",
};
const COUNT: Record<SharedCount["kind"], LocaleKey> = {
  turns: "settings.dataSharing.count.turns",
  runs: "settings.dataSharing.count.runs",
  setup: "settings.dataSharing.count.setup",
  events: "settings.dataSharing.count.events",
};
const RECHECK_MS = 5_000;

/** an app event's readable name: its own string when there is one, else the id in words ("chat_deleted" to "Chat deleted") */
function eventName(id: string): string {
  const words = id.replace(/_/g, " ").trim();
  return tFromServer(`settings.dataSharing.event.${id}`, words.charAt(0).toUpperCase() + words.slice(1)) ?? id;
}

const when = (at: number) => localizedRelativeTime(at, activeLocale());

function Problem({ title, onRetry }: { title: LocaleKey; onRetry: () => void }) {
  return (
    <div role="alert" data-shared-problem="" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-1.5 text-[13px] leading-[18px]">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-ink">{t(title)}</p>
        <p className="m-0 text-ink-secondary">{t("settings.dataSharing.checkConnection")}</p>
      </div>
      <button type="button" className="ui-button" onClick={onRetry}>{t("common.tryAgain")}</button>
    </div>
  );
}

/** Settings > Privacy > See what's been shared: the summaries and the kinds of counts sent from here, and Delete all. */
export function SharedDataPage() {
  const [shared, setShared] = useState<UsageShared | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    readUsageShared().then(setShared, () => setLoadFailed(true));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!shared?.removing) return;
    const timer = window.setInterval(() => { readUsageShared().then(setShared, () => {}); }, RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [shared?.removing]);

  const remove = async () => {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      const answer = await deleteUsageShared();
      setShared({ notes: [], counts: [], removing: answer.removing });
      setConfirming(false);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  };

  if (!shared) {
    return loadFailed ? <SettingsRows><Problem title="settings.dataSharing.loadFailed" onRetry={load} /></SettingsRows> : null;
  }
  const empty = shared.notes.length === 0 && shared.counts.length === 0;
  return (
    <div data-settings-block="shared-data" className="flex flex-col gap-6">
      <p className="m-0 px-3 text-[13px] leading-[18px] text-ink-secondary">{t("settings.dataSharing.sharedLead")}</p>
      {shared.removing && <p role="status" data-shared-removing="" className="m-0 px-3 text-[13px] leading-[18px] text-ink-secondary">{t("settings.dataSharing.removing")}</p>}
      {empty ? (
        <SettingsRows>
          <p data-shared-empty="" className="m-0 px-2 py-3 text-center text-[13px] leading-[18px] text-ink/[0.56]">{t("settings.dataSharing.empty")}</p>
        </SettingsRows>
      ) : (
        <>
          {shared.notes.length > 0 && (
            <SettingsGroup label={t("settings.dataSharing.notes")} block="shared-notes">
              <SettingsRows>
                {shared.notes.map((note) => (
                  <SettingRow key={note.id} title={t(KIND[note.kind])} subtitle={note.text ?? t("settings.dataSharing.countsOnly")}>
                    <span className="text-[13px] leading-[18px] whitespace-nowrap text-ink-tertiary">{when(note.at)}</span>
                  </SettingRow>
                ))}
              </SettingsRows>
            </SettingsGroup>
          )}
          {shared.counts.length > 0 && (
            <SettingsGroup label={t("settings.dataSharing.countsTitle")} block="shared-counts">
              <SettingsRows>
                {shared.counts.map((count) => (
                  <SettingRow key={count.kind} title={t(COUNT[count.kind])} subtitle={count.names?.length ? count.names.map(eventName).join(", ") : undefined}>
                    <span className="text-[13px] leading-[18px] whitespace-nowrap text-ink-secondary">
                      {t("settings.dataSharing.countValue", { count: count.count.toLocaleString(activeLocale()), when: when(count.last) })}
                    </span>
                  </SettingRow>
                ))}
              </SettingsRows>
            </SettingsGroup>
          )}
          <SettingsRows>
            {deleteFailed ? <Problem title="settings.dataSharing.deleteFailed" onRetry={() => void remove()} /> : confirming ? (
              <div role="alertdialog" aria-labelledby="shared-delete-ask" data-shared-confirm="" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-1.5">
                <div className="min-w-0 flex-1 text-[13px] leading-[18px]">
                  <p id="shared-delete-ask" className="m-0 text-ink">{t("settings.dataSharing.deleteAsk")}</p>
                  <p className="m-0 text-ink-secondary">{t("settings.dataSharing.deleteAskHint")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" className="ui-button" disabled={deleting} onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
                  <button type="button" data-shared-delete-confirm="" autoFocus className="ui-button ui-button-danger" disabled={deleting} aria-busy={deleting || undefined} onClick={() => void remove()}>
                    {t("settings.dataSharing.deleteAll")}
                  </button>
                </div>
              </div>
            ) : (
              <SettingRow title={t("settings.dataSharing.deleteHint")}>
                <button type="button" data-shared-delete="" className="ui-button ui-button-danger" onClick={() => setConfirming(true)}>{t("settings.dataSharing.deleteAll")}</button>
              </SettingRow>
            )}
          </SettingsRows>
        </>
      )}
    </div>
  );
}
