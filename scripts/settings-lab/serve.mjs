#!/usr/bin/env node
// starts the settings lab: node scripts/settings-lab/serve.mjs [--port 6440]
// vite gets its own cache dir here (the cli has no flag for it): worktrees share node_modules, and a shared cache
// breaks the other checkouts' dev servers
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const at = process.argv.indexOf("--port");
if (at > 0) process.env.SETTINGS_LAB_PORT = process.argv[at + 1];
const server = await createServer({
  configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
  cacheDir: fileURLToPath(new URL("./.vite-cache", import.meta.url)),
});
await server.listen();
server.printUrls();
