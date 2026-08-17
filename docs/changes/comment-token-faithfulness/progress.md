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
