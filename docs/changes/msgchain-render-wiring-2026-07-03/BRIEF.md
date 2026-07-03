# BRIEF — §55.10 message-resolution render wiring (reproduce-first) (S236)

**Gap:** `g-msgchain-render-wiring` (docs/known-gaps.md §S236). **Ruling (user S236): reproduce-first fix.**

## The gap (PA Rule-4/R26 workup — the escalation was OVER-READ; corrected)
§55.10 (`compiler/SPEC.md:32370`) = **Lock 12**, the 4-level error-message resolution chain: L1 inline override (`<name req("msg")>`) → L2 `registerMessages({...})` → L3 shipped English defaults → L4 `<match for=ValidationError on=@field.errors[0]>` escape hatch. All four are normative + composing (Level N > Level N+1).

sPA ss57 escalated (E3): "L1/L2 ignored at render, `messageFor` always returns L3, L4 crashes — a claimed pillar with ~no runtime." **That is an OVER-READ — the machinery EXISTS.** PA source-verification:
- `_scrml_message_for(error, fieldName, cellName)` (`compiler/src/runtime-template.js:3497`) WALKS L1→L2→L3 and consults the registered table `_scrml_messages_registered` (`:3517`). `registerMessages` (`:3477`) + `_scrml_messages_register_inline` (`:3466`) both present. `stdlib/data/messages.scrml` exports `messageFor` + `registerMessages` delegating to these.

The REAL defects are localized wiring bugs:
- **(a) L1 — CONFIRMED (the clear lead):** the `<errors of=>` auto-render path emits `messageFor(tag, fieldName)` **WITHOUT `cellName`** (`compiler/src/codegen/emit-html.ts:1122` + `:1192`), but the L1 branch in `_scrml_message_for` requires `cellName` to look up the per-(cell,validator) inline override. So inline overrides are NEVER consulted in the default render path → always falls through to L2/L3.
- **(b) L2 — UNCONFIRMED:** the runtime DOES consult `_scrml_messages_registered`, so a registered message SHOULD render — but a tree-shake / stub-fallback path (`emit-event-wiring.ts:1032` — a local `messageForFn` stub that prefers a global `_scrml_message_for` if present, else returns a default) can degrade to L3-only when the messages chunk is shaken out. Determine empirically whether L2 actually renders end-to-end.
- **(c) L4 — reportedly CRASHES** (`<match on=@field.errors[0]>`), PA-unreproduced. A separate consumer-path defect.

## Task
1. **Phase 0 — R26 reproduce-FIRST (the crux — this ruling is reproduce-first).** Build minimal scrml probes and capture what ACTUALLY renders vs SPEC for each level:
   - L1: a field with an inline override `<name req("Please enter your name")>` + an `<errors of=@form.name/>`, force the error, observe the rendered string. Does the override appear, or the L3 default?
   - L2: a `registerMessages({.Required: (f) => \`${f} is required\`})` + `<errors of=>`, observe. Does the registered string appear? Also test the tree-shake shape (does the chunk survive?).
   - L4: the `<match for=ValidationError on=@field.errors[0]>` block — reproduce the reported crash; capture the exact error + stack locus.
   Report a per-level verdict: works / broken-and-why-localized.
2. **Phase 1 — fix each confirmed defect, localized:**
   - **L1:** thread `cellName` through the `<errors of=>` render call so `_scrml_message_for(tag, fieldName, cellName)` gets the qualified cell name (the emit-html.ts:1122/1192 call site). The inline-override storage (`_scrml_messages_register_inline`) already keys by `(cellName, validatorName)` — supply the matching cellName at the call site.
   - **L2:** if broken, fix the registration-reaching-runtime or the tree-shake that drops the messages chunk when a registration exists.
   - **L4:** fix the crash at its localized site.
   Do the MINIMUM per defect — this is bug-fix, not a rebuild. If a level turns out to already work (R26 reverse — the escalation was wrong on it), report NOT-REPRODUCED for that level and do not "fix" it.
3. **Conformance:** author the RUNTIME halves the sPA parked (it shipped only the CODES half — `forms/msgchain-*`). Add RT cases under `conformance/cases/forms/` asserting the rendered string for L1 override + L2 registered (+ L4 if the escape renders post-fix). Capture from YOUR fixed impl, SPEC-sanity-check. Run `bun conformance/run.ts`, report the delta.

## Adversarial (S215) — must-not-break
- L3 shipped defaults still render for fields WITHOUT an override/registration (the zero-config floor).
- A field with no inline override is unaffected by the cellName threading.
- The `E-VALIDATOR-INLINE-*` compile-time codes (COLON/DYNAMIC) still fire (don't regress the codes half the sPA already pinned).
- Non-error render paths byte-identical where possible.
- Full pre-commit suite green (hook gates — no `--no-verify`).

## Mechanics
- `isolation: 'worktree'`, model opus. Commit INCREMENTALLY. Write ONLY inside your worktree (S99/S126 path discipline; verify no main-checkout leak via `git status`).
- Touches: `compiler/src/codegen/emit-html.ts`, `compiler/src/runtime-template.js`, possibly `emit-event-wiring.ts` + `emit-messages.ts` + `conformance/cases/forms/`. (DISJOINT from the parallel fail-variant dispatch, which owns `type-system.ts` + `conformance/cases/error/`.)
- Report: per-level Phase-0 verdicts, each fix locus, the conformance delta, adversarial results, FINAL_SHA. PA re-integrates via S67 file-delta at completion.
