import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serverLocalePlugin } from "./server-locale-plugin.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// yaml's Node export is CommonJS with dynamic requires that cannot run once
// inlined into ESM; its browser export is the same parser without them.
const yamlEsmPlugin = {
  name: "yaml-esm",
  setup(build) {
    build.onResolve({ filter: /^yaml$/ }, () => ({
      path: join(root, "node_modules", "yaml", "browser", "index.js"),
    }));
  },
};

// ws is CommonJS and requires Node's own modules, which an ESM bundle reaches
// only through a require of its own (esbuild otherwise throws "Dynamic require
// of "events" is not supported" when it loads).
const NODE_REQUIRE = {
  js: 'import { createRequire as __duskCreateRequire } from "node:module";\nconst require = __duskCreateRequire(import.meta.url);',
};

/** What every server bundle is built with. */
export const SERVER_BUNDLE = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Function names stay in stack traces. Node prints a whole source line with an uncaught error, so no line may be long.
  minifyWhitespace: true,
  minifySyntax: true,
  lineLimit: 500,
  plugins: [yamlEsmPlugin, serverLocalePlugin],
  banner: NODE_REQUIRE,
};

/** The harness (server/index.ts): each `import()` it makes becomes a file of its own, loaded the first time it runs,
 * so a start reads and compiles only what starting needs. Chunks sit beside index.js, so a module that finds a
 * sibling through import.meta.url finds the same folder from a chunk. */
export const HARNESS_SPLIT = {
  splitting: true,
  chunkNames: "index-chunk-[name]-[hash]",
};

/** Harness chunks that are a CommonJS package's bare default export: an `import()` of such a package destructures
 * nothing from it once split, so a build that makes one fails. */
export function commonJsDefaultChunks(metafile) {
  return Object.entries(metafile.outputs)
    .filter(([file, output]) => file.includes("index-chunk-") && output.exports.length === 1 && output.exports[0] === "default"
      && output.entryPoint !== undefined && metafile.inputs[output.entryPoint]?.format === "cjs")
    .map(([file]) => file);
}
