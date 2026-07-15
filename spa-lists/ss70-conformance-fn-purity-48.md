# sPA ss70 — conformance authoring: fn-purity §48/§33 (freeze-gate, WAVE A soundness)

**Launch:** `read spa.md ss70` · **Branch:** `spa/ss70` · **Worktree:** `../scrml-spa-ss70`

**Fill:** conformance-authoring toward the language-1.0 FREEZE bar (S256 tier-1). The `fn` **pure-contract**
(§48) is a soundness pillar — a `fn` body is a pure, deterministic, effect-free value function; the
compiler enforces that with the `E-FN-*` family (`type-system.ts` §48 body-prohibition walker, ~23297+).
The S256 audit found **8 fn-purity codes with ZERO conformance coverage** — this is the silent-wrong /
purity-violation class, highest freeze risk. NEW S256 · **fireable now** (pure conformance-corpus data —
disjoint from all compiler-source). This list enumerates the CODES; the fired sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS" — author from
impl#1 → **SANITY-CHECK vs the SPEC §48 subsection** → **ESCALATE** any impl#1-vs-SPEC divergence (do NOT
enshrine impl#1 against the spec); verify each case GREEN on `bun conformance/run.ts`; the schema +
capture→review→escalate discipline live in `conformance/README.md`. Grep each `E-FN-*` code live in
`compiler/src/type-system.ts` for its exact trigger/message before authoring. All harness-clean (pure
compile-time body walk; no timers/DB/WS).

## Core files
`conformance/README.md` (schema + method) · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/hostmethod/` + `conformance/cases/derived/` (mirror for fn/logic cases) ·
`compiler/src/type-system.ts` §48 walker (~23297-23400, the E-FN-* prohibition list) · `compiler/SPEC.md`
§48 + §33 (normative — read the named subsection per code)

## Items (one code per item; the reject path + a clean neg)
> **NOTE — E-FN-006 is RETIRED** (S32, §54 universal scope; `type-system.ts:23305`). Do NOT author it.

1. **E-FN-001** (codes) `[status=pending]` — `?{}` SQL access inside a pure `fn` body (§48.3.3; `type-system.ts:23670`). Pos (`fn` body with a `?{}` block → E-FN-001) + neg (SQL in a `function`/logic context → silent).
2. **E-FN-002** (codes) `[status=pending]` — a DOM-mutation call inside a `fn` body (`type-system.ts:23903`). Pos + neg (pure value computation → silent).
3. **E-FN-003** (codes) `[status=pending]` — a reactive-variable write (`@cell = …`) inside a `fn` body (§48.3.3; `type-system.ts:23718`). Pos + neg (read-only `@cell` use → silent).
4. **E-FN-004** (codes) `[status=pending]` — a non-deterministic call (`Date.now`/`Math.random`/`crypto.randomUUID`, §48; `type-system.ts:23812`) inside a `fn` body. Pos + neg (deterministic pure calls → silent).
5. **E-FN-005** (codes) `[status=pending]` — `async`/`await` on the `fn` declaration itself (`type-system.ts:23336`). Pos + neg (sync pure `fn` → silent).
6. **E-FN-007** (codes) `[status=pending]` — branches return different `<state>` types without an explicit union return type (`type-system.ts:23993`). Pos (divergent-branch return, no annotation → E-FN-007) + neg (explicit union return type → silent).
7. **E-FN-008** (codes) `[status=pending]` — a `lift` statement targeting an outer-scope `~` accumulator from inside a `fn` (`type-system.ts:23712`). Pos + neg (lift in a `function`, §48 shorthand exempt → silent).
8. **E-FN-ARROW-BODY** (codes) `[status=pending]` — the `fn` arrow-body form rejected (§48; `ast-builder.js:378` `node.fnArrowDiagnostic`). Pos (arrow-body `fn` → E-FN-ARROW-BODY) + neg (block-body `fn` → silent).

**Definition of done:** all 8 fn-purity codes pinned (codes-half; reject-path pos + clean neg per code);
every case GREEN on `bun conformance/run.ts`; any impl#1-vs-SPEC §48 divergence ESCALATED (not enshrined).
Outcome: the `fn` pure-contract moves from ZERO-coverage to conformance-COMPLETE on the diagnostic edge.

## Progress
`spa-lists/ss70.progress.md`. Land per-item on `spa/ss70`; ping the PA inbox (`handOffs/incoming/`) per
item with `{item, case-ids, run.ts green?, any impl#1-vs-SPEC divergence}`. Do NOT advance main / push.
PA re-integrates via file-delta (`conformance/cases/*` pure-additive data) + confirms run.ts green
independently. ESCALATE (do not decide): any impl#1-vs-SPEC divergence.
