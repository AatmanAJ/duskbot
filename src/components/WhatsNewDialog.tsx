import { useRef } from "react";
import { AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";

import { RELEASES_URL, openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { Release } from "@/lib/release-notes";
import { formBodyCls, formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, mdSecondaryCls, rowHintCls, useDialogKeys } from "./ui/GrokDialog";
import { Icon } from "./Icon";
import { ScrimMotion, SheetMotion, useDialogMotion } from "./ui/SheetMotion";

/** "Nov 27, 2026" for a release's day, read as the day it is everywhere */
export function releaseDay(date: string | undefined, locale = activeLocale()): string | null {
  if (!date) return null;
  const at = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  try { return at.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return date; }
}

/** each release: its version and day, then one line per change, newest first */
export function ReleaseNotes({ releases, current }: { releases: readonly Release[]; current?: string }) {
  return (
    <div className="flex flex-col gap-5">
      {releases.map((release) => {
        const day = releaseDay(release.date);
        return (
          <section key={release.version} data-release={release.version} aria-labelledby={`release-${release.version}`}>
            <h3 id={`release-${release.version}`} className="m-0 flex items-baseline gap-2 text-[13px] font-semibold leading-[18px] text-ink">
              <span>{release.title ? `${release.version} · ${release.title}` : release.version}</span>
              {release.version === current && <span className="font-[425] text-ink/56">{t("whatsNew.thisVersion")}</span>}
              {day && <span className="ms-auto shrink-0 font-[425] text-ink/56">{day}</span>}
            </h3>
            <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
              {release.items.map((item, index) => (
                <li key={index} className={cn(rowHintCls, "relative ps-3.5 text-pretty before:absolute before:start-0.5 before:top-[7px] before:size-1 before:rounded-full before:bg-ink/32")}>{item.text}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** What's new: the changelog's notes for this app, as a dialog; opened from Settings > Updates and from the line after an update */
export function WhatsNewDialog({ open, releases, current, onClose }: { open: boolean; releases: readonly Release[]; current?: string; onClose: () => void }) {
  return <AnimatePresence>{open && <WhatsNewSheet key="whats-new" releases={releases} current={current} onClose={onClose} />}</AnimatePresence>;
}

function WhatsNewSheet({ releases, current, onClose }: { releases: readonly Release[]; current?: string; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useDialogKeys(sheet, onClose);
  const played = useDialogMotion();
  return createPortal(
    <div {...played.layer} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <ScrimMotion {...played.scrim} aria-hidden="true" className="ui-dialog-scrim absolute inset-0" onMouseDown={() => close.current()} />
      <SheetMotion {...played.sheet} ref={sheet} role="dialog" aria-modal="true" aria-labelledby="whats-new-title" tabIndex={-1} data-whats-new=""
        className={cn(formSheetCls, "max-h-[min(560px,calc(100dvh-32px))] max-w-[440px]")}>
        <div className={formHeaderCls}>
          <h2 id="whats-new-title" className={formTitleCls}>{t("whatsNew.title")}</h2>
          <button type="button" aria-label={t("common.close")} onClick={() => close.current()} className={formCloseCls}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className={cn(formBodyCls, "pb-2")}>
          <ReleaseNotes releases={releases} current={current} />
        </div>
        <div className={formFooterCls}>
          <button type="button" data-autofocus onClick={() => void openExternalLink(RELEASES_URL)} className={mdSecondaryCls}>{t("whatsNew.allReleases")}</button>
        </div>
      </SheetMotion>
    </div>,
    document.body,
  );
}
