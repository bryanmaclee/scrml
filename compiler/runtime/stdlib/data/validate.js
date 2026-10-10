// scrml:data/validate — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/data/validate.scrml, so a subpath import
// `import { validate } from 'scrml:data/validate'` resolves at run time (SPEC §41.4).
// The implementation lives once, in the `scrml:data` shim; this file re-exports it.
//
// Surface (must match stdlib/data/validate.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js).

export {
  Rule,
  validate,
  isValid,
  firstError,
  emailField,
  passwordField,
  passwordConfirmField,
} from "../data.js";
