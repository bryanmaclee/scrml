# WORK ORDER — derived-transitive fix round 6 (re-derived S346 from the r5 review journal)

Source: the S239 r5 review workflow `wf_2ae3fd27-833` (5 finder lenses, 5/5 completed; every
finding independently verified by 2-3 refuter agents, ALL CONFIRMED, 0 refuted, 0 unverified).
Frozen review target: `review/derived-transitive-r5` = `bf99a93a` (branch `dtr-r5`).
The `/tmp` output the S345 hand-off pointed at is gone; this file IS the work order now.
Line numbers below are AS OF `bf99a93a` — re-locate before editing.

## BLOCKERS (must fix in round 6)

### B1 — HIGH — a hop caller's PARAMETER DEFAULT is never scanned (transitive limb SILENT MISS)
- locus (verified by 3 refuters): `compiler/src/route-inference.ts:4164-4166` sets
  `body = callerRecord.fnNode.body`; `:4186 scanForServerOnlyBindingRefs(body, live, "structural", true)`.
  `fnNode.params` is a SIBLING of `body` and is never handed to the scanner.
  SECOND independent reason (refuter a4b1ed7e5dd50072a): even where a nested `function-decl` IS
  reachable from the scan root, `ast-builder.js:10785/10806` stores `params[i].defaultValue` as a
  RAW SOURCE STRING, so the structural walker cannot see references inside it.
- repro (executed by refuter acd2ad468074fd201 on `bf99a93a`, unmutated):
  ```scrml
  <program>
  ${
    import { hashPassword } from 'scrml:auth'
    <pw> = "secret"
    function doHash(p) { return hashPassword(p) }
    function wrap(x = doHash(@pw)) { return x }
    const <computed> = wrap()
  }
  <div id="out">${@computed}</div>
  </program>
  ```
  → EXIT 0, no error-severity diagnostic, `_scrml_wrap_N` becomes `async` in the client bundle, the
  derived recompute binds the async stub, `[object Promise]` is rendered. Rounds 1-5 all missed it.
- fix direction: the scan root for hop-edge construction MUST include every parameter default
  expression (parsed structurally, not raw). Both reasons above must be closed — offering `params`
  to the scanner is not enough while `defaultValue` is a raw string.
- pin: an executed-artifact test (the round-4 pattern) that compiles the shape above and asserts the
  refusal `E-DERIVED-SERVER-ONLY-REACH` fires, PLUS a CONTROL (default with no server reach) that
  asserts `errorCodes` EQUALS `[]` (see B4).

### B2 — HIGH — the transitive-limb "codegen-agreement" universal is FALSE (4 sites)
- sites: `compiler/SPEC.md:3742` ("This is the interim under which route inference and codegen agree:
  codegen renames **every** reference to a server-placed function to its `async` fetch stub …");
  `compiler/SPEC.md:19574` ("Firing on every reference is the loud interim under which route inference
  and codegen agree"); `compiler/src/route-inference.ts:3850` ("the only semantics under which RI and
  codegen AGREE on this limb: codegen renames EVERY reference …"); the unit test
  `compiler/tests/unit/route-inference-derived-server-only-reach.test.js` (grep `agree`).
- why false (verified by 3 refuters, by execution): the `post-fn-name-mangle` regex at
  `compiler/src/codegen/emit-client.ts:2980-2983` carries the lookahead `(?=\s*[(;,}\]\n)]|$)` — a
  name in OPERATOR position (`doHash + 1`, `doHash * 2`) is renamed NOWHERE. Route inference refuses
  a program that codegen compiles correctly and synchronously. **RI is a strict SUPERSET of codegen's
  rewrite set, never equal to it.**
- fix direction — **THE STANDING CONSTRAINT (bryan, S345):** write ONLY the one-directional
  CONTAINMENT claim — *"every shape codegen would rewrite is refused at compile time"* — at all four
  sites. NEVER an equality / agreement claim, in any wording, on any limb. Three rounds have each
  re-minted this class (r3 "already refused via 5b" · r4 "suppression and emission agree" · r5
  "renames EVERY reference"). If you find yourself writing "agree", "the same set", "exactly when",
  or "every reference" — stop and write the containment.

### B3 — MED — SPEC.md:3304 (§6.6 error-code catalog row) is a MISSED round-5 site
- the row is arc-AUTHORED (arc diff `@@ -3304 +3304 @@`) and round-5-UNTOUCHED (byte-identical to
  `4b3f36f0`). Three defects: (a) it cites "round-4 shadow semantics S345" — the exact citation
  `SPEC.md:3700` now normatively FORBIDS ("carry no operator ruling and SHALL NOT be cited to one");
  the SPEC violates its own SHALL in the same delta; (b) it says "four residuals" — there are five
  after round 5; (c) it omits the round-5 over-fire (transitive limb suppresses on nothing).
- fix: propagate the mandate-4 provenance fix + the residual count + the over-fire to this row.
  Then `git grep -n 'round-4 shadow semantics'` and `git grep -n 'S345'` across SPEC.md + src +
  tests — every remaining S345 citation must be for something bryan ACTUALLY ruled (Q1: F3 rewrite
  is descriptive-not-ratified; Q2 filings; Q3 zero-byte objects; nothing about shadow semantics).

### B4 — LOW — the `hop-param` CONTROL is named "clean" but never asserts clean
- `compiler/tests/conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js:530-542`: the ONLY
  diagnostic assertion is `:533 expect(c.errorCodes).not.toContain(CODE)`; every sibling control in
  the same file asserts `expect(c.errorCodes).toEqual([])` (`:281`, `:547`, `:570`). Because a
  REFUSED compile still writes the full artifact set (this file's own §1/§5 pins), the three artifact
  regexes at `:536-538` keep matching after a refusal — the control stays green while its own
  subject program is refused by some other code. Verified by execution (two source mutations, both
  left the control green while refusing the program).
- fix: `toEqual([])`, matching the siblings. Apply the same to the new B1 control.

### B5 — MED — test comment `:462-464` re-mints the over-claim class
- `conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js:462-464` (round-5-ADDED): "The exemption was
  the one place the round-4 semantics still disagreed with emission." False on both limbs (limb (b)
  §11m residuals still compile at exit 0 with an async stub bound; limb (a) §7 comment records
  exit 0 / no `.server.js` / argon2id loaded). Confirmed by 2 refuters with fresh counterexamples.
- fix: scope the sentence to what it means ("the one place the round-4 SHADOW discipline …") or
  delete it. One scoping word.

### B6 — MED — new DIRECT-limb residual (`SPEC.md:3729`) contradicts the Provenance at `:3698`
- `:3729` asserts the S331 symptom artifact set is still produced and "§6.6.19 closes none of it";
  `:3698` (pre-arc provenance) says "This subsection closes the identical symptom". Both cannot be
  true as written. Refuter a55145e28959d931f verified by execution on a DIFFERENT module
  (`scrml:crypto`), a different reach form (bare ref passed to `.map`), and the transitive limb:
  the firing path DOES refuse (exit 1) AND still writes the artifact set — so what §6.6.19 closes is
  the SILENT half (exit 0), not the artifact-set half. Say exactly that; do not assert "closes none".
- fix: make `:3729` and `:3698` consistent and true against the compiler.

### B7 — HIGH, PRE-EXISTING (not a round-5 regression) — §12.2 Trigger 3 has the IDENTICAL body-only blind spot
- `compiler/src/route-inference.ts:3438` `collectServerOnlyBindingModules` scans `fnNode.body` only;
  `params` are used at `:3417-3422` to build the SHADOW set, never as a scan root. A server-only
  stdlib import in a parameter default (`function f(h = hashPassword(@pw))`) ships argon2id + the
  secret to the browser at exit 0, no `.server.js`. Refuters measured it IDENTICAL at the pre-arc
  base `23ea2e5c` — pre-existing, adopter-facing.
- disposition (PA, S346 — FORK RULE row 4, root beats position): the ROOT CAUSE is the same as B1
  (params not in the scan root + `defaultValue` raw string). **Fix it in round 6 as a SEPARATE
  COMMIT** on the same branch, with its OWN executed-artifact pin + its OWN corpus differential
  count, so it can be split out if the review wants it separate. STOP-IF-BIGGER: if closing it
  needs more than routing the same parsed defaults into `collectServerOnlyBindingModules`'s scan,
  stop, leave B1's fix standing, and REPORT the shape — the PA files it as its own arc.
  Direction-of-change: this is a conformance restoration toward §12.2 Trigger 3's normative rule
  ("a server-only stdlib import escalates the function that uses it" — a default IS the function
  using it); it is `semantics-changed` for any program with that shape (now emits `.server.js`),
  so the corpus differential count is mandatory and reported.

## NON-BLOCKERS confirmed by the review, for the record (do NOT build here)
- The DIRECT-limb leak's true root (round-5 sharpening, delta [1490]): `prune-server-only-stdlib-chunks`
  (`emit-client.ts:2898-2945`) keeps a chunk on any word-boundary TEXTUAL occurrence; route inference
  is never consulted. NOT shadow-specific — a plain string literal mentioning `hashPassword` leaks
  identically. Own arc; PA files it. Do not touch `emit-client.ts` for it in round 6.
- Lexical scoping (S345 Q1(c)) stays QUEUED: scanner + codegen renamer must move TOGETHER.

## What round 4/5 DID fix — do not regress
- r3 alias blockers (`let f = doHash` · `let api = {run: doHash}` · `const g = (p) => doHash(p)`) —
  DOCUMENTED as residuals in the SPEC and pinned; the r5 agent corrected the PA that they are
  documented, not closed. Keep the pins green and the SPEC text honest.
- transitive limb suppresses on NOTHING (r5 `a00d2050`) — keep.
- the five strikes of the direct-limb agreement claim (r5 `e9b905d9`) — keep.
