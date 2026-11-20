import { useEffect, useMemo, useState } from "react";
import {
  grokCategories,
  popularity,
  type AppEntry,
} from "@/components/connect-apps/catalog";
import { loadComposioSnapshot, type SnapshotToolkit } from "@/components/connect-apps/composio-snapshot";
import { appLogo } from "@/components/connect-apps/logos";
import { idsOf, mergeEntries } from "@/components/connect-apps/merge";
import { FIXTURE } from "../lib/api";
import { useCloud } from "./cloud";
import { connectorRows, FIXTURE_EXTRAS, withPending, type ConnectorRow } from "./connector-rows";
import { useSession } from "./session";

export { CATEGORIES, presentCategories, inCategory, searchApps, recommended } from "@/components/connect-apps/catalog";
export { idsOf } from "@/components/connect-apps/merge";
export type { Category } from "@/components/connect-apps/catalog";
export { CATEGORY_NAMES, connectedInAppOn, connectorRows, FIXTURE_EXTRAS } from "./connector-rows";
export type { ConnectorExtras, ConnectorRow, ConnectorStatus, ConnectorType } from "./connector-rows";

export interface DashApp extends AppEntry {}

type AppsState = { apps: DashApp[] | null; error: string | null };

let cached: AppsState = { apps: null, error: null };
let request: Promise<AppsState> | null = null;

function loadApps(): Promise<AppsState> {
  request ??= loadComposioSnapshot().then((snapshot): AppsState => {
    if (!snapshot) return { apps: null, error: "Could not load the app catalog." };
    const entries = snapshot.toolkits.map((toolkit: SnapshotToolkit & { website?: string; domain?: string }): DashApp => {
      const { slug, name, description, website, domain } = toolkit;
      const bundled = appLogo(slug, name);
      return {
        id: slug,
        kind: "composio",
        label: name,
        description,
        categories: grokCategories([toolkit.category]),
        icon: {
          logo: toolkit.logo ?? `https://logos.composio.dev/api/${slug}`,
          ...(domain ? { domain } : {}),
          ...(bundled ? { image: bundled.src, padded: bundled.padded, background: bundled.background, scale: bundled.scale } : {}),
        },
        ...(website ? { website } : {}),
      };
    });
    const apps = mergeEntries(entries).sort((a, b) => popularity(a) - popularity(b));
    return { apps, error: null };
  }).catch((): AppsState => ({ apps: null, error: "Could not load the app catalog." }))
    .then((state) => (cached = state));
  return request;
}

export const preloadApps = () => { void loadApps(); };

export function useDashApps(): { apps: DashApp[] | null; error: string | null } {
  const [state, setState] = useState<AppsState>(() => cached);
  useEffect(() => {
    let active = true;
    void loadApps().then((loaded) => {
      if (active) setState(loaded);
    });
    return () => { active = false; };
  }, []);
  return state;
}

/** the Composio toolkit an app connects through, or null for one only the desktop app can add */
export function composioSlug(app: Pick<DashApp, "id" | "kind" | "composio">): string | null {
  return (app.kind === "composio" ? app.id : app.composio ?? null)?.toLowerCase() ?? null;
}

export function connectedIn(app: DashApp, connectedIds: readonly string[]): boolean {
  const connected = new Set(connectedIds.map((id) => id.toLowerCase()));
  return idsOf(app).some((id) => connected.has(id.toLowerCase()));
}

export function useConnectorRows(): { rows: ConnectorRow[]; loading: boolean; error: string | null } {
  const { apps, error: appsError } = useDashApps();
  const { connections, pendingApps, error: cloudError } = useCloud();
  const { workspaces } = useSession();
  const rows = useMemo(() => {
    if (!workspaces) return [];
    const shown = withPending(connections ?? {}, pendingApps, FIXTURE ? FIXTURE_EXTRAS : undefined);
    return connectorRows(apps ?? [], shown.connections, workspaces, shown.extras, shown.pending);
  }, [apps, connections, pendingApps, workspaces]);
  const error = appsError ?? (connections === null ? cloudError : null);
  return { rows, loading: workspaces === null || apps === null && !appsError || connections === null && !cloudError, error };
}
