# s469-boot-tape-grants — one tape grant reader in the bootstrap (progress)

Branch `s469-boot-tape-grants` (cut from origin/main `78b0e1fe6`). LIMB: BOOTSTRAP (`compiler/self-host-v2/`).
impl#1 untouched.

Gaps: `g-bootstrap-whole-struct-write-bypasses-tape-field-grants-s469` (MED),
`g-bootstrap-let-struct-field-tape-no-let-on-sequence-s469` (MED),
`g-bootstrap-local-tape-rebinding-not-grant-checked-s469` (LOW),
`g-bootstrap-callsite-grant-subset-unchecked-s469` (LOW, latent).

## Baselines (origin/main `78b0e1fe6`)

- `bun scripts/bootstrap-conformance.ts`: PASS 250 · FAIL 63 · NOT-TWINNED 684 · UNSUPPORTED 815 · CRASH 0 (1812).
- slice-m4: 2260 tests, 0 fail.

## Design — THE TAPE GRANT READER (analyze.scrml)

- `replace` now lives on the TYPE: Core `SeqGrants.replace` (§66.12.3), set by `resolveSeqType` from the `replace`
  token. A field's GrantSet still reads it (`seqReplace`, which now sees through `| not`).
- `grantsAdmit(gs, edit)` is the one predicate (`replace` subsumes edits); `tapeGrants(t)` reads a tape type's
  GrantSet. Every write path calls `grantsAdmit`: resolveEditCall, resolveRemoveCall (the retired
  `shrinkGranted` is gone — removals are RemoveEnd / RemoveFront / RemoveAnywhere edits), resolveSeqShape
  (`shapeEdit(3)` is now RemoveAnywhere), wholeFieldWrite, fieldAtWrite, resolveElemFieldWrite, resolveReset,
  reset-on.
- `structTapeWrites` (§66.12.6 rule 4): the tape fields a whole struct value replaces (kept = `xs: @b.xs` or a
  self-spread that does not override it; opaque values replace all; nested struct fields walked; tape
  elements not walked). Used by every whole-struct write (cell, struct field, instance-spread override,
  element field, struct local).
- `fieldAtWrite`: a TAPE target is judged by its own grants alone (the owner's `let` never admits it); the value
  is classified (`seqEditShapeKey`) — granted-but-not-`replace` is E-BOOTSTRAP-UNSUPPORTED (Core writes a field
  whole).
- Local rebinding: the typer (`typeAssign` → `localTapeProblems`), with the annotated type, else the inferred
  type with grants dropped (`inferredTape`), else (unsettled type, tape-shaped write) `inferredTapeProblems`.
- Call site: `checkArgTape` → `argTapeProblem` (place arguments only), E-BOOTSTRAP-UNSUPPORTED (code unruled).
- `fieldDefsOf`: E-GRANT-LET-ON-SEQUENCE on a `let` tape struct field.
- Structural proof: `slice-m4/tape-write-forms.test.js` — 39 write forms × (ungranted refused, granted clean),
  plus a source scan (no `….grants.replace ||`, no `hasEditKind(….grants.edits`, no `shrinkGranted`).

## Log

- [x] Read SPEC §66.9, §66.11, §66.12 (whole), the four gap entries.
- [x] Core `SeqGrants.replace`; constructors (analyze `fixedSeq` / `anySeqGrants` / `resolveSeqType`, slice-m1
      oracle fixtures, codec / check tests). The reorder fixture's `Line[replace]` now carries it on its type
      (`dropdown.core.scrml` `replaceSeq`).
- [x] The reader + every write path routed through it (above).
- [x] Tests moved, with reasons: `typer-s440.test.js` `O` (drops `let` on a never-written tape field), `G`
      (`kids: O[replace]`); `review-r1.test.js` F1 (an inferred local tape carries no grant — the runtime half
      now writes `Entry[free, remove]` on the local).
- [x] Acceptance `acceptance/grants/*` (18 cases: 6 positive, all RUN; 12 negative), STATUS pinned.
- [x] Conformance before/after: no corpus case changed (PASS 250 · FAIL 63 · NOT-TWINNED 684 · UNSUPPORTED 815).
- [x] SPEC §66.12.6 rule 4: the "does not check this yet" sentence now says it checks, and what it refuses.
- [x] Gap entries resolved (3) / narrowed (1); `bun scripts/state.ts --write`. — commit 1.
- [x] Self-review round: a self-spread keeps a field only when it is the LAST spread (`{ ...@b, ...other }`);
      a parameter's rebinding is judged by its WRITTEN type (`paramTypeOfSym`), not an inferred one; 4 more
      forms in the enumeration (for-of binder, parameter ×2, spread ordering).

## Review round 2 (of `ccaa2b9ec`)

- [x] H1 — `persist="local"` on a `let` struct with an append-only tape field compiled clean and a cross-tab
      StorageEvent emptied the tape. `persistCellProblem` now runs `resetTapeProblem` (the one reader) for a
      `local` store → E-BOOTSTRAP-UNSUPPORTED; Core check C17 `checkPersist` refuses the same (`structTapeKept`).
      `session` unchanged (Q5). Tests: `persist.test.js` (refusal, session accepted, a `replace`-granted field
      RUNS a cross-tab sync, C17 on a hand-planted Local store); acceptance `grants/neg-persist-local-struct-tape`,
      `grants/persist-session-struct-tape` (runs).
- [x] M1 — the source scan is an ALLOW-LIST over the reader's marked range (`THE TAPE GRANT READER` … `END OF
      THE TAPE GRANT READER`): any `.grants.` / `grants.replace` / `grants.edits` read outside it fails unless its
      function is listed with a reason. The list is empty: every decision routes through `grantsAdmit` /
      `grantsAny` (capability minting, "fixed" sub-field) / `grantsHasEdits` (O57) / `grantsEditOnly` (message
      advice); `grantsEdit` (a copy of hasEditKind) is deleted. A planted read proves the scan bites.
- [x] L1 — check.scrml: `fieldAtProblem` counts a tape field as a contract; `tapeReplaceProblem` judges a
      Replace / FieldAt / ElemAt whose target is a struct against its tape fields (kept = the StructOf entry
      reads the same place). Four planted-Core tests in `tape-write-forms.test.js`, each failing on the old logic.
- [x] L2 — noted in the call-site gap entry (typed binding launders grants; with Q3).

## Owner questions (not invented — refused fail-closed where the SPEC does not settle)

1. **`reset(@b)` / `reset-on=` of a struct with a `replace`-less tape field.** §66.12.6 rule 4 says the reset is a
   `replace` of the field "once `xs` has entries" — a run-time condition. Bootstrap: E-BOOTSTRAP-UNSUPPORTED.
   Owed: a static refusal (E-WRITE-NOT-GRANTED always), or a run-time check (O36-shaped)? Rec: static refusal —
   a reset that may replace an append-only log is the exact hole point (4) closes, and "may" is enough.
2. **Call-site subset code.** Direction ruled (S435 "type"); the code is not. Bootstrap: E-BOOTSTRAP-UNSUPPORTED.
   Rec: E-WRITE-NOT-GRANTED (the callee's grant is a write the argument's type does not grant).
3. **Fresh-value arguments** (`take([])`, `take(mk())`): not subset-checked (PA reading: the parameter gives a fresh
   value its type, as a typed binding does). Confirm.
4. **A genuine replace's tape field written with a classifiable shape** (`@b = { title: t, xs: [...@b.xs, e] }`):
   rule 4's text says "any other value for the field is a `replace`", so it is judged as a replace. Confirm (the
   alternative classifies it as an end-append, which Core could not lower anyway).
5. **Persist restore / cross-tab sync** of a struct or tape cell is not judged against tape grants (it is a restore,
   not a program write). Confirm it is out of rule 4's "server reload".
6. **Tape elements**: replacing a tape of structs (`@gs = [...]`) is the outer tape's write; the elements' own tape
   fields are not judged. Confirm.
7. **`const` / parameter rebinding of a tape** reports E-ASSIGN-CONST and (when the type grants nothing) also
   E-WRITE-NOT-GRANTED — both rules apply per §66.11.5 / rule 4. Acceptable, or suppress the second?
