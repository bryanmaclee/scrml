// scrml:data/messages — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/data/messages.scrml, so a subpath import
// `import { registerMessages } from 'scrml:data/messages'` resolves at run time (SPEC §41.4).
// The implementation lives once, in the `scrml:data` shim; this file re-exports it.
//
// Surface (must match stdlib/data/messages.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js).

export {
  registerMessages,
  messageFor,
} from "../data.js";
