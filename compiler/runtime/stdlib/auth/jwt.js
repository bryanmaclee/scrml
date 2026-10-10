// scrml:auth/jwt — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/auth/jwt.scrml, so a subpath import
// `import { signJwt } from 'scrml:auth/jwt'` resolves at run time (SPEC §41.4
// names `scrml:<module>/<sub>` specifiers). The functions are implemented once,
// in the `scrml:auth` shim; this file re-exports them and declares the module's
// own error enum.
//
// Surface (must match stdlib/auth/jwt.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js):
//   - JwtError                         — variant constructor object (mirrors enum)
//   - signJwt / verifyJwt / decodeJwt / verifyJwtJwks — see ../auth.js

export { signJwt, verifyJwt, decodeJwt, verifyJwtJwks } from "../auth.js";

// JwtError — mirrors `export type JwtError:enum = { DecodeFailed(message: string) }`
// in the compiler's enum shape (payload variant → { variant, data }).
export const JwtError = Object.freeze({
  DecodeFailed: function(message) {
    return { variant: "DecodeFailed", data: { message } };
  },
  variants: ["DecodeFailed"],
});
