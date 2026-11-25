/** Hosts the phone may reach over plain http: IP literals (a computer's Wi-Fi or tailnet address), Bonjour `.local`
 * names, tailnet `.ts.net` names and the phone itself. Everything else must be https.
 *
 * Security invariant: Android's network security config cannot express IP ranges (a `<domain>` matches a name exactly
 * or by suffix), so its base config permits cleartext and this guard is what keeps plain http off public names. */
export function cleartextAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host === "localhost") return true;
  const labels = host.split(".");
  if (labels.includes("")) return false;
  return host.endsWith(".local") || host.endsWith(".ts.net");
}

export class CleartextRefused extends TypeError {
  constructor(readonly host: string) {
    super(`plain http to ${host} is not allowed`);
    this.name = "CleartextRefused";
  }
}

/** `send`, refusing an http request to a host `cleartextAllowed` does not cover. */
export function guardCleartext(send: typeof fetch, base: () => string): typeof fetch {
  return (input, init) => {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), base());
    } catch {
      return send(input, init);
    }
    if (url.protocol === "http:" && !cleartextAllowed(url.hostname)) return Promise.reject(new CleartextRefused(url.hostname));
    return send(input, init);
  };
}
