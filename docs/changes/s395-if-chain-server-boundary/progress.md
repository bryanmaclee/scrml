# progress — s395-if-chain-server-boundary

## Startup
- WORKTREE_ROOT: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a493f8f4a01973d11
- base == origin/main == ad7b65dc2777f0d186e4e39f9fb04d3a9232029a (merge-base asserted)
- bun install OK (218 packages)
- bun run pretest OK, artifact verified: samples/compilation-tests/dist/ populated (13 samples)

## Locus verdicts
- `compiler/src/codegen/collect.ts` `collectFunctions` — **HELD**. Descended only
  `node.children`; blind to `branches[].element` / `elseBranch`.
- Server-boundary ROUTING walk — **FOUND AND REFINED**. It is
  `compiler/src/route-inference.ts` `collectFileFunctions` (`:1086`), which has
  **zero** occurrences of `if-chain` in the whole 6512-line file. Three call
  sites: `rewriteServerBlockStubs`, `buildFunctionIndex`, `runRI` Step 3.
  `route-inference.ts` was the brief's "starting point, not an answer" — it was
  the right file; the specific walk was named nowhere.
- Sibling in the SAME file, closed for consistency: `collectWorkerBodyFunctionIds`
  (`:1128`). It is the E-ROUTE-001 suppression set for `<program name=…>` worker
  bodies. Left blind it would have gone OUT OF LOCKSTEP with the fixed
  `collectFileFunctions` and false-fired E-ROUTE-001 on a branch-declared fn
  inside a worker body — blast radius my own fix would have created.
- `walkMarkupContext` (`:4876`, `markupReferencedNames`) — **NOT blind**, verified
  by reading its tail: the generic `Object.keys` recursion walks the `branches`
  array, and each `{condition, element}` record's `element` carries a `.kind`, so
  it is reached. Invariant 68's placement consumers are unaffected. No edit.
- `compiler/src/symbol-table.ts:10642` — **NOT TOUCHED** (coordinator correction 3:
  a deliberately TOTAL `Object.keys` walk that already reaches
  `branches[].element`; routing it through the shared enumerator would NARROW a
  correct site). Confirmed absent from `git diff ad7b65dc..HEAD --stat`.
- `emit-server.ts:1642` — the finding that explains the trap. It reads
  `ctx.analysis.fnNodes`, i.e. `analyze.ts:100`'s `collectFunctions(fileAST)`.
  ONE collector feeds BOTH `emit-functions.ts` (client) and `emit-server.ts`
  (server); the client emitter omits a `server fn` body only because RI claimed it.

## Landing order (non-negotiable, honoured)
1. `6a92f927` — RI routing walk (`collectFileFunctions` + `collectWorkerBodyFunctionIds`).
2. `d3bc42e3` — `collect.ts` `collectFunctions`.
3. `c3b6db62` — hardened leak guard.
4. `db9931c4` — conformance cases pinning both halves.

## Phase 1 — three-way security control (by FILE COPY; no `git stash`)
Reproducer: `server fn zzload() { return 41 + 1 }` declared inside an `if=`
branch of an `if=`/`else` chain, called from that branch's markup.

| variant                        | body in client.js | server.js bytes | zzload in server.js |
|--------------------------------|-------------------|-----------------|---------------------|
| base `ad7b65dc` (both blind)   | 0                 | 0               | 0                   |
| **codegen half ALONE (trap)**  | **1**             | **0**           | 0                   |
| RI half alone                  | 0                 | 0               | 0                   |
| **both halves (shipped)**      | **0**             | **2308**        | **5**               |
| lone-`if=` oracle              | 0                 | 2308            | 5                   |

The positive control reproduced the original dispatch's measurement exactly: with
the codegen hunk alone the client bundle carried
`function _scrml_zzload_7() { return 41 + 1; }` verbatim and no `server.js` was
produced. With both halves the body appears ONLY in `server.js` (inside
`_scrml_handler_zzload_1`) and the client calls `_scrml_fetch_zzload_8()` →
`POST /_scrml/__ri_route_zzload_1`.

## Phase 2 — symptom + oracle parity
Plain `function helper()` declared in an `if=`/`else` branch:

| variant             | definitions | mangled calls | bare calls |
|---------------------|-------------|---------------|------------|
| lone-`if=` oracle   | 1           | 4             | 0          |
| base, `if=`/`else`  | 0           | 0             | 4          |
| fixed, `if=`/`else` | 1           | 4             | 0          |

Names match the oracle shape (`_scrml_helper_5` vs `_scrml_helper_8`; the suffix
is a node-id counter that differs because the chain source carries an extra
`<div else>` node). `ReferenceError` gone.

## Phase 3 — measured corpus differential
`scripts/corpus-emit-differential.ts`, base tree vs worktree, `--expect-total 1914`.

**VERDICT: NO DIFFERENCES.** 1914 sources / 7408 artifacts compared, **7408
byte-identical, 0 differing**. 0 newly failing / 0 newly passing compiles, 0
diagnostic-code changes, 0 diagnostic-text changes, 0 artifacts added/removed
(so **0 server bundles gained or lost**), 0 syntax deltas under either goggle, 0
load-context changes, bare server-fn call sites 144 → 144.

⛑ **The FIRST run of this differential was INVALID and I nearly reported it.** It
said 1021 of 7408 artifacts differed. Cause: I built the base tree by copying the
worktree and deleting its `.git` — and `.git` is one of `chunk-namespace.ts`'s two
`PROJECT_ROOT_MARKERS`, so `resolveProjectRoot` returned null on the base side and
every chunk-namespace token hashed an ABSOLUTE path instead of a relative one. The
only difference in each of the 1021 was the `// --- chunk cell scope (…)` token.
Re-run with a `.git` present: zero. The tool told me (`FINDING [INCOMPARABLE] a
side's revision is "<unknown>"`) and the 1021 were labelled UNTRUSTWORTHY — the
guard rails worked; the harness was mine to fix.

**A zero differential is only meaningful with a denominator, so I measured one.**
An independent census (`buildAST` over all 1914 corpus sources, counting
`function-decl`s reachable ONLY via `ifChainChildNodes`):

- 1914 enumerated, **1914 parsed OK**, 0 parse failures
- **17** sources contain a collapsed if-chain (the shape's precondition IS present)
- **0** sources declare a function inside an if-chain branch

So the zero is EXPLAINED: nothing in the corpus exercises the fixed path. The
census was itself bite-proved — pointed at the reproducers it reports exactly the
two collapsed ones (`fns 0 -> 1`) and correctly excludes their lone-`if=` twins.

The 17 if-chain sources: `samples/gauntlet-r11/rust-state-machine`,
`samples/gauntlet-r11-elixir-chat`, `samples/gauntlet-r11-task-dashboard`,
`samples/quiz-app`, `samples/kanban-r11`,
`samples/compilation-tests/gauntlet-s19-phase2-control-flow/{phase2-else-attr-double-020,phase2-if-else-attr-chain-017}`,
`samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-if-attr-else-043`,
`conformance/cases/outlet/duplicate-branch-exclusive`,
`conformance/cases/control-flow/{ctrl-001-orphan-else-neg, ctrl-002-orphan-else-if-neg, ctrl-003-extend-past-else-neg, ctrl-003-extend-past-else-pos, ctrl-004-else-on-state-opener-neg, ctrl-005-else-and-if-same-element-neg, ctrl-010-else-on-for-in-if-chain-pos, if-chain-inactive-branches-absent}`.

## Phase 4 — R26 empirical + security sweep
Adopter corpus: `gauntlet-r25/dev-*` (4) + `gauntlet-r27/dev-*` (5) +
`gauntlet-r28/dev-*` (5) = 14 real `.scrml`. (r26 does not exist.)

- Compile-outcome set base vs head: **identical** — 6 clean, 8 failing with
  byte-identical error/warning counts (pre-existing adopter gaps).
- Emitted artifacts base vs head: **`diff -r` byte-identical**, 104 files.
- MARKER sweep of all 62 browser-loaded bundles (client.js + `_scrml/*.js` +
  pruned runtime) for `_scrml_handler_`, `_scrml_validate_csrf`,
  `_scrml_ensure_csrf_cookie`, `Set-Cookie`, `_scrml_sql`,
  `__scrml_sql_placeholder__`, `postgres://`, `mysql://`, `DATABASE_URL`,
  `process.env`, `node:fs`, `node:crypto`, `require(` — **0 hits, both sides.**
- Server↔client line-OVERLAP: 56 both sides, delta 0. All 56 inspected: shared
  `const XError = Object.freeze({…})` §-error-type declarations (legitimately on
  both sides so both can construct/match variants) and generated
  `headers: { "Content-Type": "application/json" }` boilerplate.

⛑ **The overlap sweep DOES NOT BITE on this bug, and I only know that because I
tested it.** Pointed at a deliberately-leaking build it reported a clean
`MARKER 0 / OVERLAP 0`. The leak shape is "body inlined into client.js AND NO
server.js emitted at all" — with an empty server side there is nothing to overlap,
and the leaked body uses no marker. So a second, SOURCE-anchored checker was
written (`serverfn-placement.mjs`): for every `server fn NAME` found by a TOTAL
`Object.keys` walk (deliberately not the walk under test), (1) the app must emit a
server bundle naming it, and (2) client.js must not DEFINE it — only the generated
transport stubs `_scrml_fetch_…` / `_scrml_sse_…` / `_scrml_cps_…` may carry the
name, each read at a call site and confirmed to be transport only.

- Bite proof: on the leaking build it reports both violations
  (`client.js DEFINES it: _scrml_zzload_7` + `referenced in client.js but ABSENT
  from server.js`) and correctly stays silent on the lone-`if=` twin.
- Two rounds of false positives were found and fixed before the result was
  trusted: an unanchored substring match flagged `_scrml_handleInput_15` (an
  unrelated CLIENT function) as a leak of a server fn named `handle`, and the
  `sse` / `cps` transport families were initially unrecognised.
- **Final: 1928 sources (1914 corpus + 14 adopter), 84 with a server fn, 237
  `server fn` declarations, 0 VIOLATIONS.** Zero "referenced in client but absent
  from server" anywhere.

## Hardened-guard bite proof
`compiler/tests/unit/g-if-chain-branch-cell-never-wired.test.js`:
- codegen half alone → **2 fail** (squashed `41+1` found in client.js; serverJs 0).
- pristine base → **3 fail** (positive limb: serverJs 0; zero definitions).
- both halves → **6 pass**.

Three defects fixed in the guard, one more than the brief named:
1. `not.toContain("server fn")` VACUOUS — replaced with a squashed-body check, a
   structural check that every client-side `zzload` DEFINITION is a transport stub,
   and a server-only-marker sweep.
2. `not.toContain("41 + 1")` WHITESPACE-SENSITIVE — now normalized.
3. (not in the brief) ABSENCE-ONLY, so the BASE column satisfied it by making the
   function vanish from every bundle. Added the positive limb.

## Conformance
- `control-flow/if-chain-branch-declared-function-pos` — pre-fix the emitted bundle
  throws `ReferenceError: branchHelper is not defined` and takes the whole
  conformance run down.
- `server-fn/branch-declared-server-fn-routes-to-server` — `serverStub` returns a
  sentinel the body cannot produce, so the observed value names WHICH SIDE ran:
  base `"pending"` (dead) · codegen-half-alone `"COMPUTED-IN-THE-BODY"` (LEAK, body
  executed in the browser) · both halves `"STUBBED-OVER-THE-WIRE"` (PASS).
- conformance: **893/893 pass**.

## Test deltas
- pre-commit scope (unit+integration+conformance): base 29554 pass / 0 fail →
  head 29558 pass / 0 fail.
- `bun run test` (full, incl. browser/lsp/commands/self-host): base 30929 pass /
  **58 fail** → head 30934 pass / **55 fail**. Failing-set diff: **0 NEW**, 3 FIXED
  (the three hardened-guard tests). The 54 remaining are pre-existing on base
  (dev-watcher / happy-dom / engine tiers) and unchanged.

## Provenance (Rule 4b) — governing sentence FOUND
SPEC §12.1, `compiler/SPEC.md:7465`:

> The compiler SHALL decide where each function executes. The default is
> client-side execution.

"each function", unqualified by declaration site. Reinforced by §12.4
(`:7508`): *"The compiler SHALL perform route analysis before code generation. No
function SHALL be split across client and server without the analysis
completing."* — which is exactly what the mandated landing order enforces: the
codegen-half-alone build generated code for a function whose analysis had never
run. And §17.1.1's own Desugaring section states an if-chain desugars to a
`${ if / else }` block over ordinary markup, so a declaration in a branch body is
a declaration in the program.

This is a FIX, not a ruling.

## Findings surfaced, NOT fixed (out of scope)
1. **`${fn()}` inside a collapsed if-chain branch renders EMPTY** — and it is NOT
   this class. Reproduced on base AND head with a plain TOP-LEVEL function (never
   touched by this fix): `<div if=@open><p id="out">${topHelper()}</></><div else>…</>`
   renders `#out` as `""`. Mechanism, read out of the emitted client: the
   `_scrml_render_value(el, _scrml_topHelper_N())` block sits in `_scrml_boot` and
   resolves `el` with `document.querySelector('[data-scrml-logic="…"]')` — but the
   branch content is only put in the DOM by `_scrml_mount_template` inside
   `_scrml_nav_rewire(document)`, which `_scrml_boot` calls AFTERWARDS. `el` is
   null, nothing renders. A CELL interpolation in the same position works
   (`if-chain-inactive-branches-absent` passes), so this is specific to
   call-expression interpolations. `if-chain-branch-declared-function-pos` asserts
   through the handler position for exactly this reason.
2. **`bun run types:check` is RED on pristine base** — 9 NEW diagnostics, mostly
   `TS7016 Could not find a declaration file for module '…/ast-if-chain.js'` across
   `collect.ts`, `emit-each.ts`, `reactive-deps.ts`, `symbol-table.ts`,
   `type-system.ts`. The types-gate baseline was not refreshed when `ast-if-chain.js`
   landed. My change adds exactly ONE more of the identical class (the same TS7016,
   now in `route-inference.ts`), taking it 9 → 10. Not fixed here: a 4-line
   `compiler/src/ast-if-chain.d.ts` would zero out 5 of the 10 at once, but that
   changes a pre-existing failure signature and is outside this brief.
   `types:check` is not part of the pre-commit hook.

## Attribution correction absorbed
`ast-if-chain.js` was CREATED by #805 (`aea652c7`); #811 (`0f398b95`) closed ten
more walks onto it. Two of my earlier commit messages credit #811 with the
extraction — cosmetically wrong, recorded here rather than amended (an amend
re-runs the ~190s hook for a comment-only delta).
