// A cookie banner on a page the bot opened is answered the way a privacy-minded person would: "Reject all" or
// "Only necessary", never accept. Only a visible button inside something that is a cookie or consent banner is pressed,
// once per document, so a page's own "Decline" elsewhere is never touched. Banners drawn in a cross-origin frame
// (Sourcepoint's, for one) are out of reach and stay.
import { isUnanswered } from "./errors.ts";
import { valueInWorld } from "./evaluate.ts";
import type { FrameTree } from "./frames.ts";

/** Banners usually show within a few seconds of the page loading; later reads stop looking. */
export const CONSENT_LOOK_MS = 15_000;

const REJECT = [
  "(?:reject|decline|refuse|deny|disagree)(?: all)?(?: (?:optional|non-essential|additional|all) )?(?: ?cookies)?",
  "(?:(?:accept|allow|use) )?(?:only )?(?:strictly )?(?:necessary|essential|required)(?: cookies)?(?: only)?",
  "continue without (?:accepting|agreeing)",
  "(?:alle )?ablehnen", "nur (?:notwendige|erforderliche|essenzielle)(?: cookies)?(?: (?:akzeptieren|zulassen|erlauben))?",
  "(?:tout )?refuser", "continuer sans accepter", "rechazar(?: todo| todas)?", "rifiuta(?: tutto| tutti)?", "(?:alles )?weigeren", "afwijzen",
  "rejeitar(?: tudo)?", "avvisa alla", "afvis alle", "odrzuć wszystkie",
].join("|");

/** Words of a choice that lets tracking in: a label with them is never pressed unless it limits itself to the necessary. */
const LETS_IN = "accept all|allow all|agree|accept cookies|alle akzeptieren|tout accepter|aceptar todo|accetta tutti";

const BANNER = "cookie|consent|gdpr|privacy|cmp|onetrust|cookiebot|didomi|usercentrics|quantcast|trustarc|truste|iubenda|klaro|osano|termly|cookieyes";

export const REJECT_CONSENT = `(() => {
  const reject = new RegExp("^(?:${REJECT})$", "iu");
  const letsIn = new RegExp("${LETS_IN}", "iu");
  const banner = new RegExp("${BANNER}", "iu");
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; };
  const label = (el) => String(el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\\s+/gu, " ").trim();
  const inBanner = (el) => {
    for (let at = el, depth = 0; at && depth < 12; depth++) {
      if (at.nodeType === 1) {
        const marks = [at.id, typeof at.className === "string" ? at.className : "", at.getAttribute("aria-label") || "", at.getAttribute("data-testid") || ""].join(" ");
        if (banner.test(marks)) return true;
        if ((at.getAttribute("role") === "dialog" || at.getAttribute("role") === "alertdialog" || at.tagName === "DIALOG") && /cookie|consent/iu.test(at.innerText || "")) return true;
      }
      at = at.parentNode instanceof ShadowRoot ? at.parentNode.host : at.parentNode;
    }
    return false;
  };
  const roots = [document];
  for (let i = 0; i < roots.length && i < 40; i++) {
    for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  }
  for (const root of roots) {
    for (const el of root.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]')) {
      const text = label(el);
      if (!text || text.length > 60 || !reject.test(text) || (letsIn.test(text) && !/necessary|essential|required|notwendig|erforderlich/iu.test(text))) continue;
      if (!visible(el) || !inBanner(el)) continue;
      el.click();
      return text;
    }
  }
  return null;
})()`;

/** Presses the banner's reject or necessary-only choice; the label pressed, or null when the page shows none. */
export async function rejectConsent(frames: FrameTree): Promise<string | null> {
  try {
    const pressed = await valueInWorld<string | null>(frames, frames.mainFrameId, REJECT_CONSENT);
    return typeof pressed === "string" && pressed ? pressed.slice(0, 60) : null;
  } catch (error) {
    if (isUnanswered(error)) throw error;
    return null;
  }
}

/** One line of a read's answer after a banner was answered. */
export function consentNote(label: string): string {
  return `A cookie banner was closed by choosing ${JSON.stringify(label)}; cookies were not accepted.`;
}
