#!/usr/bin/env node
// starts the motion lab: node scripts/motion-lab/serve.mjs [--port 7650]
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const at = process.argv.indexOf("--port");
if (at > 0) process.env.MOTION_LAB_PORT = process.argv[at + 1];
const server = await createServer({ configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)) });
await server.listen();
server.printUrls();
