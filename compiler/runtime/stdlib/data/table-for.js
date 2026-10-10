// scrml:data/table-for — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/data/table-for.scrml, so a subpath import
// `import { tableFor } from 'scrml:data/table-for'` resolves at run time (SPEC §41.4).
// The implementation lives once, in the `scrml:data` shim; this file re-exports it.
//
// Surface (must match stdlib/data/table-for.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js).
//
// `TableSort` (a :struct type) has no run-time value; a server import of it is
// pruned by usage at emit time, like any erased type import.

export {
  tableFor,
} from "../data.js";
