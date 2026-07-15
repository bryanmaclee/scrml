# sPA ss77 — conformance authoring: markup / parse contract §4/§10 (freeze-gate, WAVE C language-boundary)

**Launch:** `read spa.md ss77` · **Branch:** `spa/ss77` · **Worktree:** `../scrml-spa-ss77`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). The markup + parse contract (§4
markup, §10 markup-as-value, §42 `not`) defines what scrml source IS — attribute/handler/write placement,
the forbidden JS-isms (`<style>`, `switch`), context-boundary integrity. The S256 audit puts this
markup/parse set in tier-1 (language-boundary contract). NEW S256 · **fireable now** (pure
conformance-corpus data — disjoint). Enumerates the CODES; the fired sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS". Author from
impl#1 → SANITY-CHECK vs SPEC §4/§10/§42 → ESCALATE divergences; verify GREEN on
`bun conformance/run.ts`; schema in `conformance/README.md`. Grep each code live in `compiler/src`
(`type-system.ts` + `ast-builder.js` + `block-splitter.js` + `symbol-table.ts` + native `parse-expr.js`
for the markup-value case) for the exact trigger. Harness-clean (compile-time parse/markup).

## Core files
`conformance/README.md` · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/block-grammar/` + `conformance/cases/style/` (mirror) ·
`compiler/src/{type-system.ts,ast-builder.js,block-splitter.js,symbol-table.ts}` +
`compiler/native-parser/parse-expr.js` (for E-MARKUP-VALUE-UNCLOSED) ·
`compiler/SPEC.md` §4 + §10.2 + §17.7.3 (normative — read the named subsection per code)

## Items (one code per item; reject-path pos + clean neg)
1. **E-MARKUP-002** (codes) `[status=pending]` — an attribute/closer mismatch (§10; `type-system.ts:7821`, "Attribute …"). Grep exact trigger; pos + neg.
2. **E-MARKUP-003** (codes) `[status=pending]` — a custom-attribute error (`type-system.ts:7836`, "Custom attribute …"). Pos + neg.
3. **E-MARKUP-VALUE-UNCLOSED** (codes) `[status=pending]` — a markup-as-value expression never closes: no matching `/>` or `</…>` (§10.2; fires in `parse-expr.js` on a markup-valued expression; distinct from E-CTX-003 + E-MARKUP-002 — SPEC §10.2). Pos + neg (a closed markup value → silent).
4. **E-MULTI-STATEMENT-HANDLER** (codes) `[status=pending]` — a multi-statement event-handler attribute (`ast-builder.js:15898`). Pos (`on:click="a; b"` multi-stmt → E-MULTI-STATEMENT-HANDLER) + neg (a single statement → silent).
5. **E-WRITE-NOT-IN-LOGIC-CONTEXT** (codes) `[status=pending]` — a bare write outside a logic context (`symbol-table.ts:2534`). Pos + neg (a write inside a logic block → silent).
6. **E-CTX-001** (codes) `[status=pending]` — a context-boundary error (`block-splitter.js:2989`; cf. "Unclosed <…> structural element" at :3573). Grep the exact trigger; pos + neg. (Note: `E-CTX-001` already sits in some `notCodes` — FINDINGS; author the presence case.)
7. **E-SWITCH-FORBIDDEN** (codes) `[status=pending]` — `switch` is forbidden in scrml (`ast-builder.js:2755`). Pos (a `switch` block → E-SWITCH-FORBIDDEN) + neg (use `match` → silent).
8. **E-SYNTAX-042** (codes) `[status=pending]` — a `not`-value-position syntax error ("In value position, replace …", `gauntlet-phase3-eq-checks.js:553/655`). Pos + neg.
9. **E-SYNTAX-064** (codes) `[status=pending]` — the `@.` contextual sigil used outside its valid context (§17.7.3, Bug 70; `type-system.ts:13819`). Pos + neg (a valid `@.` context → silent).
10. **E-STYLE-001** (codes) `[status=pending]` — `<style>` blocks are not supported in scrml (`block-splitter.js:3365`). Pos (a `<style>` block → E-STYLE-001) + neg (scrml styling → silent).

**Definition of done:** all 10 markup/parse codes pinned (codes-half; reject pos + clean neg per code);
run.ts green; divergences ESCALATED. The §4/§10/§42 markup-parse boundary moves to conformance-covered.

## Progress
`spa-lists/ss77.progress.md`. Land per-item on `spa/ss77`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
