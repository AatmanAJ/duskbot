// What `duskbot serve` and `duskbot pair` print for a pairing code. A browser on this computer is no longer the
// owner just by being here, so it signs in once with the link printed for it.
import qrcode from "qrcode-terminal";

import { universalPairLink, type MobilePairingResponse } from "../shared/mobile-link.ts";

/** `url` opens the web app (browsers, the iOS app); `inviteUrl` (duskbot://) is the only thing the Android app scans;
 * `localUrl` signs in a browser on this computer. */
export function pairingBlock(input: {
  code: string;
  url: string | null;
  inviteUrl?: string | null;
  localUrl?: string | null;
  expiresAt: number;
  hint?: string | null;
  phone?: "ios" | "android";
}): string {
  const lines = [`pairing code:  ${input.code}`, `expires:       ${new Date(input.expiresAt).toLocaleTimeString()} (single use)`];
  if (input.localUrl) lines.push(`this computer: ${input.localUrl}`);
  if (!input.url && !input.inviteUrl) {
    lines.push(`open:          /pair on the address you use for this server, and type the code`);
    if (input.hint) lines.push(`               (${input.hint})`);
    return lines.join("\n");
  }
  const scanInvite = input.phone === "android" && !!input.inviteUrl;
  if (input.url) lines.push(scanInvite ? `web browser:   ${input.url}` : `open or scan:  ${input.url}`);
  if (input.inviteUrl) lines.push(`phone app:     ${input.inviteUrl}`);
  const target = scanInvite ? input.inviteUrl! : input.url;
  if (target) {
    lines.push("");
    lines.push(qrToString(target));
    lines.push("");
    if (scanInvite) {
      lines.push(`Scan that in the dusk bot app. For a browser instead, open the web`);
      lines.push(`address above and type the code.`);
    } else if (input.phone === "android") {
      lines.push(`That QR opens the web app. The Android app needs the phone-app link,`);
      lines.push(`which this server cannot build without a public address: set`);
      lines.push(`DUSK_PUBLIC_URL, or open the web address above and type the code.`);
    } else if (input.inviteUrl) {
      lines.push(`Scan that with Camera for the browser, or paste the phone-app link`);
      lines.push(`above into the dusk bot app.`);
    }
  }
  return lines.join("\n");
}

/** The dusk bot phone app's own pairing: a QR its camera scan opens, and the code it can type instead. It reaches this
 * server over the link relay, so it needs no public address. */
export function phoneAppBlock(pairing: MobilePairingResponse): string {
  const lines = ["Scan this with your phone's camera, or in the dusk bot app:", "", qrToString(universalPairLink(pairing.link, pairing.code)), ""];
  if (pairing.code) lines.push(`or type this code in the app:  ${pairing.code}`);
  lines.push(`expires:       ${new Date(pairing.expiresAt).toLocaleTimeString()} (single use)`);
  return lines.join("\n");
}

/** The guided start's one sign-in, for the browser it opens on this computer. */
export function browserSignInLines(localUrl: string, code: string, expiresAt: number): string {
  return [
    "Sign in from a browser on this computer with this link (single use, until",
    `${new Date(expiresAt).toLocaleTimeString()}): ${localUrl}`,
    `or type the code ${code} on the sign-in page. Later: duskbot pair`,
  ].join("\n");
}

export function qrToString(text: string): string {
  let out = "";
  qrcode.generate(text, { small: true }, (rendered: string) => {
    out = rendered;
  });
  return out;
}
