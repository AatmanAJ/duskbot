// esbuild 0.28 gives an import() of a CommonJS package, split into a chunk of its own, only a default export. Imported
// here, statically, undici keeps its named exports in the bundle; callers import() this module instead.
export { Agent, fetch } from "undici";
