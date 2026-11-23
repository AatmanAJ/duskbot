import { useState } from "react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import type { BrowserPart } from "@/lib/browser-part";
import { InstallBusy } from "./onboarding/SignInPill";

const QUIET = "min-h-8 rounded-full px-3 text-[13px] leading-[18px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none";

/** One quiet line in the chat while the bot's browser downloads, the onboarding install look; a failed try offers another. */
export function BrowserPartLine({ part }: { part: BrowserPart }) {
  const [asked, setAsked] = useState(false);
  const [retryFailed, setRetryFailed] = useState<string | null>(null);
  if (part.phase === "failed") {
    return (
      <div data-browser-part="failed" className="flex flex-col items-start gap-1">
        <p role="status" className="m-0 text-[13px] leading-[18px] text-ink-secondary">{t("chat.browserPart.failed")}</p>
        <button type="button" className={`${QUIET} -ml-3`} disabled={asked} onClick={() => {
          setAsked(true);
          setRetryFailed(null);
          void api("/api/browser-engine/install", { method: "POST" })
            .catch((cause: unknown) => setRetryFailed(friendlyError(cause, t("chat.browserPart.retryFailed"))))
            .finally(() => setAsked(false));
        }}>{t("chat.browserPart.retry")}</button>
        {retryFailed && <p role="alert" className="m-0 text-[13px] leading-[18px] text-danger">{retryFailed}</p>}
      </div>
    );
  }
  return (
    <div data-browser-part={part.phase}>
      <InstallBusy align="start" label={t("chat.browserPart.getting")} progress={{ phase: part.phase, received: part.received, total: part.total }} />
    </div>
  );
}
