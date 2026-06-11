# SCOPE — engine `effect=` diagnostics (S182)

**Change-id:** `engine-effect-diagnostics-2026-06-11`
**Status:** scoped, ruled, dispatch-ready
**Origin:** S182 dog-food round 2 (engine surface). Two findings; both diagnostic/parser-only — **ZERO codegen change** (the canonical `${}` forms already emit correctly).
**User ruling (S182):** Fix 1 = **Option B (reject-with-diagnostic), severity ERROR**. Fix 2 rides along.

---

## Finding 1 — `effect=` silently drops a non-`${}` value (the footgun)

### Behavior (empirically reproduced, S182)
A bare `effect=load()` on an engine **opener** (S148 boot effect, §51.0.H Form 3) compiles **clean — no error, no warning** — and the boot effect is **silently dropped** (`load()` never fires at module-init). The same silent-drop exists on the **state-child** `effect=` (§51.0.H Form 1). Canonical `effect=${load()}` works correctly (emits the init→`initial=` edge call). The trap: bare event handlers ARE valid (`onclick=load()`, §5.2.3), so an adopter reasonably writes `effect=load()` and gets a silent no-op.

### Root cause (two loci, same regex)
Both parsers capture `effect=` with a `${}`-**only** regex; a non-`${}` value → `null` → tree-shaken, no diagnostic:
- **Opener:** `compiler/src/ast-builder.js:12985` — `header.search(/(?:^|\s)effect\s*=\s*\$\{/)`.
- **State-child:** `compiler/src/engine-statechild-parser.ts:2217` — `afterTagForRule.search(/(?:^|\s)effect\s*=\s*\$\{/)`. Its own comment (`:2212`) already anticipated the gap: *"malformed `effect=` → `effectRaw: null`; B17.3 typer can surface a diagnostic"* — **that diagnostic was deferred and never wired.** This fix closes it.

### Ruled approach — B (reject-with-diagnostic), ERROR
`effect=` is a §7 **logic-context block** (full, possibly multi-statement bodies — codegen re-parses it as `${...}`, emit-engine.ts:1700), so `${}` is the correct, principled delimiter; the bare `onclick=` form is a deliberate *single-expression* §5.2.3 exception that cannot carry a logic block. SPEC §51.0.B documents `effect=${...}` as canonical (SPEC.md:24609). Spec-faithful + sharp primitive (`feedback_limit_primitives_not_godify`).

**New code: `E-ENGINE-EFFECT-NOT-INTERPOLATED`** (Error; §51.0.H; cross-ref §51.0.B). Confirmed absent from the corpus. Sits alongside `E-ENGINE-EFFECT-AMBIGUOUS` / `E-ENGINE-EFFECT-ON-DERIVED`. Covers BOTH the opener (Form 3) and state-child (Form 1); the message is parameterized by locus.

### Implementation (parser sets a flag → SYM fires — the B15/B18 idiom)
1. **Parser (opener)** `ast-builder.js` ~12985: when `effect\s*=` is present in the opener header but the `${...}` capture yields null (bare or unbalanced), record a flag on the engine-decl (e.g. `openerEffectMalformed: true`, optionally the raw bad slice for the message). Do NOT change the existing `${}` capture.
2. **Parser (state-child)** `engine-statechild-parser.ts` ~2217: same — set `EngineStateChildEntry.effectMalformed: true` when `effect=` is present but not `${...}`.
3. **SYM fire** `symbol-table.ts`: opener fires from the engine-register pass (PASS 10.A `walkRegisterEngines`); state-child fires from PASS 11 (`validateEngineStateChildrenAndRules`, which already reads `EngineStateChildEntry`). Both emit `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error). Message points at the `${...}` form: e.g. *"engine `<X>` opener `effect=` must be a `${...}` logic block (§51.0.H Form 3); got a bare value `<slice>`. Wrap it: `effect=${ ... }`."* (state-child variant cross-refs Form 1).
4. **§34** add the catalog row (`compiler/SPEC.md` §34, ~16895 area — beside the other `E-ENGINE-EFFECT-*`); update the early mirror (~3094) + the §34 prologue count if one is tracked.
5. **SPEC §51.0.B / §51.0.H** normative clause: `effect=` (opener Form 3 AND state-child Form 1) REQUIRES the `${...}` logic-block form; a bare/non-interpolated value is `E-ENGINE-EFFECT-NOT-INTERPOLATED`. The §51.0.B attribute-table row already shows `effect=${...}`; add the "bare → E-..." normative statement.

### Blast radius
2 parser sites (flag-set only) + 2 SYM fire points + 1 §34 row + 1–2 SPEC clauses + tests. Small. **No codegen change** — the `${}` path is untouched; the bare path moves from silent-drop to hard error.

---

## Finding 2 — `E-ENGINE-VAR-DUPLICATE` + `E-ENGINE-003` double-fire (LOW)

### Behavior
A duplicate engine variable fires BOTH `E-ENGINE-VAR-DUPLICATE` (new, §51.0.C) AND `E-ENGINE-003` "Duplicate machine name" (legacy) — redundant noise; both are correct.

### Root cause
`<engine>` decls are shared into both `nodes` (→ SYM PASS 10.A → `E-ENGINE-VAR-DUPLICATE`, `symbol-table.ts:5426`) AND `machineDecls` (→ the legacy validator → `E-ENGINE-003`, `type-system.ts:4981`) per `a41df176`. Every `machineDecls` entry is `kind:"engine-decl"` (ast-builder.js:14176; legacy `<machine>` is a deprecated alias producing the same node). `E-ENGINE-003` fires on any duplicate name without discriminating `<engine>` vs `<machine>`.

### Approach — mutual exclusivity (exactly one code per duplicate)
**Invariant:** `E-ENGINE-VAR-DUPLICATE` (§51.0.C) is canonical for §51.0 **engine**-keyword decls; `E-ENGINE-003` fires only for legacy `<machine>`-keyword decls. Gate `E-ENGINE-003` (`type-system.ts:4978`) to skip engine-keyword decls (and, symmetrically, ensure `E-ENGINE-VAR-DUPLICATE` doesn't ALSO fire for a legacy `<machine>` duplicate — verify the SYM pass scope).

### Phase-0 survey item (depth-of-survey-discount)
The discriminator is the source keyword (`<engine>` vs `<machine>`), already detected for `W-DEPRECATED-001` (ast-builder.js:1146 area). **Survey:** find the flag the engine-decl node carries for the keyword used; confirm whether `E-ENGINE-VAR-DUPLICATE` already fires for legacy `<machine>` duplicates (if so, decide which code wins per form). Pick the cleanest gating that yields exactly-one-code-per-duplicate for both forms.

### Blast radius
1 site (`type-system.ts:4978`) + possibly the SYM scope + a test. Tiny.

---

## Decomposition (one dispatch)
- **S1** parser opener flag (ast-builder.js)
- **S2** parser state-child flag (engine-statechild-parser.ts)
- **S3** SYM fire E-ENGINE-EFFECT-NOT-INTERPOLATED (symbol-table.ts, both loci)
- **S4** §34 row + SPEC §51.0.B/§51.0.H normative clause
- **S5** Fix 2 — gate E-ENGINE-003 to legacy-machine-only (mutual exclusivity)
- **S6** tests — bare opener / bare state-child → E-ENGINE-EFFECT-NOT-INTERPOLATED; canonical `${}` → no fire (regression); engine-var dup → single code; legacy `<machine>` dup → E-ENGINE-003 only
- **S7** empirical recompile — bare `effect=` now errors (not silent); `${}` form still emits the boot call; engine-var dup fires one code

## Verification note
Not a HIGH codegen fix (diagnostic + parser-flag; zero codegen change) — the full S138 R26 mandate is lighter, but S7's empirical recompile of a real `.scrml` repro IS required (confirm the silent-drop is gone + the canonical path is unaffected). PA dual-verifies at landing.

## Cross-refs
S182 dog-food (engine round); SPEC §51.0.B / §51.0.H Form 1 + Form 3 / §34; `feedback_limit_primitives_not_godify`; `feedback_dont_soft_classify_bugs` (silent-drop = bug); `a41df176` (the shared engine-decl instance that created the double-fire).
