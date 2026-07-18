# BRIEF — #81 writer-ownership Axiom ① build (exclusive wholesale-owner + compile-error)

**Dispatched:** S268 (bryan), 2026-07-18, recovering S266. **Agent:** scrml-js-codegen-engineer, iso:worktree, background.
**Ruling (bryan, S268):** ① is a NECESSARY PRECURSOR to ② (decomposed-surface merge); build ① first. Both ① and ② are V1-freeze scope. This build = ① only. Do NOT build ② (the runtime accumulator) here — ① is a compile-time-only analysis that ② will later extend.

## Authorities to read FIRST (do not work from this brief alone)
1. **`../scrml-support/docs/deep-dives/i81-writer-ownership-R2-fork-2026-07-17.md`** — THE design authority. Read §"The fork" (axiom ① row), §"Recommendation — ①", §"What ① entails concretely", §"Build path once ruled" IN FULL. The surface-partition + compile-error rule + spec-reconciliation list are specified there verbatim.
2. **The held branch `fix/i81-value-attr-emitter` @ `bcf85c29`** (on origin) — the prior #81 emitter work. Read its on-branch `docs/changes/i81-value-attr-emitter-2026-07-16/progress.md` (487 lines — the per-defect disposition log) + `BRIEF.md`. This branch has BOTH the SOUND fixes to KEEP and the REFUSAL guards to REPLACE.

## The axiom ① (from the DD, do not re-derive)
Per physical DOM surface (`className`, `style`/`display`, `.value`, each boolean-attr, each `data-*`/generic attr):
- **Composers** (own their own slice; always allowed to coexist): per-token/per-property writers — `class:foo` (classList.toggle), transition classes, `show=`/`if=` (`.style.display`).
- **Exclusive owners** (wholesale writers of the whole surface): `class=(expr)`, `style=(expr)`, template-lit `class="x-${v}"`, the new `value=(expr)`.
- **Rule:** a wholesale writer + ANY other writer on the same physical surface → a NEW `E-*-WRITER-CONFLICT` compile-error naming BOTH sites. A SOLE wholesale writer → emit the binding (this is the #81 fix). Sole/multiple composers → fine.

## What to build (compile-time analysis; NO runtime machinery)
1. **Premise-verify on current main `510cef8d`** — the DD's writer-inventory file:lines are from S265 (main has moved ~6×). Re-locate the 7 writers on current main (emit-bindings, emit-event-wiring, emit-html, emit-variant-guard) before touching anything. Note #104 touched attribute-registry/route-inference/emit-expr; #99 touched session/emit-server — factor into the rebase.
2. **Rebase the held branch onto current main `510cef8d`** (or cherry-derive) — resolve conflicts (emit-html.ts / emit-event-wiring.ts likely overlap session/CSS lands). Re-verify green baseline after rebase.
3. **KEEP the sound fixes** the branch already has: F5 (`.value` property write), F6 (thenable), D2 (selector-sanitize), F7/F8 (component-prop discrimination), the NR-authoritative resolvedKind routing, CSS-safe placeholder keys. These are correct and reused by ② later.
4. **REPLACE the refusal guards** (F3 style-wipe drop, D5 bool-attr drop, F2 — the `W-CG-VALUE-ATTR-*` drop-attr+warn "coordination by refusal") with the surface-partition conflict ANALYSIS: build the writer-set per surface at compile time, apply the ① rule. `css-conflict-check.ts` already tracks `condClasses` — reuse that machinery for the analysis.
5. **New diagnostic** `E-*-WRITER-CONFLICT` (pick the canonical name per §34 conventions — e.g. `E-REACTIVITY-WRITER-CONFLICT` or `E-ATTR-WRITER-CONFLICT`; align with the existing E-ATTR-012 / E-REACTIVITY-ATTR-CONFLICT family) naming BOTH conflicting sites + suggesting the author pick one wholesale owner.
6. **Spec reconciliation (SPEC.md):** promote §5.5.4 `class={expression}` out of "(Planned)"; correct §5.5.3's false "independent… SHALL NOT treat as a conflict" claim (a template-lit/`class:` mix IS a conflict under ①); add the new error code to §34. Cross-check the current §5.5.x line numbers (spec moved since the DD's L1765/1866/1890 refs).

## Test / verify bar (S239 + R26 mandatory before land)
- The branch's `compiler/tests/unit/value-attr-binding-i81.test.js` (869 lines) — update to assert the ① model: sole-wholesale COMPILES; wholesale+other on one surface ERRORS with the new code naming both sites; composers coexist.
- **R26 empirical (MANDATORY):** compile Peter's `assetManagement/portal.scrml` shape — the 7 dead bindings (`class=(cond?'a':'b')`, all SOLE writers) MUST now COMPILE (unblocks #81); an ambiguous `class=(expr)` + `class:foo` mix MUST ERROR. If you don't have portal.scrml, synthesize the exact shapes from the DD's writer table.
- Full `bun test compiler/tests/{unit,integration,conformance} --bail` → 0 new fails. Conformance: add a case pinning the new writer-conflict code (codes-half) + the sole-owner emit (runtime-half) — this is the merge-blocker for the surface per the GATE.
- **Validate emitted client JS with an Acorn `sourceType:"module"` parse**, not `new Function()` (S267 lesson — sloppy-mode false-passes).

## Constraints
- iso:worktree; commit INCREMENTALLY (crash-recovery anchor); path discipline (never Write via a main-rooted absolute path — worktree only).
- Do NOT push to main / do NOT open the PR — return to PA for the S239 adversarial gate. PA lands on bryan's authz.
- Archive this brief to `docs/changes/i81-writer-ownership/BRIEF.md` on your branch + a `DONE-PROBE:` line + a `progress.md`.
- Return: a summary of the surface-partition impl, the new error code name, the spec deltas, the R26 result (portal shapes compile / mix errors), and the test delta.
DONE-PROBE: bun test compiler/tests/unit/value-attr-binding-i81.test.js 2>&1 | grep -q '0 fail' && bun test compiler/tests/conformance/conf-ATTR-WRITER-CONFLICT.test.js 2>&1 | grep -q '0 fail'
