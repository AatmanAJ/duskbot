import { useDesktopCapabilities } from "../DesktopCapabilities";
import { browserAvailable, builtInBrowserEnabled } from "@/lib/feature-flags";
import { stateForBot } from "@/lib/mascot";
import { useDispatch, useStoreSelector, useStoreShallow, type Bot } from "@/state/store";
import { approvalModeFor } from "../../../shared/approval-mode";
import { chiefScope } from "../../../shared/bot-owner";
import { connectorGrantsState, type ConnectorGrantsState } from "@/lib/connector-grants";

export type BotPatch = Partial<
  Pick<
    Bot,
    | "name"
    | "title"
    | "description"
    | "soul"
    | "notifications"
    | "cloudBackend"
    | "autoStartVps"
    | "vpsAlias"
    | "color"
    | "mascotExpression"
    | "mascotBody"
    | "mascotFaceColor"
    | "avatarUrl"
    | "avatarCrop"
    | "avatarZoom"
    | "avatarFocusX"
    | "avatarFocusY"
    | "alwaysAllow"
    | "autoApprove"
    | "approvalMode"
    | "outbound"
    | "fallback"
    | "speakReplies"
    | "replyStyle"
    | "memoryEnabled"
    | "xResearch"
    | "macControl"
    | "voice"
    | "chiefOfStaff"
    | "approvePeerComms"
    | "composio"
    | "browser"
    | "recordBrowserSteps"
    | "mcpServers"
    | "modelSelection"
  >
> & {
  computer?: Bot["computer"] | null;
  connectorTools?: Bot["connectorTools"] | null;
  connectorScopes?: Bot["connectorScopes"] | null;
  phoneApps?: Bot["phoneApps"] | null;
  peers?: string[] | null;
  acknowledgeLocalAuto?: boolean;
  acknowledgePeerScope?: boolean;
};

export function useBotSettingsDerived(bot: Bot) {
  const dispatch = useDispatch();
  const config = useStoreSelector((s) => s.config);
  const mascotMotion = useStoreSelector((s) => (s.mascotMotion?.botId === bot.id ? s.mascotMotion : null));
  const engine = useStoreSelector((s) => s.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId));
  // one Chief of Staff for the whole workspace (per person on a Team Cloud), whatever sidebar section a bot is in
  const currentChief = useStoreSelector((s) => s.bots.find((candidate) => candidate.chiefOfStaff && chiefScope(candidate) === chiefScope(bot)));
  const botRoutines = useStoreShallow((s) => s.routines.filter((routine) => routine.botId === bot.id));
  const { capabilities } = useDesktopCapabilities();
  const patch = (p: BotPatch) => dispatch({ type: "updateBot", botId: bot.id, patch: p });
  const activeState = stateForBot(bot);
  const approvalMode = approvalModeFor(bot);
  const trustedModesAvailable = Boolean(window.duskDesktop?.approvals && capabilities.host.packaged);
  const canCoordinate = engine?.capabilities?.agentsMcp === true;
  // Connected apps reach a bot through Composio's MCP or the native Email one; either lets the switch work.
  const canUseConnectedApps = engine?.capabilities?.composioMcp === true || engine?.capabilities?.emailMcp === true;
  const connectedAppsConfigured = config?.composio?.configured === true;
  const connectedAppsEnabled = bot.composio !== false;
  const connectorGrantState: ConnectorGrantsState = connectorGrantsState(bot);
  const canUseBrowser = engine?.capabilities?.browserMcp === true;
  const desktopBrowser = browserAvailable(config);
  const browserBlockedOnWindows = window.duskDesktop?.platform === "win32" && !desktopBrowser;
  const browserFeature = builtInBrowserEnabled(config);
  const browserAllowed = bot.browser !== false;
  const browserEnabled = browserFeature && browserAllowed;
  const activeBotRoutines = botRoutines.filter((routine) => routine.enabled).length;

  return {
    patch,
    engine,
    approvalMode,
    trustedModesAvailable,
    canCoordinate,
    canUseConnectedApps,
    connectedAppsConfigured,
    connectedAppsEnabled,
    connectorGrantState,
    canUseBrowser,
    desktopBrowser,
    browserBlockedOnWindows,
    browserFeature,
    browserAllowed,
    browserEnabled,
    currentChief,
    botRoutines,
    activeBotRoutines,
    activeState,
    mascotMotion,
  };
}
