import { xResearchAction } from "@/lib/cloud-plan";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { mcpServersForBot, mcpServersOfBot, useMcpServers } from "@/lib/mcp-servers";
import { useStoreSelector, useDispatch, type Bot } from "@/state/store";
import type { ConnectorScope } from "../../../../shared/connector-scopes";
import { ConnectorGrantPage, ConnectorGrantRows, GRANT_PAGE } from "../../bot-settings/ConnectorGrantRows";
import { useToolSelection } from "../../bot-settings/ToolSelectionCard";
import { useBotApps } from "../../bot-settings/useBotApps";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { openKeySettings } from "../../keys/key-focus";
import { Card, NavRow, NoteRow, pillCls, rowCls, SelectRow, SwitchRow, useSubPage } from "../../ListRows";
import { useCloudPlan } from "../../ProIntroduction";
import { RowIconButton } from "../../ui/GrokDialog";
import { FieldCard, sheetAreaCls } from "./sheet-kit";

type Derived = ReturnType<typeof useBotSettingsDerived>;

/** The bot's apps and tools as rows; app limits, MCP servers, a custom selection and always-allowed tools each open their
 * own page. */
export function ToolsSheet({ bot, derived }: { bot: Bot; derived: Derived }) {
  const sub = useSubPage();
  // the page on top: in Settings a sheet's pages stack under Settings' own, so the first of them is not always the one shown
  const at = sub.stack?.length ? sub.stack.at(-1)!.id : sub.at;
  const apps = useBotApps(bot);
  const selection = useToolSelection(bot, derived.engine?.driverKind);
  const grantSlugs = apps.connectedSlugs;
  if (at?.startsWith(GRANT_PAGE)) return <ConnectorGrantPage bot={bot} patch={derived.patch} slug={at.slice(GRANT_PAGE.length)} slugs={grantSlugs} />;
  switch (at) {
    case "apps": return <AppLimitsPage bot={bot} derived={derived} apps={apps} />;
    case "grants": return <ConnectorGrantRows bot={bot} patch={derived.patch} slugs={grantSlugs} />;
    case "servers": return <ServersPage bot={bot} patch={derived.patch} />;
    case "selection": return <SelectionPage bot={bot} selection={selection} />;
    case "always": return <AlwaysPage bot={bot} patch={derived.patch} />;
  }
  return (
    <>
      <AppsCard bot={bot} derived={derived} apps={apps} />
      <ToolsCard bot={bot} derived={derived} selection={selection} />
    </>
  );
}

type Apps = ReturnType<typeof useBotApps>;
type Selection = ReturnType<typeof useToolSelection>;

function AppsCard({ bot, derived, apps }: { bot: Bot; derived: Derived; apps: Apps }) {
  const dispatch = useDispatch();
  const { open } = useSubPage();
  const { patch, canUseConnectedApps, connectedAppsConfigured, connectedAppsEnabled, connectorGrantState } = derived;
  const shown = connectedAppsEnabled && apps.phase === "ready";
  const chosen = Object.values(bot.connectorScopes?.apps ?? {}).length;
  const hint = !connectedAppsConfigured ? t("botPanel.sheet.appsConnectFirst")
    : !canUseConnectedApps ? t("botPanel.sheet.appsNoModel")
      : connectedAppsEnabled && connectorGrantState === "partial" ? t("botPanel.sheet.appsSome")
        : connectedAppsEnabled && connectorGrantState === "none" ? t("botPanel.sheet.appsNoTools") : undefined;

  return (
    <Card label={t("botPanel.sheet.apps")} data-sheet-group="apps">
      <SwitchRow
        title={t("botPanel.sheet.appsRow")}
        hint={hint}
        label={t("botPanel.ui.botAccessAppsAllow")}
        checked={connectedAppsEnabled}
        disabled={!connectedAppsEnabled && (!connectedAppsConfigured || !canUseConnectedApps)}
        onChange={() => patch({ composio: !connectedAppsEnabled })}
      />
      {shown && (
        <NavRow
          data-sheet-row="app-limits"
          title={t("botPanel.ui.sheetRowsWhichApps")}
          value={bot.connectorScopes ? t("sheet.rows.appsChosen", { count: chosen }) : t("botPanel.ui.sheetRowsAllApps")}
          onClick={() => open("apps", t("botPanel.ui.sheetRowsWhichApps"))}
        />
      )}
      {connectedAppsConfigured && (
        <NavRow data-sheet-row="add-app" title={t("botPanel.sheet.addApp")} onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })} />
      )}
    </Card>
  );
}

function AppLimitsPage({ bot, derived, apps }: { bot: Bot; derived: Derived; apps: Apps }) {
  const { open } = useSubPage();
  const { patch } = derived;
  const scopes = bot.connectorScopes;
  const limited = scopes !== undefined;
  const slugs = [...new Set([...apps.connectedSlugs, ...Object.keys(scopes?.apps ?? {})])].sort();
  const labels = Object.fromEntries(apps.apps.map((app) => [app.slug, app.label]));
  const grantSlugs = apps.connectedSlugs;
  const setScope = (slug: string, scope: ConnectorScope | null) => {
    const next = { ...scopes?.apps };
    if (scope) next[slug] = scope;
    else delete next[slug];
    patch({ connectorScopes: { apps: next } });
  };
  const levels = [
    { value: "off", label: t("botPanel.ui.botAccessScopesOff"), title: t("botAccess.scopes.offHint") },
    { value: "read", label: t("botPanel.ui.botAccessScopesRead"), title: t("botAccess.scopes.readHint") },
    { value: "write", label: t("botPanel.ui.botAccessScopesReadWrite"), title: t("botAccess.scopes.readWriteHint") },
  ] as const;

  return (
    <>
      <Card>
        <SwitchRow
          title={t("botPanel.sheet.onlyChosen")}
          label={t("botPanel.ui.botAccessScopesLimitLabel")}
          checked={limited}
          onChange={() => patch({ connectorScopes: limited ? null : { apps: {} } })}
        />
      </Card>
      {limited && (
        <Card label={t("botPanel.sheet.apps")} data-sheet-group="app-scopes">
          {slugs.length === 0 && <NoteRow>{t("botAccess.scopes.empty")}</NoteRow>}
          {slugs.map((slug) => (
            <SelectRow
              key={slug}
              data-sheet-row={`scope:${slug}`}
              title={labels[slug] ?? slug}
              hint={apps.connectedSlugs.includes(slug) ? undefined : t("botPanel.ui.botAccessScopesNotConnected")}
              label={t("botAccess.scopes.accessLabel", { app: labels[slug] ?? slug })}
              value={scopes?.apps[slug] ?? "off"}
              options={levels}
              onChange={(value) => setScope(slug, value === "off" ? null : value)}
            />
          ))}
        </Card>
      )}
      {grantSlugs.length > 0 && (
        <Card>
          <NavRow data-sheet-row="grants" title={t("botPanel.ui.botAccessGrantsHeader")} onClick={() => open("grants", t("botPanel.ui.botAccessGrantsHeader"))} />
        </Card>
      )}
    </>
  );
}

function ToolsCard({ bot, derived, selection }: { bot: Bot; derived: Derived; selection: Selection }) {
  const { open } = useSubPage();
  const { servers: all, error } = useMcpServers();
  const servers = all ? mcpServersOfBot(all, bot.id) : null;
  const mounted = servers ? mcpServersForBot(servers, bot.mcpServers, bot.id).length : 0;
  const always = bot.alwaysAllow?.length ?? 0;
  const busy = Boolean(bot.busy);
  const serversValue = error ? t("botPanel.sheet.serversError") : servers === null ? t("botPanel.ui.mcpLoading")
    : servers.length === 0 ? t("botPanel.ui.sheetRowsNoServers") : t("sheet.rows.serversOn", { on: mounted, count: servers.length });

  return (
    <Card label={t("botPanel.ui.sheetRowsTools")} footnote={busy ? t("botAccess.tools.busy") : undefined} data-sheet-group="tools">
      <NavRow data-sheet-row="servers" title={t("connectors.tab.mcp")} value={serversValue} onClick={() => open("servers", t("connectors.tab.mcp"))} />
      <SelectionRow bot={bot} selection={selection} />
      {selection.fields.custom && (
        <NavRow data-sheet-row="selection" title={t("botPanel.ui.botAccessToolsCustom")} value={selection.saving ? t("botPanel.ui.botAccessToolsSaving") : selection.status} onClick={() => open("selection", t("botPanel.ui.botAccessToolsCustom"))} />
      )}
      <ResearchRow bot={bot} patch={derived.patch} />
      <NavRow
        data-sheet-row="always"
        title={t("botPanel.ui.botAccessAlwaysTitle")}
        value={always ? String(always) : t("botPanel.sheet.nothingYet")}
        onClick={() => open("always", t("botPanel.ui.botAccessAlwaysTitle"))}
      />
    </Card>
  );
}

/** All tools or a custom selection: choosing Custom opens the lists to fill in. */
function SelectionRow({ bot, selection }: { bot: Bot; selection: Selection }) {
  const { at, open } = useSubPage();
  const { saved, fields, saving, status, change, clear } = selection;
  return (
    <SelectRow
      data-sheet-row="tool-selection"
      title={t("botPanel.sheet.toolsRow")}
      hint={!saved.ok ? status : saving && !fields.custom ? t("botPanel.ui.botAccessToolsSaving") : undefined}
      label={t("botPanel.ui.botAccessToolsTitle")}
      disabled={saving || Boolean(bot.busy)}
      value={fields.custom ? "custom" : "all"}
      options={[{ value: "all", label: t("botPanel.sheet.toolsAll") }, { value: "custom", label: t("botPanel.sheet.toolsCustom") }]}
      onChange={(value) => {
        if (value === "all") { void clear(); return; }
        change({ custom: true, onlyListed: true });
        if (at !== "selection") open("selection", t("botPanel.ui.botAccessToolsCustom"));
      }}
    />
  );
}

function SelectionPage({ bot, selection }: { bot: Bot; selection: Selection }) {
  const { draft, fields, parsed, support, unavailable, saving, error, change, save, example, status, empty } = selection;
  const locked = saving || Boolean(bot.busy);
  return (
    <>
      <Card footnote={bot.busy ? t("botAccess.tools.busy") : undefined} data-sheet-group="tools">
        <SelectionRow bot={bot} selection={selection} />
        {fields.custom && (
          <SwitchRow title={t("botPanel.ui.botAccessToolsOnlyListed")} checked={fields.onlyListed} disabled={locked} onChange={() => change({ onlyListed: !fields.onlyListed })} />
        )}
      </Card>
      {fields.custom && (
        <>
          <FieldCard label={t("botPanel.ui.botAccessToolsAllow")}>
            <textarea
              aria-label={t("botPanel.ui.botAccessToolsAllow")}
              disabled={locked || !fields.onlyListed}
              rows={4}
              spellCheck={false}
              placeholder={example}
              value={fields.allow}
              onChange={(event) => change({ allow: event.target.value })}
              className={sheetAreaCls}
            />
          </FieldCard>
          <FieldCard label={t("botPanel.ui.botAccessToolsExclude")}>
            <textarea
              aria-label={t("botPanel.ui.botAccessToolsExclude")}
              disabled={locked}
              rows={2}
              spellCheck={false}
              placeholder="mcp:mail:send"
              value={fields.deny}
              onChange={(event) => change({ deny: event.target.value })}
              className={sheetAreaCls}
            />
          </FieldCard>
          <div className="-mt-2.5 flex items-center justify-end gap-3 px-3">
            <span role="status" className="mr-auto min-w-0 truncate text-[12px] leading-4 tracking-[0.01em] text-ink-secondary">{saving ? t("botPanel.ui.botAccessToolsSaving") : status}</span>
            <button type="button" aria-label={t("botPanel.ui.botAccessToolsSave")} disabled={locked || !draft || !parsed.ok} onClick={() => void save()} className={pillCls}>
              {t("botPanel.sheet.save")}
            </button>
          </div>
          {(empty || unavailable || !parsed.ok) && (
            <Card>
              {empty && <NoteRow tone="warn">{t("botAccess.tools.emptyHint")}</NoteRow>}
              {unavailable && <NoteRow tone="danger">{t(support === "mcp" ? "botAccess.tools.nativeUnsupported" : "botAccess.tools.unsupported")}</NoteRow>}
              {!parsed.ok && <NoteRow tone="danger">{parsed.error}</NoteRow>}
            </Card>
          )}
        </>
      )}
      {error && <Card><NoteRow tone="danger">{error}</NoteRow></Card>}
    </>
  );
}

function ServersPage({ bot, patch }: { bot: Bot; patch: Derived["patch"] }) {
  const dispatch = useDispatch();
  const { servers: all, error, refresh } = useMcpServers();
  const servers = all ? mcpServersOfBot(all, bot.id) : null;
  const mounted = new Set((servers ? mcpServersForBot(servers, bot.mcpServers, bot.id) : []).map((server) => server.name));
  const usesAll = bot.mcpServers == null;
  const busy = Boolean(bot.busy);
  const toggle = (name: string) => {
    if (!servers || busy || error) return;
    const current = usesAll ? servers.filter((server) => server.enabled).map((server) => server.name) : [...(bot.mcpServers ?? [])];
    patch({ mcpServers: current.includes(name) ? current.filter((item) => item !== name) : [...current, name] });
  };

  return (
    <>
      <Card footnote={busy ? t("botPanel.sheet.busy") : undefined} data-sheet-group="mcp">
        {error && <NavRow drill={false} title={t("botPanel.sheet.serversError")} value={t("botPanel.ui.connectorsActionRetry")} onClick={() => void refresh()} />}
        {servers === null ? !error && <NoteRow>{t("botPanel.ui.mcpLoading")}</NoteRow>
          : servers.length === 0 ? <NoteRow>{t("botPanel.sheet.noServers")}</NoteRow>
            : servers.map((server) => (
              <SwitchRow
                key={server.name}
                title={server.name}
                hint={!server.enabled ? t("botPanel.sheet.serverOff") : server.offFor?.includes(bot.id) ? t("botPanel.sheet.serverOffHere") : undefined}
                label={t("botPanel.ui.botAccessMcpAllow", { name: server.name })}
                checked={mounted.has(server.name)}
                disabled={!server.enabled || busy || Boolean(error)}
                onChange={() => toggle(server.name)}
              />
            ))}
      </Card>
      <Card>
        <NavRow data-sheet-row="add-server" aria-label={t("botPanel.ui.botAccessMcpAdd")} title={t("botPanel.sheet.addServer")} onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "mcp" })} />
        {servers && servers.length > 0 && !usesAll && (
          <NavRow drill={false} data-sheet-row="use-all" disabled={busy || Boolean(error)} title={t("botPanel.sheet.useAll")} onClick={() => patch({ mcpServers: null })} />
        )}
      </Card>
    </>
  );
}

function ResearchRow({ bot, patch }: { bot: Bot; patch: Derived["patch"] }) {
  const dispatch = useDispatch();
  const xUnavailable = useStoreSelector((s) => s.config?.xResearch?.unavailable === true);
  const available = useStoreSelector((s) => s.config?.treg?.configured === true || s.config?.xResearch?.included === true);
  const connecting = xResearchAction(useCloudPlan()?.view ?? null) === "connecting" && !xUnavailable;
  const on = bot.xResearch !== false;
  if (!available && !connecting) {
    return <NavRow data-sheet-row="research" title={t("botPanel.sheet.researchRow")} value={t("botPanel.sheet.researchKey")} onClick={() => dispatch(openKeySettings("treg"))} />;
  }
  return (
    <SwitchRow
      data-sheet-row="research"
      title={t("botPanel.sheet.researchRow")}
      hint={available ? undefined : t("botPanel.sheet.researchSetup")}
      label={t("botPanel.ui.researchSwitch")}
      checked={available && on}
      disabled={!available}
      onChange={() => patch({ xResearch: !on })}
    />
  );
}

function AlwaysPage({ bot, patch }: { bot: Bot; patch: Derived["patch"] }) {
  const entries = bot.alwaysAllow ?? [];
  return (
    <Card footnote={t("botAccess.always.description")} data-sheet-group="always">
      {entries.length === 0 && <NoteRow>{t("botAccess.always.empty")}</NoteRow>}
      {entries.map((entry) => (
        <div key={entry} className={cn(rowCls, "group/row py-0.5 pr-0.5")}>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-4 text-ink">{entry}</span>
          <RowIconButton reveal icon="trash" label={t("botPanel.ui.botAccessAlwaysRemove", { entry })} onClick={() => patch({ alwaysAllow: entries.filter((key) => key !== entry) })} />
        </div>
      ))}
    </Card>
  );
}
