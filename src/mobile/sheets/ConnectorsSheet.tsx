import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { connectorDescription } from "@/lib/app-catalog";
import { preloadConnectedApps } from "@/lib/connected-apps";
import { hasActiveConnection } from "@/lib/connector-status";
import { listLogins } from "@/lib/logins";
import { HOSTED_MCP_APPS, hostedConnections } from "@/lib/hosted-mcp-apps";
import { ServiceTile } from "@/components/ServiceIcon";
import { Icon } from "@/components/Icon";
import { type McpServerListing, isRemoteMcpListing } from "@/components/mcp-draft";
import { grokCategories, type AppEntry } from "@/components/connect-apps/catalog";
import { mergeEntries, idsOf } from "@/components/connect-apps/merge";
import { appLogo } from "@/components/connect-apps/logos";
import { loadConnectorCatalog } from "@/components/connect-apps/use-connectors";
import { loadComposioSnapshot, mergeCatalog } from "@/components/connect-apps/composio-snapshot";
import { remoteConnection, sameEndpoint } from "@/components/connect-apps/use-remote-apps";
import { managedConnectorUnavailableReason } from "../../../shared/connector-availability";
import type { DirectoryAnswer } from "../../../shared/connector-directory";
import { Sheet } from "../Sheet";
import { haptic } from "../haptics";
import { dur, ease } from "../motion";
import { EmptyState } from "../Illustration";
import type { SheetPageProps } from "./registry";

interface AppsSnapshot { entries: AppEntry[]; added: Set<string>; incomplete: boolean }

export function appIsAdded(entry: AppEntry, added: ReadonlySet<string>): boolean {
  return idsOf(entry).some((id) => added.has(id));
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

const SKELETON_ROWS = 4;

/** The apps the bots here can use, read only: apps are connected from a computer, never from the phone. */
export function ConnectorsSheet({ open, onClose }: SheetPageProps<"connectors">) {
  const [snapshot, setSnapshot] = useState<AppsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reduced = useReducedMotion();
  const requestVersion = useRef(0);
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
  const connected = snapshot ? connectedApps(snapshot.entries, snapshot.added) : [];
  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.connectors.title")} full>
      <div className="px-2 pt-2">
        {error && <div className="mb-4 rounded-[20px] bg-ink/[0.045] px-4 py-3"><p role="alert" className="text-[15px] leading-[22px] text-ink">{t("mobile.connectors.error")}</p><button type="button" disabled={loading} onClick={() => void load()} className="mobile-press mt-2 min-h-11 rounded-full bg-ink px-5 text-[15px] font-semibold text-app disabled:opacity-40">{t("mobile.connectors.retry")}</button></div>}
        {!snapshot ? (
          loading && <div role="status" aria-label={t("mobile.connectors.loading")} className="overflow-hidden rounded-[20px] bg-ink/[0.045]">
            {Array.from({ length: SKELETON_ROWS }, (_, key) => <div key={key} aria-hidden className={APP_ROW}><span className="size-10 shrink-0 rounded-[11px] bg-ink/[0.06]" /><span className="flex-1 space-y-2"><span className="block h-4 w-1/2 rounded-full bg-ink/[0.06]" /><span className="block h-3 w-3/4 rounded-full bg-ink/[0.05]" /></span></div>)}
          </div>
        ) : connected.length > 0 ? (
          <motion.ul aria-label={t("mobile.connectors.title")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : dur.base, ease: ease.out }} className="overflow-hidden rounded-[20px] bg-ink/[0.045]">
            {connected.map((entry) => <li key={entry.id} className={APP_ROW}>
              <AppFace entry={entry} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold text-ink">{entry.label}</span><span className="mt-0.5 line-clamp-1 text-[14px] leading-5 text-ink-secondary">{entry.description}</span></span>
            </li>)}
          </motion.ul>
        ) : !error && <EmptyState art="plug" title={t("mobile.connectors.emptyTitle")} body={t("mobile.connectors.emptyBody")} className="pt-12" />}
      </div>
    </Sheet>
  );
}

const APP_ROW = "flex min-h-[72px] items-center gap-3 px-4 py-2.5";

/** the apps connected here, each once, in the order the catalog lists them */
export function connectedApps(entries: readonly AppEntry[], added: ReadonlySet<string>): AppEntry[] {
  return entries.filter((entry) => appIsAdded(entry, added));
}
