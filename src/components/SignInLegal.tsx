import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { LEGAL_LINKS } from "@/mobile/legal";

const LINK = "rounded-sm underline underline-offset-2 hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** The line under every sign-in: signing in agrees to the terms and privacy policy, and only then does the app share usage. */
export function SignInLegal({ className }: { className?: string }) {
  return (
    <p data-sign-in-legal="" className={cn("text-center text-[12px] leading-[18px] text-ink-tertiary", className)}>
      {t("signIn.legal.before")}{" "}
      <button type="button" className={LINK} onClick={() => void openExternalLink(LEGAL_LINKS.terms)}>{t("signIn.legal.terms")}</button>
      {" "}{t("signIn.legal.and")}{" "}
      <button type="button" className={LINK} onClick={() => void openExternalLink(LEGAL_LINKS.privacy)}>{t("signIn.legal.privacy")}</button>
      {t("signIn.legal.after")}
    </p>
  );
}
