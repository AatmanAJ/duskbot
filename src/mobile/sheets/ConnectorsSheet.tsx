import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "../../icons";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { api } from "@/state/store";
import { connectorDescription } from "@/lib/app-catalog";
import { preloadConnectedApps } from "@/lib/connected-apps";
import { hasActiveConnection } from "@/lib/connector-status";
import { listLogins } from "@/lib/logins";
import { HOSTED_MCP_APPS, hostedConnections } from "@/lib/hosted-mcp-apps";
import { ServiceTile } from "@/components/ServiceIcon";
import { Icon } from "@/components/Icon";
import { type McpServerListing, isRemoteMcpListing } from "@/components/mcp-draft";
import { CATEGORY_LABEL, grokCategories, popularity, presentCategories, searchApps, type AppEntry, type Category } from "@/components/connect-apps/catalog";
import { mergeEntries, idsOf } from "@/components/connect-apps/merge";
import { appLogo } from "@/components/connect-apps/logos";
import { loadConnectorCatalog } from "@/components/connect-apps/use-connectors";
import { loadComposioSnapshot, mergeCatalog } from "@/components/connect-apps/composio-snapshot";
import { remoteConnection, sameEndpoint } from "@/components/connect-apps/use-remote-apps";
import { openConnectApps } from "@/components/connect-apps/open";
import { managedConnectorUnavailableReason } from "../../../shared/connector-availability";
import type { DirectoryAnswer } from "../../../shared/connector-directory";
import { Sheet } from "../Sheet";
import { haptic } from "../haptics";
import { EmptyState } from "../Illustration";
import type { SheetPageProps } from "./registry";

interface AppsSnapshot { entries: AppEntry[]; added: Set<string>; incomplete: boolean }

export function appIsAdded(entry: AppEntry, added: ReadonlySet<string>): boolean {
  return idsOf(entry).some((id) => added.has(id));
}

export type AppGroup = { key: "connected" | "popular" | Category; entries: AppEntry[]; total: number };

const POPULAR_SHOWN = 8;
export const CATEGORY_SHOWN = 5;

/** The list as people look for an app: what's connected, the popular ones, then each category with its first few. An app
 * shows once, in the first group it belongs to. */
export function groupApps(entries: readonly AppEntry[], added: ReadonlySet<string>, expanded: ReadonlySet<string> = new Set()): AppGroup[] {
  const seen = new Set<string>();
  const take = (list: AppEntry[]) => { for (const entry of list) seen.add(entry.id); return list; };
  const connected = take(entries.filter((entry) => appIsAdded(entry, added)));
  const popular = take(entries.filter((entry) => !seen.has(entry.id) && popularity(entry) !== Infinity).sort((a, b) => popularity(a) - popularity(b)).slice(0, POPULAR_SHOWN));
  const groups: AppGroup[] = [{ key: "connected", entries: connected, total: connected.length }, { key: "popular", entries: popular, total: popular.length }];
  for (const category of presentCategories(entries)) {
    const members = entries.filter((entry) => !seen.has(entry.id) && entry.categories[0] === category);
    take(members);
    groups.push({ key: category, entries: expanded.has(category) ? members : members.slice(0, CATEGORY_SHOWN), total: members.length });
  }
  const rest = entries.filter((entry) => !seen.has(entry.id));
  if (rest.length) {
    const other = groups.find((group) => group.key === "other");
    if (other) { other.total += rest.length; if (expanded.has("other")) other.entries.push(...rest); else other.entries = [...other.entries, ...rest].slice(0, CATEGORY_SHOWN); }
    else groups.push({ key: "other", entries: expanded.has("other") ? rest : rest.slice(0, CATEGORY_SHOWN), total: rest.length });
  }
  return groups.filter((group) => group.entries.length > 0);
}

function logoIcon(id: string, name: string, fallback: AppEntry["icon"] = {}): AppEntry["icon"] {
  const logo = appLogo(id, name);
  return logo ? { ...logo, image: logo.src } : fallback;
}

async function readApps(): Promise<AppsSnapshot> {
  const [catalog, inventory, directory, servers, logins, email, x, bundled] = await Promise.allSettled([
    loadConnectorCatalog(),
    preloadConnectedApps(true),
    api<DirectoryAnswer>("/api/connectors/directory"),
    api<{ servers: McpServerListing[] }>("/api/mcp/servers"),
    listLogins(),
    api<{ state: string }>("/api/email"),
    api<{ using: string | null }>("/api/x/status"),
    loadComposioSnapshot(),
  ]);
  const added = new Set<string>();
  const services = inventory.status === "fulfilled" ? inventory.value.services : {};
  for (const [id, status] of Object.entries(services)) if (hasActiveConnection(status)) added.add(id);
  if (logins.status === "fulfilled" && logins.value.onePassword?.connected) added.add("1password");
  if (email.status === "fulfilled" && email.value.state === "connected") added.add("email");
  if (x.status === "fulfilled" && x.value.using != null) added.add("x");
  const mcp = servers.status === "fulfilled" ? servers.value.servers.filter((server) => !server.bot) : [];
  for (const [id, connected] of Object.entries(hostedConnections(mcp))) if (connected) added.add(id);
  const own: AppEntry[] = [
    { id: "1password", kind: "logins", label: t("mobile.connectors.passwordName"), description: t("mobile.connectors.passwordDescription"), categories: ["credentials"], icon: logoIcon("1password", "1Password") },
    { id: "email", kind: "native", label: t("mobile.connectors.emailName"), description: t("mobile.connectors.emailDescription"), categories: ["communication"], icon: { glyph: "envelope" } },
    { id: "x", kind: "native", label: t("mobile.connectors.xName"), description: t("mobile.connectors.xDescription"), categories: ["marketing"], icon: logoIcon("x", "X") },
    { id: "custom-mcp", kind: "native", label: t("mobile.connectors.customName"), description: t("mobile.connectors.customDescription"), categories: ["code"], icon: { glyph: "plug" } },
    ...HOSTED_MCP_APPS.map((app): AppEntry => ({ id: app.id, kind: "hosted", label: app.label, description: t(app.id === "whop" ? "mobile.connectors.whopDescription" : "mobile.connectors.agentcardDescription"), categories: ["finance"], icon: "image" in app.icon ? { image: app.icon.image } : { glyph: "credit-card" } })),
  ];
  const mode = catalog.status === "fulfilled" ? catalog.value.mode ?? "unavailable" : "unavailable";
  const listed = mergeCatalog(catalog.status === "fulfilled" ? catalog.value.cards ?? [] : null, catalog.status === "fulfilled" ? catalog.value.source : undefined, bundled.status === "fulfilled" ? bundled.value : null) ?? [];
  const cards = listed.filter((card) => !managedConnectorUnavailableReason(mode, card.slug) || added.has(card.slug)).map((card): AppEntry => ({
    id: card.slug, kind: "composio", label: card.label, description: connectorDescription(card), categories: grokCategories(card.categories), website: card.domain ?? undefined,
    icon: logoIcon(card.slug, card.label, { logo: card.logo, padded: true }),
  }));
  const remote = directory.status === "fulfilled" ? directory.value.apps.filter((app) => app.source === "remote-mcp" && app.url) : [];
  const ownedServers = new Set<string>();
  for (const app of remote) {
    const matches = mcp.filter(isRemoteMcpListing).filter((server) => sameEndpoint(server.url, app.url!));
    for (const server of matches) ownedServers.add(server.name);
    if (matches.some((server) => remoteConnection(app, server) === "connected")) added.add(app.id);
  }
  const vendors = remote.map((app): AppEntry => ({ id: app.id, kind: "remote", label: app.label, description: app.description, categories: grokCategories(app.categories), website: app.domain ?? undefined, icon: logoIcon(app.id, app.label, { domain: app.domain }) }));
  const custom = mcp.filter((server) => !ownedServers.has(server.name) && !HOSTED_MCP_APPS.some((app) => server.name === app.id || server.name.startsWith(`${app.id}-`))).map((server): AppEntry => {
    const id = `mcp:${server.name}`;
    if (server.enabled) added.add(id);
    return { id, kind: "custom", label: server.name, description: t("mobile.connectors.serverDescription"), categories: ["code"], icon: { glyph: "server" } };
  });
  return {
    entries: [...mergeEntries([...own, ...cards, ...vendors]), ...custom], added,
    incomplete: [catalog, inventory, directory, servers, logins, email, x].some((answer) => answer.status === "rejected") || inventory.status === "fulfilled" && (!inventory.value.authoritative || inventory.value.refused === true) || directory.status === "fulfilled" && directory.value.providers.some((provider) => provider.available && !provider.ok),
  };
}

/** An app's logo, or its initial only when it has none: the tile draws that fallback itself. */
export function AppFace({ entry }: { entry: Pick<AppEntry, "label" | "icon"> }) {
  const { glyph, glyphPaint: _glyphPaint, ...art } = entry.icon;
  return (
    <span aria-hidden className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-ink/[0.06] text-ink-secondary">
      {glyph ? <Icon name={glyph} size={21} /> : <ServiceTile card={{ label: entry.label, ...art }} size={40} className="absolute inset-0" />}
    </span>
  );
}

export function ConnectorsSheet({ open, onClose }: SheetPageProps<"connectors">) {
  const [snapshot, setSnapshot] = useState<AppsSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestVersion = useRef(0);
  const id = useId();
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(false);
    try {
      const next = await readApps();
      if (version === requestVersion.current) { setSnapshot(next); setError(next.incomplete); if (next.incomplete) haptic("error"); }
    } catch { if (version === requestVersion.current) { setError(true); haptic("error"); } }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, []);
  useEffect(() => { if (open) void load(); return () => { requestVersion.current++; }; }, [open, load]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const searching = Boolean(query.trim());
  const entries = snapshot ? searching ? searchApps(snapshot.entries, query, snapshot.entries.length) : snapshot.entries : [];
  const groups: AppGroup[] = !snapshot ? [] : searching ? [{ key: "popular", entries, total: entries.length }] : groupApps(entries, snapshot.added, expanded);
  const connect = (entry: AppEntry) => { openConnectApps({ kind: "detail", id: entry.kind === "custom" ? "custom-mcp" : entry.id }); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.connectors.title")} full>
      <div className="px-3 pt-2">
        <label htmlFor={id} className="mx-3 mb-3 flex h-11 items-center gap-2 rounded-full bg-ink/[0.06] px-4 text-ink-secondary"><Search aria-hidden size={19} /><span className="sr-only">{t("mobile.connectors.search")}</span><input id={id} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("mobile.connectors.search")} className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink placeholder:text-ink-tertiary" /></label>
        {error && <div className="mx-3 mb-4 rounded-2xl bg-ink/[0.045] px-4 py-3"><p role="alert" className="text-[15px] leading-[22px] text-ink">{t("mobile.connectors.error")}</p><button type="button" disabled={loading} onClick={() => void load()} className="mobile-press mt-2 min-h-11 rounded-full bg-ink px-5 text-[15px] font-semibold text-app disabled:opacity-40">{t("mobile.connectors.retry")}</button></div>}
        {loading && !snapshot ? <div role="status" aria-label={t("mobile.connectors.loading")}>{[0, 1, 2, 3, 4].map((key) => <div key={key} aria-hidden className="flex min-h-[72px] items-center gap-3 px-3 py-3"><span className="size-10 shrink-0 rounded-[11px] bg-ink/[0.06]" /><span className="flex-1 space-y-2"><span className="block h-4 w-1/2 rounded-full bg-ink/[0.06]" /><span className="block h-3 w-3/4 rounded-full bg-ink/[0.05]" /></span></div>)}</div> : groups.map((group) => <section key={group.key} aria-labelledby={`${id}-${group.key}`} className="mb-6">
          {!searching && <h2 id={`${id}-${group.key}`} className="px-3 pb-1 pt-2 text-[15px] font-semibold text-ink">{group.key === "connected" || group.key === "popular" ? t(`mobile.connectors.${group.key}`) : t(CATEGORY_LABEL[group.key])}</h2>}
          <ul>{group.entries.map((entry) => {
            const added = appIsAdded(entry, snapshot!.added);
            return <li key={entry.id}><button type="button" onClick={() => connect(entry)} className="mobile-row flex min-h-[72px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left">
              <AppFace entry={entry} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold text-ink">{entry.label}</span><span className="mt-0.5 line-clamp-1 text-[14px] leading-5 text-ink-secondary">{entry.description}</span></span>
              <span className={cn("flex min-h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[14px] font-semibold", added ? "text-success" : "bg-ink/[0.06] text-ink")}>
                {added && <Check aria-hidden size={15} />}{t(added ? "mobile.connectors.added" : "mobile.connectors.add")}
              </span>
            </button></li>;
          })}</ul>
          {!searching && group.total > group.entries.length && <button type="button" onClick={() => setExpanded((current) => new Set([...current, group.key]))} className="mobile-row flex min-h-11 w-full items-center gap-2 rounded-2xl px-3 text-left text-[15px] font-semibold text-ink-secondary"><ChevronDown aria-hidden size={18} />{t("mobile.connectors.showAll", { count: group.total })}</button>}
        </section>)}
        {!loading && snapshot && entries.length === 0 && (searching
          ? <EmptyState art="plug" title={t("mobile.connectors.noMatch")} body={t("mobile.connectors.noMatchHint")} className="pt-12" />
          : <EmptyState art="plug" title={t("mobile.connectors.emptyTitle")} body={t("mobile.connectors.emptyBody")} action={{ label: t("mobile.connectors.retry"), onClick: () => void load() }} className="pt-12" />)}
      </div>
    </Sheet>
  );
}
