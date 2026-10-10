// scrml:store/kv — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/store/kv.scrml, so a subpath import
// `import { createStore } from 'scrml:store/kv'` resolves at run time
// (SPEC §41.4). The functions are implemented once, in the `scrml:store` shim;
// this file re-exports them and declares the module's own error enum.
//
// Surface (must match stdlib/store/kv.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js):
//   - KvError                          — variant constructor object (mirrors enum)
//   - createStore / createSessionStore / createCounter — see ../store.js

export { createStore, createSessionStore, createCounter } from "../store.js";

// KvError — mirrors `export type KvError:enum = { ParseFailed(message: string) }`
// in the compiler's enum shape (payload variant → { variant, data }).
export const KvError = Object.freeze({
  ParseFailed: function(message) {
    return { variant: "ParseFailed", data: { message } };
  },
  variants: ["ParseFailed"],
});
