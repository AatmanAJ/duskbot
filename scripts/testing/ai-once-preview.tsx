// The whole first run as the person sees it, for proving it asks for an AI once: the real WelcomeFlow with a fake
// desktop bridge, signed in, ChatGPT, Claude and Grok connected on this computer (Claude's sign-in stays here).
// ?side=desktop|cloud: this computer's window, or the new cloud's own page. ?beat=: the screen to open (a resumed run).
// ?cloud=1: the run picked dusk cloud. Served by scripts/verify-ai-once.ts.
import { createRoot } from "react-dom/client";
import { WelcomeFlow } from "../../src/components/onboarding/WelcomeFlow";
import { DesktopCapabilitiesProvider } from "../../src/components/DesktopCapabilities";
import { setEmailGateDone } from "../../src/lib/analytics";
import { initialDesktopCapabilities } from "../../src/lib/desktop";
import { setLocale } from "../../src/lib/i18n";
import { applySkinChoice } from "../../src/lib/skins";
import { saveWelcomeDraft } from "../../src/lib/welcome-draft";
import type { BeatId } from "../../src/lib/onboarding";
import { StoreProvider } from "../../src/state/store";
import "../../src/styles.css";
import "../../src/styles/overlays.css";
import "../../src/styles/motion.css";

setLocale("en");
setEmailGateDone("skipped");
applySkinChoice("system");
const params = new URLSearchParams(location.search);
const side = params.get("side") ?? "desktop";
saveWelcomeDraft({ beat: (params.get("beat") ?? "welcome") as BeatId, ...(params.get("cloud") === "1" ? { cloud: true as const } : {}) });

const account = { status: "connected", account: { id: "a", email: "sam@example.test", name: "Sam Rivera" },
  entitlement: { plan: params.get("cloud") === "1" ? "pro" : "free", status: params.get("cloud") === "1" ? "active" : "inactive", expiresAt: null, version: 1 },
  clouds: params.get("cloud") === "1" ? [{ id: "c1", primary: true, runsOn: "cloud", status: "setting_up", origin: null }] : [] };
if (side === "desktop") {
  window.duskDesktop = {
    platform: "darwin",
    remoteClient: { active: false },
    getCapabilities: async () => ({ ...initialDesktopCapabilities(), windowChrome: "mac-inset" }),
    onCapabilitiesChanged: () => () => {},
    macPermissions: { status: async () => ({ accessibility: "denied", screen: "denied" }), request: async () => ({ accessibility: "denied", screen: "denied" }) },
    cloudAccount: { state: async () => account, onState: () => () => {}, refresh: async () => account, holdSignIns: async () => ({ outcome: "held" }),
      carriedAis: async () => ({ instanceIds: ["codex", "grok"] }), offer: async () => null, openDashboard: async () => {} },
  } as unknown as typeof window.duskDesktop;
}

createRoot(document.getElementById("root")!).render(
  <StoreProvider><DesktopCapabilitiesProvider>
    <WelcomeFlow onDone={() => { document.body.dataset.firstRunDone = "1"; }} cloudHome={side === "cloud"} />
  </DesktopCapabilitiesProvider></StoreProvider>,
);
