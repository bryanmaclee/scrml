# progress — s462-p0-unawaited-async-stdlib

- [x] merge origin/main (already at d6820a607), bun install, pretest
- [x] S2 async mismatches .scrml vs shim + parity test §6 — commit 9c447e964
      (verifyJwtJwks, resetPassword, hmac, requestMagicLink,
      requestEmailVerification, requestPasswordReset, sleep)
- [x] S1 aliased import await — `importedNames` on the callee map +
      `isPromiseReturningImportedCallee` at all 14 classifier sites
- [x] S1 audit of other local-name consumers; re-exports
      (`inheritStdlibReExports`, `stdlibOrigin`, false E-IMPORT-004 on a chain
      through a stdlib re-export, renamed type/fn re-export chase)
- [x] e2e repro tests (integration/s462-p0-unawaited-async-stdlib: base 7 fail,
      head 9 pass) + unit/s462-stdlib-facts-by-imported-name
- [ ] gates + corpus differential

Deferred (surfaced, not fixed here):
- a local `.scrml` that only re-exports stdlib names emits no server-side
  re-export (W-SERVER-IMPORT-UNEMITTED; the importer's server bundle fails to
  link — fails closed). Pre-existing on base.
- a helper function referenced as a VALUE (not called) from a server function
  is not emitted into the server bundle (ReferenceError at run time).
- `if (verifyJwtJwks(t, url))` tests the result OBJECT, which is truthy even
  when awaited — the brief's repro shape is an API misuse, not fixed by await.
