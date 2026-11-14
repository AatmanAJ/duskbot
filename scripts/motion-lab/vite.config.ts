import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// the motion lab: a review site for motion variants, never shipped. `node scripts/motion-lab/serve.mjs`
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const port = Number(process.env.MOTION_LAB_PORT) || 7650;

export default defineConfig({
  root: here("."),
  publicDir: false,
  // its own cache inside this checkout: worktrees share node_modules, and a shared vite cache breaks the other runs
  cacheDir: here("./.vite-cache"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": here("../../src"), "@lab": here("./lib") } },
  define: { __APP_VERSION__: JSON.stringify("motion-lab"), __DUSK_SITE_URL__: JSON.stringify("https://dusk.bot") },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: { protocol: "ws", host: "127.0.0.1", clientPort: port },
    // a worktree links node_modules from another checkout; its fonts must still be served
    fs: { allow: [here("../.."), realpathSync(here("../../node_modules"))] },
  },
});
