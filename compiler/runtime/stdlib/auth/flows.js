// scrml:auth/flows — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/auth/flows.scrml, so a subpath import
// `import { requestMagicLink } from 'scrml:auth/flows'` resolves at run time
// (SPEC §41.4). The functions are implemented once, in the `scrml:auth` shim.
//
// Surface (must match stdlib/auth/flows.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js).

export {
  requestMagicLink,
  verifyMagicLink,
  requestEmailVerification,
  verifyEmail,
  requestPasswordReset,
  verifyResetToken,
  resetPassword,
} from "../auth.js";
