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
