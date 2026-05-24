# M6.7-D4 — FIX-NATIVE: object-literal-in-call-arg / return-position — PHASE-0 STOP-AND-REPORT (bucket empty at HEAD)

Worktree:    /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a006f5faac2564305
Branch:      worktree-agent-a006f5faac2564305
Startup pwd: /home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-a006f5faac2564305
Base HEAD:   003ee3a8 (S127 close; D1/D2/C1/C2 already absorbed)

Maps consulted: primary.map.md (full) + Task-Shape Routing "Native-parser bug fix" row
(structure/schema/domain/test maps). **Maps consulted but not load-bearing for the verdict** —
the load-bearing fact (the D4 label is stale) came from empirical Acorn-oracle probing, not from
any map. The map's own warning ("treat ALL native-parser map content as hypothesis to verify
against source") was the correct posture; the maps did not pin the gap because there is no gap.

## VERDICT (one line)
**The D4 "object-literal-in-call-arg / return-position" bucket is EMPTY at current HEAD.** The
native parser ALREADY has full object-literal parity with the live (Acorn) front-end for call-arg,
return, assign, nested, arrow-concise, array-element, computed-key, spread, and method-shorthand
positions. There is NO native-parser fix to make for this label. This is the brief's explicit
STOP-and-report condition: do not "fix" the parser to accept forms it already accepts.

## Phase 0 — ROOT-CAUSE CONFIRMATION (the discipline the brief demanded; label was WRONG a 5th time)

### Step 1 — Re-measured the CURRENT corpus NSBH residual (post-D2/C1/C2)
Drove the full 1001-file `.scrml` corpus (`enumerateScrmlCorpus`: samples 876 + examples 64 +
stdlib 50 + self-host 11) through `nativeParseFile` at HEAD `003ee3a8`.
(scratch-d4/phase0-corpus.mjs.)

  CURRENT total "no statement begins here" (NSBH) fires: **293** across **110** files.
  (D1's pre-D2 number was 474; D2 and the other landed units cleared the rest down to 293.)

NSBH is a DOWNSTREAM cascade (the D1 finding holds): the statement loop reports NSBH after an
upstream expression/statement production bails and strands the cursor. So I classified by the
FIRST error code per file — the TRUE upstream trigger:

| First-error code (upstream trigger) | files | what it is |
|---|---:|---|
| E-EXPR-UNEXPECTED            | 18 | `${...}` markup-escape-in-expr seam (test-fixture placeholder), `given x => {}`, `server {}`, `^{}` meta-context |
| E-EXPR-MATCH-ARROW          | 13 | match/transition arm `=>` family (D3 territory) |
| E-EXPR-PARAM                | 12 | `given`/arrow param-list forms |
| E-STMT-IMPORT-NAME          | 12 | string-literal import specifier `import { "channel-name" as alias }` (channel-import form) |
| E-STMT-FUNCTION-BODY        | 11 | function-body seam (post `await`/`throw`/`fail` cascades) |
| E-EXPR-MATCH-PATTERN        | 11 | match-pattern arm family (D3 territory) |
| E-STMT-MISSING-SEMICOLON    |  8 | downstream of an upstream bail |
| E-STMT-EXPECT-RPAREN        |  7 | paren-group bail |
| E-AWAIT-NOT-IN-SCRML        |  4 | `await` in corpus (deliberately rejected by native; live also rejects) |
| E-ASYNC-NOT-IN-SCRML        |  4 | `async` in corpus (deliberately rejected; live also rejects) |
| E-STMT-BINDING-NAME         |  2 | binding-name seam |
| E-THROW-NOT-IN-SCRML        |  2 | `throw` (deliberately rejected) |
| E-STMT-FUNCTION-NAME        |  2 | fn-name seam |
| E-MARKUP-002                |  1 | markup seam |
| **E-EXPR-OBJECT-PROP**      |  **1** | **the ONLY object-literal-adjacent first-trigger — and it is NOT an object literal (see Step 3)** |
| E-EXPR-FUNCTION-BODY        |  1 | function-body seam |
| E-TRY-NOT-IN-SCRML          |  1 | `try` (deliberately rejected) |

The transition-arm coarse line-text bucket (`:>`, 42 fires) is the already-filed **D3** unit.
**Object-literal-in-call-arg / return-position does NOT appear as a trigger anywhere** except the
single mis-attributed E-EXPR-OBJECT-PROP file dissected in Step 3.

### Step 2 — Pinned the object-literal forms against the Acorn oracle (parseProgram + nativeParseFile)
Every object-literal form the live (Acorn) parser ACCEPTS, the native parser ALSO parses with
ZERO diagnostics — through BOTH `parseProgram(lex(src))` AND the full `nativeParseFile` assembler:

| form | acorn | native |
|---|---|---|
| `x.send({ k: v })`                              | OK | OK |
| `x.send({ error: "bad" })`                      | OK | OK |
| `function f() { return { error: "x" } }`        | OK | OK |
| `function f() { return { a, b } }` (shorthand)  | OK | OK |
| `let o = { k: v }`                              | OK | OK |
| `foo({ a: { b: 1 } })` (nested)                 | OK | OK |
| `arr.map(x => ({ id: x }))` (arrow-concise)     | OK | OK |
| `function f() { return { data: { id: 1 } } }`   | OK | OK |
| `let a = [{ x: 1 }, { y: 2 }]` (array-elem)     | OK | OK |
| `let o = { [k]: v }` (computed key)             | OK | OK |
| `let o = { ...a, b: 1 }` (spread)               | OK | OK |
| `let o = { f() { return 1 } }` (method shorthand)| OK | OK |
| `pick({ a: 1, b: 2 }, ["a"])` (call-arg + arr)  | OK | OK |

(`return { ... }` at FILE TOP LEVEL: acorn REJECTS, native accepts — but that is a
return-statement-context permissiveness, not an object-literal gap; it does not drop any EXACT
fixture and is unrelated to the D4 label.)

This matches the corpus evidence directly: the `assertEqual(pick({ a: 1, b: 2, c: 3 }, ...))`,
`isOk({ ok: true, status: 200 })`, `if (not ok) return { error: ... }` lines that APPEAR among the
NSBH cascade line-texts all parse clean in isolation — they fire NSBH only because an UPSTREAM
trigger (an `await`/`throw`/string-import/`given` form earlier in the SAME `${}`/`~{}` block)
stranded the cursor. The object literal is collateral, never the cause.

### Step 3 — Disproved the single E-EXPR-OBJECT-PROP first-trigger (corpus-stale attribution)
`stdlib/format/index.scrml` is the ONE file whose first error is `E-EXPR-OBJECT-PROP`. The trigger
line (offset 8882–8946, line 250–251) is INSIDE a `~{` inline-test block:
    ~{
        import { assertEqual, assertTruthy, assertFalsy } from 'scrml:test'
The real fault is the `from`-keyword / string-import-specifier inside the test block being parsed
in expression position (`KwFrom` → E-EXPR-UNEXPECTED at col 59); the E-EXPR-OBJECT-PROP /
E-EXPR-UNCLOSED-BRACE pair is the cascade as the parser tries to recover. It is NOT an
object-literal-in-call-arg form. Corpus-wide, E-EXPR-OBJECT-PROP fires 17× total — 16 at error-list
index > 0 (pure cascades, with priors like `E-AWAIT-NOT-IN-SCRML`, `E-THROW-NOT-IN-SCRML`,
`E-STMT-FUNCTION-BODY`) and the lone idx=0 is this string-import case. **Zero genuine
object-literal parse gaps.**

### Step 4 — Confirmed it is parity-completeness already satisfied, not corpus-stale-acceptance
Object literals in call-arg/return/assign positions are core JS and core scrml; the LIVE parser
accepts them (Acorn parses them) → they are in the language → native matching them is completeness.
Native ALREADY satisfies that completeness. No subset-philosophy line is in play (nothing to add).

## STOP CONDITION HIT — which one and why
Brief STOP condition: *"If Phase-0 finds the trigger is actually a corpus-stale form / a different
root cause, STOP and report; do not 'fix' the parser to accept non-scrml."* The stronger variant
applies here: the labeled form is one the parser ALREADY accepts in full parity with live. There is
nothing to fix without manufacturing a non-existent gap. Per the brief's anti-pattern guard
(the label has been WRONG/imprecise 4 times running; this is the 5th), I did NOT invent a fix.

No subset-philosophy line crossed. No node/bridge change. `compiler/src/codegen/` untouched
(correctly — it was never in scope).

## NAMED FOLLOW-ON UNITS (the TRUE residual — filed, NOT fixed; mirrors D1's STOP-and-split)
The 110-file / 293-fire NSBH residual decomposes into these DISTINCT native parse-path gaps. None
is "object-literal". Recommended unit slicing (dominant first):

- **M6.7-D5  `${...}` markup-escape-in-expression seam** — the dominant E-EXPR-UNEXPECTED driver
  (the `${...}` literal placeholder used pervasively in fixtures + `<...>${...}</>` component markup).
  ~12–15 of the 18 E-EXPR-UNEXPECTED files. Likely a markup↔logic seam recognition gap, not an
  expression-arm gap — verify whether these are genuine live-accepted forms or fixture placeholders
  first (some `${...}` line-texts look like elided fixture stubs).
- **M6.7-D6  string-literal import specifier `import { "channel-name" as alias }`** (E-STMT-IMPORT-NAME,
  12 files, ALL trucking-dispatch channel imports). A clean, well-bounded single-root-cause unit —
  the native import parser expects an identifier where live accepts a string-literal specifier name.
  Strong D6 candidate: tightest scope, clearest oracle, 12 files.
- **M6.7-D3 (already filed)  match/transition arm family** — E-EXPR-MATCH-ARROW (13) +
  E-EXPR-MATCH-PATTERN (11) + the `:>` transition-arm line-texts (42). Confirmed still open.
- **M6.7-D7  `given` reactive-param form** (E-EXPR-PARAM 12 + several E-EXPR-UNEXPECTED `given x => {}`
  / `given u.name => {}` / `given a, b => {}` lines). The `given` head and its param list are not
  recognized in the native logic-statement dispatch.
- **M6.7-D8  `server {}` bare server-block + `^{}` meta-context in expression position** — smaller,
  appears in E-EXPR-UNEXPECTED (`server {`, `let payload = ^{ ... }` in self-host/tab.scrml).
- The `E-AWAIT/ASYNC/THROW/TRY-NOT-IN-SCRML` triggers (11 files combined) are DELIBERATE native
  rejections of forms live ALSO rejects — NOT parity gaps; corpus files that legitimately fail.
  Do NOT file as fix units.

(Re-measure each after the prior lands — cascades collapse, as D1→D2 showed 474→293.)

## MANDATORY GATES — status under a no-op (STOP) outcome
Because Phase-0 produced a STOP (no source change), the gates are reported as BASELINE-HELD:

1. **Strict-pass canary EXACT — HELD at 964** (unchanged; no source touched). Full histogram at
   HEAD = {EXACT:964, LIVE-DEGENERATE:12, GAP-state-block:1, LIVE-PHANTOM:1, DEFERRAL-test-block:21,
   LIVE-HOIST-MISCLASSIFY:2}; strict-pass 1000/1001; `parser-conformance-corpus.test.js` 1019 pass /
   0 fail. (Captured this run — matches the S127-close reference exactly.)
2. **Within-node canary — UNCHANGED** (no fix → no allowlist regen needed; nothing moved).
3. **Full `bun test` — green** (the pre-commit hook ran on the tooling commit and PASSED; no
   live-pipeline code was touched, so no regression surface).
4. **New unit test — INTENTIONALLY NOT ADDED.** A load-bearing test must fail against the pre-fix
   parser; there is no fix and the object-literal forms ALREADY pass, so a "D4 object-literal" test
   would be GREEN against the unmodified parser (non-load-bearing by construction). Adding it would
   be a make-work artifact that falsely implies a fix landed. Per the brief's "prove it is
   load-bearing (FAIL against pre-fix)" requirement, this gate is correctly N/A for a STOP outcome.
   The object-literal parity is instead PROVEN by the Step-2 Acorn-oracle table above.
5. **Corpus NSBH impact — 293 before / 293 after** (no change; the D4 label clears 0 fires because
   it was never the cause of any).

## FILES TOUCHED
- scratch-d4/phase0-corpus.mjs           (NEW — phase-0 corpus NSBH measurement + classifier)
- scratch-d4/phase0-out.txt              (NEW — captured fire dump for classification)
- scratch-d4/first-error-dist.txt        (NEW — first-error-code distribution)
- docs/changes/m67-phase-a-flag-flip/d4-object-literal.md  (NEW — this report)
NO source files in compiler/native-parser/ or compiler/src/ modified (correct for a STOP outcome).

## PA ACTION REQUESTED
- Retire the "D4 = object-literal-in-call-arg" label from the M6.7 flip ledger — it is closed/empty.
- Re-slice the next flip unit from the TRUE residual above. Recommended next: **D6 string-literal
  import specifier** (tightest, 12 files, clean oracle) or **D5 `${...}` markup-escape seam** (largest
  single E-EXPR-UNEXPECTED driver — but triage fixture-placeholder vs genuine-form first).

## Tags
#m6-7-d4 #native-parser #object-literal #phase-0-root-cause #stop-and-report #stale-bucket-label
#nsbh-residual #parity-completeness #scrml-flip #conformance-canary #within-node-canary

## Links
- [d1-arrow-callarg.md](./d1-arrow-callarg.md)
- [d2-server-function.md](./d2-server-function.md)
- [c1-component-parity.md](./c1-component-parity.md)
- [c2-codegen-output.md](./c2-codegen-output.md)
- [parse-expr.js](../../../compiler/native-parser/parse-expr.js)
- [parse-file.js](../../../compiler/native-parser/parse-file.js)
- [parser-conformance-corpus.test.js](../../../compiler/tests/parser-conformance-corpus.test.js)
- [primary.map.md](../../../.claude/maps/primary.map.md)
