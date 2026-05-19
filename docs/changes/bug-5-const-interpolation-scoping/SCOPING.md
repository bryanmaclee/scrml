# Bug 5 — `${IDENT}` interpolation of a `const` produces empty placeholder + no-op JS

**Filed:** 2026-05-19 (S107)
**Surface:** markup-interpolation codegen (`emit-html.ts` placeholder allocation + `emit-event-wiring.ts` reactive-wiring emission + `emit-logic.ts` file-scope statement emission)
**Discovered during:** dogfood pass on `docs/website/app.scrml` (S106 side session; filed as Bug 5 in `handOffs/incoming/read/2026-05-19-0614-side-session-to-scrmlTS-PA-dogfood-bug-surface.md`)
**Severity:** **HIGH.** Markup-as-value pillar L1 misfires on its single most common shape — interpolating a top-level constant into markup. The DOM placeholder is rendered as empty (visible hole in layout); the client JS gets a naked `IDENT;` no-op statement. No diagnostic. Adopter wiring a version pill, footer year, or any compile-time literal via the obvious `${X}` shape sees an empty UI with no error to chase.

**Verified at HEAD `0534c18` (S107 OPEN):** reproducer exhibits the bug exactly as the side-session report described, **plus one new finding** the side-session didn't catch (Anomaly C below — a phantom `_scrml_logic_1` placeholder rendered OUTSIDE the host element from implicit logic-wrap of the bare `const` decl).

---

## §1 Reproducer (minimal)

`app.scrml`:

```scrml
<program>

    const VERSION = "v0.3.0"

    <span class="version-pill">${VERSION}</span>

</>
```

Compile via:

```bash
bun run compiler/src/cli.js build /tmp/bug-5-repro/
```

---

## §2 Observed output (broken)

**`dist/app.html` body:**

```html
<span data-scrml-logic="_scrml_logic_1"></span><span class="version-pill"><span data-scrml-logic="_scrml_logic_2"></span></span>
```

**`dist/app.client.js`:**

```js
const VERSION = "v0.3.0";
VERSION;

// --- Event handler wiring (compiler-generated) ---
document.addEventListener('DOMContentLoaded', function() {

  // --- Reactive display wiring ---
});
```

Three distinct anomalies present in the output.

### Anomaly A — empty placeholder for `${VERSION}` interpolation site

`<span data-scrml-logic="_scrml_logic_2"></span>` is allocated INSIDE the `<span class="version-pill">` host (correct position), but the `// --- Reactive display wiring ---` block is EMPTY — no `el.textContent = VERSION;` line. Result: placeholder renders as empty span; styled version-pill is a visible empty chip; adopter sees a layout hole.

### Anomaly B — orphan `VERSION;` no-op expression statement

`emit-logic.ts`'s file-scope statement walker emits `VERSION;` as a bare expression statement (evaluates the const and discards the value). Pure noise — no behavior, no effect.

### Anomaly C — phantom `_scrml_logic_1` placeholder OUTSIDE the host (new finding S107)

`<span data-scrml-logic="_scrml_logic_1"></span>` is rendered as a sibling BEFORE `<span class="version-pill">`. Source has no second `${...}` and no markup element at that position. Likely cause: the bare `const VERSION = "v0.3.0"` statement directly inside `<program>` body is being implicitly wrapped as a `kind: "logic"` AST node, and `emit-html.ts` emits a placeholder for every `kind: "logic"` node it encounters in markup walk. The placeholder is then unconsumed (declarations aren't interpolations) and renders as a phantom empty span in the DOM.

The side-session report only described Anomalies A and B. Anomaly C is structurally related (same emit-html.ts `kind === "logic"` branch) and amplifies adopter-impact: even adopters who never interpolate a const but who declare any top-level value-style statement inside `<program>` body get phantom DOM nodes injected into their output.

---

## §3 Spec verification (pa.md Rule 4)

Sections read in full from `compiler/SPEC.md` directly:

### §1.4 Markup-as-First-Class-Value (pillar) [line 123-138]

> scrml treats markup as a first-class value type. Markup elements may sit anywhere expressions sit — passed as function arguments, stored in reactive state cells, returned from functions, and placed on the right-hand side of `=` declarations.

§1.4 establishes the bi-directional pillar: markup IS a value AND values appear in markup positions. The `${VERSION}` shape is the latter direction: the value `"v0.3.0"` is placed into a markup-body position via interpolation.

### §7.4 Markup as Expression in Logic Context [line 5250-5268]

> Markup syntax is valid as an expression inside `${ }` logic contexts.
> ```scrml
> let aDiv = <div id="staticId" class=dynamicClass()>;
> ```
> - The compiler SHALL generate DOM construction code for inline markup expressions.

§7.4 covers the reverse direction (markup AS expression in logic context) — not the present bug. Listed for completeness; the surrounding framework matters even where the present bug's exact shape isn't normatively spelled out.

### §7.4.1 Markup-as-expression under the markup-as-value pillar (Stage 0b D4 — L1) [line 5270-5282]

> The L1 pillar (§1.4) raises markup to a first-class value type in scrml... **markup elements may sit anywhere expressions sit.** Pass-as-arg, store-in-cell, return-from-fn, RHS-of-`=`, RHS-of-`const <derived>` (§6.6), inside `lift` (§10), inside slot fills (§16), inside refinement-type predicates that return markup (rare but legal), inside `match` arm RHS (§18), inside `^{}` meta contexts that emit markup (§22) — every one of these loci is a manifestation of the same pillar.

§7.4.1 reframes §7.4 under the pillar. Still describes the markup-AS-expression direction; the bug is the value-INTO-markup direction.

### §3 Context Model — interpolation grid [line 271]

> | Markup body | Not applicable (declarations not in markup body directly) | `${@x}` — interpolation reads the cell value | `<x/>` — render-by-tag if cell has render-spec (Shape 2); see §6.4 |

§3 explicitly names `${@x}` as the interpolation form for reading cell values in markup body. The grid presumes V5-strict `@x` cell access; it does NOT explicitly state behavior for `${ident}` where `ident` is a non-`@`-prefixed local (e.g., a `const`-bound value).

### SPEC §7.6 / §7.6.1 — file-level scope [line 5349 cited via grep]

> A variable declared with `let` or `const` at the top level of a file-level `${}` block SHALL be in scope for all subsequent `${}` blocks and markup interpolations in the same file.

This is the load-bearing statement: **const-bound locals ARE in scope inside `${...}` markup interpolations.** Therefore `${VERSION}` referring to a top-level `const VERSION = "v0.3.0"` is normatively valid and SHALL resolve. The spec does NOT define what the codegen path does when the resolved expression has no reactive deps; the implicit assumption (per pillar L1 + the consistent treatment elsewhere) is that the value displays at that position.

### Spec gap surfaced by this bug

The SPEC has the bi-directional pillar (§1.4 + §7.4.1) and the in-scope rule for file-level locals (§7.6 line 5349) but does NOT have a normative statement of the form: "`${expr}` in markup-body position SHALL evaluate `expr` and display its string value at render time, reactively if `expr` references reactive cells, one-shot otherwise."

Closing this bug likely requires a small SPEC amendment AS WELL AS the codegen fix, so the fix-shape becomes normatively pinned (not just a code change that future maintainers might walk back). Surfaced as **Q-BUG5-OPEN-1** below.

---

## §4 Root cause analysis

Two structurally-related sites:

### Site 1 — `emit-event-wiring.ts:875-960` (Anomaly A — empty reactive-display wiring)

The "Reactive display wiring" emitter handles three cases for each `LogicBinding`:

1. **Transition directives present** → emit transition wiring (lines 826-887).
2. **`varRefs.length === 0 && exprUsesServerFn(expr, serverFnNames)`** → emit one-shot async render (lines 916-926).
3. **`varRefs.length > 0`** → emit `el.textContent = ${rewrittenExpr}` + `_scrml_effect(...)` reactive subscription (lines 928-959).

**There is no else-branch** for "non-empty body, no reactive refs, no server fn." That case falls through and emits nothing. `${VERSION}` (where `VERSION` is a const-bound local) lands exactly there.

### Site 2 — `emit-html.ts:1650-1690` (Anomaly C — phantom placeholder)

The `node.kind === "logic"` branch (line 1650) unconditionally allocates a placeholder via `genVar("logic")` and emits `<span data-scrml-logic="${placeholderId}"></span>`. The branch presumes every `kind: "logic"` node in markup-walk-position is an interpolation that needs DOM presence.

The bare `const VERSION = "v0.3.0"` statement, parsed by `ast-builder.js` as a `kind: "logic"` node (per the implicit-logic-wrap of bare statements inside markup-body), takes this path and gets a phantom placeholder. The placeholder is then unconsumed by any downstream wiring (declarations aren't interpolations to bind to).

### Site 3 — `emit-logic.ts` file-scope statement walker (Anomaly B — orphan `VERSION;` no-op)

The file-scope JS emitter walks every `kind: "logic"` node and emits its body as JS. For `${VERSION}` (body = single bare-expr `VERSION`), it emits `VERSION;` — a syntactically-valid expression statement with no effect. The walker doesn't distinguish "interpolation body (should be consumed by binding wiring, not file-scope statement emit)" from "actual file-scope logic block (legitimate `${ ... }` block at file-level that should emit statements)."

---

## §5 Fix-shape options

### Option α — constant-fold at compile time

When `${expr}` in markup-body position resolves to a compile-time-known value (literal, `const`-bound to a literal, simple arithmetic on constants), inline the string value directly into the markup. Emit NO placeholder. Emit NO JS wiring. Emit NO orphan expression statement.

```html
<!-- α output -->
<span class="version-pill">v0.3.0</span>
```

**Pros:** smallest DOM. Zero runtime cost. Cleanest output. Matches the markup-as-value pillar most literally — the value IS in the markup, fused at compile time.
**Cons:** asymmetric with the reactive case. Requires the codegen to recognize compile-time-constant expressions (constant-folder.ts already exists in `compiler/src/codegen/`). Adopter mental model now has TWO shapes for the same source syntax (compile-time inline vs runtime placeholder), surfaced via output inspection.

### Option β — one-shot startup binding (uniform with reactive case)

Emit the placeholder + emit a one-shot JS write at DOMContentLoaded:

```html
<span class="version-pill"><span data-scrml-logic="_scrml_logic_2"></span></span>
```

```js
document.addEventListener('DOMContentLoaded', function() {
  // --- Reactive display wiring ---
  {
    const el = document.querySelector('[data-scrml-logic="_scrml_logic_2"]');
    if (el) {
      el.textContent = VERSION;
    }
  }
});
```

NO `_scrml_effect(...)` subscription (no reactive deps to subscribe to). Just the initial textContent write.

**Pros:** structurally uniform with the reactive case — same placeholder shape, same wiring shape minus the effect subscription. Adopter mental model has ONE shape. Smallest diff from current code (add an else-branch to `emit-event-wiring.ts:928`). No need to add constant-folding to the codegen path.
**Cons:** more DOM than Option α (the placeholder span persists). More JS than Option α (the one-shot write). Adopter inspecting the rendered DOM sees an extra `<span data-scrml-logic>` for what could be a literal text node.

### Option γ — hybrid: compile-time-constant → inline; otherwise → one-shot binding

Constant-fold when statically possible (Option α); fall back to one-shot binding for non-constant non-reactive expressions like `${Math.random()}` or `${someJsLibCall()}` (Option β).

**Pros:** best of both — clean output where possible, uniform handling everywhere. Adopter writes `${VERSION}` and the optimizer decides; adopter writes `${Date.now()}` and gets a runtime value.
**Cons:** two paths to maintain. The constant-fold decision itself is a small classifier (predicate: "does this expression have any non-pure-literal references?"). More test surface.

### Adopter-facing implication common to all three

Anomaly C (phantom `_scrml_logic_1` placeholder for the bare `const` decl) MUST be fixed regardless of which option is chosen — declarations should NOT emit placeholders in markup-walk. This is a separate site (`emit-html.ts:1650-1690`) and a separate fix. Likely shape: classify the logic-node body — if it contains only declarations (no expressions that need DOM presence), skip placeholder emission.

Anomaly B (orphan `VERSION;` no-op) is a downstream consequence of the same classifier — when emit-logic.ts walks logic nodes and emits their bodies as file-scope statements, it should EXCLUDE interpolation-bodies (which are consumed by binding wiring, not file-scope statement emission). If a logic node was tagged as an interpolation by the parser/HTML-walk, file-scope JS emit should skip its body.

---

## §6 Recommendation

**Option γ (hybrid) preferred.** Reasoning:
- Option α alone leaves a structural gap: `${Date.now()}` and `${Math.random()}` are non-reactive and non-foldable; they need *some* path. Option α has no answer for them; Option β does.
- Option β alone is correct everywhere but always pays the placeholder cost. Adopters using lots of compile-time-known interpolations (version pills, footer years, env config) get DOM bloat that Option α eliminates for free.
- Option γ matches the spirit of L1: markup is a value, and the compiler optimizes when it can.

**Sequencing:**
1. **Phase 1 (PA-direct, ~2-3h)** — fix Anomaly A only via Option β (add the missing else-branch in `emit-event-wiring.ts:928`). Bug 5's headline symptom (empty version pill) closes. Anomaly B and C remain but no longer break adopter-visible behavior.
2. **Phase 2 (PA-direct, ~2-3h)** — fix Anomaly C (phantom placeholder for declaration-only logic nodes in `emit-html.ts:1650-1690`) + Anomaly B (skip interpolation-body in file-scope statement emit). Output cleans up. Adopter inspecting DOM sees the expected structure.
3. **Phase 3 (PA-direct, ~3-5h)** — add constant-folding optimization (Option γ on top of β). Compile-time-known interpolations inline into markup. Spec amendment lands alongside (per Q-BUG5-OPEN-1).

Total: ~7-11h aggregate; Phase 1 alone closes the HIGH-severity symptom.

**Test plan:**
- New unit test file: `compiler/tests/unit/bug-5-const-interpolation.test.js` — assertions on HTML+JS shape for: `${const-string}`, `${const-number}`, `${literal}`, `${@reactive}` (regression), `${nonReactiveJsCall()}` (Phase 1 covers via Option β; Phase 3 stays as Option β not α since non-foldable), `${not-in-scope-ident}` (should fail with E-NAME-NOT-FOUND or similar; regression confirmation).
- Update `examples/` and `docs/website/app.scrml` to revert the side-session workaround (replace literal `v0.3.0` strings back with `${VERSION}`) once Phase 1 lands.

---

## §7 Open questions

**Q-BUG5-OPEN-1 — SPEC amendment shape. RATIFIED S107 (2026-05-19) — Yes, add new §7.4.2.** New normative section "Expressions interpolated INTO markup body" lands alongside the existing §7.4 / §7.4.1 (which cover the reverse direction — markup-AS-expression in logic). Cross-refs from §1.4 (pillar L1) + §3 (context grid) + §7.4.1. Closes the spec gap surfaced by this bug per pa.md Rule 4 (SPEC is normative; codegen behavior must be normatively pinned, not left as undocumented). Lands as part of Phase 3.

**Q-BUG5-OPEN-2 — fix-shape ratification. RATIFIED S107 (2026-05-19) — Option γ (hybrid).** Constant-fold when statically possible (α); fall back to one-shot startup binding for non-foldable non-reactive (β). Reasoning per §6: matches the spirit of L1 (markup is a value; the compiler optimizes when it can); preserves a uniform answer for `${Date.now()}` / `${Math.random()}` / `${someJsLibCall()}` which α-alone cannot handle. Three-phase sequencing per §6 (Phase 1 β only / Phase 2 anomaly cleanup / Phase 3 constant-folding + SPEC §7.4.2). Sub-question on `bun.eval()` results (compile-time-eval'd to literals per §30.2): folds naturally into the Phase 3 classifier — bun.eval'd literals are post-rewrite literals, the constant-folder sees them as such.

**Q-BUG5-OPEN-3 — declaration-only logic nodes. RATIFIED S107 (2026-05-19) — Emitter classifier (not parser change).** Keep the implicit logic-wrap for parse uniformity (S101 §40.8 program-as-container relies on uniform markup-walk of `<program>` body). Emitters classify their wrapped bodies: `emit-html.ts:1650-1690` skips placeholder for declaration-only bodies; `emit-logic.ts` file-scope walker only emits interpolation bodies as expression statements when they're tagged as actual file-level `${ ... }` blocks, not as `${...}`-in-markup interpolations. Small targeted changes; preserves the program-as-container shape S101 ratified. Lands as part of Phase 2.

**Q-BUG5-OPEN-4 — test-bench impact.** Phase 1 changes the JS output for any test fixture that exercises non-reactive `${...}` interpolation. Likely some existing tests assert on the empty-wiring shape and will need updates. **PA-verification standing rule pre-dispatch:** grep test fixtures for `data-scrml-logic` assertions; reconcile per-Phase. Not a separate ratification — folds into each Phase dispatch brief.

**Q-BUG5-OPEN-5 — interaction with §40.8 program-as-container.** S101 made `<program>` body default mode markup; bare statements like `const VERSION = "v0.3.0"` directly inside `<program>` body are now first-class. This bug surface DIDN'T exist (or surfaced differently) under the pre-v0.3 wrapped shape. **PA-verification standing rule pre-dispatch:** regression test added that the fix works for both shapes: bare statement inside `<program>` body (v0.3 shape) AND `${ const VERSION = "v0.3.0" }` explicit-logic-block (pre-v0.3 shape). Not a separate ratification — standing requirement on every Phase's test plan.

**Q-BUG5-OPEN-6 — `~` fallthrough surface (NEW S107, user-surfaced).** `${~}` interpolation in markup body is currently broken with the SAME shape as `${VERSION}` — same code path (`emit-event-wiring.ts:928` `varRefs` regex on line 902 only matches `@IDENT`, not `~`), same fall-through to no-wiring. Empirically confirmed at HEAD `0534c18`: `${ "v0.3.0"; ~ }` compiles to a placeholder + hoisted `_scrml_tilde_N` assignments at file scope + EMPTY wiring block.

**Disposition — rides Bug 5's fix automatically.** The `~` rewriter at `emit-reactive-wiring.ts:372` already hoists multi-statement `${...}` bodies to file scope (initializer → consumer reference). By the time the wiring path runs, the body has been collapsed to a single-reference final form. The Phase 1 else-branch (`el.textContent = ${rewrittenExpr}`) will see the final `_scrml_tilde_N` reference and emit the textContent write correctly. No new code path needed.

**§32.4 boundary rule preserved.** `${~}` standalone in markup body where `~` was set OUTSIDE the `${}` is E-TILDE-001 — that legality boundary is unchanged. Only the LEGAL in-same-block pattern (`${ initializer; ~ }`) is affected, and it's affected by being MADE TO WORK instead of silently no-op'ing.

**Test plan addendum — Phase 1 SHALL include `~` regression cases:**
- `${ "literal"; ~ }` in markup body → placeholder + `_scrml_tilde_N = "literal"` hoisted + `el.textContent = _scrml_tilde_N` in wiring (positive case).
- `${ computeFoo(); ~ }` where `computeFoo()` returns a string → same shape, runtime call as initializer.
- `${~}` standalone in markup body (no in-block initializer) → E-TILDE-001 fires (regression — confirm spec-enforcement unchanged).
- `${ initializer; let x = ~; x }` → exactly-once consumption preserved; final expr is `x`, hoist captures the chain correctly.
- Cross-`${}` boundary case: `${ initializer }` in one block + `${~}` in adjacent block → E-TILDE-001 (regression — §32.4 boundary preserved).

---

## §8 Files affected (preliminary)

| File | Change |
|---|---|
| `compiler/src/codegen/emit-event-wiring.ts:928` | Add else-branch for non-reactive non-server-fn interpolation; emit one-shot `textContent = expr` write (Option β / Phase 1) |
| `compiler/src/codegen/emit-html.ts:1650-1690` | Classifier on logic-node body; skip placeholder emission for declaration-only bodies (Phase 2) |
| `compiler/src/codegen/emit-logic.ts` | Skip interpolation-body in file-scope statement emission (Phase 2) |
| `compiler/src/codegen/constant-folder.ts` | Extend to recognize `${const-string}` / `${const-number}` shapes; mark for inline-substitution (Phase 3) |
| `compiler/SPEC.md` §7.4.2 (NEW) | Normative section on expressions interpolated INTO markup body (Q-BUG5-OPEN-1) |
| `compiler/SPEC.md` §34 | Possibly +1 lint or +1 error code if classifier wants to surface non-resolvable interpolation ident — TBD per Q-BUG5-OPEN-2 |
| `compiler/tests/unit/bug-5-const-interpolation.test.js` (NEW) | Per §6 test plan |
| `docs/website/app.scrml` | Revert side-session workaround (literal `v0.3.0` → `${VERSION}`) after Phase 1 |
| `docs/website/app.scrml` footer | Same (MIT-license line) |

---

## §9 Cross-references

- Side-session report (Bug 5 verbatim): `handOffs/incoming/read/2026-05-19-0614-side-session-to-scrmlTS-PA-dogfood-bug-surface.md` §"Bug 5"
- SPEC §1.4 (markup-as-value pillar) — line 123
- SPEC §7.4 (markup-as-expression) — line 5250
- SPEC §7.4.1 (markup-as-expression under L1 pillar) — line 5270
- SPEC §7.6 file-level scope (const-in-markup-interpolation rule) — line 5349
- SPEC §3 (context model interpolation grid) — line 271
- PRIMER §2 (Pillar L1)
- pa.md Rule 4 (SPEC is normative; derived docs are NOT) — load-bearing on Q-BUG5-OPEN-1
- pa.md Rule 5 + memory `feedback_dont_soft_classify_bugs.md` — Bug 5 IS a bug, not a "doc gap"

---

## §10 Tags

#bug-5 #const-interpolation #markup-as-value #pillar-L1 #emit-event-wiring #emit-html #emit-logic #SCOPING #v0.3.x-candidate #pa-direct #S107
