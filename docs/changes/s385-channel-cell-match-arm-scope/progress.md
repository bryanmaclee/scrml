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

---

## Phase 2 — the fix (COMPLETE for the non-each arm; variant A NOT closed)

### The defects were TWO independent bugs, not one shared root

**Defect 1** — three separate AST walks all descended only into `node.children`, and a `<match>` is
`kind: "match-block"` with **no `children` at all** (arm bodies hang off `armBodyChildren`):

| walker | file | consequence of the gap |
|---|---|---|
| `_expandChannelNode` | `component-expander.ts` | mount never inlined → cells absent from scopeChain → false `E-STATE-UNDECLARED` |
| arm-body consume gate | `codegen/emit-match.ts` | gate probed raw text for a **PascalCase** opener; a channel alias is camelCase → never matched → raw `<probeChan/>` re-emitted **verbatim into the HTML string** |
| `collectChannelNodes` + `collectChannelFunctionMap` + `collectChannelCellMap` | `codegen/emit-channel.ts` | even once inlined, the whole WebSocket layer (route + IIFE + cell mirror) was never emitted |

**Defect 2 — the PA hypothesis was WRONG, and so was mine initially.** The span is populated
correctly at the fire site all along. Measured directly:

```
[S385] fire span = {"file":".../typo-top.scrml","start":66,"end":75,"line":6,"col":14}
```

The type-system is blameless. `compile.js`'s `formatError`/`formatWarning` read only the FLAT
`filePath`/`line`/`column` fields, while stage diagnostics carry location in a `span` object
(`{file,start,end,line,col}` — note `col` vs `column`). So a fully-located diagnostic printed with
no location at all. **Not specific to `E-STATE-UNDECLARED`**: a plain top-level `${@typoCell}` in a
`<div>` was equally location-less, and no stage diagnostic ever printed a `:line:col` under
`scrml compile`. `build.js` and `dev.js` already do `e.line ?? e.span?.line`; `compile.js` never got
the same treatment — and `compile` is the command the adopter was running.

### A hazard that shaped the fix — why the walk is a CURATED field list

My first attempt walked *every* array-of-nodes generically. Measured, that is WRONG:

```
j-each.scrml  each-block: bodyChildren / templateChildren share 3 node identities (incl. markup/probeChan)
a.scrml       logic: body / imports share 1 identity; body / typeDecls share 1 identity
```

A generic walk visits such a mount **twice** and produces two independent `_cloneChannelDecl`
copies — duplicate channel wiring, observed live as a doubled inline. Aliased arrays are also
silently DE-ALIASED if one field is rewritten and its twin is not. The final walk is therefore the
minimal overlap-free set `children` / `body` / `armBodyChildren`; `armBodyChildren` shares no element
identity with `match-block.bodyChildren`. `each-block` bodies are deliberately NOT walked.

### What is fixed and what is NOT

Fixed: **mount + read inside the same non-each `<match>` arm** (variant L) — was a hard
`E-STATE-UNDECLARED` emitting a bogus literal tag with zero wiring; now compiles clean and emits the
same file-level WebSocket layer a top-level mount produces.

**NOT fixed: variant A, the adopter's exact shape** — see Phase 3 step 1 and the open-question
section below.

---

## Phase 3 — empirical verification, per numbered step

**1. Recompile the reproducer — `a.scrml` MUST compile clean, exit 0. → FAILED (honest result).**
`a.scrml` still exits 1 with `E-STATE-UNDECLARED`. Its arm is **each-bearing**, so ast-builder's
S316 path blanks `children` and stashes the body as raw text BEFORE CE runs. There is no node for
CE to walk. See the open question below. It now at least reports a precise location:
`a.scrml:11:18` plus a source-context snippet.

**2. Symptom-specific check + a genuine-typo location probe. → PASS.**
A constructed `@typoCell` case now prints:
```
error [E-STATE-UNDECLARED]: bare `@typoCell` read with no reactive cell in scope. ...
  --> .../typo-top.scrml:6:14
      5 |     <div>
 >    6 |         <p>${@typoCell}</p>
```
Location AND source context, where pre-fix there was neither.

**3. Full variant matrix re-run, PRE vs POST, both measured by execution.**
(`WIRED` = emitted client carries `_scrml_ws_probe`; `LITERAL` = a raw `<probeChan` tag shipped.)

| # | shape | PRE | POST | verdict |
|---|---|---|---|---|
| A | mount + read in an **each-bearing** arm | FAIL, LITERAL | FAIL, LITERAL | **unchanged — NOT fixed** |
| B | no mount at all | FAIL | FAIL | unchanged (arguably correct) |
| C | top-level mount, read outside | CLEAN, WIRED | CLEAN, WIRED | inert |
| D | mount in each-bearing arm, no read | CLEAN, LITERAL | CLEAN, LITERAL | unchanged |
| E | same-file local cell in arm | CLEAN | CLEAN | inert |
| F | read inside an `<each>`, top-level mount | CLEAN, WIRED | CLEAN, WIRED | inert |
| G | `<each in=@undeclaredName>` | CLEAN | CLEAN | **out-of-scope guard HOLDS** |
| H/H2 | top-level mount, read **inside** the arm | CLEAN, WIRED | CLEAN, WIRED | inert |
| I | mount in arm, read **outside** the match | FAIL, LITERAL | FAIL, **WIRED**, no literal | improved, still FAIL |
| J | mount inside an `<each>` body | FAIL | FAIL | unchanged (deliberately untouched) |
| K | mount inside an `<if>` body | CLEAN, WIRED | CLEAN, WIRED | inert |
| **L** | **mount + read in the same non-each arm** | **FAIL, LITERAL** | **CLEAN, WIRED** | **FIXED** |
| M | adopter workaround: top-level mount, each-bearing arm | CLEAN, WIRED | CLEAN, WIRED | inert |

Exactly ONE row flips verdict, and it flips toward the contract.

**4. Variant G guard — must STILL compile clean. → PASS.** `<each in=@totallyUndeclaredName>`
compiles clean before and after. The out-of-scope false negative is untouched, and is now pinned by
an explicit guard test so it cannot start rejecting silently.

**5. Real adopter sources + corpus sweep. → PASS, byte-identical.**
952 files swept (`gauntlet-r25/dev-*.scrml` + `examples/**` + `samples/**`), recording each file's
full diagnostic CODE SET and pass/fail verdict, once on `56473410` and once on the fix:

```
$ diff sweep-PRE.txt sweep-POST.txt
$ echo $?
0
```
**Zero files changed, in either direction.** 728 OK / 224 FAIL, unchanged. The four `gauntlet-r25`
adopter files carry identical diagnostic sets before and after (none of them contains
`E-STATE-UNDECLARED`).

**6. Full suite. → PASS, no new failures.**
- Pre-commit gate (unit + integration + conformance + top-level): **0 fail**, and it gated both
  fix commits.
- Full `bun run test`: **55 fail** on the fix vs **59 fail (+1 error)** on base `56473410` —
  measured by reverting the five source files and re-running. My change strictly REDUCES failures.
- Authoritative browser check: `bun scripts/browser-baseline.ts --check` →
  `PASS — browser failure name set matches the baseline (48 asserted)`.
- `bun run types:check`: 4 NEW diagnostics — **identical on base**, in `emit-each.ts` /
  `route-inference.ts`, files I never touched. Pre-existing on `origin/main`; my changes add zero.

---

## Phase 4 — direction-of-change (measured, not assumed)

| class | count | evidence |
|---|---|---|
| **inert** | 952 of 952 corpus files | `diff sweep-PRE sweep-POST` → empty |
| **newly-accepting** | 1 shape (variant L) | FAIL → CLEAN, and toward SPEC §6.1.2 |
| **newly-rejecting** | **0** | variant G guard holds; corpus diff empty; browser baseline name-set identical |
| **semantics-changed** | 1 shape (variants I + L) | emitted output changes from "bogus literal `<probeChan/>` tag, no wiring" to "correct file-level WebSocket layer". Strictly a repair — the prior output could not work at runtime under any input. |

Assumed-zero was not accepted anywhere: the 952-file sweep was run twice and diffed.

---

## OPEN — variant A, the adopter's shape. NOT fixed, and it needs a ruling.

`a.scrml` fails because ast-builder (`ast-builder.js:15922-15975`, the S316
`g-nested-each-in-match-arm-drops-diagnostics` fix) BLANKS an **each-bearing** bare-body match arm
(`children: []`) to avoid the S153 `collectEachBlocks` double-emit, stashing the body as raw text in
`_reparseEachArmBodyRaw`. At CE time the mount is not a node, it is a string. `type-system.ts:13036`
re-parses that string locally with throwaway ids — and those nodes never pass through CE.

Closing it requires BOTH:
- CE learning to see mounts inside a stranded raw arm body, and
- codegen wiring a channel for an each-bearing arm — whose emitter deliberately excludes that case
  (`!/<\s*each\b/` at `emit-match.ts`) so the each id-restamping is not lost.

That is a rework of machinery with S153 / S177 / S316 history, on a live adopter's flagship path.
It is not a surgical fix and I did not invent semantics for it.

**Verified workaround for the adopter (compiled, not asserted):** move the `<probeChan/>` mount out
of the arm to `<program>` level. Variant M — top-level mount, each-bearing arm containing both the
`${@stamp}` read and the `<each in=@items>` — **compiles clean and emits the channel wiring.**
That is a one-line source move that unblocks the gate today.
