// The surfaces gallery: the real app against the disposable fixture server, with its store's dispatch handed to the
// run (window.__surfaceGallery), so each settings page, bot panel tab, dialog and sheet can be opened in turn and
// checked by chat-gallery/layout-audit.ts. ?onboarding=<step> opens the first-run flow at that step instead.
// Served only by scripts/testing/surface-gallery.e2e.test.ts.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConnectAiDialog } from "../../src/components/onboarding/ConnectAi";
import { Toast } from "../../src/components/ui/Toast";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { setEmailGateDone } from "../../src/lib/analytics";
import { GROK_MOVE_NOTICE } from "../../src/lib/notices";
import { applySkin, SKINS } from "../../src/lib/skins";
import { saveWelcomeDraft } from "../../src/lib/welcome-draft";
import { BEAT_ORDER, type BeatId } from "../../src/lib/onboarding";
import { useStore } from "../../src/state/store";
import { CloudReady } from "../../src/components/CloudSetup";
import { useSidebarFooterSlot } from "../../src/lib/sidebar-footer-slot";
import { auditLayout } from "./chat-gallery/layout-audit";
import "../../src/styles.css";
import "../../src/styles/overlays.css";
import "../../src/styles/motion.css";

const params = new URLSearchParams(location.search);
const step = params.get("onboarding");
if (step && (BEAT_ORDER as readonly string[]).includes(step)) saveWelcomeDraft({ beat: step as BeatId });
else setEmailGateDone("skipped");
localStorage.setItem(GROK_MOVE_NOTICE, "1");
applySkin(SKINS.find((one) => one.id === params.get("skin"))?.id ?? "grok");

function Probe() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    Object.assign(window, { __surfaceGallery: { dispatch, botId: state.bots.find((bot) => bot.name === "Pepper")?.id ?? state.bots[0]?.id, ready: state.bots.length > 0 } });
  }, [dispatch, state.bots]);
  return null;
}

// ?card=cloud-ready: the cloud-ready card in the sidebar footer, as a new dusk cloud shows it.
// ?card=connect-ai: Connect an AI opened from inside the chat's composer dock, where the no-AI card opens it, so the
// gallery's cover check sees whether its scrim escapes the dock's stacking context and covers the whole window
function Cards() {
  const slot = useSidebarFooterSlot();
  const [dock, setDock] = useState<Element | null>(null);
  useEffect(() => {
    if (params.get("card") !== "connect-ai") return;
    const timer = setInterval(() => { const found = document.querySelector("[data-grok-inset]"); if (found) { setDock(found); clearInterval(timer); } }, 100);
    return () => clearInterval(timer);
  }, []);
  if (params.get("card") === "cloud-ready") return <CloudReady slot={slot} onDone={() => undefined} />;
  // ?card=toast-done / toast-error: a passing toast, held on screen
  if (params.get("card") === "toast-done") return <Toast text="Pepper is ready to use" action={{ label: "Undo", onClick: () => undefined }} timeoutMs={600_000} onDone={() => undefined} />;
  if (params.get("card") === "toast-error") return <Toast tone="error" text="Couldn't save Pepper's name. Try again." timeoutMs={600_000} onDone={() => undefined} />;
  if (params.get("card") === "connect-ai" && dock) return createPortal(<ConnectAiDialog tested={null} onClose={() => undefined} />, dock);
  return null;
}

Object.assign(window, { __galleryAudit: auditLayout });
createRoot(document.getElementById("root")!).render(<App><Probe /><Cards /></App>);
