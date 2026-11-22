/** A host as pages report it: lower case, without the root's trailing dot. */
export function plainHost(host: string): string {
  return host.toLowerCase().replace(/\.$/u, "");
}

/** A login's host from what the person typed: a page address or a bare
 * domain. Anything that is not a plain http(s) address is refused. */
export function normalizeLoginHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  // eslint-disable-next-line no-control-regex -- Reject control characters and spaces before URL parsing normalizes them.
  if (!text || text.length > 2048 || /[\u0000- \u007f\\]/u.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) return null;
  const host = plainHost(url.hostname);
  if (!host.includes(".") && host !== "localhost" && !host.startsWith("[")) return null;
  return host;
}

/** What a login saved from Settings is sealed for (shared/saved-secrets.ts sealedValueAAD): its normalized host and
 * trimmed username, so a relay cannot move the password to another site or account. */
export function loginSealTarget(host: string, username: unknown): string[] {
  return [host, typeof username === "string" ? username.trim() : ""];
}
