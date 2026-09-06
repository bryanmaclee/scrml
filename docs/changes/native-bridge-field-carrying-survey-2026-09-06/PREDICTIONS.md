# Predictions, recorded BEFORE the experiment ran

Each is stated with its basis, then checked by `bridge-survey-repair.ts`. Result appended
below each once measured.

## P1 — `logic.typeDecls` is INERT

**Signature:** `logic.typeDecls: LIVE-HAS / NATIVE-EMPTY` — the single largest field-level
divergence signature, present in **61 of the 156** newly-missing cases (39%).

**Prediction: repairing it recovers 0–4 of the 61.**

Basis (`verified by reading`): every located consumer of `typeDecls` in `compiler/src/` reads
the **root** `ast.typeDecls` / `fileAst.typeDecls`, not the per-`logic`-node one —
`name-resolver.ts` (3 sites, `ast.typeDecls`), `symbol-table.ts`
(`getEnumVariantsFromTypeDecls(fileAst.typeDecls, ...)`), `type-system.ts`
(`fileAST.typeDecls ?? fileAST.ast?.typeDecls`). The native bridge DOES populate the root
`typeDecls` correctly (`verified by execution`, inspect-case on `api/api-base-missing-neg`:
native root `typeDecls` has both decls; native `logic.typeDecls` is `[]`).

So the 61/156 co-occurrence is a **confound**: the signature fires on any case that declares
a type at file top level, which is most negative-test cases. It is not the cause.

RESULT — **P1 HELD** (`verified by execution`, `artifacts/repair.log`). Baseline discipline
first: `repair=none` reproduces `still-missing 156/156`, so the `selfHostModules.buildAST`
injection point is equivalent to the flip. Then `repair=typeDecls` -> `still-missing 156/156`,
**RECOVERED 0**. The largest field-level signature in the survey is INERT.

## P2 — `<api>` is a real parser divergence, not a missing field

**Signature:** `KIND-ABSENT api-decl` (9 cases) + `KIND-ABSENT endpoint-decl` (12 cases) = 21
cases, disjoint sets by absent-kind grouping.

**Prediction: no field copy recovers these. The native parser emits a generic `markup` node
with `tag: "api"` for `<api>`; the whole `api-decl` / `endpoint-decl` production is
unimplemented.**

Basis (`verified by execution`, inspect-case on `api/api-base-missing-neg`): live emits
`{kind: "api-decl", base, src, endpoints:[...]}`; native emits
`{kind: "markup", tag: "api", children: [text, logic, text]}` — the endpoint line is left as
an unparsed `logic` child. This is a production the native grammar does not have, so it costs
a grammar rule, not a bridge assignment.

RESULT — **P2 HELD** (`verified by execution`, `artifacts/repair2.log`). No field repair moved
any of the 21. The stronger check is stage 3's `allFieldKeys` (typeDecls + the three
`function-decl` keys + the two `engine-decl` keys applied together): `still-missing 156/156`,
**RECOVERED 0**.

## P3 — the legacy string-TEXT fields are the only real plumbing cluster, and they are small

**Signature:** in the "field/count only" bucket the dominant value-level divergence is on the
legacy string text fields. `verified by execution` (stage 4, `valuediff.log`):

- live `state-decl.init` = `"[ \"a\" , \"b\" ]"` (live's TOKEN-JOIN re-print)
- native `state-decl.init` = `"[\"a\", \"b\"]"` (native's `emitStringFromTree` AST re-print,
  installed by `backfillNativeExprText`, compiler/src/native-walker/exprtext-backfill-walker.ts)

and, worse, `maps/literal-malformed-pos`: live `"[ \"DAL\" : ]"` vs native `"[:]"` — the
re-print DESTROYED the malformed text the check needs. The un-migrated regex-over-TEXT checks
(`checkLifecycleBindingAccess` and friends) read these strings, so they stop matching.

**Prediction: an ORACLE repair — copy live's `init`/`expr`/`condition`/`raw`/`bodyRaw`/
`typeAnnotation` onto shape-matched native nodes — recovers 10–30 of the 156, essentially all
of it inside the 28-case field/value bucket, with little or no effect on the 114 cases that
carry a native parse error or an entirely absent node kind.**

If it recovers far MORE than 30, the text-field class is the structural gap and the estimate
collapses. If it recovers ~0, then even the field bucket is not plumbing and nothing collapses.

RESULT — **P3 FAILED, on the low side** (`verified by execution`, `artifacts/repair3.log`).
Predicted 10–30; the oracle recovered **8**. The eight:
`engine/derived-engine-markup-write`, `engine/derived-engine-no-initial-pos`,
`engine/derived-engine-no-rules-pos`, `engine/derived-engine-statechild-write`,
`error/renders-undefined-var`, `lifecycle/effect-on-derived-engine`,
`loop/w-assign-001-severity-pos`,
`type-state-codes/e-type-lifecycle-variant-not-transitioned-pos` — seven of the eight are
`engine-decl` text slots (`derivedExprText` / `inlineMatchBody` / `openerEffect`).

I over-estimated the text-field class by ~2x. The direction of the error matters: the survey's
conclusion (field-carrying is NOT the gap) gets STRONGER, not weaker, from the miss. An ORACLE
that is allowed to consult the live parser and copy fifteen text slots wholesale still leaves
**148 of 156** broken.
