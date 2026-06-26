# Compiler re-imagining — RULING (S222, 2026-06-26)

**Status:** RATIFIED. Supersedes the SCOPING status of `SCOPE.md` (the de-risk investigation is complete).
**User ruling (S222):** *"lets go, full steam ahead."* + tuples ratified + the FBIP-makes-mechanics-beautiful framing.

## The decision
**Commit narrow-Road-B: re-imagine the scrml compiler in scrml, from the spec + first principles.**
- **Narrow form** (per the lexer slice): the type + case-analysis ladder — pure `fn` `match`-folds over typed enums + payloads + exhaustive dispatch. **NOT** the literal reactive-`<engine>` runtime (Approach A — a fundamental misfit, GAP-A1). **NOT** a `<machine>` primitive (the non-visual-substrate DD settled NO — the bare fold IS the substrate; restore is free in the fold and a guarded `<machine>` would re-break it; `<machine>` stays deprecated/dying, precedent intact).
- **Human-authored** (the "humans build V1" rule): the parity-port FRAMING is DROPPED; human-authorship is KEPT. Success metric = *"is this how a scrml native would write it,"* not *"is it a faithful port of the TS compiler."* (Cross-ref memory `feedback_self_host_is_from_scratch`.)

## The evidence (three de-risk slices + the substrate DD)
- **Lexer slice** — clean (net-cleaner, flagship for the type/state layer, 0 fundamental gaps, 0 `_{}`). The SPEC already uses this lexer's engines as its §51.0.B.1 worked examples.
- **DG-builder slice** (opposite shape) — narrow-Road-B HOLDS but WEAKENS: representation layer decisively cleaner, graph-traversal MECHANICS a wash-to-noisier (the COW-clone-in-hot-loops tax). The meta-resonance hook inverted (value-acyclic reactivity can't model a cyclic analyzed graph). 0 fundamental gaps, 0 `_{}`.
- **`<machine>` substrate DD** — NO new primitive; the `enum + match`-fold IS the substrate. Converges: the compiler is folds.
- **Net:** feasible + generalizes + zero fundamental gaps both slices → the prize is REAL. It is **BOUNDED** (beautiful representation, adequate mechanics) **UNLESS the mechanics are made beautiful** — which is the program below.

## The mechanics-beauty program (what makes the prize UNBOUNDED — "without compromise, compile-time is free")
The mechanics felt adequate because scrml is **copy-on-write everywhere** — pure source clones in hot loops. The fix is to push the cost into the COMPILER, keeping the source pure:
1. **FBIP — functional-but-in-place (THE CRUX).** Pure value semantics at the source; in-place mutation at runtime where the compiler PROVES single-ownership. Substrate exists: `lin` (§35) is the ownership signal; value-acyclicity (§59.5) makes reuse analysis easier; scrml is already static-analysis-heavy. **De-risk slice FIRING S222** (`fbip-feasibility-2026-06-26.md`, agent a7e40eed) — decides feasible-and-scoped vs major-subsystem vs blocked. The bounded-vs-unbounded prize pivots on this.
2. **Value-native Set (§59.12 un-defer)** — the DG builder is the missing exerciser; kills set-as-array verbosity + (with value-canonical iteration) the determinism tax. → **ss37** (survey-first, fireable).
3. **Tuples** — RATIFIED S222; clean multi-return (kills the `DfsResult` struct-wrap). → **ss36** (survey-first, fireable).
4. **A scrml-native scanning stdlib** — the lexer scan layer leans on JS-host string methods; a cursor/char-class/span vocabulary (compiler authors it as dogfood; with FBIP the cursor is a `lin` threaded in-place). Library, not language — sequences with the lexer build.

## Program shape (waves — sequencing)
1. **Language prereqs (NOW):** tuples (ss36) · Set (ss37) · FBIP feasibility (firing) — these serve the whole language AND unblock the beautiful-mechanics compiler. NOT native-parser-internal → not wasted by the rewrite.
2. **FBIP build** (gated on the feasibility verdict) — the crux subsystem; likely a `lin`-annotated-only first increment before full inference.
3. **Compiler-in-scrml build waves** (the lexer first — Approach B from the lexer slice is the design) → parser → typer → codegen. Each a flagship dogfood.
4. **Coexistence:** the TS compiler (incl. the TS native-parser) stays the LIVE front-end during the multi-quarter transition. **The TS native-parser internals are now transition-FROZEN** — fix only adopter-blockers (e.g. `g-mount-hang-rails-dev`, an active 100%-CPU hang); the rest (ss35) is superseded-pending-rewrite, not worth investing in.

## Out of scope / unchanged
- This is multi-year per the calibration; "full steam" is the POSTURE + starting the prereqs + de-risking FBIP, not building the whole compiler this session.
- `<machine>` revival: REJECTED. The §18.0.2 inert-`rule=`→lint-checked promotion stays friction-gated (banked, not fired).
