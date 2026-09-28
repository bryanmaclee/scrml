# s440-e-error-002-handler-conformance — progress (append-only)

## 2026-09-28 — start
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae3f795fdfd7f8631`, base `d244a6f3b` (== origin/main).
- Maps: primary.map.md read; no map mentions E-ERROR-002 or a handler exemption. schema.map.md's `handlerBlock` entry (S437b) was load-bearing — it names the 2+-statement-only attach that IS the exemption's mechanism.

## Governing sentences (Rule 4 gate)
- §19.4.3: "Failing to handle the result of a `!` function call in any of these ways SHALL be a compile error: **E-ERROR-002**"
- §19.4.4: "The caller of a `!` function SHALL handle the result via match, `?`, `!{}`, or `<errorBoundary>`. An unhandled `!` function call SHALL be a compile error (E-ERROR-002)."
- §5.2.3: "An inline block holding a single statement (`onclick={@filter = .All}`) is legal and equivalent to the bare shape of the same statement." and "No statement of the block SHALL be dropped, whatever its kind or position".
- §41.14.3: "The submit handler signature SHALL match `fn(values: StructType) ! ErrorType`" — formFor's onsubmit is a reference that MUST be failable.
No second SHALL contradicts these; no SPEC text grants a handler exemption.

## Where the exemption lived (hypothesis check)
- PA hypothesis: type-system.ts (+ lint-defer.ts mention). HELD for type-system.ts; lint-defer.ts is only a doc-comment mention of the E-ERROR-002 site (no decision there).
- The exemption was by OMISSION in `visitAttr` (type-system.ts): a multi-statement handler (`value.handlerBlock`, attached by ast-builder `attachHandlerStatementList` only for 2+ statements or a multi-line single statement) is walked via `visitLogicNode` -> `bare-expr` case -> E-ERROR-002. One-statement forms (`call-ref` for bare `onclick=f()`, `expr` for `{ f() }` / `${f()}`) only got `checkLogicExprIdents` (scope check), never the failable-call check.

## Before measure
- `bun scratchpad/measure.ts <root> before.json` — compileScrml per file over examples/ samples/ conformance/ stdlib/ benchmarks/: files=2072, withErrors=714, E-ERROR-002 files=2 (both intentional neg fixtures).

## Findings during impl
- A `!{}`-guarded ONE-statement braced/`${}` handler (`onclick={ risky() !{ | .E :> ... } }`) SILENTLY DROPPED the guard at HEAD: the expression view stops at the call; emitted `function(event){ _scrml_risky(); }`. Fixed in ast-builder: a single guarded-expr statement takes the statement view (`handlerBlock`), so the guard is emitted and the call counts as handled.
- formFor lowers `onsubmit=fn` to a synthesized call-ref tagged `formForSubmitCell` — exempted (the source is a reference).

## After measure (same command)
- Impl only (pre-migration): files=2072, withErrors=721 → newly-failing = 5 of the listed files (6 sites) + 4 formFor cases (synthesized call-ref) → formFor exempted → exactly the 5 listed files / 6 sites; zero other diffs.
- Post-migration: files=2072, withErrors=714, E-ERROR-002 files=2 — per-file error-code sets IDENTICAL to before (diff empty: nothing newly accepted, nothing newly rejected).
- sample server-failable-001 migrated to a non-failable wrapper fn (not inline `!{}`): an inline guarded handler block does NOT await a server call (pre-existing handlerBlock bug), a function body does.
- Tests: unit+integration+conformance 25722 pass / 1 fail (defer-statement fixture with `onclick=work()` failable — migrated) ; browser 48 fail vs base 50 (base extra = TodoMVC dist env gap), no new; root/lsp/commands 6834/0.

## SPEC + gap (commit e9917c46e)
- §19.4.3 OPEN block replaced with ruled text + provenance; §34 rows (x2) do not mention the exemption — unchanged. SPEC-INDEX regenerated.
- known-gaps g-e-error-002-handler-exemption-depends-on-statement-count → RESOLVED S440 (entry edit only).

## Conformance pins
- 4 new cases under conformance/cases/error/: handler-unhandled-failable-{multi-stmt,one-stmt,bare-and-expr}-pos + handler-failable-reference-and-guard-neg (runtime: click guarded → @r=7).
- Bite check on a base-tree extract (git archive d244a6f3b): 3 of 4 FAIL at base (multi-stmt passes at base, as expected — it already fired); the guard-neg fails at base at RUNTIME (guard dropped).
- conformance: base 1041/1048 (+7 xfail) → after 1045/1052 (+7 xfail, same 7).

## Scope narrowing — CPS-implicit (post-adversarial)
- Warnings-inclusive re-measure (errors+warnings, base = git-archive extract of d244a6f3b) showed the shared helper also newly emitted W-CPS-NEEDS-FAILABLE on 29 files (incl. examples/19-lin-token.scrml) — `onclick=serverFn()` where the server fn is CPS-implicit-failable (not declared `!`). The ruling covers DECLARED-`!` calls; escalating the W-CPS deprecation warning onto the most common server-call handler shape is a separate decision. Handler path now skips CPS-implicit callees.
- Re-measure after: errors+warnings per-file sets identical to base except the 2 new pin cases. Unit test added.
- Adversarial positions: each row / engine state-child / match arm / component-def body all fire once; component PROP callback (`<Btn act=risky/>` + `onclick=act()`) does not fire in ANY form (pre-existing — failability not tracked through fn-typed props); errorBoundary contains (E-ERROR-005 w/o fallback); `on mount {}` is a logic block (already fired at base, unchanged).
