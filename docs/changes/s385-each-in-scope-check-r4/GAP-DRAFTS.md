# S385 round 4 — gap drafts for `known-gaps.md`

Round 3's two drafted gaps (`GAP-S385-EACH-KEY-DESTRUCTURE`,
`GAP-S385-EACH-ITER-SHAPE-UNFIRED`) are unchanged and still live at
`docs/changes/s385-each-in-scope-check/GAP-DRAFTS.md`. This file adds only what
round 4 surfaced.

---

## GAP-S385-VALIDATE-EMIT-SKIPPED-WHEN-WRITE-FALSE — the emitted-JS parse gate never runs for a programmatic consumer

**Severity: MEDIUM.** Silent-accept of source whose emitted JS does not parse, on
every non-writing consumer — the LSP included.

### The finding

`api.js` runs the emitted-JS parse gate (`validateEmittedArtifacts`, the sole
producer of `E-CODEGEN-INVALID-LOGIC` for this class) inside the write block:

```
if (write && outputDir) {
    ...
    if (validateEmit && !hasPriorFatalError && cgResult.outputs) { ... }
}
```

`validateEmit` itself defaults to `true` (`api.js:871`), so the gate is not
flag-off — it is *unreachable* when `write` is false. A caller that passes
`write: false` gets a CLEAN result for source the CLI rejects.

### Reproducer — the same four sources, two harnesses, opposite verdicts

Measured at `origin/main` (`d02adb68`), round 4:

| source | CLI (`scrml compile`, writes) | `compileScrml({write:false})` |
| --- | --- | --- |
| `<each in=${@rows} as r>` | FAILED, `E-CODEGEN-INVALID-LOGIC` | **CLEAN** |
| `<each in=@rows as r key=${r}>` | FAILED, `E-CODEGEN-INVALID-LOGIC` | **CLEAN** |
| `<each in=@rows as r key=${@a}-${r}>` | FAILED, `E-CODEGEN-INVALID-LOGIC` | **CLEAN** |
| `<each in=@rows as r key=${@a}-${@typo}>` | FAILED, `E-CODEGEN-INVALID-LOGIC` | **CLEAN** |

### Why it is worth filing rather than shrugging at

1. **It made two competent reviewers disagree about a fact.** During the S385
   review an adversarial reviewer claimed the `key=${@a}-${r}` shape "compiles
   with zero `E-` diagnostics"; the PA ran it and got a loud
   `E-CODEGEN-INVALID-LOGIC`. Both were right — about different harnesses. That
   is the [[feedback_the_probe_answered_a_different_question]] wrong-referent
   class, and this gap is a standing generator of it.

2. **The unit tier is structurally blind to a whole diagnostic class.** Every
   unit test built on a `write:false` harness — this arc's own test file among
   them — cannot observe `E-CODEGEN-INVALID-LOGIC` no matter what it asserts. A
   codegen regression that emits unparseable JS passes the unit tier silently.

3. **The LSP is a `write:false` consumer.** An editor showing a clean buffer for
   source that will not build is the same class of silent-wrong the S385 arc
   exists to close, one stage over.

### Fix sketch (NOT done here — out of scope for S385)

Hoist the gate out of `if (write && outputDir)`. It reads `cgResult.outputs` in
memory and needs `outputDir` only to resolve the stdlib-import rewrites for a
*syntactic* check; a synthetic bundle root is faithful for that purpose (the
gate's own comment already argues this for the `pathFor` sub-dir case). Expect
fallout: the corpus ships pre-existing invalid-JS artifacts (the `validateEmit`
option doc says so), which is precisely why measuring before flipping matters.

### Test anchor

`compiler/tests/unit/each-opener-expr-undeclared-read.test.js` §9, as a
`test.todo` naming this id.

---

## GAP-S385-EACH-OPENER-INTERPOLATION — `<each in=${…}>` gets a diagnostic that names punctuation, not the mistake

**Severity: LOW.** Message quality on an already-rejected shape. No valid program
is affected.

### The finding

`${…}` is not a valid `<each>` opener form in any slot or spelling. It is
rejected — but by two different accidents, neither of which says so:

| watermark | diagnostic |
| --- | --- |
| `origin/main`, via the CLI | `E-CODEGEN-INVALID-LOGIC: the compiler could not lower this construct to valid output.` |
| `origin/main`, via `compileScrml({write:false})` | *(none — see the gap above)* |
| post-S385-r4, both harnesses | `E-SCOPE-001: Undeclared identifier \`$\` in logic expression.` |

The r4 message arrives EARLIER (type-system stage, so it reaches the `write:false`
consumers main missed), which is the right direction on the accept/reject axis.
It is still the wrong message: it names `$`, a character the author wrote as
template punctuation and not as an identifier, and it suggests "you meant a
reactive `@$`".

### The honest diagnostic

Something in the shape of *"`${…}` is not a `<each>` opener form — write the
expression directly: `in=@rows`, `key=r.id`"*, at the opener span.

### Why round 4 did not just add it

It is a NEW diagnostic on a NEW rejection rule, which needs a SPEC home (§17.x /
§34 row + code allocation). S385's remit is the read-side scope check. Inventing
a code inside a scoped excision would be exactly the sort of silent scope
expansion `pa.md` forbids.

### Explicitly NOT the fix

Do **not** re-add a raw-text `${…}` scan to suppress this. That scan is what
round 4 removed, and it caused a HIGH false positive
(`in=@rows.map(r => \`id-${r}\`)`) by reaching into a lambda body the shared
walker deliberately skips, plus a false negative that reopened the arc's own
hole. A guard would need to distinguish a bare `${` from one inside a string or
template literal — i.e. a mini-lexer — to be safe, and it would still be a text
scan over a value the compiler has already parsed.

### Test anchor

`compiler/tests/unit/each-opener-expr-undeclared-read.test.js` §9 — the four
rejection cases pin the accept/reject property code-agnostically, so the honest
diagnostic can land without touching them; a `test.todo` names this id.

---

## Surfaced, not drafted

- **`E-EACH-ITER-SHAPE` is still unimplemented** — round 3 drafted this
  (`GAP-S385-EACH-ITER-SHAPE-UNFIRED`) and round 4 re-relies on it: the `in=`/`of=`
  check is `iterShape`-gated precisely because `<each in=@rows of=@typo>` has no
  conflict diagnostic to defer to. Unchanged by r4.
