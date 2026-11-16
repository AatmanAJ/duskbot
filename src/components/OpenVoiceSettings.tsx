import { createElement, Fragment, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { openSettings } from "@/lib/open-settings";
import type { LocaleKey } from "@/locales";
import { useDispatch } from "@/state/store";

/** A button on a voice line that opens Settings at Voice, where a speech service is picked or its key fixed. */
export function OpenVoiceSettings({ labelKey, className }: { labelKey: LocaleKey; className?: string }) {
  const dispatch = useDispatch();
  return (
    <button type="button" data-open-voice-settings="" onClick={() => dispatch(openSettings("voice"))}
      className={className ?? "shrink-0 rounded text-[13px] text-ink-secondary transition-colors hover:text-ink"}>
      {t(labelKey)}
    </button>
  );
}

/** A voice line followed by the button that opens Settings at Voice. */
export function withVoiceSettings(text: string, labelKey: LocaleKey): ReactNode {
  return createElement(Fragment, null, text, " ", createElement(OpenVoiceSettings, { labelKey }));
}
