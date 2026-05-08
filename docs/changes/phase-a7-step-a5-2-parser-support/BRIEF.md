---
title: A5-2 dispatch brief — parser support for §51.0.M-Q (S67 ratified engine + temporal extensions)
date: 2026-05-08
session: S70 (PA-drafted; awaits convener authorization to fire)
authority: A7 phase ratified S67; A5-1 spec amendments LANDED S68 (`1de05ef`); A5-2 sub-step is parser-only
status: BRIEF READY — awaits convener authorization to fire
predecessor: A5-1 (SPEC §51.0.M-Q + §51.12.3.1 + §34 +2 codes + §4.15 + §24.4 — LANDED S68 `1de05ef`)
successor:   A5-3 (typer + symbol-table walker for the same surface, ~5-8h)
---

## §1 Scope of A5-2

A5-2 is the **parser-support sub-step** of Phase A7 (S67 ratified engine + temporal
extensions). It produces parser AST surfaces for the five §51 features that A5-1 added
to SPEC.md. **Parser-only.** Typer, symbol-table walker, codegen, and runtime are out
of scope (they belong to A5-3, A5-4, A5-5).

**The five features (parser deliverables):**

| Feature | SPEC | Parser deliverable |
|---|---|---|
| `<onTimeout after=DURATION to=.Variant/>` | §51.0.M | New structural element parsed inside engine state-child bodies. Captured as `EngineStateChildEntry.onTimeoutElements: OnTimeoutEntry[]` (currently typed `unknown[]` in `EngineMetadata`). |
| `history` bare attribute on state-children | §51.0.N | `<Variant history rule=...>` — bare attribute captured on `EngineStateChildEntry.historyAttr: boolean` (currently typed `boolean` in `EngineMetadata`). |
| `internal:rule=` prefix on state-children | §51.0.O | Parallel field to canonical `rule=`. Captured as `EngineStateChildEntry.internalRule: EngineRuleForm` using the existing 6-form discriminated union. |
| `parallel` bare attribute on file-scope `<engine>` | §51.0.P | Captured on `engine-decl.parallelAttr: boolean` AST field (which `EngineMetadata.parallelAttr` mirrors). |
| Nested `<engine>` declarations + `.Variant.history` target form | §51.0.Q.1 + §51.0.N target syntax | Composite state-child body parses inner `<engine>` declarations as nested AST. `.Variant.history` recognized as a structured target form in `rule=` / expression positions. |

**A5-2 does NOT do:**

- Typer validation (`E-HISTORY-NO-INNER-ENGINE`, `E-INTERNAL-RULE-NOT-COMPOSITE`,
  `E-ENGINE-INVALID-TRANSITION` extension for cascade-miss diagnostic, `to=` legality
  check on `<onTimeout>`, `parallel` silent-ignore on nested/derived engines, etc.) —
  that's A5-3.
- Computed-delay relaxation (§51.12.3.1) — covered by A5-5 (~1.5-2.5h, optional follow-on).
- Codegen — A5-4.
- Runtime — A5-4 (the runtime backbone for `<onTimeout>` already exists per §51.0.M
  cross-ref to §51.12 — `_scrml_machine_arm_timer` / `_scrml_machine_clear_timer`; A5-4
  reuses, doesn't reinvent).
- Test fixtures + sample updates — A5-7.
- Item G B-shakeable timer extensions (event-timeout watchdog, named multi-timer) —
  A5-6 (optional follow-on).

A5-2 is **pure AST-shape extension** — produce the structured AST that A5-3 will walk.

---

## §2 Spec authority — read every section before parser work

Per pa.md Rule 4 (spec is normative; derived planning docs are not), each parser
deliverable maps to a specific SPEC section. **Read each before designing the parser
shape.** Quoted line ranges are post-A5-1 (current at HEAD `f59bbcc`).

| Deliverable | SPEC section | Lines |
|---|---|---|
| `<onTimeout>` element form, attributes, semantics, placement, composition | §51.0.M | `compiler/SPEC.md:20503-20612` |
| `history` bare attribute + `.Variant.history` target form | §51.0.N | `compiler/SPEC.md:20614-20707` |
| `internal:rule=` prefix | §51.0.O | `compiler/SPEC.md:20709-20770` |
| `parallel` bare attribute on file-scope engine | §51.0.P | `compiler/SPEC.md:20772-20819` |
| Nested `<engine>` declarations + composite state-children + parent-rule cascade | §51.0.Q | `compiler/SPEC.md:20821-20988` (focus §51.0.Q.1 for parser; §51.0.Q.2-4 are typer/codegen) |
| `<onTimeout>` registered as structural element (registry side) | §4.15, §24.4 | already amended at A5-1 land |
| `+2` §34 codes (E-HISTORY-NO-INNER-ENGINE, E-INTERNAL-RULE-NOT-COMPOSITE) | §34 | A5-3's territory; A5-2 produces the AST these codes will check |

**Cross-feature spec authority (read for context):**

- §51.0.B — engine declaration syntax (the form a nested engine uses, identical to file-scope). `compiler/SPEC.md:20078-20122`.
- §51.0.F — `rule=` contract (target-only forms; the surface `internal:rule=` mirrors). `compiler/SPEC.md:20237-20286`.
- §51.0.H — `<onTransition>` element (sibling-shape precedent for `<onTimeout>`). `compiler/SPEC.md:20315-20365`.
- §51.0.I — `:`-shorthand body form (composes with state-children that have `<onTimeout>` siblings). `compiler/SPEC.md:20366-20385`.
- §51.0.K — Machine Cohesion footnote (singleton invariant — outer × 1 = 1 inner instance). `compiler/SPEC.md:20427-20479`.
- §51.12 — legacy `<machine>` temporal transitions (the runtime backbone `<onTimeout>` reuses). `compiler/SPEC.md:22210-22380`.
- §4.15 — scrml-defined structural elements registry. Part of §4 block grammar.
- §24.4 — structural-elements-not-HTML registry distinction.

---

## §3 Existing infrastructure A5-2 inherits

**Phase 0 SURVEY mandate:** the depth-of-survey discount is **frequency-7** at scrmlTS
per primer §12 + master-list §0.4. A5-2 has **substantial pre-existing scaffolding**
from B14/B15/B17 — read them all before estimating fresh-build cost.

### §3.1 EngineMetadata forward-compat fields (B14 — ALREADY DECLARED)

`compiler/src/symbol-table.ts:265-285` declares the A7 forward-compat fields with the
exact §51.0.M-Q labels. **A5-2's job is populating them, not declaring them.** The
field types are conservative (`unknown[]`, `boolean`) — A5-2 may TIGHTEN the types
when populating, replacing `unknown[]` with the structured shape that fits.

```typescript
// EXISTING (B14 — symbol-table.ts:265-285):
parentEngine?: StateCellRecord | null;       // §51.0.Q — back-pointer for nested
innerEngines?: StateCellRecord[];             // §51.0.Q — for hosts of nested
historyAttr?: boolean;                        // §51.0.N — history bare attr
internalRules?: unknown[];                    // §51.0.O — internal:rule= entries
parallelAttr?: boolean;                       // §51.0.P — parallel bare attr
onTimeoutElements?: unknown[];                // §51.0.M — <onTimeout> entries
```

`compiler/src/symbol-table.ts:3688-3693` shows the B14 PASS 10.A registration site
where the fields are initialized to undefined / null / [] / boolean. **A5-2 amends the
populating logic only at the point where A5-2's parser AST flows into the
StateCellRecord.**

### §3.2 EngineStateChildEntry — B15's per-state-child shape

`compiler/src/symbol-table.ts` exports `EngineStateChildEntry`:

```typescript
// CURRENT (B15 — symbol-table.ts):
export type EngineStateChildEntry = {
  tag: string;                    // "Variant" name
  rule: EngineRuleForm;           // §51.0.F discriminated union (6 forms)
  bodyRaw: string;                // raw text — see B15 limitation note
  isColonShorthand: boolean;      // §4.14 / §51.0.I — :-shorthand body? (B18 added)
  rawOffset: number;
};
```

**A5-2 EXTENDS this shape** with three new fields:

```typescript
// A5-2 EXTENSION (proposed shape — agent confirms during Phase 0):
export type EngineStateChildEntry = {
  tag: string;
  rule: EngineRuleForm;
  bodyRaw: string;
  isColonShorthand: boolean;
  rawOffset: number;

  // ---- A5-2 NEW ----
  /** §51.0.N — `history` bare attribute on the state-child opener. */
  historyAttr: boolean;
  /** §51.0.O — `internal:rule=` parallel to canonical `rule=`. Same 6-form
   *  EngineRuleForm shape; `kind: "absent"` when the prefix is not present. */
  internalRule: EngineRuleForm;
  /** §51.0.M — `<onTimeout>` siblings inside this state-child body.
   *  Empty array when none are present. */
  onTimeoutElements: OnTimeoutEntry[];
  /** §51.0.Q.1 — nested `<engine>` declarations parsed out of this body.
   *  Empty array when this state-child is non-composite. */
  innerEngines: NestedEngineEntry[];
};
```

`OnTimeoutEntry` and `NestedEngineEntry` are NEW types this dispatch introduces.

### §3.3 EngineRuleForm — already covers 6 forms

`compiler/src/symbol-table.ts` exports `EngineRuleForm`:

```typescript
export type EngineRuleForm =
  | { kind: "single";       target: string }
  | { kind: "multi";        targets: string[] }
  | { kind: "wildcard" }
  | { kind: "absent" }
  | { kind: "legacy-arrow"; raw: string }
  | { kind: "parse-error";  raw: string; reason: string };
```

**A5-2 EXTENSION:** the §51.0.N target syntax `.Variant.history` is a structured-variant
form. Three options for how to model it (agent decides during Phase 0):

- **Option A — flag on existing forms.** Extend `single` and `multi` with an optional
  `historyForm: boolean` discriminator: `{ kind: "single"; target: string; historyForm?: boolean }`.
- **Option B — new shape.** Add a 7th form: `{ kind: "history"; outerVariant: string }`.
- **Option C — string-encoded target.** Keep `target` as `".Playing.history"` literal;
  let the typer split. (Loses some compile-time discrimination.)

Recommendation: **Option A** preserves the existing union shape for downstream
walkers (B15, B16) and adds a single non-load-bearing flag. But Phase 0 should verify
against B15/B16's `EngineRuleForm` consumers to confirm.

### §3.4 ast-builder.js — engine-decl recognition

`compiler/src/ast-builder.js` has the engine-decl recognition path. Survey for:

- The opener attribute scanner — needs to recognize `parallel` as a bare attribute
  alongside existing `pinned` recognition.
- The `engine-decl` AST shape — gains `parallelAttr: boolean` field.
- The body-passthrough — currently captures `rulesRaw: string`; A5-2 may need to NOT
  change this (the body-walk is delegated to `engine-statechild-parser.ts`), OR may
  want a structured pre-walk for nested engine recognition. Phase 0 confirms.

### §3.5 engine-statechild-parser.ts — B15's product

`compiler/src/engine-statechild-parser.ts` parses `engine-decl.rulesRaw` into
`EngineStateChildEntry[]`. **This is the primary touch-point for A5-2.** Survey for:

- Where `<onTimeout>` siblings are encountered — they appear as PascalCase-style markup
  inside the state-child body but with a known fixed tag (`onTimeout`). Need to
  distinguish from PascalCase variant tags (which are nested state-children of an
  inner engine, NOT siblings of the outer state-child).
- The `:`-shorthand body form recognition (B18 extension) — `<onTimeout>` is allowed
  ONLY in non-shorthand bodies (the inline single-expression form has no place for
  sibling structural elements). Confirm with §51.0.I.
- The state-child opener attribute scanner — needs to recognize `history` as a bare
  attribute and `internal:rule=` as an attribute prefix.

### §3.6 expression-parser.ts — `.Variant.history` recognition

The structured target `.Variant.history` is a S67 grammar extension. It appears in
TWO positions:

1. As a `rule=` attribute value: `<Paused rule=.Playing.history>`.
2. As an expression on the RHS of an engine-variable assignment:
   `${ @appMode = .Playing.history }`.

For (1), the engine-statechild-parser's `rule=` value parser handles it (the outer
parsing context already extracts the attribute value).

For (2), `compiler/src/expression-parser.ts` is the touch-point. Survey for:

- The bare-variant `.Variant` recognition (B20 work — `preprocessForAcorn` regex,
  `shouldSkipExprParse` relaxation in ast-builder.js). `.Variant.history` is a
  member-expression-shaped extension of bare-variant; the existing infrastructure may
  cover it as `MemberExpr(.Playing, "history")` natively if the parser's MemberExpr
  path admits leading-dot targets.
- The variable-length lookbehind regex (B20-canonical) — confirm it handles
  `.Playing.history` cleanly.

**Anticipated finding:** B20's bare-variant infrastructure may cover `.Variant.history`
naturally as a property access on a bare-variant root. Phase 0 verifies. If true, the
expression-parser side may need ZERO changes; the recognition falls out of existing
infra.

### §3.7 Tokenizer — `internal:` attribute prefix

`compiler/src/tokenizer.ts` recognizes attribute prefixes (`bind:`, `on:`, `onserver:`,
`onclient:`, `class:`). **`internal:` is a NEW prefix** specific to engine state-child
attributes. Survey for:

- The prefix-recognition list — does it admit a new prefix without churn?
- The downstream attribute-name handling — `internal:rule` has a colon; current
  attribute-iteration may already split on `:` for the bind:/on:/etc. families.

### §3.8 Pre-Stage-2 lint pass — ghost-pattern catalog

`compiler/src/lint-ghost-patterns.js` is the pre-Stage-2 lint pass that runs BEFORE
TAB. Survey for any ghost-pattern that A5-2's new syntax might unintentionally trigger
(e.g., `<onTimeout>` looks like an event-handler attribute name when seen out of
context). If A5-2 adds new structural elements to the registry, the ghost-pattern
catalog may need updates so dev-error messages stay clean.

---

## §4 Deliverables — concrete

### §4.1 Parser surface

| # | Deliverable | Files (best-guess; agent confirms) |
|---|---|---|
| 1 | `<onTimeout after=DURATION to=.Variant/>` recognition inside engine state-child bodies. Self-closing structural element. Capture as `OnTimeoutEntry { after: string; to: string; rawOffset: number }`. The `after=` value is captured raw (literal `Nms`/`Ns`/etc. OR computed `${expr}<unit>`); A5-3 typer parses the duration form. The `to=` value is captured as a §51.0.F target string (single-target form only — multi-target / wildcard `to=` are not legal per §51.0.M). | `engine-statechild-parser.ts`, `symbol-table.ts` (new type), `ast.ts` |
| 2 | `history` bare attribute on engine state-child openers. `<Variant history rule=...>`. Set `EngineStateChildEntry.historyAttr: boolean`. | `engine-statechild-parser.ts` |
| 3 | `internal:rule=` prefix on engine state-child openers. Parallel to canonical `rule=`. Same six EngineRuleForm shapes (single/multi/wildcard/absent/legacy-arrow/parse-error). When the prefix is not present, `internalRule.kind === "absent"`. | `engine-statechild-parser.ts`, possibly `tokenizer.ts` |
| 4 | `parallel` bare attribute on file-scope `<engine>`. Set `engine-decl.parallelAttr: boolean` AST field. Must be recognized at the engine-decl opener-scan time, not at state-child parse time. | `ast-builder.js`, `ast.ts` |
| 5 | Nested `<engine>` declarations parsed out of state-child bodies. Capture as `NestedEngineEntry { rawText: string; rawOffset: number; ... }` OR as a fully-parsed engine-decl AST node (Phase 0 chooses). The composite state-child marker is "this state-child body contains a nested `<engine>`" — that marker is downstream-derivable from `innerEngines.length > 0`. | `engine-statechild-parser.ts`, possibly delegating to `ast-builder.js`'s engine-decl path |
| 6 | `.Variant.history` target form recognition in `rule=` + `internal:rule=` attribute values. Reflected in `EngineRuleForm` extension (Option A flag preferred — see §3.3). | `engine-statechild-parser.ts` |
| 7 | `.Variant.history` recognition as engine-variable assignment RHS. Likely zero-source-change if B20 bare-variant infrastructure naturally extends. | `expression-parser.ts` (verification only, possibly no changes) |

### §4.2 AST type extensions

| Type | Change |
|---|---|
| `EngineStateChildEntry` | +4 fields: `historyAttr`, `internalRule`, `onTimeoutElements`, `innerEngines` |
| `EngineMetadata.{historyAttr, internalRules, parallelAttr, onTimeoutElements, innerEngines, parentEngine}` | Tighten types from `unknown[]` / `boolean` to structured shapes; populate during PASS 10.A engine registration AFTER parser flows them through |
| `EngineRuleForm` | +1 optional flag `historyForm?: boolean` on `single` and `multi` shapes (Option A — confirm in Phase 0) |
| New: `OnTimeoutEntry { after: string; to: string; rawOffset: number }` | Exported from `symbol-table.ts` |
| New: `NestedEngineEntry { rawText: string; rawOffset: number; ... }` OR direct `EngineDeclNode` reference | Exported from `symbol-table.ts` |
| `engine-decl` AST node (in `ast.ts`) | +1 field `parallelAttr: boolean` |

### §4.3 ZERO new diagnostics fired by A5-2

A5-2 produces AST. Diagnostics that consume A5-2's AST belong to A5-3:

- `E-HISTORY-NO-INNER-ENGINE` — fires when `historyAttr === true` AND `innerEngines.length === 0`.
- `E-INTERNAL-RULE-NOT-COMPOSITE` — fires when `internalRule.kind !== "absent"` AND `innerEngines.length === 0`.
- `E-ENGINE-INVALID-TRANSITION` extended message — when a write inside a composite is rejected by outer's `rule=` (per §51.0.Q.3 cascade-miss diagnostic).
- `E-STRUCTURAL-ELEMENT-MISPLACED` — when `<onTimeout>` appears outside an engine state-child OR inside a `<match>` block-form arm. (Existing code; A5-3 wires the firing for the new `<onTimeout>` placement.)
- `to=` legality check on `<onTimeout>` — A5-3 typer.

**A5-2's own diagnostics:** any structural parse-failure should produce a `parse-error`-shape AST entry (mirroring B15's `EngineRuleForm.parse-error` pattern), NOT a hard-fail. Downstream typer surfaces the diagnostic.

---

## §5 Phase 0 SURVEY — MANDATORY before per-step decomposition

Per primer §12 depth-of-survey discount mitigation checklist, A5-2 has high
discount-likelihood:

- B14 declared the EngineMetadata A7 forward-compat fields BY NAME (matching §51.0.M-Q
  letters). The agent finds them ready to populate.
- B15's `engine-statechild-parser.ts` is well-structured and extension-ready
  (per its docstring naming `<onTimeout>`/`history`/`internal:rule=`/`parallel` as
  "B17 / A7 dispatches").
- B20's bare-variant infrastructure may naturally cover `.Variant.history` as a
  property-access form.

**Phase 0 deliverables — write to `docs/changes/phase-a7-step-a5-2-parser-support/SURVEY.md`:**

1. **Locus confirmation** — for each §4.1 deliverable row, name the EXACT file + line
   range that needs the extension. Confirm or correct the §3.X best-guesses above.
2. **Body-walk feasibility** — does `engine-statechild-parser.ts` currently walk into
   state-child bodies enough to find `<onTimeout>` siblings + nested `<engine>`
   declarations? Or does the body-walk need a substantial advance? **This is the
   load-bearing cost question.** Per primer §13.7 B15 specifics, "today's AST stores
   state-child bodies as raw text" — but the existing parser may walk far enough at
   `bodyRaw` extraction time to find the structural elements without full body-AST
   work.
3. **`.Variant.history` expression-parser path** — does B20's `preprocessForAcorn`
   regex (`(?<![A-Za-z0-9_$\)\]"'\`]\s*)\.\s*([A-Z][A-Za-z0-9_]*)`) admit
   `.Playing.history` as a bare-variant followed by `.history` MemberExpr?
   If yes → zero source change in expression-parser. If no → narrow regex extension.
4. **Tokenizer `internal:` prefix** — does the current attribute-prefix list extend
   cleanly, or is there a closed registry?
5. **Cost decomposition** — break A5-2 into sub-steps if the body-walk advance is
   substantial enough to warrant separate dispatches. Per master-list estimate ~6-9h
   if all extensions ride existing infrastructure; up to ~12-15h if a body-walk
   advance is required.
6. **`EngineRuleForm.historyForm` recommendation** — confirm Option A (flag on existing
   forms) vs Option B (new shape) vs Option C (string-encoded). Survey downstream
   consumers (B15, B16, A1c codegen via `emit-machines.ts:478-714` per primer §7) and
   recommend.

**Phase 0 must include any SCOPE CORRECTIONS:** if Phase 0 reveals that one of the §4.1
deliverables is structurally larger than estimated, OR that one falls naturally to A5-3
typer, OR that an unanticipated touch-point exists — surface explicitly. Per pa.md
Rule 4, the brief is derivative; the agent's survey is authorized to correct it.

**Stop-and-report after Phase 0** — do NOT proceed to implementation without PA
acknowledgment of the survey findings. (PA may dispatch the implementation step
without further review if survey confirms the brief; or may amend if survey diverges.)

---

## §6 Test plan

### §6.1 Unit tests — new file: `compiler/tests/unit/a5-2-parser-support.test.js`

Mirror B14/B15/B17 unit-test structure. Sections:

- §A5-2.1 `<onTimeout>` element parsing — literal duration, computed `${expr}<unit>`,
  multiple per state-child, single-target `to=`, missing `after=` / `to=` shape.
- §A5-2.2 `history` bare attribute — present, absent, on multiple state-children,
  composition with `rule=` and `internal:rule=`.
- §A5-2.3 `internal:rule=` prefix — single-target, multi-target, wildcard, absent,
  combined with canonical `rule=`, `.Variant.history` target.
- §A5-2.4 `parallel` bare attribute — present, absent, multiple file-scope engines.
- §A5-2.5 Nested `<engine>` recognition — single-level nesting, identical attribute
  shape (own `for=`, `initial=`, state-children), `var=` override on inner.
- §A5-2.6 `.Variant.history` target form — in `rule=`, in `internal:rule=`, in
  expression RHS, empty-history fallback (parser doesn't fire — runtime semantic).
- §A5-2.7 Composition — composite state-child carrying ALL of (`history`, canonical
  `rule=`, `internal:rule=`, nested `<engine>`, `<onTimeout>` siblings).
- §A5-2.8 AST shape contract — `EngineStateChildEntry.{historyAttr, internalRule,
  onTimeoutElements, innerEngines}` populated correctly; `engine-decl.parallelAttr`
  set; `EngineMetadata` mirror fields populated by PASS 10.A.
- §A5-2.9 Span integrity — `rawOffset` fields on new entries point to source positions.
- §A5-2.10 Negative cases that A5-2 itself produces parse-error entries (NOT hard-fails)
  — malformed `internal:rule=` value, malformed `<onTimeout>` attributes.

**Estimated test count: 35-50 unit tests.**

### §6.2 Integration tests — DEFERRED to A5-3

Integration tests that exercise typer + symbol-table + parser end-to-end belong to
A5-3 (typer dispatch). A5-2 ships only parser-shape unit tests.

### §6.3 Test invariant

All existing tests must continue to pass with delta = +new-tests-only. **0 regressions**
is the contract. Run `bun run test` (full suite via pretest); confirm baseline 9,626
pass / 60 skip / 1 todo / 0 fail moves only by additions.

---

## §7 Out of scope

- Typer validation of A5-2-produced AST (A5-3 — separate dispatch).
- Codegen for A5-2-produced AST (A5-4 — separate dispatch).
- Computed-delay relaxation impl (`${expr}<unit>` form lowered to runtime arg) (A5-5).
- Item G B-shakeable timer extensions (A5-6 — optional follow-on).
- Test fixtures + sample updates (A5-7).
- Self-host scrml updates (deferred per S66 user direction — post-v1.0.0).
- A1c codegen (independent phase per S70 sequencing decision: A7 parser+typer first).

---

## §8 CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

(Worktree-isolation block per pa.md §F4 standing rule. Paste verbatim into agent
dispatch prompt.)

```
Your worktree path is: <ABSOLUTE-WORKTREE-PATH-HARNESS-ASSIGNS>

## Startup verification (do this BEFORE any other tool call)

1. Run `pwd` via Bash. Output MUST equal the worktree path above. Save as WORKTREE_ROOT.
2. Run `git rev-parse --show-toplevel` via Bash. Output MUST equal WORKTREE_ROOT.
3. Run `git status --short` via Bash. Confirm tree is clean.
4. Run `bun install` via Bash. Worktrees do NOT inherit `node_modules` from main.
5. Run `bun run pretest` via Bash. Populates `samples/compilation-tests/dist/` for
   browser tests.

If ANY check fails: DO NOT proceed. Report the mismatch and exit.

## Path discipline (enforce on EVERY Read/Write/Edit call)

- For Read: paths under WORKTREE_ROOT are safe.
- For Write/Edit: ALWAYS use ABSOLUTE paths under WORKTREE_ROOT. Do NOT use relative
  paths — the harness may resolve them against an `Additional working directories`
  list that includes main, causing silent writes to main's working tree.
- NEVER use absolute paths starting with the main repo root directly.
- If an intake doc / hand-off doc references a path like
  `/home/bryan-maclee/scrmlMaster/scrmlTS/foo/bar.ts`, translate it to
  `$WORKTREE_ROOT/foo/bar.ts` before writing.

If you find yourself about to write to a path starting with the main repo root, STOP.
Re-derive the path from WORKTREE_ROOT.
```

---

## §9 Crash-recovery + commit cadence (per pa.md global rule)

Background agents are unreliable. Commit early and often:

- After each meaningful unit of work (a file edited, a test added, a sub-deliverable
  closed), commit immediately. WIP commits are fine.
- Update `docs/changes/phase-a7-step-a5-2-parser-support/progress.md` after each step.
- The branch is the checkpoint. If the agent dies after 3 of 7 deliverables, those 3
  are recoverable.
- Final cleanup commit can squash or amend if desired, but never delay committing to
  wait for a "clean" state.
- Per S69 PA-debug recovery pattern (B18 + B20 first dispatches): if a long-running
  dispatch hits API errors mid-implementation, the salvaged Phase 0 SURVEY +
  incremental WIP commits + progress.md let PA hand-take or re-dispatch with minimum
  loss.

---

## §10 References — load-bearing reading

**Required reading before parser work:**

1. `compiler/SPEC.md:20503-20988` — §51.0.M through §51.0.Q (the five features)
2. `compiler/SPEC.md:20078-20122` — §51.0.B (engine declaration syntax — the form a nested engine uses)
3. `compiler/SPEC.md:20237-20286` — §51.0.F (`rule=` contract — the substrate `internal:rule=` mirrors)
4. `compiler/SPEC.md:20315-20365` — §51.0.H (`<onTransition>` element — sibling-shape precedent)
5. `compiler/src/symbol-table.ts:200-310` — EngineMetadata + EngineStateChildEntry shapes
6. `compiler/src/symbol-table.ts:3680-3720` — PASS 10.A registration site
7. `compiler/src/engine-statechild-parser.ts` (full file) — B15's product, the primary touch-point
8. `compiler/src/expression-parser.ts:preprocessForAcorn` — B20's bare-variant regex (relevant for `.Variant.history` recognition)
9. `compiler/src/ast-builder.js:shouldSkipExprParse` — B20's leading-dot relaxation (relevant for `.Variant.history`)

**Briefing context (mandatory per pa.md PA orchestration responsibilities):**

10. `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` — read before writing scrml code (none expected this dispatch — implementation-side, not scrml-side)
11. `docs/PA-SCRML-PRIMER.md` — full read at session start; §13.7 B14/B15 specifics + §13.7 B17 specifics directly relevant to A5-2

**Recovery context:**

12. `pa.md` §"Worktree-isolation: startup verification + path discipline" — F4 finding
13. `pa.md` §"Dispatch landing — worktree-as-scratch / file-delta" — S67 standing rule
14. Global rules `~/.claude/CLAUDE.md` — Crash Recovery: Incremental Commits + Progress Reports

---

## §11 Tags

#a7 #a5-2 #parser-support #s67-amendments #s68-spec-landed #onTimeout #history #internal-rule #parallel #nested-engine #variant-history #composite-state-child #depth-of-survey-frequency-7 #brief-ready
