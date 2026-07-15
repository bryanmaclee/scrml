# issue #28 — BS tag-close leading-equals — progress

Append-only log. Branch: fix/issue28-tagclose-leading-equals. Base: 7d5fda26.

## 2026-07-15 — session start
- Entered pre-made worktree, isolation gate verified (pwd/toplevel/branch/HEAD all correct, tree clean).
- `bun install` OK inside worktree.
- Reproduced bug: `<page auth="none"><div><span>= hi</span></div></page>` → E-DG-002 @div + 2× E-CTX-001. Confirmed live @ 7d5fda26.

## Investigation — actual fire sites (empirical, via splitBlocks block-tree dump)
Brief pointed at `peekTopLevelStateDeclSignal` line ~1595. Empirically that line is NOT the fire site for the matrix rows; it returns FALSE for them. The real fires:
- `scanAttributes` line ~1321 (`if (c === ">" && ch(1) === "=") { attrRaw += c; step(); continue; }`) — UNCONDITIONAL `>=` swallow. Fires for `<span>= hi>` / `<div>=...>` / `<td>=...>` when the element is a direct markup child (rows 1b, 3, 4, and the leaf of row 2). Swallows the opener `>` + leading `=` → opener never terminates.
- `classifyOpenerForCompoundScan` (state-decl detection ~line 2015) — a child `<span>= hi>` (opener `>` immediately followed by `=`) is misclassified as a Shape-1 state-decl child, which makes the PARENT (`<div>` / `<tr>`) look like a compound state-decl → the whole subtree is gobbled as a text block and lifted → `@div` reactive var → E-DG-002 + E-CTX cascade. Fires for rows 1, 2.
- `peekTopLevelStateDeclSignal` line ~1595 — over-broad skip; NOT a matrix fire site, but it DOES break the no-space top-level decl form `<count>=0` (skips `>=`, runs to EOF, returns false). That is a pre-existing, separate, out-of-scope issue (matrix row 8 uses the space form `<count> = 0`, which works).

## Baseline matrix (pre-fix)
row1  CTX001=2 ATTROP=0 Compiled=0 first=E-DG-002   (FAIL — classify)
row1b CTX001=1 ATTROP=0 Compiled=0 first=E-CTX-001  (FAIL — scanAttributes)
row2  CTX001=2 ATTROP=0 Compiled=0 first=E-DG-002   (FAIL — classify)
row3  CTX001=1 ATTROP=0 Compiled=0 first=E-CTX-001  (FAIL — scanAttributes)
row4  CTX001=1 ATTROP=0 Compiled=0 first=E-CTX-001  (FAIL — scanAttributes)
row5  CTX001=0 ATTROP=0 Compiled=1 (PASS — parenthesized)
row6  CTX001=0 ATTROP=0 Compiled=1 (PASS — quoted)
row7  CTX001=0 ATTROP=1 Compiled=0 (PASS — reject fires; NO E-CTX-001)
row8  CTX001=0 ATTROP=0 Compiled=1 (PASS — space decl)
row9  CTX001=0 ATTROP=0 Compiled=1 (PASS — paren-tracked >=)

## Fix plan
Discriminator = "is there a pending unquoted attribute value?" i.e. a depth-0 unquoted `=` seen earlier in this opener.
- scanAttributes: swallow `>=`-as-comparison only when `sawUnquotedEq` (prior depth-0 unquoted `=`); else `>` terminates. Strictly narrows (only changes openers where `>=` appears with NO prior `=` — exactly the leading-`=`-after-bare-tag bug). Preserves S188 reject for `if=@n >= 3`.
- classify: an opener whose `>` is IMMEDIATELY followed by `=` (no whitespace, no prior attr `=`) is NOT a state-decl child.
- peek line 1595: mirror the narrowing for site-consistency, guarding so it stays FALSE for leading-`=` markup (does not newly gobble). TBD after empirical check.
