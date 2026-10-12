// md-reader.js — the compiler's entry to the ONE md reader (SPEC §67.8, ruling S462 F4).
//
// Re-exports the GENERATED shim `compiler/runtime/stdlib/md.js` (impl#1's library-mode compile of
// `stdlib/md/index.scrml`, written by scripts/gen-md-shim.ts). It adds nothing: it exists so the
// TypeScript side (md-lower.ts) reads the reader through typed declarations (md-reader.d.ts)
// without a hand-written declaration file inside the generated runtime directory.
export { parseSlots, dedent, headingSlugs, MdBlock, MdInline } from "../runtime/stdlib/md.js";
