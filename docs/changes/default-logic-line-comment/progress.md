# progress — §40.8 default-logic body: comment-adjacent statements emitted as page text

Append-only. Timestamps are local.

---

## 2026-08-23 — STEP 0 + reproduction + root-cause trace

**Worktree** `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a31fa6daa7172cd94`
**Base** `569d19e1` (cut from `origin/main`). Brief files fetched from `gaps/s368-default-logic-comment`.
**Baseline pre-commit gate** (unit+integration+conformance, no browser): **29067 pass / 86 skip / 1 todo / 0 fail**.

### Reproduced — yes, before changing anything

`repro-minimal.scrml` emits `log("M1");` into `<body>` as literal text. Exit 0, zero diagnostics
beyond the unrelated `W-PROGRAM-SPA-INFERRED`.

### Root cause — PA hypothesis REFINED (locus held, mechanism did not)

The PA-located loci were `ast-builder.js` (`liftBareDeclarations` + the default-logic body path),
the block-splitter, and `tokenizer.ts`.

- `ast-builder.js` / `liftBareDeclarations` — **HELD.** The decision site is the terminal
  `result.push(block)` fall-through at the end of the function.
- `block-splitter.js` — **HELD as a contributing cause**, not as the decision site. BS extracts a
  `//` line comment as its own `comment` child, which FLUSHES the preceding text run.
- `tokenizer.ts` — **WRONG.** Not on the path. No edit needed.

The real mechanism is **not** "a `//` comment is not treated as logic content". It is:

> A `type:"text"` block at a §40.8 default-logic root is lifted into a synthetic `${...}` logic
> block ONLY IF its raw text matches one of **eight leading-anchored shape regexes**. Anything else
> falls through to `result.push(block)` and becomes inert page text, silently.

The eight gates (all `ast-builder.js`): `BARE_EXPORT_AT_END_RE` :1290 · `BARE_DECL_NAME_EQ_AT_END_RE`
:1600 · `USE_FOREIGN_LIFT_RE` :1656 · `BARE_DECL_RE` :1675 · `TOPLEVEL_STATE_DECL_RE` :1709 ·
`TILDE_TOKEN_RE` :1748 · `TOPLEVEL_AT_WRITE_RE` :1783 · `TOPLEVEL_ON_LIFECYCLE_RE` :1820.

Comments break these gates in **two opposite ways**, and only the first was reported:

1. **`//` line comment — FLUSH.** BS emits it as a separate `comment` child, splitting one text run
   into two. A statement that was riding a run whose LEADING content was a declaration becomes the
   leading content of a fresh run, matches nothing, and leaks.
2. **`/* */` block comment — ANCHOR DEFEAT.** It stays *inside* the text run, so the run now begins
   with `/*`. Every gate regex is `^`-anchored with only `\s*` permitted before the keyword, so the
   comment blocks the match and **the declaration itself leaks**.

Direction 2 is strictly more severe and was recorded in the brief as CLEAN. Measured:
`<program>\n/* c */\nfn f(a: number){ return a }\n<p>ok</>\n</program>` ships the entire `fn`
declaration into `<body>` as page text. Exit 0. Zero diagnostics.

Two of the eight gates (`TILDE_TOKEN_RE` §32 Gap 6, `TOPLEVEL_ON_LIFECYCLE_RE` GITI-029) exist
*solely* to work around direction 1 — both doc comments say so verbatim. This is the third report of
the same root cause, previously patched twice by adding another shape regex.

### Brief premise corrections (all measured on this base)

| brief claim | measured |
|---|---|
| `//` + 1 following statement leaks | CONFIRMED |
| `/* block */` instead of `//` → CLEAN | **FALSE as a general claim.** True only when a declaration precedes the block comment. A *leading* block comment leaks the declaration itself. |
| the comment is required to reproduce | **FALSE.** `<program>\nlog("M1");\n<p>ok</>\n</program>` with no comment at all leaks identically — a lone bare call matches no gate. |
| statement BEFORE the comment also leaks ("poisons both directions") | NOT REPRODUCED. The pre-comment run keeps its declaration-shaped leading content and lifts normally. |
| adding a `fn` suppresses the residual diagnostic — possible SECOND root | **SAME ROOT, and the determinant is not `fn`.** It is comment POSITION relative to the swallowed statement. `decl / fn / log(@wop)` → exit 1. `decl / fn / // c / log(@wop)` → exit 0 silent. `decl / // c / fn / log(@wop)` → exit 1. The comment only matters when it sits between the last declaration and the swallowed statement. |

### Class sweep — population

Silently reclassified as page text at a §40.8 default-logic root, all exit 0 / zero diagnostics:

*Direction 1 (`//` flush; a declaration exists earlier in the body):* bare call statement · bare call
containing an undeclared `@name` read (**suppresses `E-STATE-UNDECLARED`** — the masking limb) ·
`await` expression statement · cell method call `@xs.push(...)` · nested-path write `@o.a = ...` ·
bare `for (...) {...}` · bare `if (...) {...}` · bare identifier expression statement · assignment to
a local · every statement of a multi-statement run.

*Direction 2 (leading `/* */` anchor defeat):* `const`/`let` local declaration · `fn` / `function`
declaration · structural state declaration `<x> = 0` · and by construction every other gate whose
regex is `^`-anchored.

*Residue, NOT closed by this dispatch:* a default-logic body whose text run contains **no**
declaration anywhere (`<program>\nlog("M1");\n</program>`). No gate can trigger, so the run stays
text. SPEC §40.8 is silent on a bare CALL statement at default-logic body-top — it enumerates what
auto-lifts (declarations) and carves out writes with `E-WRITE-NOT-IN-LOGIC-CONTEXT`, but says
nothing about calls. Surfaced as a design question rather than guessed. See NOTES in the report.

### Fix shape

Evaluate the lift gates against the text run with **comments neutralised in both directions**:
coalesce consecutive `text`/`comment` siblings (undo the `//` flush), and skip leading comments of
both forms when testing the gate (undo the anchor defeat). On a hit, emit ONE synthetic `${...}`
whose raw is the full merged source span, comments included — the logic parser already handles
comments (the explicit-`${}` control case compiles clean). On a miss, push the ORIGINAL blocks
unchanged so comment text never starts rendering.

No gate regex is modified. The fix gives the eight existing gates the un-fragmented, un-prefixed run
they were each written to see.

---

## 2026-08-23 — fix landed + full-corpus emit differential

**Commit** `5e0f95c4` — `compiler/src/ast-builder.js`, `compiler/native-parser/parse-markup.js`,
`compiler/tests/parser-conformance-within-node-allowlist.json`,
`compiler/tests/unit/default-logic-comment-lift.test.js` (one coupled unit; the pre-commit gate ran
the full suite and passed).

### What the fix does

`liftBareDeclarations` now normalises the INPUT its eight `^`-anchored gate regexes see, instead of
gaining a ninth regex:

- `stripLeadingComments(raw)` — drops leading comments of BOTH forms for the gate TEST only. Closes
  the `/* */` ANCHOR DEFEAT (direction 2).
- `coalesceCommentSeparatedRun(blocks, i, …)` — rejoins byte-CONTIGUOUS `text`/`comment` siblings.
  Closes the `//` FLUSH (direction 1). Contiguity is required: the lifted block anchors its body at
  the first block's span start, so a gap would skew every downstream sub-node span.
- **Merging is MINIMAL by design.** `matchesAnyLiftGate` stops the merge before any following
  fragment that clears a gate ON ITS OWN — that fragment already lifts correctly as its own logic
  node, and absorbing it would consolidate two nodes into one and move the artifact for no benefit.
  Only what would otherwise be silently dropped is merged. A trailing comment-only tail is not
  absorbed either (relocating a comment rescues no statement).
- When no gate fires, the ORIGINAL blocks are pushed unchanged, so comment text never renders.
- Coalescing declines when the merged run trails with a pairing shape (bare `export` /
  `const Name =`) so the two PAIRING gates keep their block-indexed markup pairing. Without this
  guard `// c` + `const Card = <div>…</>` regressed to `E-CODEGEN-INVALID-LOGIC` — caught and fixed
  before landing.

### Native-parser mirror — REQUIRED, not optional

`compiler/native-parser/parse-markup.js` carries a 1:1 mirror of `liftBareDeclarations`. Landing the
live fix alone took the within-node parity canary from **0 to 20+ over-budget fixtures**. Mirroring
(`coalesceCommentRunNative`, `stripLeadingCommentsNative`, `matchesAnyLiftGateNative`, plus a
`bodyTextOverride` on `synthLiftedLogicBlock` so the node SPAN stays the first block's span exactly
as live does) brought it to **1**. That last one is `samples/rust-dev-debate-dashboard.scrml`, whose
allowlist row moved with a written justification: it is RED with `E-TYPE-026` ×4 both before and
after (verified by direct compile, not inferred), and the residual is the documented native
`parseLogicBody` state-decl gap (live `state-decl` vs native `bare-expr` — the P4-1/P5-1 unit's
concern, named in `parse-markup.js`'s own `liftBareBlocks` scope comment), now reached on more nodes
because more code is parsed instead of dropped. Its SPAN-COORD count MOVED DOWN 118 → 89 and was
recorded downward per that file's own rule.

### Full-corpus emit differential — MANDATORY, and it is clean

`bun scripts/corpus-emit-differential.ts`, base `569d19e1` vs head `5e0f95c4`. Both sides given a
REAL git root marker — the first attempt used a hand-made `.git` directory and the tool correctly
refused with `FINDING [INCOMPARABLE] a side's revision is "<unknown>"`, so the base was re-cut as an
actual `git worktree`. **The refusal is the tool working; the numbers below come from the valid run.**

```
sources enumerated        base 1906   head 1906
source set delta          0
compile-failure delta     0 newly failing / 0 newly passing
diagnostic changes        0 code / 0 text-only
artifact set delta        0 added / 0 removed
artifact content diffs    35 of 7388 compared
syntax delta (effective)  0 new / 0 fixed / 0 message-changed
load-context changes      0
bare server-fn sites      base 144 / head 144  (delta 0)
```

**Newly-rejecting: MEASURED ZERO, not assumed.** 1906 sources compiled on both sides; the
compile-failure SET is identical (1227 OK / 679 failing, both sides), and zero diagnostics changed —
neither code nor text. No migration is owed.

**All 35 changed artifacts, classified mechanically (not spot-checked):**

| class | count |
|---|---|
| WHITESPACE-ONLY | 24 |
| NODE-ID-RENUMBER-ONLY | 6 |
| WHITESPACE + NODE-ID RENUMBER | 5 |
| **anything else** | **0** |

Total byte delta **−554, every artifact SHRANK or stayed the same length** — the signature of
removing leaked source text and inter-comment whitespace from the emitted body. 29 HTML, 6 JS.

- *Whitespace*: a whitespace-only text run that sits between a comment and a rescued statement is now
  inside the lifted logic block (where it emits nothing) rather than a text node (where it emitted
  spaces). Largest single diff — `gauntlet-r10-svelte-dashboard.html`, −176 bytes — is five lines of
  trailing spaces collapsing to one empty line. No content moved.
- *Node-id renumber*: fewer AST nodes shifts the sequential node counter. **Verified as a consistent
  BIJECTION across every co-referencing artifact of each source** — the `<each>` anchor comment in
  the HTML, the renderer function name, the `_scrml_find_each_anchor` argument, the
  `data-scrml-each-mount` attribute, the `_scrml_each_renderers` registry key, the call sites, and
  the SSR HTML string embedded in the JS all move together. Zero inconsistent mappings, zero id
  collisions across the 6 affected sources (script:
  `check-id-bijection.py`, 4–15 artifacts per source).

### Pre-existing defects found in passing — FILED, NOT FIXED

1. **`E-CODEGEN-INVALID-LOGIC` on a reassignment at default-logic body-top.** `let bias = 1` then
   `bias = "x"` lowers to `let bias = 1; const bias = "x"` → "Identifier 'bias' has already been
   declared", reported as a compiler defect. Confirmed PRE-EXISTING by compiling the no-comment
   variant at the merge-base. My fix routes the comment-bearing variant onto the same already-broken
   path; it does not create it.
2. **`E-SYNTAX-050` from a block comment before a structural state decl.**
   `<program>` + `/* c */` + `<x> = 0` fires *"Bare '/' is no longer a valid closer"* at **stage BS**
   — the `*/` is read as a closer. Upstream of the lift entirely; fired identically before the fix.
3. **A `//` on the SAME LINE as a closer eats the closer.** `<p>the // operator divides</>` yields
   `E-CTX-001` + `E-CTX-003`. Identical before and after; verified at the merge-base.
