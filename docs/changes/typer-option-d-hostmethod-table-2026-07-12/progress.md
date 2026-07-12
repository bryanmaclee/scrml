# typer Option-D — curated host-method return-type table (freeze-blocker)

change-id: `typer-option-d-hostmethod-table-2026-07-12`
gap: `g-typer-hostmethod-return-asis-and-anon-struct-poison` (host-method-return-asIs half only)
base: main @ `40b580c5`
worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0272430e331b585b`

## FINAL SCOPE (post S239 review — bryan ruling)
The S239 adversarial review found the GCP3 equality mirror was a SOUNDNESS INVERSION.
Bryan ruled: DROP the mirror, KEEP the sound receiver-keyed type-system half, DEFER the
equality half. Final shipped state:

- SHIP: `type-system.ts` `HOST_METHOD_RETURNS` + `HOST_PROPERTY_RETURNS` + `resolveReceiverExprType`.
  Receiver-KEYED and sound (fires only when the receiver resolves to string/array/number; an
  `asIs` receiver stays `asIs`; a struct field named `length` wins over the host property).
  Closes F5 (a `match` on a `substring()` result no longer fires E-TYPE-025).
- DROP: `gauntlet-phase3-eq-checks.js` reverted EXACTLY to base. The GCP3 mirror keyed on
  method NAME alone (GCP3 cannot resolve receiver types), so `(x: asIs).indexOf(...) == "y"`
  was wrongly hard-errored — inverting §14.1.1 (asIs methods must stay exempt). Dropping it
  also removes the Finding-2 flat-map cross-scope poison. E-EQ-001 reverts to base behavior:
  a host-method result vs a mismatched type is silently accepted again = the DEFERRED gap.

## SPEC grounding (Rule 4)
- §14.1.1 (SPEC 7576-7586): `asIs` is the sanctioned SILENT untyped escape hatch; never errored.
  The shipped fix NARROWS what falls into `asIs` (receiver-keyed); does NOT make `asIs` loud.
- §45.2/§45.3: primitives always comparable; cross-type `==` is E-EQ-001 (deferred half).
- §48 (fn boundary): asIs propagation across the fn boundary is the mundane cross-fn face.

## Step 1 — type-system.ts host-method return-type table (SHIPPED, closes F5)
- `HOST_METHOD_RETURNS` (receiverKind -> method -> ResolvedType) + `HOST_PROPERTY_RETURNS`
  (`.length` -> number), placed after the ScopeChain class. Invariant-return methods only
  (HARD-3); polymorphic (map/filter/pop/slice/…) intentionally omitted -> stay `asIs`.
- Numeric methods -> `tPrimitive("number")` (NOT integer).
- Helpers: `hostReceiverKind`, `resolveReceiverExprType` (ident/lit/struct-field/nested-host),
  `resolveHostMemberCallType`, `resolveHostMemberPropType`. RECEIVER-KEYED: an `asIs` receiver
  -> `hostReceiverKind` returns null -> value stays `asIs`.
- Wired into the let/const `asIs`/`unknown` upgrade block (extends the ident-call upgrade to
  member calls + modeled `.length`).
- RESULT: F5 E-TYPE-025 GONE; `const ch = c.source.substring(...)` then
  `return match ch { "a" :> "vowel" _ :> "other" }` compiles clean; generated JS is a clean
  `if (_scrml_match === "a") return "vowel"; else return "other";`.
- COMMIT: bcf7dd77 (full pre-commit gate green; unit 16090/0).

PRE-EXISTING / OUT-OF-SCOPE: a statement-position `match x { "a" :> return X ... }` (return
INSIDE arms) hits E-CODEGEN-INVALID-LOGIC even on a plain `ch: string` param with NO host
method AND with the explicit `const ch: string` annotation — a §18 statement-match codegen gap
independent of typing and of this change. The canonical match-as-expression form works.

## Step 2 — GCP3 mirror: BUILT (08b6b982) then DROPPED (S239 ruling)
- Built HOST_METHOD_MIRROR + wiring; the S239 review found it unsound (method-name keying
  fired on `asIs` receivers; flat-map cross-scope poison). Reverted `gauntlet-phase3-eq-checks.js`
  to base 40b580c5 (mirror + recordBinding upgrade + classifyOperand/typeOfSide branch all removed).

## Re-verification matrix (mirror-drop — all CLEAN, proving the inversion is gone)
- asIs `const r = x.indexOf("a"); r == "missing"`   -> CLEAN (was hard E-EQ-001 with the mirror)
- asIs `x.replace("a","b") == 5`                     -> CLEAN
- asIs `x.push(1) == "tag"`                          -> CLEAN
- asIs `x.includes("k") == 5`                         -> CLEAN
- Finding 2: sibling `strFn(){const i="world"; i=="world"}` + `indexFn(s){const i=s.indexOf("x"); i==5}`
  -> strFn CLEAN (no cross-scope poison). Confirmed the same source FIRED E-EQ-001 on the mirror
  commit 08b6b982 and is CLEAN now — isolates Finding-2 exactly.
- F5 STILL closes (type-system half intact): `match c.source.substring(...)` compiles clean.
- gauntlet-phase3-eq-checks.js diff vs base 40b580c5 = EMPTY (exactly base).

## Tests / conformance (final)
- Unit: compiler/tests/unit/hostmethod-return-type-option-d.test.js REWRITTEN — 8 pass / 0 fail.
  Section A (type-system F5): substring-match no-E-TYPE-025, clean, charAt-match. Section B
  (equality DEFERRED, soundness re-verify): 4 asIs-receiver cases CLEAN + Finding-2 no-poison.
  The 3 mirror-dependent "fires E-EQ-001" tests were REMOVED (that behavior is the deferred gap).
- Conformance: REMOVED hostmethod/eq-crosstype-caught (relied on the mirror; now silent/deferred)
  and hostmethod/eq-sametype-clean (vacuous without the mirror). KEPT hostmethod/substring-match-typed
  (runtime case: firstKind == "vowel", #out text "vowel"). Suite 387/387 pass.

## §34 / SPEC
- NO new diagnostic code. The shipped half only narrows E-TYPE-025 off modeled results; no §34 edit.
- DEFERRED (PA-filed): (a) the host-method equality silent-accept (the reproducible eqE gap) — the
  GCP3-consumes-resolved-types re-architecture is the correct fix, tracked separately; (b) RULING 3
  SPEC documentation of the sanctioned host-method surface (§14/§48 placement is a design choice).
