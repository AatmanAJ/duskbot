import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// the settings lab: six takes on the Settings panel, never shipped. `node scripts/settings-lab/serve.mjs`
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const port = Number(process.env.SETTINGS_LAB_PORT) || 6440;

export default defineConfig({
  root: here("."),
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": here("../../src"), "@lab": here("./lib"), "@kit": here("./kit") } },
  define: { __APP_VERSION__: JSON.stringify("1.42.0"), __DUSK_SITE_URL__: JSON.stringify("https://dusk.bot") },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: { protocol: "ws", host: "127.0.0.1", clientPort: port },
    // a worktree links node_modules from another checkout; its fonts must still be served
    fs: { allow: [here("../.."), realpathSync(here("../../node_modules"))] },
  },
});
