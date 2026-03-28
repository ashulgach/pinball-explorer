/**
 * Prevent Emscripten (used by ext2fs WASM) from detecting a Node.js environment.
 *
 * vite-plugin-node-polyfills injects a `process` global with `versions.node` set,
 * which makes Emscripten's environment detection (`ENVIRONMENT_IS_NODE`) return true.
 * When that happens, the WASM wrapper tries to use `fs.readFileSync` and `__dirname`
 * — both of which are shimmed to empty in the browser — causing a silent hang
 * during `ext2fs.mount()`.
 *
 * This module MUST be imported before ext2fs so it runs before the WASM init.
 */
if (typeof globalThis.process !== 'undefined' && globalThis.process.versions) {
  delete globalThis.process.versions.node;
}
