import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ChatNotice } from "../../src/components/ChatErrorBanner";
import { ModelCard } from "../../src/components/bot-panel/DetailsTab";
import { DesktopCapabilitiesProvider } from "../../src/components/DesktopCapabilities";
import { setEmailGateDone } from "../../src/lib/analytics";
import { applySkin, type SkinId } from "../../src/lib/skins";
import { StoreProvider, useStore } from "../../src/state/store";
import "../../src/styles.css";
import "../../src/styles/overlays.css";

// Served only by scripts/verify-backup-row.ts: the bot's Model card with its Backup model row, and the note a send with
// no AI connected gets. ?view=row|note, ?skin=.
const params = new URLSearchParams(location.search);
setEmailGateDone("skipped");
applySkin((params.get("skin") ?? "daylight") as SkinId);

function Preview() {
  const { state, dispatch, refreshInstances } = useStore();
  useEffect(() => { void refreshInstances().catch(() => {}); }, [refreshInstances]);
  const bot = state.bots[0];
  if (!bot) return null;
  return (
    <main className={`m-6 flex flex-col gap-6 rounded-2xl bg-panel p-4 ${params.get("view") === "note" ? "w-[600px]" : "w-[380px]"}`} data-preview-ready="">
      {params.get("view") === "note"
        ? <div><ChatNotice notice={{ kind: "note", botName: null, text: "Connect an AI first, so bots can answer.", connect: true }} /></div>
        : <ModelCard bot={bot} patch={(patch) => dispatch({ type: "updateBot", botId: bot.id, patch })} />}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<StoreProvider><DesktopCapabilitiesProvider><Preview /></DesktopCapabilitiesProvider></StoreProvider>);
