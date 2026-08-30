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

---

# FIX ROUND (S239 adversarial pass) — the approach was WRONG, and is now reversed

## What the review caught, reproduced by me before touching anything

**F2 — CONFIRMED VERBATIM.** A mount nested ONE level inside the arm:

```
<Ready>
    <div><probeChan/></div>
    <p>${@stamp}</p>
</>
```

compiled **CLEAN** and emitted, literally:

```js
return "<div><probeChan /></div>\n            <p><span data-scrml-logic=\"_scrml_logic_1\"></span></p>";
```

`_armWrapperHasCEInlinedNode` inspected only TOP-LEVEL wrapper children, so `_p3aInlinedFrom` was
not a direct child, the gate fell through to the `armsRaw` re-parse, and the raw alias tag shipped.
**That is precisely the defect my own commit message and code comment claimed to have eliminated.**

**F1 parity gap — CONFIRMED by execution.** Arm mount vs top-level mount: the channel's exported
`beat` reaches `.server.js` **0 times vs 1** (calling it is a ReferenceError), and the client carries
**1 `stamp` init/set vs 4**. I did NOT try to fix the reviewer's claimed "TypeError on first render" —
the coordinator could not demonstrate it and neither could I; the parity gap is what is real.

**F4 — CONFIRMED.** `visitArmBodies(node, visit)` at `emit-channel.ts:85` sat inside the
`node.kind === "markup"` branch while the helper returns unless `kind === "match-block"`. Dead.

**F5 — CONFIRMED.** `… See SPEC §40.8. (line 2, col 5)` immediately followed by `--> …:2:5`.

## The judgement call: (b) refuse, not (a) full parity

I checked whether (a) was reachable before choosing. It is not, and not for one reason:

1. **Every** collector feeding channel emission descends `node.children` only, and a `<match>` is
   `kind:"match-block"` with **no `children`**. Missing it: `collectChannelNodes`,
   `collectChannelFunctionMap`, `collectChannelCellMap` (`emit-channel.ts`) and `collectFunctions`
   (`codegen/collect.ts` — read at `:170`, `children`-only). The set is open-ended.
2. An each-bearing arm is blanked by ast-builder (S316) and stashed as raw TEXT, so the mount is not
   a node at CE time at all.
3. **The decisive one.** Even with every collector taught to descend, the type-system binds the
   inlined cells in the **arm's lexical scope** while the runtime mirror is **file-scoped** — which
   is why variant I (mount in arm, read outside) still failed even after I had it fully WIRED.
   Reconciling that means hoisting the inlined decl, and hoisting contradicts §38.12.2's normative
   in-place `Replace M with deepClone(decl)`. **That is a SPEC amendment, not a bug fix.**

So the fix now **fails CLOSED**: `E-CHANNEL-MOUNT-IN-CONDITIONAL`, naming the alias, the container,
and the one-line move to `<program>` level. Reversible; a half-done (a) is what the previous commit
shipped. The acceptance machinery (CE `armBodyChildren` walk, the `emit-match` gate, the
`emit-channel` collectors — and with them the F4 dead call) is **reverted to base**.

Detection covers both forms the mount can take: a **deep subtree search** of `armBodyChildren` (so
the F2 nested shape is caught, not just direct children) and a **scan of the S316
`_reparseEachArmBodyRaw` text** (so the adopter's each-bearing arm is caught, where no node exists).

## Post-fix matrix, by execution

| shape | verdict |
|---|---|
| mount direct child of a `<match>` arm | **REFUSED** |
| mount NESTED in the arm (`<div><probeChan/></div>`) — F2 | **REFUSED** |
| mount in an **each-bearing** arm (adopter's `a.scrml`) | **REFUSED** |
| mount in an arm with **no read** (used to compile clean + ship dead markup) | **REFUSED** |
| mount inside an `<if>` body | **CLEAN + WIRED** (unchanged — `<if>` is a markup node) |
| top-level mount, read outside | **CLEAN + WIRED** |
| top-level mount, read **inside** the arm | **CLEAN + WIRED** |
| the documented workaround (`m-workaround`) | **CLEAN + WIRED** |
| `<each in=@undeclaredName>` | **CLEAN** (out-of-scope guard holds) |

## Direction of change, re-measured for the newly-rejecting arm

1005 files (`gauntlet-r25/dev-*` + `examples/**` + `samples/**` + `stdlib/**`), diagnostic code set
+ verdict per file, run on base `56473410` and on the fix:

```
$ diff sw-PRE.txt sw-POST.txt
$ echo $?
0
```

**Empty.** The refusal has **measured-zero** blast radius on the corpus — base §8's migration
obligation for a newly-rejecting change is satisfied at zero cost.

Pre-commit gate: **29348 pass / 0 fail / 86 skip / 2 todo**.

## Test strengthening (F3)

Acceptance tests now assert **cell decls + the exported server fn**, not just the WebSocket
transport — the transport alone is satisfied by a half-wired channel and would have let the suite go
green while the feature was broken. The unfixed *support* case is recorded as an explicit
`test.todo` so CI carries the debt instead of a doc.

## Noted, not fixed

`compileScrml` populates `outputs` even when the compile has HARD ERRORS, and the CLI writes those
artifacts to disk on a failed compile. That is pre-existing and out of scope here, but it is the
reason the refusal has to be a hard error rather than a lint.

**⚑ `E-CHANNEL-MOUNT-IN-CONDITIONAL` needs a §34 catalog row.** SPEC is PA-owned; deliberately
untouched.


---

# ROUND 3 — ruling absorbed, blocker fixed, rebased onto `origin/main`

**bryan ruled: reject (a).** Fail-closed stands, `E-CHANNEL-MOUNT-IN-CONDITIONAL` stays, SUPPORT for
arm-mounted channels is CLOSED — it needs a SPEC amendment and is not a bug fix. Recorded here so the
`test.todo` in the integration suite is read as *deliberately deferred*, not *pending*.

## The blocker — reproduced verbatim before touching anything

A channel alias equal to any enum VARIANT NAME refused a **correctly-placed top-level** mount:

```scrml
import { "probe" as Ready } from './chan.scrml'
type Phase:enum = { Loading, Ready }
<Ready/>                          <!-- already at <program> level -->
<match for=Phase on=@phase> … <Ready><p>${@stamp}</p></> </>
```

→ `E-CHANNEL-MOUNT-IN-CONDITIONAL … Fix: move <Ready/> out to <program> level.` **It is already
there.** Unfollowable instruction, file cannot be compiled at all, compiles clean on `main` —
newly-rejecting on valid code, the one direction we are least allowed to ship.

**Root, confirmed at the reviewer's locus by reading `ast-builder.js`:** `armBodyChildren` holds
SYNTHETIC wrappers fabricated at `:15965` and `:15990` as `{kind:"markup", tag: arm.variantName}` —
structurally indistinguishable from author markup. `findAliasMount` started at the wrapper ARRAY, so
`aliases.has(rec.tag)` matched the fabrication.

**The suite could never have caught it**: every fixture used `probeChan`, which cannot collide with a
variant name. Now pinned three ways — colliding alias at top level is CLEAN; colliding alias *inside*
an arm is still REFUSED (so the guard cannot be satisfied by merely ignoring colliding names); nested
match reports exactly once.

## Detector rewritten, not patched — two findings shared one cause

The old shape had **every container search its own subtree**. That produced both the wrapper collision
AND the duplicate report. The walk now attributes each mount to its **nearest enclosing container**:

- descends into each wrapper's `.children` and marks the wrapper `seen`, so a wrapper is never
  classified as a mount;
- reports each mount **exactly once**. Measured: a mount inside a nested `<match>` produced **2**
  diagnostics before, **1** after.

## Also fixed (relayed by the coordinator, verified by me)

**Unescaped alias reaching `new RegExp`.** Confirmed reachable by reading
`buildImportedChannelAliases`: the `else if (Array.isArray(imp.names))` fallback does
`result.set(name, …)` where `name` is the raw channel `name=` string. A `(` or `[` would make the
constructor **THROW** — crashing the compile rather than emitting a diagnostic — and a `.` would
silently become a wildcard. Now escaped, matching the two sibling regex builders already in the same
file (`:2531`, `:2678`). Defensive: a crash beats a diagnostic nobody asked for.

## Rebase onto `origin/main` (was 15 behind)

Conflict set was exactly the two predicted files. Both resolved to `origin/main` wholesale, then my
remaining pieces re-applied on top.

**`#756` (`67e0f614`) supersedes my `2258078e` — dropped entirely**, along with my
`resolveDiagLocation` unit tests, which asserted my old `{filePath,line,column}` shape. Their shape
(`{file,line,col}`, with the middle `?? diag.col` level that `build.js`/`dev.js` already use) is
better and has its own suite at `compiler/tests/commands/diagnostic-span-fallback.test.js`.

**Re-applied on top of theirs:**

1. **`stripRedundantLocation` (F5).** #756 *introduced* the duplicate-location defect on `main` —
   `(line 2, col 5)` immediately followed by `--> …:2:5`, newly exact because before #756 the arrow
   carried no coordinates. Verified by execution before and after. **Gated on the resolved FILE, not
   just the line**: `-->` only prints when a file resolved, so gating on line alone would delete
   coordinates nothing replaces. Pinned by a test.
2. **Atomic `resolveDiagLocation`.** Resolving components independently could pair a top-level
   `filePath` with `line`/`col` from a `.span` naming a DIFFERENT file, then render that file's line
   as the offending source — confidently wrong, worse than incomplete. The file now always comes from
   the same carrier as the coordinates; a span's `col` is borrowed only when both carriers agree on
   the file. **#756's own contract is preserved** — explicit top-level coordinates still win over a
   span naming another file, and their regression test passes unmodified.

## Verification on the merged tree

| gate | result |
|---|---|
| pre-commit (unit + integration + conformance + top-level) | **29363 pass / 0 fail** / 86 skip / 2 todo |
| corpus sweep, 1005 files, `origin/main` vs fix | **`diff` empty, exit 0** |
| `browser-baseline.ts --check` | **PASS** — 48 asserted, name set identical |
| `types:check` | 4 diagnostics, **all pre-existing on `origin/main`** in `emit-each.ts` / `route-inference.ts`, neither touched by me |
| refusal/acceptance matrix | all 4 unwireable shapes REFUSED; `<if>`-body, top-level, workaround, colliding-alias-top-level all CLEAN + WIRED |

Files changed vs `origin/main`: `compiler/src/component-expander.ts`,
`compiler/src/commands/compile.js`, `compiler/src/commands/diagnostic-format.js` (+ tests).

**⚑ Still owed: a §34 catalog row for `E-CHANNEL-MOUNT-IN-CONDITIONAL`.** SPEC is PA-owned.


---

# ROUND 4 — the raw-text path is DELETED

**bryan ruled: (a) now, file the gap, (b) as its own arc.**

## Reproduced before deleting

A mount correctly at `<program>` level, plus an each-bearing arm containing only a COMMENT naming the
alias:

```scrml
<probeChan/>
<match for=Phase on=@phase>
    <Ready>
        <!-- do not mount <probeChan/> here -->
        <each in=@rows as r><li>${r}</li></each>
    </>
</>
```

→ `E-CHANNEL-MOUNT-IN-CONDITIONAL`. **Clean on `main`, FAILS on the branch.** A comment made a valid
file uncompilable. Same class for any `<pre>`, doc block, or string literal naming the alias.

## What was deleted

`findAliasInRaw` and its `_reparseEachArmBodyRaw` call site. **Zero references remain.** Detection is
now **node-path only**.

This is a **deliberate, ruled FAIL-OPEN** for the each-bearing arm — the adopter's exact shape. S316
blanks that arm before CE runs, so there is no tree to ask, and a text scan cannot distinguish a
mount from a mention. Don't ask the text what the tree already knows; where the tree cannot be asked,
the answer is to stop asking, not to guess more carefully. **Masking comments and strings was NOT
implemented** — that is the enumerate-forever shape ruled against at S371.

## Matrix, re-run by execution

| shape | result |
|---|---|
| `l` — mount direct child of arm | **REFUSED** (node path) |
| `f2-nested` — mount one level deep | **REFUSED** |
| `p-nested` — mount two levels deep | **REFUSED** |
| `d-noread` — non-each arm, mount, no read | **REFUSED** |
| `nested-match` — mount in inner match | **REFUSED ×1** (no duplicate) |
| `c` / `m-workaround` / `k-if` / `g` / `collide` | **CLEAN** |
| `s-comment` — comment naming the alias | **CLEAN** ← the round-4 regression guard |
| `q-strlit` — `<pre>` naming the alias | **CLEAN** |
| `d-each` — each-bearing arm + mount, no read | **CLEAN — ruled fail-open** |
| `a` — adopter shape | refusal **no longer fires**; still fails on the PRE-EXISTING `E-STATE-UNDECLARED` that is present on `main` |

⚑ **Note on the expected matrix.** "D" was expected to flip to fail-open. The round-2 `d-noread`
fixture is **not** each-bearing (no `<each>` in the arm), so it is a node-path case and correctly
stays REFUSED. The true each-bearing equivalent was added as `d-each` and does go fail-open. The
expectation holds once the variant is correctly identified.

## Corpus re-measure, `origin/main` vs fix

1005 files. **Newly-failing: 0 of 1005.** 250 FAIL on both sides, and `diff` is byte-empty — so the
identity is per-file (verdict AND diagnostic code set), not merely matching aggregate counts. Zero
now for a *stronger* reason than in round 3: there is no longer a text-scan heuristic that could fire
on a mention.

## Tests

- The comment case and a `<pre>` case are pinned **CLEAN** — the regression this round exists to
  prevent.
- The each-bearing refusal assertion is converted to an explicit **`test.todo`** naming the filed
  gap, so CI carries the fail-open as known debt rather than silently asserting the wrong thing.

## ⚑ Doc claims this round falsifies

- **`compiler/SPEC.md` §34 row for `E-CHANNEL-MOUNT-IN-CONDITIONAL`** claims detection happens "BOTH
  ways a mount can exist … and a scan of the S316 `_reparseEachArmBodyRaw` text stash." **That is now
  FALSE.** SPEC is PA-owned and was NOT touched — flagged for PA correction.
- **In-source:** the doc block on `reportChannelMountsInConditionals` made the same both-paths claim.
  **Fixed in this commit** — it now carries an explicit SCOPE section stating the check is node-path
  only, that the adopter shape is not detected, why the text scan was deleted, and a do-not-restore
  note. I swept `component-expander.ts` and the integration suite for any other both-paths wording;
  the remaining `raw text` hits in that file are pre-existing comments about unrelated subsystems
  (prop substitution, `armsRaw` codegen re-parse) and make no claim about this check.

## Gates at the round-4 tip

| gate | result |
|---|---|
| pre-commit | **29364 pass / 0 fail** / 86 skip / 3 todo |
| corpus, `origin/main` vs fix | **0 of 1005 newly-failing**, diff byte-empty |


---

# ROUND 5 — two code nits and one doc correction

## 1. The diagnostic said "arm" when the container was an `<each>`

The opening container label was computed; the trailing back-reference was hardcoded. Reproduced from
`scrml compile`:

> "is mounted inside an **`<each>` body** … Its cells stay readable everywhere in the file, including
> inside this **arm**"

There is no arm. Added `CHANNEL_MOUNT_CONTAINER_NOUN` beside the existing `..._LABEL` map and wired
the trailing clause to it. Verified both directions by execution — the `<each>` mount now reads
"including inside this `<each>` body"; the `<match>` mount still reads "including inside this arm".

## 2. `resolveDiagLocation` dropped a flat `col` even when the files MATCHED

Reproduced:

```
{filePath:"a.scrml", column:7, span:{file:"a.scrml", line:3}}
  ->  {file:"a.scrml", line:3}        // col 7 discarded
```

That contradicted the `#756` "top-level coordinates win" contract stated eight lines above it, and
regressed the pre-change chain (`--> a.scrml:3:7` became `--> a.scrml:3`). **The atomicity rule was
right but over-applied** — dropping the flat col is correct only when the files DIFFER, because only
then does it index into something other than the file being reported. Now consults the already
computed `sameFile`.

Both directions pinned by new tests; the differing-file drop still holds, and #756's own suite is
untouched and green.

## 3. The SCOPE note was wrong, and under-enumerated

**Wrong:** it claimed the each-bearing shape "compiles clean and ships dead markup". Only half true.
Measured by compiling both:

| shape | outcome |
|---|---|
| each-bearing arm + mount + a `${@cell}` **READ** | **fails CLOSED** with the misleading `E-STATE-UNDECLARED` — the adopter's exact shape; `repro/a.scrml` fails at **L11:18**, it does NOT compile clean |
| each-bearing arm + mount + **no read** | **compiles clean at exit 0, ships the raw tag as dead markup** — the silent fail-open |

The note now states both and marks which one is silent.

**Under-enumerated:** the note claimed to enumerate the holes while missing one. The arm walk is
guarded on `Array.isArray(rec.armBodyChildren)`, and ast-builder's wrapper builder returns
`undefined` on **four** paths, not two — a missing/non-string `armsRaw`, a `parseMatchArms` THROW, a
parse yielding zero arms, and a build yielding zero wrappers. On any of them the ENTIRE match block
is skipped and no mount inside it is detected. Not a regression (base was equally blind), now
enumerated, with an instruction to add a third hole rather than let the claim stand while false.

⚑ The same over-claim is in the **PA-owned SPEC §34 row**. `compiler/SPEC.md` NOT touched.

## Final gates

| gate | result |
|---|---|
| pre-commit | **29366 pass / 0 fail** / 86 skip / 3 todo |
| corpus, `origin/main` vs fix, 1005 files | **diff byte-empty — 0 newly-failing** |
| `browser-baseline --check` | **PASS** — 48 asserted, name set identical |
| `types:check` | 4 diagnostics, all pre-existing on `origin/main` in `emit-each.ts` / `route-inference.ts`, neither touched |
| matrix | refusals + clean set unchanged from round 4 |

Merged current `origin/main` (ledger-only `#771`); 0 behind at the final tip.


---

# ROUND 6 — `engine-decl` is the third container

## Reproduced first

A channel mounted in an `<engine>` state-child body: **exit 0, zero diagnostics, literal `probeChan`
in `clientJs`, zero `_scrml_ws` wiring.** The identical silent dead-channel outcome as the `<match>`
case. This is the third hole my own round-4 SCOPE note asked a future agent to add rather than let
the enumeration stand while false.

## One branch, not three — the emitter question, answered

The emitter **is** shared: `emit-engine.ts` and `emit-match.ts` both call
`emit-variant-guard.ts:emitVariantGuardedRender`. But the guard runs on the **AST**, and there the
shapes are already parallel:

```
match-block . armBodyChildren[i] . children   <- arm body
engine-decl . bodyChildren[i]    . children   <- state-child body
```

So `engine-decl` reuses the **same discipline** already applied to arm wrappers — never classify the
direct wrapper entry, descend into its `.children` with the container attributed. Plus a label and a
container noun (`"state-child body"`, so the trailing clause never says "arm").

## Collision-safe by construction

Direct `bodyChildren` entries are deliberately **not** classified. A state-child is author-written
markup whose TAG is a variant name (`<Done rule=.Idle>`), and **the AST carries no marker separating
it from a mount — measured, identical key sets.** Classifying there would false-accuse an alias
colliding with a variant name: the round-3 blocker class.

Pinned by test: an alias named `Done`, mounted at `<program>` level beside a `<Done>` state-child,
compiles **CLEAN** and stays **wired** (4 `_scrml_ws` refs).

## Residual, enumerated (hole 3)

A mount that is a **direct child of the engine body** — a sibling of the state-children — is still
not caught. It emits **nothing at all**: no tag, no wiring. Resolving it needs a variant-name oracle;
`governedType` + `ast.typeDecls` covers same-file enums but **not imported ones**, so it buys a
partial oracle in exchange for a real false-positive risk. Recorded as `test.todo` rather than
guessed at. The SCOPE note now enumerates **three** holes and asks for a fourth to be added.

## Two shared-helper nits

- **line+col atomicity.** `{file:"a", line:5, span:{file:"a", line:9, col:11}}` yielded `col:11`
  against `line:5` — a column belonging to another line. The docstring promised "from ONE carrier"
  and enforced only file identity. The span's col is now borrowed only when the span agrees on the
  file **and** the line (or carries no line).
- **Stale docstring.** It claimed all three commands resolve location identically. They do not:
  this helper resolves atomically while `build.js:903-905` / `dev.js:512` use flat
  `filePath || file || span?.file`, so on a mismatched carrier `compile` reports the span's file
  where `build`/`dev` report the top-level one. Docstring narrowed to what is actually promised and
  the divergence named. `build.js`/`dev.js` NOT touched, per instruction.

## Gates

| gate | result |
|---|---|
| pre-commit | **29368 pass / 0 fail** / 86 skip / 4 todo |
| corpus, `origin/main` vs fix, 1005 files | **diff byte-empty — 0 newly-failing** |
| `browser-baseline --check` | **PASS** — 48 asserted, name set identical |
| `types:check` | 4 diagnostics, all pre-existing on `origin/main` in files I never touched |
| matrix | refusal/clean sets unchanged; engine mount now REFUSED; engine collision CLEAN + WIRED |
