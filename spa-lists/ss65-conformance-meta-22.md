# sPA ss65 — conformance: meta `^{}` §22 (compile-time meta / reflect)

**Launch:** `read spa.md ss65` · **Branch:** `spa/ss65` · **Worktree:** `../scrml-spa-ss65`

**Fill:** conformance-authoring cluster (compile-time + 1-2 emit-splice runtime on existing `run()`), ~12-13 cases · NEW S252

## Shared ingestion
Author conformance cases pinning **§22 `^{}` meta** — implemented; Approach C closed the runtime `meta`
API at 12 primitives (§22.12). Currently **0 cases reference `E-META-*`/`reflect(`.** Dominated by the
**compile-time `E-META-*` family** (`E-META-004` is Reserved — SKIP); a couple of `emit()`-splice cases
are runtime-observable through the ordinary `run()` (NO new driver). Contract = codes + (for splice) the
normalized DOM. **Mirror `conformance/cases/error/` + `conformance/cases/block-grammar/`** for the negs;
`reactive/render-static`-style for the splice. Read the README case-format section FIRST.

## Core files
`conformance/README.md` · `conformance/run.ts` · `conformance/normalize.ts` (for the splice DOM cases) ·
`compiler/SPEC.md` §22 (**§22.4 compile-time ~15319-15547 · §22.11 code summary ~15918-15932**) ·
`conformance/cases/error/` + `conformance/cases/block-grammar/` (pattern-to-mirror)

## Items (author each; commit per-case)
1. **`meta-runtime-var-in-compiletime-neg`** `[status=open]` — a runtime `@cell` (or a JS-host ambient `bun`/`process`/`console`/`fetch`/`setTimeout`, the Approach-C ban) in a compile-time `^{}` → **E-META-001**.
2. **`meta-invalid-token-neg`** `[status=open]` — invalid token inside `^{}` → **E-META-002**.
3. **`meta-reflect-unknown-type-neg`** `[status=open]` — `reflect(NoSuchType)` → **E-META-003**.
4. **`meta-mixed-patterns-neg`** `[status=open]` — `^{}` mixes compile-time API with runtime-only values → **E-META-005**.
5. **`meta-lift-in-block-neg`** `[status=open]` — `lift` inside `^{}` → **E-META-006**.
6. **`meta-sql-in-runtime-block-neg`** `[status=open]` — `?{}` SQL inside a runtime `^{}` → **E-META-007**.
7. **`meta-reflect-outside-block-neg`** `[status=open]` — `reflect()` outside any `^{}` → **E-META-008**.
8. **`meta-nested-block-neg`** `[status=open]` — nested `^{}` inside a compile-time `^{}` → **E-META-009**.
9. **`meta-compiler-namespace-neg`** `[status=open]` — reference to reserved `compiler.*` → **E-META-010**.
10. **`meta-reflect-clean-pos`** `[status=open]` — well-formed `^{ reflect(User) }` fires nothing → `notCodePrefixes:["E-META-"]`.
11. **`meta-emit-clean-pos`** `[status=open]` — well-formed `^{ emit("<p>..</p>") }` fires nothing.
12. **`meta-emit-splice-render-rt`** `[status=open]` — top-level `^{ emit("<p id=x>hi</p>") }` splices markup → `domAnchored:[{selector:"#x",text:"hi"}]` (carry `spec`+`rationale`, runtime case).
13. **`meta-emit-raw-escape`** `[status=open, optional]` — §22.4.1 `\n` normalization in `emit()`.

## Progress
`ss65.progress.md`. Land on `spa/ss65`; ping the PA inbox when ready. Do not touch main / do not push.
