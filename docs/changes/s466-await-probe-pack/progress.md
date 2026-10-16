# s466-await-probe-pack — progress

Dispatch: dpa-023 phase 1a (S466 "lets move the dpa up"). Base: origin/main `7c8e8f99a`.
No compiler source touched. Branch = test data + runner + notes.

## Steps

- [x] Startup verification: worktree clean, merge-base == origin/main `7c8e8f99a`. `bun install` + `bun run pretest` OK.
- [x] Read: primary.map.md (header + Task-Shape/test rows), `conformance/README.md` (full), D3 SCOPE.md, dpa-023 DD (Context, Q5).
- [x] Shapes copied verbatim (30 families, 424 shapes) -> `compiler/tests/integration/security-await-pack/shapes/`.
      The r8 copies of `probes/`, `probes2/`, `probes3/` are byte-identical to the r5/r6/r7 originals (checked).
      Two shape NAMES repeat across families (`libBindNotNot` n7+m3, `libFnDeclIf` n7+n8), so ids are `<family>/<shape>`.
- [x] `pack.js` (harness), `classify.js` (table CLI), `known-fail.js`, `await-probe-pack.test.js`, `README.md`.
- [x] Classification on main (below). Mutation check both directions (below).
- [ ] Gates (below).

## Home decision: (2) impl#1 integration suite, conformance extension proposed

`conformance/` CAN run real server handlers (`serverDb` + `sqlEngine: "real"`, RATIFIED S236), so the
reviewers' shapes are closer to expressible there than the brief assumed. They still do not fit the
contract as it stands, for four reasons, each a contract change:

1. **The verdict is a disjunction.** The floor is "refused at compile time OR, at run time, a wrong
   password is never WELCOMEd". 133 of 424 shapes refuse on main, with 22 distinct code sets, some of
   them impl#1 defects (`E-CODEGEN-INVALID-LOGIC` ×10, `E-SCOPE-001`, `E-MU-001`). `expect` is
   conjunctive: a case would have to pin either impl#1's refusal codes (baking impl#1 defects into the
   language contract) or a runtime result (red on every refusing shape). The bootstrap may legitimately
   accept a shape impl#1 refuses, and vice versa.
2. **"Not WELCOME" is a negative runtime assertion.** `state` is a superset check for equality; there
   is no "this cell never holds X". The 500 / deny-all classes are fail-closed but have no exact value.
3. **The known-fails are an OPEN security gap, not a carried one.** `xfail` requires a
   `status=carried` gap (S430 P7); `g-imported-async-server-fn-not-awaited-s465` is `status=open`
   (security, fixed for cause). Marking it carried would misstate the ledger.
4. **The server route is the judged unit.** Going through the client adds the client await
   machinery as a second variable (correct for the UNJUDGED shape, noise for the other 423).

So the pack lands in `compiler/tests/integration/security-await-pack/` (on the existing gate), and the
extension below is for the owner.

## Design note — proposed conformance extension (owner's call: §62.2 contract change)

**One line:** add an impl-neutral `serverCall` effect (call a server fn by SOURCE name with args against
the `serverDb` seed, assert on the result) plus a `failClosed` outcome (`refused` with any `E-` code OR
the runtime assertion holds), and allow an `xfail` against an OPEN security gap.

```jsonc
{
  "id": "await-m5-libExportCurried",
  "spec": "§13.2", "rationale": "an async call reached through a curried export is awaited on the server",
  "expect": {
    "serverDb": { "users": [{ "id": 1, "name": "bob", "pw": "$argon2id$v=19$m=1024,t=1,p=1$…" }] },
    "sqlEngine": "real",
    "serverCall": [                                  // NEW: keyed by the SOURCE fn name, like serverStub
      { "fn": "f", "args": ["bob", "wrong-password"], "notResult": "WELCOME" },   // the floor
      { "fn": "f", "args": ["bob", "right-password"], "result": "WELCOME" }       // correctness
    ],
    "failClosed": {                                  // NEW: the disjunction
      "refused": "any-error",                        //   a compile with any E- code satisfies the case …
      "floor": [0]                                   //   … otherwise serverCall[0] MUST hold; [1] is checked
    }                                                //   only when the floor holds and the compile succeeded
  },
  "xfail": { "impl1-ts": { "gap": "g-imported-async-server-fn-not-awaited-s465", "open": true, "fails": { … } } }
}
```

- `serverCall` is impl-neutral the same way `serverStub` is: the source fn name, never a route. impl#1's
  adapter maps `f` -> `__ri_route_f_<n>`; a thrown handler / non-2xx reports as a failed call, which
  satisfies `notResult`.
- `failClosed.refused` values: `"any-error"` or a code list. `"any-error"` is what this pack needs; a code
  list is for shapes where the SPEC names the refusal (§13.2 `E-ASYNC-*`, §13.7 `E-VALUE-SERVER-CALL`).
- `xfail.open: true` would be legal only for a `sev=HIGH` gap with `status=open` and would require the
  gap to list the case ids, so it cannot become a second carried-gap channel.
- Cost: 424 cases through the adapter's server-eval path (no client DOM for `serverCall`-only cases).
  Not measured. The impl#1 pack here runs in ~40 s.
- The UNJUDGED shape (`s12/nestedServerCall`) is judged by the EXISTING verbs: two buttons, `serverDb`,
  `state` on two cells. It needs only `failClosed` and a `notState`, not `serverCall`.

## Classification on main `7c8e8f99a`

`PASS=250  PASS-REFUSED=133  PASS-500=20  PASS-DENY=10  UNJUDGED=1  FAIL=10  total=424` (classify.js, 39.7 s)

KNOWN-FAIL (wrong password accepted; all `g-imported-async-server-fn-not-awaited-s465`):
m2/topBindingAwaitedInBinding · m3/bindNotBinding · m3/libBindChainNot · m4/appExportConstAnn ·
m4/libExportConstAnnInner · m5/bindCallsLetBinding · m5/libExportTernaryFn · m5/libExportImportedValue ·
m5/libExportBindingOfBinding · m5/libExportCurried

**Record correction:** the DD says 9 FAIL on main. It is 10. `m2/topBindingAwaitedInBinding` accepts a
wrong password on main; the reviewers' own r7 BASE and r8 BASE logs show the same
(`~/.cache/scrml-review-await-r8/base-all.txt`). The r8 BR log shows it fixed on the r8 branch.

UNJUDGED: `s12/nestedServerCall` (`f` is a client fn; the decision runs in the client bundle).

PASS-DENY (fail closed, right password also refused): s10/topParamDefault, pa-verify/med1Regex (by design:
`isCode("bob")` is false), n1/paramDefaultTopFn, m1/topLetAssignLater, m6/voImports{ClientFnLib,PureFnLib,
ConstLib,Host,Alias}, m7/voUsesEnumFromTypeLib (the m6/m7 right-password call throws `ReferenceError`).

PASS-500 (20): server bundle fails to load (4: missing `./lib.server.js` / `./lib2.server.js`, missing export)
or the handler throws `ReferenceError` / `SQLiteError: no such table` (16). These are impl#1 defects that
happen to fail closed; not this pack's to fix.

## Verification

- Mutation check: moved `m5/libExportCurried` out of KNOWN_FAIL and put `m5/libExportParen` in. Both went red:
  `WRONG PASSWORD ACCEPTED — m5/libExportCurried: FAIL …` and `m5/libExportParen: PASS` vs expected FAIL.
  Restored.
- Determinism: the classify run and the test run agree shape-for-shape (same 10 FAIL, 1 UNJUDGED).
- Runtime: `bun test compiler/tests/integration/security-await-pack/` -> 427 pass, 0 fail, 38.6 s. Under the
  2-minute target, so it stays in the pre-commit `integration` set / CI `gate`.
- Pinned argon2id hash: default cost measured 108 ms/verify (~90 s for the pack); pinned m=1024,t=1 at 0.75 ms.
  The test checks the pin against `scrml:auth`'s `verifyPassword` first.

## Gates

- New suite on main: `bun test compiler/tests/integration/security-await-pack/` -> 427 pass / 0 fail, 38.6 s.
- Pre-commit hook (unit + integration + conformance + root `*.test.js`, `--bail`) at `663de0985`:
  `✓ Pre-commit checks passed.` (took ~21 min wall under 4 concurrent full suites on the box).
- `bun scripts/facts.ts --check`: STALE after the new test file (test files 1,739 -> 1,740); regenerated
  with `--write`, then `--check` exit 0.
- `bun scripts/state.ts --check`: exit 0, `PASS — all @generated sections current` (WARN-only, pre-existing:
  maps 87 behind; known-gaps heading/marker drift 72).
- [x] Gates done.

## Deferred / for the PA

- **Record correction for the DD:** 10 FAIL on main, not 9 (`m2/topBindingAwaitedInBinding`).
- **UNJUDGED `s12/nestedServerCall`:** a client-side wrong-password decision this instrument cannot see.
  Not measured whether the client bundle awaits `inner(...)` (§13.7 is Nominal on impl#1, so it may well
  WELCOME a wrong password client-side). Judging it needs the conformance `serverDb` run.
- **The r8 branch should refresh `known-fail.js`** when it lands (`classify.js` gives the table). The DD
  says r8 regresses `m5/libExportParen`; this pack would catch that as a new FAIL.
- **Conformance extension** (design note above) is the owner's call.
