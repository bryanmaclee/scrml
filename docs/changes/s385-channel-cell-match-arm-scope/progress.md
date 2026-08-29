# progress — s385-channel-cell-match-arm-scope

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a8702b6fc289f0891`
Base: `origin/main` @ `56473410`. Branch: `worktree-agent-a8702b6fc289f0891`.

---

## Phase 0 — baseline (COMPLETE)

Full-suite baseline captured from the anchor commit's pre-commit hook run
(unit + integration + conformance):

```
29338 pass · 86 skip · 1 todo · 0 fail · 131726 expect() calls
Ran 29425 tests across 1289 files. [267.74s]
```

### Defect 1 + Defect 2 reproduced verbatim on `56473410`

`bun compiler/bin/scrml.js compile <scratch>/a.scrml --output-dir <tmp>`:

```
error [E-STATE-UNDECLARED]: bare `@stamp` read with no reactive cell in scope. ...
  stage: TS

FAILED — 1 error, 3 warnings
```

Defect 2 confirmed in the same output: no `-->` line, no `(line N, col N)`, while the three
other diagnostics in the same run each carry both.

### Variant matrix — ALL rows re-run by me, including the relayed-unverified B/D/E

| # | variant | brief said | I measured | agrees? |
|---|---|---|---|---|
| A | `${@stamp}` in match arm, channel mounted **in the arm** | ERROR | **ERROR** | yes |
| B | as A, mount **removed entirely** | ERROR ("mount is irrelevant") | **ERROR** | result yes, **interpretation NO** |
| C | `${@stamp}` outside the match, mount top-level | CLEAN | **CLEAN** | yes |
| D | only `<each in=@items>` in arm, mount in arm, no `${}` read | CLEAN | **CLEAN** | yes, but see below |
| E | same-file local `${@localCell}` in arm, no import | CLEAN | **CLEAN** | yes |
| F | `${@stamp}` inside `<each>` body, mount top-level | CLEAN | **CLEAN** | yes |
| G | `<each in=@totallyUndeclaredName>` (out of scope) | CLEAN | **CLEAN** | yes |

### New variants I constructed — these falsify the brief's framing

| # | variant | result |
|---|---|---|
| H | mount **top-level**, read `@localCell` AND `@stamp` **inside the arm** | **CLEAN** |
| H2 | mount **top-level**, read only `@stamp` **inside the arm** | **CLEAN** |
| I | mount **inside the arm**, read `@stamp` **outside the match** | **ERROR** |
| J | mount **inside an `<each>` body**, read outside | **ERROR** |
| K | mount **inside an `<if>` body**, read outside | **CLEAN** |

**The brief's failing conjunction is WRONG.** It is not "a read inside a match arm".
H2 puts the read inside the arm and is CLEAN; I puts the read outside and is ERROR.
The variable is the **MOUNT** position, not the read position:

> **A cross-file channel mounted inside a `<match>` arm or an `<each>` body is never
> CE-inlined. Once inlined anywhere, its cells are file-scope-visible everywhere.**

Row B's *result* replicates, but the brief's inference from it ("mount is irrelevant") is
the exact opposite of the truth. B errors because there is **no mount at all**, so nothing
is inlined — a different, arguably-correct reason.

---

## Phase 1 — root cause (COMPLETE)

### The mechanism, by execution path

`compiler/src/component-expander.ts` `_expandChannelNode()` (~`:4826`) is the CE (§38.12)
mount-discovery walk. It replaces a markup node whose tag matches a local channel alias with
a deep clone of the exported `<channel>` decl. **It recurses into exactly three node kinds:**

| node kind | field it descends |
|---|---|
| `markup` | `m.children` |
| `state`  | `s.children` |
| `logic`  | `l.body` |

Every other node kind hits the bare `return node;` at the end of the function — **no recursion.**

I dumped the post-TAB AST for every variant and located the mount node:

```
a.scrml       AST-nodes: NONE   || stranded-in-raw: nodes[0].children[3].armBodyChildren[1]._reparseEachArmBodyRaw
c.scrml       AST-nodes: nodes[0].children[3]                              -> CE finds it   CLEAN
f.scrml       AST-nodes: nodes[0].children[3]                              -> CE finds it   CLEAN
h2.scrml      AST-nodes: nodes[0].children[3]                              -> CE finds it   CLEAN
i.scrml       AST-nodes: nodes[0].children[3].armBodyChildren[1].children[0] -> CE MISSES    ERROR
j-each.scrml  AST-nodes: nodes[0].children[3].bodyChildren[1]              -> CE MISSES     ERROR
k-if.scrml    AST-nodes: nodes[0].children[3].children[1]                  -> CE finds it   CLEAN
```

That yields **two distinct sub-mechanisms under one heading**:

**(i) Field/kind gap.** `<match>` is `kind: "match-block"` — NOT `"markup"` — so CE never even
enters it. Its arm bodies live in `armBodyChildren`, its body text in `bodyChildren`. `<each>`
keeps its body in `bodyChildren`, never in `children`. CE walks only `children`/`body`, so both
containers are invisible. `<if>` works purely because it *is* a `markup` node with a plain
`children` array (variant K). **Causes variants I and J.**

**(ii) Raw-text stranding.** For an **each-bearing bare-body match arm**, `ast-builder.js:15922-15975`
(the S316 `g-nested-each-in-match-arm-drops-diagnostics` fix) deliberately **blanks the arm**
(`children: []`) to avoid the S153 `collectEachBlocks` double-emit, and stashes the body as a raw
string in `_reparseEachArmBodyRaw`. At CE time the mount is **not a node at all** — it is text.
`type-system.ts:13036` later re-parses that raw string LOCALLY with throwaway ids, and those
re-parsed nodes **never pass through CE**, so `<probeChan/>` stays an unexpanded tag and `@stamp`
resolves against nothing. **Causes variant A — the adopter's actual shape.**

Verified `a.scrml`'s arm is exactly this case:

```
ARM tag=Ready children.length=0 _matchArmBodyForm=bare-body
    _reparseEachArmBodyRaw = "<probeChan/>\n  <p>${@stamp}</p>\n  <each in=@items as i key=i.id>..."
```

### PA locus hypothesis: **WRONG**

The hypothesis was "a `<match>` arm body is walked in a context carrying neither the parent scope
chain nor a real span". Variant H2 falsifies the scope-chain half outright: a read inside a match
arm resolves a CE-inlined channel cell perfectly **provided the mount is elsewhere**. The arm body
*does* carry the parent scope chain. `type-system.ts:7830` is only where the symptom surfaces;
the cause is one stage earlier, in CE, and it is about the **mount**, not the read.

The brief's pointer to `type-system.ts:12931-12939` was a **near-miss that paid off**: the comment
block itself was not the cause, but reading ~100 lines further to `:13036` is what exposed
sub-mechanism (ii).

### A WORSE, SILENT defect found while tracing — surfaced, see NOTES

Variant D compiles **CLEAN** and emits the mount as a **literal unexpanded HTML string**:

```js
// out-d/d.client.js:32
return "<probeChan />\n            <!--scrml-each:00b6d2m9_8051000--><!--/scrml-each:00b6d2m9_8051000-->";
```

vs. the top-level-mount build (h2) which emits 8 channel-wiring references. So the CE gap is not
only a diagnostics defect: **a channel mounted inside a match arm is silently dropped from codegen
and shipped to the DOM as a bogus literal tag.** The E-STATE-UNDECLARED over-fire is the *only*
thing currently making this shape fail loudly.
