# BRIEF — srcmap-attr-expr-relative-span-2026-05-31 (archived per S136)

**Dispatched:** S149, 2026-05-31 · **Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **background:** true · **model:** opus
**Base HEAD:** `8765462a` (main) · standalone

## Root cause (PA-verified empirically before dispatch)
B1 source-map use-site spans (landed `1108d45a`) work for 24/26 mario hits. 2/26 are WRONG: `if=@gameOver` markup conditionals emit `srcmapMark` with `span.start=1` — FRAGMENT-RELATIVE to the re-parsed `@gameOver` attribute value (`@gameOver`[1]=`g`), not absolute into the file → resolves to byte 1 = the `// Example 14` comment line. The 24 correct hits flow through emit-expr on logic-block AST nodes with absolute spans; only the markup-attribute-expr re-parse path produces relative spans. Confirmed via instrument run: exactly 2 hits resolve line=0, both `off=1 name=gameOver`; real gameOver offsets all 1500+.

## Fix
Thread the absolute base offset into the re-parsed attribute-expr spans (so if=/show= conditionals map to their REAL use line — recover provenance). Fallback (only if threading is out of proportion): don't emit a marker for fragment-reparsed exprs (honest-synthetic). NOT a line-0 guard (papers over the bug — fragment-relative offset lands mid-file in other files, un-caught; Rule 4 violation).

## Acceptance (R26)
mario: zero source-kind mappings on comment/line-0; if=@gameOver maps to real use line. counter: no regression. NEW fixture: compound `if=@a && @gameOver` with attr NOT near top — proves fragment-relative offset gone. node --check clean, marker-leak 0/0.

(Full verbatim Agent() prompt with S99/S126 path-discipline + S83 commit + S138 R26 doctrine blocks — same boilerplate shape as sibling source-map BRIEFs.)

---

## PA POST-DISPATCH CORRECTION (S149 — recorded after dispatch; agent not amendable, SendMessage unavailable)

The brief above understated the residual as "2/26 hits, name gameOver." A deeper PA instrument run (dump of every srcmapMark hit's resolved source line) shows the real scope is **6 line-0 hits across 3 names**:
- 3× `healthRisk` (recorded off=13 → comment-line byte 13 ": Mario State")
- 2× `gameOver`  (recorded off=2 → comment-line byte 2)
- 1× `lives`     (recorded off=2)

Total srcmapMark hits on mario = 24 (not 26); 6 of them resolve to source line 0 (the `// Example 14: Mario State Machine` comment). Fire sites include `if=(@gameOver)` (mario L161/172), `if=(@healthRisk == HealthRisk::AtRisk && not @gameOver)` (L159), and `${riskBanner(@healthRisk)}` interpolation / derived-engine reads — i.e. BOTH the if=/show= markup-attribute-expr path AND interpolation-lowered reads carry fragment-relative spans, not just `if=@gameOver`.

**Impact on the fix:** root cause + fix direction UNCHANGED (fragment-relative attr/interpolation expr spans → thread absolute base offset). The dispatched ACCEPTANCE GATE is already correct and catches all 6 — it requires "ZERO source-kind mappings resolve to source line 0" + "ALL hits resolve to real use sites," not just the gameOver ones. PA LANDING REVIEW MUST verify all 6 (3 names) resolve, not just 2.

---

## PA LANDING NOTE (S150, 2026-05-31 — PA-direct; both dispatched agents died S149)

**Root cause in the brief above was empirically WRONG (Rule 4).** "ROOT CAUSE LOCATED `emit-event-wiring.ts:1243`" does NOT hold: mario has no if-*chains* (only standalone `if=`), so that re-parse path never fires for the mario hits. Instrumented stack-trace tracing of the actual emitted marks showed TWO classes:

1. **Fragment-relative (the brief's intended class, but upstream):** ~40 `safeParseExprToNode(expr, 0)` sites in `ast-builder.js` (if/while/do-while conditions, `${...}` interpolations, bare-exprs) parse with base offset 0 → relative spans. A `@gameOver` read in a re-parsed `(@gameOver)` lands at byte 2 → resolves to the file's opening comment (line 0). `formatSrcmapMark` only suppressed `start <= 0`, so the small positive offset escaped.
2. **Wrong-absolute (NEW, distinct B1 bug):** object-literal props (`{author_id: @authorId}`), worker/channel `if=(@result is some)` reads, and reactive `@x = …` assigns record a wrong *absolute* offset (large, but pointing at a mid-file line that doesn't hold the name). NOT fragment-relative — the offset-threading fix wouldn't catch these.

**Fix chosen (user-ratified "honest-synthetic now + queue full fix"):** validate-at-resolution in `build-source-map.ts` — drop any named use-site mapping whose recorded offset resolves to a line not containing the identifier. Catches BOTH classes (offset-source-agnostic), contained to the source-map-only path, no AST mutation, zero footprint when maps are off. Acceptance gate MET and exceeded: examples corpus LINE-WRONG 40→0 (not just mario's 6), col-drift 39 KEPT (right-line/wrong-col preserved). +2 regression tests. Pre-commit subset 15,430/0.

**The brief's preferred fix (thread absolute offset → correct provenance) is the QUEUED full-fix arc** — see known-gaps §0 S150 NEW LOW. The infra exists (`collectExpr` returns absolute spans); it's ~40 sites + the wrong-absolute-offset B1 root, deferred per the user's scope call.

**Acceptance fixture note:** the brief asked for a `if=@a && @gameOver` not-near-top fixture. The validate-at-resolution approach makes that fixture redundant for the line-lie (it validates the RESULT regardless of how the offset went wrong); the locked regression is the build-source-map unit test "DROPS a named mapping whose offset resolves to a line NOT containing the identifier."
