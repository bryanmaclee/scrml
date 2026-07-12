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
1. **`meta-runtime-var-in-compiletime-neg`** `[status=landed-RENAMED 6ff46b6e]` — RENAMED → **`meta-jshost-global-neg`**. FINDING: the primary trigger (runtime `@var` in a compile-time `emit` block) fires **E-META-005** (phase-mix), NOT E-META-001 — §22.11 condition-(1) is shadowed by E-META-005 and is not isolable from source. Pinned E-META-001 via the sanctioned Approach-C JS-host-global path (`console` in a `^{}` body) → **E-META-001** (isolable, clean).
2. **`meta-invalid-token-neg`** `[status=landed 6ff46b6e]` — invalid token inside `^{}` → **E-META-002**.
3. **`meta-reflect-unknown-type-neg`** `[status=landed 6ff46b6e]` — `reflect(NoSuchType)` → **E-META-003**.
4. **`meta-mixed-patterns-neg`** `[status=landed 6ff46b6e]` — `^{}` mixes compile-time API with runtime-only values → **E-META-005**.
5. **`meta-lift-in-block-neg`** `[status=landed 6ff46b6e]` — `lift` inside `^{}` → **E-META-006**.
6. **`meta-sql-in-runtime-block-neg`** `[status=landed 6ff46b6e]` — `?{}` SQL inside a runtime `^{}` → **E-META-007**.
7. **`meta-reflect-outside-block-neg`** `[status=landed 6ff46b6e]` — `reflect()` outside any `^{}` → **E-META-008**.
8. **`meta-nested-block-neg`** `[status=landed 6ff46b6e]` — nested `^{}` inside a compile-time `^{}` → **E-META-009**.
9. **`meta-compiler-namespace-neg`** `[status=landed 6ff46b6e]` — reference to reserved `compiler.*` → **E-META-010**.
10. **`meta-reflect-clean-pos`** `[status=landed 6ff46b6e]` — well-formed `^{ reflect(User) }` fires nothing → `notCodePrefixes:["E-META-"]`.
11. **`meta-emit-clean-pos`** `[status=landed 6ff46b6e]` — well-formed `^{ emit("<p>..</p>") }` fires nothing.
12. **`meta-emit-splice-render-rt`** `[status=landed 6ff46b6e]` — top-level `^{ emit("<p id=x>hi</p>") }` splices markup → `domAnchored:[{selector:"#x",text:"hi"}]` (carry `spec`+`rationale`, runtime case).
13. **`meta-emit-raw-escape`** `[status=landed-PAIR 6ff46b6e]` — §22.4.1 realized as a PAIR: **`meta-emit-raw-escape`** (raw verbatim, literal `\n`) + **`meta-emit-normalize-escape`** (bonus sibling, `emit` normalizes literal `\\n`→space). The distinction only surfaces with a literal double-backslash source; each alone is weaker, so both authored for an honest contrast.

## Progress
`ss65.progress.md`. Land on `spa/ss65`; ping the PA inbox when ready. Do not touch main / do not push.

**DONE (sPA ss65).** All 13 items landed on `spa/ss65` (14 cases: item-1 renamed, item-13 a pair). Cases commit `6ff46b6e`; suite 386→400. 0 parked. Re-integration signal in `handOffs/incoming/`.
