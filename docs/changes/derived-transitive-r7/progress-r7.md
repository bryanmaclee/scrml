# dtr-r7 — progress (append-only)

Startup pwd: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a7593f7fd5a570a19`
Base: `git merge-base HEAD origin/dtr-r6` == `ff0cbdd81150a4c3726e5c266708b65e593892c9` == `origin/dtr-r6`. ASSERTED.

---

## B-1 — BASELINE REPRODUCTION (pre-fix, at `ff0cbdd8`)

Probe: `.tmp/b1-probe.mjs` (compiles each shape to disk, reports whether a `.server.js`
was emitted for the function under test — i.e. whether §12.2 Trigger 3 escalated it).

```
$ bun .tmp/b1-probe.mjs
string-literal-default       errors=[] serverJs=1 escalated=true clientHasFetchStub=true
template-literal-default     errors=[] serverJs=1 escalated=true clientHasFetchStub=true
object-key-default           errors=[] serverJs=1 escalated=true clientHasFetchStub=true
member-property-default      errors=[] serverJs=1 escalated=true clientHasFetchStub=true
comment-in-default           errors=[] serverJs=1 escalated=true clientHasFetchStub=true
nested-decl-string-default   errors=[] serverJs=1 escalated=true clientHasFetchStub=true
CONTROL-bare-ref             errors=[] serverJs=1 escalated=true clientHasFetchStub=true
CONTROL-call                 errors=[] serverJs=1 escalated=true clientHasFetchStub=true
```

**All SIX over-fire shapes fire.** PA's diagnosis HELD, and is REFINED in one place:
the nested-`function-decl` shape (`nested-decl-string-default`) fires through a
SECOND site — the walk's own `function-decl` branch at `route-inference.ts:3735-3741`,
which also text-scans. The PA's two-call fix touches only the TOP-LEVEL roots in
`collectServerOnlyBindingModules` and would have left the nested shape over-firing.

### The consequence, measured on the artifact (not inferred)

`.tmp/b1-artifact.mjs` on `function greet(msg = "please join us")` beside
`import { join } from 'scrml:path'`, at exit 0 with ZERO diagnostics, emits
`case.server.js` containing:

```js
  const _scrml_result = await (async () => {
    const _scrml_body = await _scrml_req.json();
    const msg = _scrml_body["msg"];
    return msg;
  })();
  return new Response(JSON.stringify(_scrml_result ?? null), { ... });
```

The parameter default `"please join us"` is **DROPPED**. `greet()` with no argument
now returns `null` over the wire instead of the string. Exit 0, no diagnostic.

### The normative text it violates

`compiler/SPEC.md` §12.4 (`:7463-7470`), unamended:

> Route inference SHALL be per-function. … it SHALL NOT classify a function based on
> the names of identifiers that appear inside string-literal contents of its body …
> matching a server-fn name as a token inside a string literal is NOT a reference and
> SHALL NOT propagate taint.

---

## B-1 — POST-FIX MEASUREMENT (`f7ae4c33`)

```
$ bun .tmp/b1-probe.mjs
string-literal-default       errors=[] serverJs=0 escalated=false clientHasFetchStub=false
template-literal-default     errors=[] serverJs=0 escalated=false clientHasFetchStub=false
object-key-default           errors=[] serverJs=0 escalated=false clientHasFetchStub=false
member-property-default      errors=[] serverJs=0 escalated=false clientHasFetchStub=false
comment-in-default           errors=[E-CODEGEN-INVALID-LOGIC] serverJs=0 escalated=false clientHasFetchStub=false
nested-decl-string-default   errors=[] serverJs=0 escalated=false clientHasFetchStub=false
CONTROL-bare-ref             errors=[] serverJs=1 escalated=true clientHasFetchStub=true
CONTROL-call                 errors=[] serverJs=1 escalated=true clientHasFetchStub=true
```

6/6 over-fires stop. **Both genuine catches survive.**

The default is preserved in the emitted client:
`function _scrml_greet_3(msg = "please join us") {`

`comment-in-default`'s `E-CODEGEN-INVALID-LOGIC` is **PRE-EXISTING and unrelated** —
measured with NO import at all and with a purely client-safe import
(`.tmp/b1-comment.mjs`):

```
comment-default-NO-import          errors=[E-CODEGEN-INVALID-LOGIC]
comment-default-clientsafe-import  errors=[E-CODEGEN-INVALID-LOGIC]
plain-default-NO-import            errors=[]
```

Round 6's over-fire was MASKING it by relocating the function to the server.
Surfaced as a deferred item; pinned in conf §8b so it cannot be widened quietly.

### Full contract gate, post-fix

```
$ bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance
 22435 pass
 70 skip
 1 todo
 0 fail
 86353 expect() calls
Ran 22506 tests across 1226 files. [354.59s]
[exited with code 0]
```

Matches the reviewer's independently-measured 22,435 / 0 exactly.

---

## THE COVERAGE HALF — assertions added, and their BITE PROOFS

### The unpinned-in-both-directions claim is CONFIRMED

Arc suites measured on the pre-fix tree and the post-fix tree:

```
$ git stash push -- compiler/src/route-inference.ts
$ bun test compiler/tests/unit/route-inference-derived-server-only-reach.test.js \
           compiler/tests/conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js
 149 pass / 0 fail        # PRE-fix (over-firing tree)
$ git stash pop
$ bun test <same two files>
 149 pass / 0 fail        # POST-fix
```

**Identical.** Nothing caught the over-fire being introduced and nothing would have
caught it being removed. (The brief's cited `138` does not reproduce at either tree;
the number is 149 on both.)

### Assertions added (all in `compiler/tests/conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js`)

- **§8b** — 5 non-reference default shapes + a default-PRESERVED artifact assertion +
  the comment shape. Direction: goes red if the over-fire RETURNS.
- **§8c** — the nested-`function-decl` guard (F1), 2 shapes + a client-safe control.
  Direction: goes red if that genuine catch is LOST.
- **§9** — GAP PIN for the destructured-parameter-default LEAK (measured, pre-existing,
  not fixed here) + its nested twin as the discriminator.
- **§7** — reordered so `assertRefusedOrStubFree` runs FIRST (F2), plus a NEW hop-chain
  assertion the section's own test name had promised for three rounds.

### BITE PROOF 1 — the over-fire returns (§8b must go red)

Mutation: in `scanParamDefaultRaw`, `if (rawMode === "text-scan") { scanRaw(raw); return; }`
placed first — i.e. round 6's behaviour restored.

```
(fail) …§8b… > string-literal: compiles clean and stays CLIENT-side (§12.4 SHALL NOT)
(fail) …§8b… > template-literal: …
(fail) …§8b… > object-property-key: …
(fail) …§8b… > member-property: …
(fail) …§8b… > nested-decl-string-literal: …
(fail) …§8b… > the parameter default is PRESERVED in the emitted client function
(fail) …§8b… > comment-in-default: not escalated …
 35 pass
 7 fail
```

RESTORED →
```
 42 pass
 0 fail
```

### BITE PROOF 2 — the top-level genuine catch is lost (§8 must go red)

Mutation: `const trigger3ScanRoot: unknown[] = [body];` (drop the param defaults).

```
(fail) …§8… > t3-default-call: clean compile, the call is server-hosted, nothing server-only is client-loaded
(fail) …§8… > t3-default-bare-ref: …
 40 pass
 2 fail
```

RESTORED → `42 pass / 0 fail`.

### BITE PROOF 3 — F1: the nested-`function-decl` branch is disabled (§8c must go red)

Mutation: `if (false && kind === "function-decl") {` in `scanForServerOnlyBindingRefs`.

```
(fail) …§8c… > nested-default-call: escalated, and NOTHING server-only reaches the browser
        expect(c.serverJsFiles.length).toBeGreaterThan(0);
        error: expect(received).toBeGreaterThan(expected)
        Expected: > 0
        Received: 0
(fail) …§8c… > nested-default-bare-ref: …
 40 pass
 2 fail
```

And the LEAK the branch prevents, measured under the same mutation
(`.tmp/b1-assert-shapes.mjs`):

```
=== genuine-nested-decl-call ===
  errorCodes=[] serverJs=0
  client has Bun.password=true argon2id=true _scrml_stdlib.auth=true
=== genuine-nested-decl-bare-ref ===
  errorCodes=[] serverJs=0
  client has Bun.password=true argon2id=true _scrml_stdlib.auth=true
```

RESTORED → `42 pass / 0 fail`, and the leak greps go back to `false`.

### BITE PROOF 4 — F2: the reorder makes the helper's body reachable

Mutation: `const scanRoot: unknown[] = [body];` in `computeServerReachingFns`
(drop the hop caller's own defaults).

Under the OLD ordering the first failing line would have been
`expect(c.errorCodes).toContain(CODE)` and the helper would never have executed.
Under the NEW ordering the failure comes from INSIDE the helper — the artifact fact:

```
403 | function assertRefusedOrStubFree(c) {
404 |   if (c.errorCodes.includes(CODE)) return "refused";
405 |   expect(c.clientLoadedText).not.toContain("_scrml_fetch_");
                                       ^
error: expect(received).not.toContain(expected)
Expected to not contain: "_scrml_fetch_"

(fail) …§7… > default-bare-ref: refused with the code, and the chain names the hop
(fail) …§7… > default-callback-ref: …
(fail) …§7… > default-call-review-shape: …
 39 pass
 3 fail
```

(`default-nested-decl` correctly stays green — the nested-decl branch catches it
independently. That is the discrimination the section was missing.)

### BITE PROOF 5 — the NEW hop-chain assertion (F2's "assert the artifact fact")

Mutation: nested-decl branch disabled (`if (false && …)`), §7 `default-nested-decl`:

```
711 |         expect(c.codeMessages).toContain("const <computed> -> wrap -> doHash");
                                     ^
error: expect(received).toContain(expected)
Expected to contain: "const <computed> -> wrap -> doHash"
Received: "… const <computed> -> wrap -> inner -> doHash …"
(fail) …§7… > default-nested-decl: refused with the code, and the chain names the hop
 0 pass / 1 fail
```

This is the reviewer's exact observation reproduced: the shape still refuses, only the
chain string moves, and **the mutated chain reads as an improvement** — which is why a
pin that only watched the code could not tell a broken branch from a working one.

RESTORED → arc suites `162 pass / 0 fail` across both files.

### BITE PROOF 6 — §8d, the fail-closed DECLINE fallback (a REFINEMENT of the PA's fix)

The PA's stated fix was structural with no fallback. **The decline branch is reachable on
ordinary code**, measured against the compiler's own front end (`.tmp/decline-probe.mjs`):

```
expr-whole    "hashPassword"                   expr-whole    "\"please join us\""
expr-whole    "`please join us`"               expr-whole    "{ join: 1 }"
expr-whole    "a.join"                         expr-whole    "[1].map(hashPassword)"
expr-whole    "?{ SELECT 1 }"                  stmts         "1 /* join later */"
expr-partial  "match @x { .A :> hashPassword }"
DECLINE       "if @x { hashPassword } else { 1 }"
DECLINE       "<div>hashPassword</div>"
DECLINE       ")("        DECLINE  "hashPassword("        DECLINE  "\"unterminated"
```

An `if`-expression default is ordinary scrml and it DECLINES. So the fix adds a
limb-(a)-only fallback, and §8d pins it.

Mutation: `if (false && rawMode === "text-scan") scanRaw(raw);`

```
1172 |       expect(c.errorCodes).toEqual([]);
                                  ^
error: expect(received).toEqual(expected)
- []
+ [ "E-CODEGEN-INVALID-LOGIC" ]
(fail) …§8d… > an `if`-expression default (parses under NEITHER grammar) still escalates, clean
 0 pass / 1 fail
```

RESTORED → `43 pass / 0 fail`.

**HONEST SCOPE OF THIS ONE.** With the fallback removed the shape does NOT leak — codegen's
backstop fires instead (`E-CODEGEN-INVALID-LOGIC`, serverJs 1 -> 0). So the fallback's
measured value on this shape is that a WORKING program stays a working program rather than
being rejected by a backstop; I did not construct a decline shape that leaks. §8d claims
exactly that and no more.

---

## B-2 — THE COUNTEREXAMPLES, REPRODUCED

```
$ bun .tmp/b2-probe.mjs

=== residual4-fn-valued ===
  errorCodes = []
  codegen rewrote to the fetch stub at 2 site(s):
     async function _scrml_fetch_doHash_3(p) {
     let f = _scrml_fetch_doHash_3;

=== destructured-default ===
  errorCodes = []
  codegen rewrote to the fetch stub at 2 site(s):
     async function _scrml_fetch_doHash_3(p) {
     function _scrml_wrap_4({ x = _scrml_fetch_doHash_3 }) {
```

Both are rewrites route inference does not refuse. The universal is FALSE.

**AND THE BRIEF'S SUGGESTED BOUND IS ALSO FALSE.** *"every SAME-FILE reference to a
`function`-declaration name that codegen would rewrite is refused"* — `doHash` in the
destructured default IS a same-file `function`-declaration name, it IS rewritten, and it
is NOT refused. So no bound was written. The SPEC now states the MEASURED SCOPE (an
enumeration of the shapes the limb was built for) and says in terms that the two sets are
INCOMPARABLE.

### AND IT IS WORSE THAN THE BRIEF STATED — the destructured default is a LEAK

```
$ bun .tmp/b2-destructured-direct.mjs
=== direct-destructured-default ===          function f({ h = hashPassword }) { return h("k") }
  errorCodes=[] serverJs=0
  CLIENT LEAK: Bun.password=true argon2id=true _scrml_stdlib.auth=true
    | const { hashPassword } = _scrml_stdlib.auth;
    | function _scrml_f_3({ h = hashPassword }) {
    | async function hashPassword(password) {
=== direct-plain-default ===                 function f(h = hashPassword) { return h("k") }
  errorCodes=[] serverJs=1
  CLIENT LEAK: Bun.password=false argon2id=false _scrml_stdlib.auth=false
```

Identical on the pre-fix tree (measured via `git stash`), so **PRE-EXISTING, not caused by
this round.** And provably pre-existing on `origin/main`, whose scan root is `body` alone:

```
$ git show origin/main:compiler/src/route-inference.ts | grep -n "scanForServerOnlyBindingRefs(body"
3431:  for (const mod of scanForServerOnlyBindingRefs(body, live).values()) found.add(mod);
```

### The discriminator: the NESTED twin is already correct

```
$ bun .tmp/b2-destructured-nested.mjs
=== direct-nested-destructured ===   function outer(v){ function inner({h = hashPassword}){…} … }
  errorCodes=[] serverJs=1     CLIENT LEAK: Bun.password=false _scrml_stdlib.auth=false
=== direct-array-destructured ===    function f([ h = hashPassword ]) { return h("k") }
  errorCodes=[] serverJs=0     CLIENT LEAK: Bun.password=true  _scrml_stdlib.auth=true
```

So the gap is the TOP-LEVEL scan ROOT (`fnNode.params` is a sibling of `fnNode.body`), not
an unreadable pattern — the walk reaches a NESTED declaration's `params` generically.
NOT FIXED HERE (it moves placement and carries a companion shadow-set over-fire); recorded
as §6.6.19 residual 6 and pinned as an executed gap at conf §9.

---

## B-4 — THE GOVERNING-SENTENCE GATE: OUTCOME (2), A FINDING

`SPEC.md:2960` is `#### 6.6.4 Diamond Dependency — Structural Solution`
(`<price>`/`<quantity>`/`<subtotal>` ordering).

```
$ sed -n '2960,2995p' compiler/SPEC.md | grep -ci "await\|async\|promise"
0
```

**Searched for a section that normatively states the derived recompute is invoked without
`await`: §6.6.1-§6.6.19, §13 (Async Model), §19.9 (Server Function Errors), and a
whole-document grep for `un-awaited` / `not awaited` / `no \`await\`` / `never awaited`.
NO GOVERNING SENTENCE EXISTS.** Every hit is one of the §6.6.19 sites that cite §6.6.4.

Nearest normative anchors, which ENTAIL the property but do not state it:
- **§6.6.3 Phase 3 (SHALL)** — on read the runtime *"SHALL re-evaluate the derived
  expression, clear the dirty flag, cache the new result, and return it."*
- **§6.6.5 (SHALL)** — *"`flush()` SHALL be a built-in function that **synchronously**
  re-evaluates all dirty derived nodes in the current reactive graph **before returning**."*
  A recompute that awaited could not satisfy this.
- **§6.6.7** — the emitted shape is `_scrml_derived_declare("total", () => …)`, a plain
  non-`async` thunk.

**AND A TENSION WORTH SURFACING:** §13.2 normatively says *"The compiler SHALL insert
`await` at every call site where a server-generated fetch call is made."* Inside a derived
thunk it does not, and cannot — which is precisely why §6.6.19 refuses instead of emitting.
§6.6 owes the un-awaited sentence; §13.2 owes the corresponding carve-out. Recorded in
§6.6.19's cross-reference block; **the shipped adopter-facing diagnostic now carries NO
citation after "no `await`"**, with a source comment forbidding one until §6.6 has a
sentence.

`runtime-template.js:1245`/`:1268` cite §6.6.4 for re-entrance prevention and are CORRECT —
§6.6.4 does contain *"The dirty flag SHALL be cleared immediately when re-evaluation
begins … This prevents re-entrant re-evaluation."* Left alone.

---

## F6 — DIRECTION-OF-CHANGE, RE-RUN WITH THE TRACKED SCRIPT

`scripts/corpus-emit-differential.ts` (NOT a scratchpad `diff-run.mjs`). The base side is a
`git archive origin/dtr-r6` snapshot at `.tmp/base-dtr-r6`, given its own git identity so
the two sides are distinguishable revisions.

```
$ bun scripts/corpus-emit-differential.ts capture \
    --compiler-root <WT>/.tmp/base-dtr-r6 --label base-dtr-r6-ff0cbdd8 \
    --work /tmp/dtr-r7-diff/base-work --manifest /tmp/dtr-r7-diff/base.manifest.json \
    --expect-total 1909
$ bun scripts/corpus-emit-differential.ts capture \
    --compiler-root <WT> --label head-dtr-r7 \
    --work /tmp/dtr-r7-diff/head-work --manifest /tmp/dtr-r7-diff/head.manifest.json \
    --expect-total 1909
$ bun scripts/corpus-emit-differential.ts diff \
    --base /tmp/dtr-r7-diff/base.manifest.json --head /tmp/dtr-r7-diff/head.manifest.json \
    --json /tmp/dtr-r7-diff/diff.json
```

```
EMIT DIFFERENTIAL   base=base-dtr-r6-ff0cbdd8 (c07b1b55)   head=head-dtr-r7 (73ca53f0)

   TOTAL          base  1909 of  1909    head  1909 of  1909
   source SET delta: none — the two sides enumerated the SAME 1909 sources
   cross-check   : AGREE (walk set == independent `find` set, both directions)
   expect-total  : ASSERTED and MATCHED (1909)

VERDICT: 2 DIFFERENCE(S)   over 1909 common sources of 1909 base / 1909 head enumerated
                           and 7409 compared artifacts
  sources enumerated        base 1909   head 1909
  source set delta          0
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 code / 2 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    0 of 7409 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  syntax delta (script)     0 new / 0 fixed
  syntax delta (module)     0 new / 0 fixed
  load-context changes      0
  bare server-fn sites      base 145 / head 145  (delta 0, in 0 source(s))
```

The 2 text-only changes are FULLY ATTRIBUTABLE and are the only ones:

```
   diagnostic-TEXT-only changes (same codes): 2 of 1909 common sources (full list, no cap):
     * conformance/cases/derived/e-derived-server-only-reach-lambda-hop/case.scrml
     * conformance/cases/derived/e-derived-server-only-reach-transitive/case.scrml
```

**7409/7409 artifacts byte-identical.** Zero newly-rejecting, zero newly-accepting, zero
placement movement anywhere in the corpus.

### The two text-only diffs, extracted word-by-word (`.tmp/f6-explain.mjs`)

They are two DIFFERENT causes, and neither is a behaviour change:

```
=== conformance/cases/derived/e-derived-server-only-reach-lambda-hop/case.scrml ===
  exitCode base=1 head=1
    base: …runtime invokes the recompute with no `await` (§6.6.4). The cell's…
    head: …runtime invokes the recompute with no `await`. The cell's value…
  codes base=["E-DERIVED-SERVER-ONLY-REACH","W-PROGRAM-REDUNDANT-LOGIC","W-PROGRAM-SPA-INFERRED"]
  codes head=["E-DERIVED-SERVER-ONLY-REACH","W-PROGRAM-REDUNDANT-LOGIC","W-PROGRAM-SPA-INFERRED"]
  codes IDENTICAL: true
  artifacts (11) byte-identical: true

=== conformance/cases/derived/e-derived-server-only-reach-transitive/case.scrml ===
  exitCode base=1 head=1
    base: …cleaner source. See SPEC §40.8. (line 22, col 1) -->…
    head: …cleaner source. See SPEC §40.8. (line 25, col 1) -->…
  codes base=["E-DERIVED-SERVER-ONLY-REACH","W-PROGRAM-REDUNDANT-LOGIC","W-PROGRAM-SPA-INFERRED"]
  codes head=["E-DERIVED-SERVER-ONLY-REACH","W-PROGRAM-REDUNDANT-LOGIC","W-PROGRAM-SPA-INFERRED"]
  codes IDENTICAL: true
  artifacts (11) byte-identical: true
```

1. **`lambda-hop`** — the SHIPPED DIAGNOSTIC STRING lost the false `(§6.6.4)` citation.
   That is B-4's source edit at `route-inference.ts:6188`, and it is the ONLY compiler-
   behaviour-visible change this branch makes to any corpus source. It is text-only by
   construction: a citation removed from a message body changes no code, no severity, no
   exit disposition, and no artifact.
2. **`transitive`** — a LINE NUMBER moved, `(line 22, col 1)` -> `(line 25, col 1)`. This is
   NOT the compiler at all: I edited the `//` COMMENT at the top of that fixture (the same
   §6.6.4 citation fix), adding 3 lines, which shifted the span an unrelated
   `W-PROGRAM-*` warning reports. The compiler behaved identically on both sides.

Both keep the SAME diagnostic-code multiset, the SAME exit code, and 11/11 byte-identical
artifacts. Neither is a placement, refusal, or emission change.

⚠ **TWO INSTRUMENT DEFECTS FOUND AND CORRECTED BEFORE THE NUMBERS ABOVE WERE TRUSTED**, and
the first run's numbers were garbage:
1. A `git archive` extraction has no `.git`, so `git rev-parse HEAD` walked UP and returned
   the HEAD of the enclosing worktree — **both sides reported the same revision** and the
   harness correctly refused with `INCOMPARABLE`. Fixed by giving the snapshot its own repo.
2. `--work` under the head's own compiler root makes the compiler print the out-dir
   RELATIVELY, which `normalizeStream` (which folds the ABSOLUTE work path) cannot fold.
   That alone produced **1228 phantom text-only diffs and 1021 phantom artifact diffs.**
   Fixed by putting both work dirs under the system temp dir, outside both roots.
   **Had the harness not refused on (1), (2)'s noise would have read as a real regression.**

The brief's cited `2366/0/0` from the untracked scratchpad script does not correspond to
this instrument's population: the tracked script's five default roots enumerate **1909**
`.scrml` sources and REPORT the 457 excluded ones by directory (compiler 123, dashboard 1,
docs 286, handOffs 47).

---

## R26 EMPIRICAL — the SYMPTOM on real sources, not "tests pass"

`.tmp/r26.mjs` compiles the same 139 real sources on BOTH trees —
`docs/readme-snippets/tasks-app.scrml` plus every `samples/compilation-tests/*.scrml`
containing a `function` with a parenthesised default, plus a 1-in-4 stride — and compares
three observables per source: the diagnostic multiset, the PLACEMENT (`.server.js` count +
the sorted set of server-hosted function names read out of the emitted handlers), and the
artifact-name set.

```
$ bun .tmp/r26-cmp.mjs
R26 COMPARISON — 139 sources
  new/changed refusals (diagnostic multiset) : 0
  PLACEMENT drift (.server.js set + hosted fn names) : 0
  artifact-name-set drift : 0
  TOTAL differing sources : 0
  positive control — sources that DO emit a .server.js on head : 17
  positive control — sources with >=1 diagnostic on head : 11
```

The positive controls are what make the zeros mean something: 17 of the 139 genuinely
escalate and 11 genuinely diagnose, so the comparison is not vacuously green.

`docs/readme-snippets/tasks-app.scrml`, both sides identical:
```
codes=[]  serverJsCount=1  serverHostedFns=["createTask","loadTasks","toggle"]
artifacts=[scrml-runtime.<HASH>.js, tasks-app.client.js, tasks-app.css,
           tasks-app.html, tasks-app.server.js]
```

---

## CURRENCY GATES

```
$ bun run scripts/regen-spec-index.ts --check
  SPEC-INDEX totals are STALE.  have: 37,243  want: 37,259
$ bun run scripts/regen-spec-index.ts        # regenerated, committed
$ bun run scripts/regen-spec-index.ts --check
  SPEC-INDEX totals OK — Total lines: 37,259 | Total sections: 65 + appendices
```

### ⚠ MY OWN EARLIER CLAIM ABOUT `docs/FACTS.md` WAS WRONG — CORRECTED HERE

Mid-dispatch I recorded that `bun scripts/facts.ts --check` "fails IDENTICALLY on the
untouched base (verified by stashing every change)" and therefore left it alone per the
brief's *"Do NOT touch `docs/FACTS.md` staleness — it is honest against this branch's base."*

**THE STASH TEST WAS INVALID AND THE CONCLUSION WAS FALSE.** `git stash` removes only
UNCOMMITTED changes; by the time I ran it, `f7ae4c33` (route-inference.ts, +113 lines) and
`83d49b3c` (the test files) were already COMMITTED, so the stashed tree still carried my own
source delta. I measured my own change and called it pre-existing.

Re-measured properly, against the independent `origin/dtr-r6` snapshot at `.tmp/base-dtr-r6`:

```
$ cd .tmp/base-dtr-r6 && bun scripts/facts.ts --check
  PASS  @generated:facts-table (docs/FACTS.md)
  PASS  @generated:facts-lists (docs/FACTS.md)
PASS — all derived facts current.
```

**The base is CLEAN.** Both stale figures are attributable to this branch and to nothing else:

```
| live compiler source (`compiler/src`) | 241,406 -> 241,519 lines across 187 files |   (+113, route-inference.ts)
| specification lines (`compiler/SPEC.md`) | 37,243 -> 37,259 |                         (+16,  SPEC.md)
```

So `docs/FACTS.md` is regenerated and committed here. The brief's premise — that the
staleness was honest against the base — did not hold; the leave-it-alone instruction was
predicated on it and does not apply. **The generalisable error: a stash-based
"is it pre-existing?" test is only valid when nothing of yours is committed yet.** Use an
independent checkout of the base, which is what the differential harness already required.

---

## FINAL VERIFICATION SET

```
$ bun test compiler/tests/unit/route-inference-derived-server-only-reach.test.js \
           compiler/tests/conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js
 163 pass
 0 fail
 308 expect() calls
Ran 163 tests across 2 files.

$ bun conformance/run.ts
conformance (impl#1): 886/886 cases pass

$ bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance
 22448 pass
 70 skip
 1 todo
 0 fail
 86410 expect() calls
Ran 22519 tests across 1226 files. [356.29s]
[exited with code 0]

$ bun scripts/facts.ts --check
  PASS  @generated:facts-table (docs/FACTS.md)
  PASS  @generated:facts-lists (docs/FACTS.md)
PASS — all derived facts current.

$ bun run scripts/regen-spec-index.ts --check
SPEC-INDEX totals OK — Total lines: 37,259 | Total sections: 65 + appendices
```

Baseline for comparison — the full contract gate immediately after the B-1 fix and before
any test was added: `22435 pass / 70 skip / 1 todo / 0 fail`, which matches the reviewer's
independently-measured figure exactly. The delta to `22448` is **+13 tests, all added by
this dispatch** (§8b 7 · §8c 3 · §8d 1 · §9 3, minus none removed), **0 fail throughout.**

