// scrml:data/form-for — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/data/form-for.scrml, so a subpath import
// `import { registerLabels } from 'scrml:data/form-for'` resolves at run time (SPEC §41.4).
// The implementation lives once, in the `scrml:data` shim; this file re-exports it.
//
// Surface (must match stdlib/data/form-for.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js).

export {
  registerLabels,
  formFor,
} from "../data.js";
