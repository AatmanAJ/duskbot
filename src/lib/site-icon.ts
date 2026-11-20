// a site's own icon, fetched by the app (server/site-icons.ts) so no icon service learns which sites appear here
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The app's address for a site's icon, or null for anything that is not a public site name. */
export function siteIconUrl(domain: string | null | undefined): string | null {
  const name = String(domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  return DOMAIN.test(name) ? `/api/site-icon?domain=${encodeURIComponent(name)}` : null;
}

const COMPOSIO_LOGO = /^https:\/\/logos\.composio\.dev\/api\/([a-z0-9][a-z0-9_-]{0,80})$/i;

/** Composio's logos are SVGs, some of them hundreds of KB, that the window would draw on its main thread as each row
 * scrolls in; the app draws each once as a small PNG instead. Any other address is kept as it is. */
export function appLogoUrl(logo: string): string {
  const slug = COMPOSIO_LOGO.exec(logo)?.[1];
  return slug ? `/api/site-icon?app=${slug.toLowerCase()}` : logo;
}
