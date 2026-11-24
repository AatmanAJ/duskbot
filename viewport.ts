// Sets a control-dusk ui fixture's window to W×H points at 2x, dark, reduced motion. Usage: viewport.ts REPO UI_HANDLE [W] [H]
import { readFileSync } from "node:fs";
const [repo, handlePath, w = "1280", h = "800"] = process.argv.slice(2);
const { agentBrowser, sessionEnv } = await import(`${repo}/scripts/testing/control-dusk-ui.ts`);
const handle = JSON.parse(readFileSync(handlePath, "utf8"));
await agentBrowser(handle.binary, sessionEnv(handle), ["set", "viewport", w, h, "2"]);
await agentBrowser(handle.binary, sessionEnv(handle), ["set", "media", "dark", "reduced-motion"]);
console.log("ok");
