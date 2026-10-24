// Shapes that LOG IN ON A WRONG PASSWORD on this branch today. Each entry names the open gap it is owed to.
//
// The pack is green with these failing and goes RED when:
//   - a shape NOT listed here logs in on a wrong password (a new hole), or
//   - a listed shape stops doing so (it was fixed: delete its entry; if the gap has no listed
//     shapes left, the gap's own status is the PA's to change).
//
// Refresh with `bun compiler/tests/integration/security-failable-pack/classify.js` — never by
// hand-editing to make the suite pass.
//
// Measured S468 fix round 1 (branch s468-failable-alias-and-match): 24 shapes. For comparison, the
// same 188 shapes on base 5c43c3b8e: 63 FAIL; on the frozen review head 7ecae57eb: 47 FAIL.
// S469 (fix round 1, agent 2): 21 of 226 — the HANDLER and SERVER_STMT entries were fixed (deleted;
// families n11 / n12 added), only the VALUE class (ruling owed) remained.
// S469 fix round 2: 0 of 260.

// S469 fix round 2: EMPTY. The 21 VALUE shapes (`g-failable-function-used-as-value-unchecked-s468`) are
// refused by construction — bryan RULED F4 (ruling:user-voice-scrml.md S469 "Split + audit"): the
// language lets a failable function be used as a value; impl#1 refuses every read of one outside
// callee position except a `const` alias by name (E-IMPL1-FAILABLE-FN-VALUE, an impl#1 limitation,
// carried as `g-impl1-failable-fn-value-refused-s469`).
export const KNOWN_FAIL = {
  // S469 s469-lift-gate-staleness: EMPTY again. The 36 n23 entries of round 5 (a cell read inside a called
  // function; the value-indexed row side; a body local in a keyed row) owed to
  // g-lift-gate-placement-inherits-main-staleness-s469 are fixed: a lifted gate re-evaluates by re-running the
  // code that produced what it reads, under the runtime's read tracking (emit-lift.js emitLiftGate).
};

// Shapes this instrument CANNOT judge: client pages with no #wrong button (a client function calling
// a SERVER `check`; the decision needs the server half run). Listed so the hole is named.
export const UNJUDGED = {
  "n6/cli->srv expr direct": "no #wrong button: client -> server call, needs the server half",
  "n6/cli->srv stmt direct": "no #wrong button: client -> server call, needs the server half",
};

// Shapes whose OWN logic logs in on the wrong password (the reviewer wrote them to probe acceptance,
// not the floor): `p != "" || check(p)` is truthy before `check` runs; `!(match …)` inverts; an
// `.Ok(v)` arm on `p == "wrong" || …` binds `true`. Today each is refused (E-ERROR-002); a compiler that
// correctly ACCEPTS one would show it LOGGED IN, which is right, so the floor is not asserted for them.
export const BY_DESIGN_LOGS_IN = {
  "n2/expr || truthy left": "`p != \"\" || check(p)` is true for any non-empty password",
  "n2/expr ! not": "`!(match …)` inverts the verdict",
  "n2/expr Ok binds left value": "`.Ok(v)` on `p == \"wrong\" || check(p)` binds `true` for \"wrong\"",
};
