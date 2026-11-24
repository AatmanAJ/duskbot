// usage: REPO=<checkout> node --experimental-strip-types ab.ts <ui.json> <agent-browser args...>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const { sessionEnv } = await import(`${process.env.REPO}/scripts/testing/control-dusk-ui.ts`);
const [handlePath, ...args] = process.argv.slice(2);
const handle = JSON.parse(readFileSync(handlePath!, "utf8"));
process.stdout.write(execFileSync(handle.binary, args, { env: sessionEnv(handle) }));
