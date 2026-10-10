// scrml:data/schema-for — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/data/schema-for.scrml, so a subpath import
// `import { schemaFor } from 'scrml:data/schema-for'` resolves at run time (SPEC §41.4).
// The implementation lives once, in the `scrml:data` shim; this file re-exports it.
//
// Surface (must match stdlib/data/schema-for.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js).

export {
  schemaFor,
} from "../data.js";
