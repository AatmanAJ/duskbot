import { perfProbe } from "./perf-hook";
import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { setEmailGateDone } from "../../src/lib/analytics";
import { GROK_MOVE_NOTICE } from "../../src/lib/notices";
import { applySkinChoice, readSkinChoice } from "../../src/lib/skins";
import { applyChatWidth, readChatWidth } from "../../src/lib/chat-width";
import { applyFont, readFont } from "../../src/lib/fonts";
import { rememberConversation } from "../../src/lib/last-conversation";
import "../../src/styles.css";
import "../../src/styles/overlays.css";
import "../../src/styles/motion.css";

// Served only by scripts/testing/transcript-perf.ts against a disposable fixture.
setEmailGateDone("skipped");
localStorage.setItem(GROK_MOVE_NOTICE, "1");
const open = new URLSearchParams(location.search).get("open");
if (open) rememberConversation(open);
applySkinChoice(readSkinChoice());
applyFont(readFont());
applyChatWidth(readChatWidth());
createRoot(document.getElementById("root")!).render(
  <Profiler id="app" onRender={perfProbe.onRender}>
    <App />
  </Profiler>,
);
