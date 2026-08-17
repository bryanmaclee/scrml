# comment-token-faithfulness — progress

Append-only. Newest entries at the bottom.

## Unit 0 — startup
- WORKTREE_ROOT: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2434fecbe66d3da0
- remote origin = git@github.com:bryanmaclee/scrml.git (correct repo; attempt 1 was provisioned from scrml-support)
- `bun install` OK (217 packages), `bun run pretest` OK (13 test samples compiled)
- tree clean at start
- base commit = `c159f1a2` == `origin/main` tip exactly. NO `dtr-r7` content in this tree.

## Baseline — MEASURED, and it corrects the brief on anchor (B)

Reproducers compiled with `compiler/src/cli.js compile`; param shapes measured directly
through `splitBlocks` -> `buildAST` (probe in scratchpad, not committed).

### Anchor (A) — REPRODUCES exactly as briefed
`function greet(/* the message */ msg) { return msg }`
-> `error [E-SCOPE-001]: Undeclared identifier 'msg'`, exit 1.
Recorded param name: `"the message */ msg"`.

### Anchor (B) — DOES NOT reproduce as briefed. It fails LOUD here, not silently.
`function greet(msg = // join\n  1) { return msg }` with a live call site
-> `error [E-CODEGEN-INVALID-LOGIC]`, exit 1, no artifacts written:
```
...ion _scrml_greet_1(msg = join 1) { return msg; } })();
```
Recorded default: `"join\n1"`. With `--no-validate-emit` the emitted client carries
`function _scrml_greet_1(msg = join` + newline + `1) {...}` — broken JS, not a dropped default.
The brief's "exit 0, zero diagnostics, `= 1` is gone, emits `(msg)`" is NOT observable on
`origin/main`. The only exit-0 path found is when `greet` has no caller and is tree-shaken
(`W-DEAD-FUNCTION`), which is not the briefed shape. See NOTES in the report.

**The invariant that DOES hold on both trees** is the one worth anchoring on: the
reconstructed default text is the comment CONTENT plus its closing delimiter, never the
source text.

### The measured defect surface — WIDER than the two anchors

| shape | recorded today |
|---|---|
| `greet(/* the message */ msg)` | name `the message */ msg` |
| `greet(msg = // join\n 1)` | default `join\n1` |
| `greet(msg = /* join */ 1)` | default `join */1` |
| `greet(msg = 1 /* c */ 2)` | default `1 c */2` |
| `greet(msg = 1 /*c*/ 2)` | default `1c*/2` |
| `greet(msg: /* t */ string)` | typeAnnotation `t */ string` |
| `greet(msg = 1 // tail\n)` | default `1 tail` |
| `greet(msg = /*x*/)` | default `x*/` |
| `greet(a, /* c */ b)` | 2nd name `c */ b` |
| `greet(lin /*c*/ msg)` | name `linc*/ msg` — **`isLin` SILENTLY LOST** (`^lin\s+` no longer matches) |
| `greet({a,b} /*c*/ = {...})` | typeAnnotation `c*/` on a destructure pattern |
| `greet(msg = f(/*c*/ 1))` | default `f(c*/1)` |
| `greet(msg = /*c*/ "hi")` | default `c*/"hi"` |

`lin` is the genuinely-silent one on this tree: `lin /*c*/ msg` compiles to a NON-linear
parameter with no diagnostic. That is the severe symptom the brief was reaching for.

### Glue hazard — CONFIRMED, mitigation is load-bearing
`greet(msg = 1 /*c*/ 2)` records `1c*/2` today. A bare skip with no separator yields `12`
— a silently wrong default. The brief-mandated space insertion is required, not optional.

## Unit 1 — LANDED `9d9377aa`

`tokenizer.ts`: `advance(2)` moved from the two call sites INTO `readLineComment` /
`readBlockComment`, so each reader owns its opening delimiter and captures
`start`/`line`/`col` AT the `/`. Text gains the opener; span gains two characters at the
front; columns are corrected by 2. Trailing `\n` deliberately retained.

`tokenizePassthrough` VERIFIED already faithful (emits `raw` over
`[base, base+raw.length)`); asserted, not modified.

`ast-builder.js:5205` S184 rationale UPDATED in the same commit — it justified its skip by
claiming the tokenizer "already stripped" the leading glyph, which Unit 1 makes false. The
skip is still right, for the honest reason: `raw` is JavaScript-to-be, a comment is not a
value.

New suite `compiler/tests/unit/comment-token-faithfulness.test.js` (12 tests). It bites in
BOTH directions and both halves are load-bearing:
- with Unit 1 reverted: **7/12 fail** (§4 delimiters, §5 columns, §6 unterminated, §7 EOF)
- against the plausible WRONG fix (prepend the opener to `.text`, leave the span alone):
  **6/12 fail**, and the failures are §1/§2/§3 — the round-trip invariant. This is why the
  round-trip assertions are in the suite even though they PASSED pre-fix: they guard the
  wrong fix, not the unfixed state.

## Unit 2 — `appendTok` skips COMMENT tokens

`parseParamList`'s `appendTok` returns early on `tok.kind === 'COMMENT'`, emitting a single
space when the buffer is non-empty and does not already end in one.

**Re-emit was measured INSUFFICIENT, not merely inelegant.** With Unit 1 landed and Unit 2
reverted — i.e. a perfectly faithful token re-emitted verbatim — the recorded values are:

```
A  greet(/* the message */ msg)   name `/* the message */ msg`   STILL BROKEN
E  greet(a, /* c */ b)            2nd name `/* c */ b`           STILL BROKEN
T  greet(msg: /* t */ string)     typeAnnotation `/* t */ string` STILL BROKEN
G0 greet(msg = 1 /*c*/ 2)         default `1/*c*/2`              STILL BROKEN
```
`cur` is consumed by string surgery (`/^lin\s+/`, `indexOf(':')`, `.trim()`), never parsed,
so no re-emission can be correct there. Skip fixes both buffers. The brief's Unit-2
argument is confirmed empirically, not accepted on assertion.

### Measured before/after over the full ratified shape set

| shape | BASE `c159f1a2` | HEAD |
|---|---|---|
| `greet(/* the message */ msg)` | name `the message */ msg` | name `msg` |
| `greet(a, /* c */ b)` | `a`, `c */ b` | `a`, `b` |
| `greet(msg /* c */)` | name `msg c */` | name `msg` |
| `greet(/*a*/ /*b*/ msg)` | name `a*/b*/ msg` | name `msg` |
| `greet(msg = // join\n 1)` | default `join\n1` | default `1` |
| `greet(msg = /* join */ 1)` | default `join */1` | default `1` |
| `greet(msg = 1 // tail\n)` | default `1 tail` | default `1` |
| `greet(msg = f(/*c*/ 1))` | default `f(c*/1)` | default `f( 1)` |
| `greet(msg = /*c*/ "hi")` | default `c*/"hi"` | default `"hi"` |
| `greet(msg = /* x */)` | default `x */` | NO default (== `msg =`) |
| `greet(msg: /* t */ string)` | type `t */ string` | type `string` |
| `greet(msg = 1 /*c*/ 2)` | default `1c*/2` | default `1 2` (loud, correct) |
| `greet(msg = a /*c*/ b)` | default `ac*/ b` | default `a b` (loud, correct) |
| `greet(lin /*c*/ msg)` | name `linc*/ msg`, **isLin LOST** | name `msg`, `isLin: true` |
| `greet({a,b} /*c*/ = {...})` | spurious type `c*/` | no type annotation |
| `greet(/*c*/)` | **PHANTOM param named `c*/`** | no params |

Two shapes NOT in the brief and newly closed: `greet(msg /* c */)` (trailing comment welded
into the name) and `greet(/*c*/)` (**a comment minted a parameter out of thin air**, silently).

New suite `compiler/tests/unit/param-list-comment-skip.test.js` (21 tests).
Bite proof: with Unit 2 reverted (Unit 1 still in place) **18/21 fail**.

## Direction of change

**Unit 1 — `semantics-changed`, and it is a WIDENING of information.** A COMMENT token's
`.text` and `.span` both change. No consumer read either (measured — see blast radius), so
the only OBSERVABLE change is COMMENT-token line/col in diagnostics, corrected by 2 columns.

**Unit 2 — `semantics-changed` for the affected shape class.** A signature carrying a
comment now records the parameter the author wrote. Three directions, named honestly:
1. **loud -> clean** (the intent): `A`, `E`, `T`, `B`, `B2`, `C`, `V`, `R`, `P`, `Q`, `S`.
2. **silent-wrong -> correct** (the severe one): `lin /*c*/ msg` regains `isLin`.
3. **loud -> silent, ONE shape**: `greet(msg = /* x */)` previously produced the garbage
   default `x */` and died at `E-CODEGEN-INVALID-LOGIC`; it now records NO default and
   compiles. This is NOT a new class — `greet(msg =)` has always done exactly this. It
   joins an existing silent-acceptance class rather than opening one. Surfaced, not fixed:
   a diagnostic for an empty default is a separate question and is out of this brief.

**Never `silent-wrong` in the new direction.** The one shape that could have gone there —
the glue weld to `12` — is what the space mitigation exists to prevent, and §4 of the new
suite asserts `not.toBe("12")` explicitly.

## Corpus migration — MEASURED, not assumed

Every `.scrml` under `examples`, `samples`, `conformance`, `stdlib`, `benchmarks`,
`compiler/tests` parsed with BOTH the base-commit (`c159f1a2`, extracted via `git archive`)
and HEAD compiler, comparing every recorded `params` array:

```
scanned: 2014   differing: 0   base-threw: 0   head-threw: 0
```

**ZERO files migrate.** Per the S346 rule this is **blast radius only** — it says the change
is safe to land, and says NOTHING about whether the fix was needed. The corpus contains no
comment-in-signature because writing one was, until this commit, punished.

## Deferred — NOT fixed, surfaced

**A comment INSIDE a destructure pattern corrupts the pattern, and it is UNCHANGED by this
work.** `function greet({ a /*c*/, b }) {...}` records, at BOTH base and HEAD:
`[{ name: <destructure-object with ONLY `a`> }, { name: "b" }]` — `b` is dropped from the
pattern and minted as a second positional parameter. `parseDestructurePattern`
(`ast-builder.js:10385`) has no COMMENT handling at all. Same defect class, different
function, outside this brief's `appendTok` scope. Byte-for-byte identical before and after,
so this work neither caused nor worsened it.
