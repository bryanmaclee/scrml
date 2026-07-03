# sPA ss57 — conformance authoring: validators + validity surface §55 + formFor runtime (freeze-gate, flagship pillar #2)

**Launch:** `read spa.md ss57` · **Branch:** `spa/ss57` · **Worktree:** `../scrml-spa-ss57`

**Fill:** conformance-authoring toward the language-1.0 freeze bar (S235). The auto-synthesized validity surface (§55) is a flagship pillar; the built suite has 3 shallow cases (`conformance/cases/forms/{validator-valid,validator-invalid,isvalid-rollup}`) covering only isValid + per-field errors. The universal-core vocab breadth, touched/submitted, `<errors of=>`, cross-field, the message chain, and multi-error are UNCOVERED. Also closes the flagship **formFor §41.14 runtime half** — `conformance/cases/form-for/formfor-validity-bug58-clean` is explicitly `"runtime-half-pending"` (the marquee demo has NO (b) half). NEW S235 · **fireable now** (data-only; disjoint from ss55/ss56).

**Method + harness ceiling + escalate-divergence discipline:** identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" (author-from-impl#1 → sanity-check-vs-SPEC → ESCALATE any divergence; verify each with `bun conformance/run.ts`; mirror existing cases; SPEC is normative — read the §55.x subsection in full per item). Harness = compile + happy-dom mount + 7 selector verbs + serverStub-fetch (`conformance/README.md` / `driver.ts`). §55 is fully harness-clean (form interaction, no timers/DB).

## Shared ingestion
The validity surface: §55 (universal-core §55.1 · isValid/errors §55.5/.6 · touched/submitted §55.7 · `<errors of=>` §55.8 · message chain §55.10 · cross-field §55.11 · multi-error/short-circuit §55.12 · reset interaction §55.13 · derived-reject §55.14) + formFor §41.14. Mirror `conformance/cases/forms/*` + the pending `form-for/` case.

## Core files
`conformance/README.md` · `conformance/cases/forms/` + `conformance/cases/form-for/` (existing) · `conformance/run.ts` · `compiler/SPEC.md` §55 + §41.14 (normative)

## Items (least-ingestion-first)
1. **universal-core vocab breadth §55.1** (RT) `[status=landed spa/ss57]` — one case exercising each predicate valid+invalid → the right `ValidationError` tag: `length`/`pattern`/`min`/`max`/`gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`oneOf`/`notIn` (+ `req`/`is some` already shallow-covered). Assert `@field.errors[0]` tag + `@field.isValid`.
2. **touched / submitted §55.7** (RT) `[status=landed spa/ss57]` — interaction → `@field.touched` true; document-submit → `@compound.submitted` true; the timing table.
3. **`<errors of=expr/>` §55.8** (RT) `[status=landed spa/ss57]` — renders per-cell errors + the compound rollup; `all` attr toggles full-array vs first-error.
4. **cross-field predicate-args §55.11** (RT) `[status=landed spa/ss57]` — `<confirm req eq(@password)>` → validity depends on the other cell; change the source → confirm re-validates.
5. **4-level message-resolution chain §55.10** (RT+codes) `[status=landed spa/ss57]` — inline `req("msg")` > registered > `scrml:data` default; the colon-form `req:"…"` is NOT valid (codes).
6. **multi-error / short-circuit §55.12** (RT) `[status=landed spa/ss57]` — a field failing multiple predicates → the error order / req-short-circuit rule.
7. **validators-on-derived reject §55.14** (codes) `[status=landed spa/ss57]` — `E-DERIVED-WITH-VALIDATORS` on a `const`-derived cell carrying validators.
8. **formFor §41.14 runtime half** (RT) `[status=landed spa/ss57]` — closes the `runtime-half-pending` case: define a `:struct` → `formFor` renders the `<form>` + validity surface wired + submit produces the field values; per-field errors render. FLAGSHIP.

**DoD:** the validity surface moves SHALLOW→conformance-COMPLETE; formFor gains its (b) half; all green on `bun conformance/run.ts`; divergences escalated.

## Progress
`spa-lists/ss57.progress.md`. Land per-item on `spa/ss57`; ping PA inbox per item. Do NOT push. PA re-integrates (S67 file-delta + independent run.ts green). ESCALATE any impl#1-vs-SPEC divergence.
