// scrml:data/parse — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/data/parse.scrml, so a subpath import
// `import { ParseError } from 'scrml:data/parse'` resolves at run time (SPEC §41.4).
// The implementation lives once, in the `scrml:data` shim; this file re-exports it.
//
// Surface (must match stdlib/data/parse.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js).

export {
  ParseError,
  parseVariant,
} from "../data.js";
