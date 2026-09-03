# S397 — the fail-closed `~` codegen floor

## RULING THIS IMPLEMENTS

bryan, S397: *"measure both, then land the fail-closed floor."* Measurements are in. This lands
the floor.

**What it is:** `compiler/src/codegen/emit-expr.ts` currently emits
`null /* ~ orphaned — codegen-fallback */` when a `~` reaches `emitIdent` with no resolved slot.
Replace that with a hard error.

**Why it needs zero analysis strength (dpa-040's own reasoning):** a `~` reaching `emitIdent`
unresolved is BY CONSTRUCTION one the analysis could not resolve. Emitting a value is fail-OPEN by
construction; erroring is fail-CLOSED by construction. No new analysis is required to decide it.

**Why it is the precondition for everything else on this surface:** while the fallback emits a
value, **no conformance case can distinguish any candidate `~` design from any other** — they are
all extensionally identical, because nothing fires. dpa-040: *"until it lands, neither ruling is
falsifiable."*

## ⚑ STEP 1 — THE GATING MEASUREMENT. DO THIS FIRST AND REPORT IT BEFORE CHANGING CODE.

**Run the output-side orphan census.** Compile the full corpus and count occurrences of
`~ orphaned` in the EMITTED JS, per file.

```
# shape only — build the real thing
compile every .scrml → out dir; grep -c '~ orphaned' over emitted *.js
```

**This is the migration, and it is the only honest measure of it.** Do NOT reason from the
measurement dispatch's bucket D — PA-verified that 3 of its 5 entries are the accumulator role
(`§48.5.1` / `§49.6.1`), which codegen RESOLVES correctly (`let _tN = []`, `.push` per lift,
`return _tN`) and which never reach the fallback at all. Bucket D counts *reads with no antecedent
expression statement*; the fallback fires on *unresolved slots*. **Different axes.**

Expected order of magnitude: small. **One known genuine site**
(`samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-as-expr-tilde-partial-012.scrml`,
a §17.6.6 partial-`if`). If the census returns materially more than that, **STOP and report before
changing anything** — a large number means the fallback is load-bearing somewhere nobody modelled,
and that is a finding, not a migration.

## STEP 2 — THE DIAGNOSTIC. RULED BY BRYAN, S397: **"mint the code."**

**MINT A NEW CODEGEN-STAGE CODE.** Do NOT reuse `E-TILDE-001`.

`E-TILDE-001` is specified as a TYPE-SYSTEM diagnostic. Firing it from codegen would give one §34
row two fire stages and make "which stage owns this condition" unanswerable from the catalog — and
this surface has already been burned by a §34 row asserting a fire site that did not exist.

**Obligations that ride with the mint (base Rule 4b + §34 discipline):**
- A §34 catalog row, severity **Error**, landing WITH the implementation (named-codes-land-with-impl).
- A `provenance:` line citing `ruling:user-voice-scrml.md S397 "mint the code"`.
- The message SHALL name the condition precisely — a `~` reached codegen with no resolved slot —
  and SHALL NOT claim the type-system checked anything, because it did not.
- ⚑ **At least one conformance `-neg` case that actually produces it**, verified by flipping it and
  watching it go red. A code with zero `-neg` cases has never been proven to fire; that is exactly
  how `E-TILDE-001/002` sat dead while two normative sections contradicted each other.

Pick the code name to fit §34's existing family conventions and state your choice in `progress.md`.

## STEP 3 — THE CONFORMANCE FALLOUT

⚑ **`ctrl-027-arm-body-tilde-read-and-recovery-pos` PINS the orphan fallback** (`text: ""`), and the
S397 landing just re-scoped it to name which side it pins. **Making the orphan an error breaks that
pin.** Re-scope it a third time — and per §62.2 the corpus IS the versioned contract, so state what
you did and why in `progress.md`. **Do not delete a conformance case to make a suite green.**

Also check the unit file `g-bare-expr-in-if-arm-rebinds-tilde-context.test.js` — its four
`NESTED_BLOCK_CONSTRUCTS` rows assert `~ orphaned` is ABSENT (property 1), so they should be
unaffected, but verify rather than assume.

## STEP 4 — MIGRATE, DO NOT SUPPRESS

Each site the census finds is either (i) a genuine bug now surfaced — fix the source, or (ii) a
deliberate negative case — convert it to a `-neg` conformance case that PROVES the new error fires.

⚑ **Option (ii) is the valuable one.** dpa-040's highest-leverage recommendation is that *every §34
code catalogued as Error must have ≥1 conformance `-neg` case that actually produces it* — a code
with zero `-neg` cases has never been proven to fire, which is exactly how `E-TILDE-001/002` sat
dead. **Land this arc with its own `-neg` case, so the floor is itself proven to bite.**

## DIRECTION-OF-CHANGE

**Newly-REJECTING** (base §8) — the reversible direction. Programs that compiled now fail. That is
the point: they were compiling to a silent `null`. Owes a MEASURED migration (step 1), which is why
step 1 gates the rest.

## SCOPE — hard

- `emit-expr.ts` fallback → error. The §34 row. The conformance fallout. The migration.
- Do **NOT** wire `checkLinear`/`TildeTracker`. Do NOT register `~` in `LinTracker`. Do NOT touch the
  `name === "~"` exclusions at `type-system.ts:18586`/`:19259`. Those are dpa-040 steps 2-4 and are
  bryan's to sequence — this arc is step 1 only.
- Do **NOT** change what initializes `~` (§32.2). The eager-vs-lazy fork is UNRULED.
- Do NOT fix the filed pre-existing defects (side-effect-only loop in arm; server-boundary `lift`
  emitting `return`; post-decl repoint; the statement swallow; the braceless if/else drop).

## GATES

- Census reported BEFORE any code change.
- Corpus differential vs `origin/main`: the ONLY diffs may be the migrated sites, each named.
- R26. Conformance green. Suite `comm -13` empty.
- A `-neg` case proving the new error FIRES, verified by flipping it and watching it go red.
- ⚑ No `test.failing`. No `git stash` (shared across worktrees). No bare `pkill -f`.
