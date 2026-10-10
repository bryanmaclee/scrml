// scrml:auth/password — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/auth/password.scrml, so a subpath
// import `import { hashPassword } from 'scrml:auth/password'` resolves at run
// time (SPEC §41.4). The functions are implemented once, in the `scrml:auth`
// shim; this file re-exports them and declares the module's own error enum.
//
// Surface (must match stdlib/auth/password.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js):
//   - PasswordError                    — variant constructor object (mirrors enum)
//   - hashPassword / verifyPassword / generatePassword — see ../auth.js

export { hashPassword, verifyPassword, generatePassword } from "../auth.js";

// PasswordError — mirrors `export type PasswordError:enum = { VerifyFailed(reason: string) }`
// in the compiler's enum shape (payload variant → { variant, data }).
export const PasswordError = Object.freeze({
  VerifyFailed: function(reason) {
    return { variant: "VerifyFailed", data: { reason } };
  },
  variants: ["VerifyFailed"],
});
