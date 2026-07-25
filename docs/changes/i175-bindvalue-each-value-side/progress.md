# i175 — `bind:value` value-side wiring inside `<each>` (GH adopter #175)

## Status: IMPLEMENTATION COMPLETE — tests green

## 2026-07-24

### DONE
- **Root fix** (`compiler/src/codegen/emit-each.ts`): the per-item attr emitter
  (`renderTemplateAttrToJs`) no longer silently no-ops `bind:*`. For an OUTER /
  shared reactive cell (`bind:value=@msg`) it now wires the value side by REUSING
  the root-agnostic `emitBindDirectiveBody` helper (emit-bindings.ts) — same
  lowering the top-level + match-arm paths use — with:
    - `acquire` returning the freshly-created element local `elVar` directly (no
      querySelector — the each factory builds DOM imperatively);
    - `wrapEffect` = `wrapEachValueSideEffect`, which injects the
      `_scrml_resolve_item(...)` item-resolution prelude into the read-back effect
      so it disposes with the item across keyed reconcile (goes inert on the
      reconcile path when its key is gone — no write to a detached node).
  File-scoped inputs (enum / reactive-type / compound maps + the diagnostic sink)
  are published once per file via a module-level `_eachBindSupportCtx` set at
  `emitEachBodyRenderForFile` entry (mirrors the `_eachReconcileCtxStack`
  pattern), cleared in a `finally`. When UNSET (Tier-0 lift path) the bind branch
  falls back to the pre-i175 deferred comment — byte-identical, no regression.
- **Deferred LOUDLY**: item-field RHS (`bind:value=@.field` / `@<iterVar>.field`)
  emits the NEW `W-EACH-BIND-ITEM-FIELD-DEFERRED` warning (+ a comment) instead
  of a silent no-op. `ref=`/`transition:`/`in:`/`out:` stay deferred as before.
- **§34 catalog**: added the `W-EACH-BIND-ITEM-FIELD-DEFERRED` row (compiler/SPEC.md).
- **Tests**:
  - unit `compiler/tests/unit/each-bind-value-i175.test.js` — 7 pass (outer-cell
    wired / item-field warns / top-level byte-identical guard).
  - browser `compiler/tests/browser/each-bind-value-i175.browser.test.js` — 7 pass
    (two-way canary: programmatic write→input.value, input event→@msg, fan-out;
    disposal-on-shrink via the reconcile path).

### EMPIRICAL (adopter repro recompiled)
- GREP A: reactive value-side wiring `.value = _scrml_reactive_get("msg")` PRESENT.
- GREP B: the `bind:value" deferred (Landing 2 scope` comment GONE for the wired input.
- Executed-DOM two-way confirmed in happy-dom (both directions).
- `bind:value=@.text` fires `W-EACH-BIND-ITEM-FIELD-DEFERRED`.

### CAVEAT (pre-existing, out of scope)
- Shrink to EMPTY when the `<each>` has an `<empty>` fallback takes the
  empty-guard branch (`replaceChildren()`), bypassing `_scrml_reconcile_list`, so
  per-item effects are not re-run to inert. This is a shared each-runtime
  reconcile-reactivity boundary affecting ALL per-item effects (text/class/attr),
  documented as DEFERRED by each-body-interactivity-landing2. i175 owns the
  RECONCILE-path disposal (shrink-to-nonempty / same-key), which is asserted green.

### Regression checks (all green)
- bind-value + each-block + bind-value-component-expansion: 118 pass / 0 fail.
- each-body-interactivity-landing2 + each-in-tier0-lift-bug72 + bug-11 lift: 22 pass / 0 fail.

### Final test counts (after)
- unit: 16779 pass / 0 fail (17 skipped), 850 files — includes the 7 new i175 unit tests.
- integration + conformance: 4433 pass / 6 fail, 298 files. The 6 failures are ALL
  pre-existing/environmental and outside this change's blast radius (emit-each per-item
  bind wiring): 4× self-host-smoke (buildImportGraph / resolveModules parity + "compiled
  tab.js exists" — cross-OS path + missing self-host build artifact, the MEMORY
  cross-os-forced-posix class), 1× B5 CSRF runtime guard (session/csrf middleware), 1×
  unnamed teardown. None touch codegen/bindings; self-host-smoke does not import emit-each.
- Targeted regression: bind-value + each-block + component-expansion 118/0; each browser
  landing2 + tier0-lift + bug-11 22/0; new i175 unit 7/0 + browser 7/0.

### DONE (wrap)
- Committed on branch i175-bindvalue-each-value-side.
