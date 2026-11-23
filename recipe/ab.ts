import { readFileSync } from "node:fs";
const ui = await import(process.cwd() + "/scripts/testing/control-dusk-ui.ts");
const h = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const env = ui.sessionEnv({ home: h.home, session: h.session, chrome: h.chrome }, process.env);
console.log(await ui.agentBrowser(h.binary, env, process.argv.slice(3), 60_000));
