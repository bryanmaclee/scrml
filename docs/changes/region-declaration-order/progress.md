# region-declaration-order — progress (append-only)

Change-id: `region-declaration-order`
Gap: `g-region-bodies-emit-in-bucket-order-not-declaration-order` (MED)
Scoping: `docs/changes/route-region-teardown/SCOPING-EDGE2.md` §1 + §3 (U1) + §4 fork 1
Authorized: S314 (bryan, "fire u1"; fork 1 = land U1 standalone ahead of the route-region arc)
Direction-of-change: **`semantics-changed`** (pa-base §8, the silent class)

---

## 2026-08-02 — startup

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a8ce52b8212bb7fe1`
(verbatim startup `pwd`). Base `60cd90e3`, `git merge main` → already up to date, tree clean,
`bun install` + `bun run pretest` green.

Maps read: `primary.map.md` (Task-Shape Routing row 1 + invariants 1/2/3),
`structure.map.md` "THE EMITTED-BUNDLE EXECUTION BOUNDARY",
`dependencies.map.md` "Module-init vs the soft-nav rehydrator".

---

## 2026-08-02 — SPEC verified against source (Rule 4 gate)

- §20.8.8 step 3 at `SPEC.md:15854-15857` — the ordering sentence is verbatim as briefed.
- §20.8.8(6) at `SPEC.md:15865-15867` — initial load IS a `route-enter`.
- §6.7.2.1 bullet 1 at `SPEC.md:3799-3804` — the set is exactly six kinds.

No SPEC clause touched by this landing. It is implementation conforming to an existing sentence.

---

## 2026-08-02 — PA-asserted loci

| locus | verdict |
|---|---|
| `emit-reactive-wiring.ts:849-900` — the five bucket passes | **HELD** |
| `emit-reactive-wiring.ts:1081` — `classifyMarkupNodes` | **HELD** |
| `emit-client.ts` / `emit-logic.ts` U1b touch-points | see the U1b section below |

---

## 2026-08-02 — corpus measurement (extends the brief's)

Census over **2328** in-repo `.scrml` files: **10** declare a `<request>`, and it co-occurs with
**NONE** of `<timer>`/`<poll>` (0), `<channel>` (0), input-state (0), `<timeout>` (0). The brief
measured the `<request>`+`<timer>` pair at zero; the same is true of every out-of-set pair, which
is what makes the emission-slot choice inert in practice.

In `scrml-support` (847 `.scrml`): one file pairs `<request>` with `<channel>` —
`docs/gauntlets/gauntlet-r24/dev-1-react.scrml`. It was added to the artifact-diff set explicitly.

---

## 2026-08-02 — U1a LANDED

`compiler/src/codegen/emit-reactive-wiring.ts` — Step 5 (`<timer>`/`<poll>`) and Step 5c
(`<request>`) are now ONE source-ordered pass:

- `classifyMarkupNodes` gains `regionOrderedNodes: Array<{kind, node}>`, populated in the SAME
  pre-order DFS that already fed the per-bucket arrays. A markup node is pushed before its
  children are visited, so push order is source order. The per-bucket arrays are unchanged.
- The merged pass emits one section header per contiguous RUN of the same kind.
- The merged block occupies the slot of whichever in-set bucket emitted FIRST under the legacy
  ordering — the lifecycle slot when the file declares any `<timer>`/`<poll>`, the request slot
  otherwise. SPEC constrains the in-set bodies relative to each other and says nothing about
  their position relative to the out-of-set kinds, so the rule is chosen to hold the out-of-set
  neighbours still. Consequence: a file declaring only ONE of the two in-set kinds is
  byte-identical to the pre-fix output.
- **NOT widened**: `<keyboard>`/`<mouse>`/`<gamepad>` (5b), `<channel>` (5.5), `<timeout>` (5d).

### Emitted-position oracle

Reproducer `<request id="first" url=…/>` → `<timer interval=1000>` → `<request id="third" url=…/>`:

```
pre-fix  (main 60cd90e3):  timer :28  ·  first :35  ·  third :60
post-fix:                  first :27  ·  timer :53  ·  third :62
```

### Runtime oracle — EXECUTED, not grepped

The emitted bundle was evaluated under a recording stub (`with (Proxy)` sandbox):

```
pre-fix  RUN ORDER: ["timer:1000", "request:/api/a", "request:/api/c"]
post-fix RUN ORDER: ["request:/api/a", "timer:1000", "request:/api/c"]
```

### Corpus artifact diff

`examples/` (whole tree, incl. per-project subdirs) + `samples/compilation-tests/` +
`scrml-support` `gauntlet-r25/dev-{1..4}` + `gauntlet-r24/dev-1-react`, compiled from an
IDENTICAL staged path with main's compiler and then with the worktree compiler (same path ⇒ same
chunk-namespace token), snapshotted between runs:

```
baseline artifacts: 2425   post artifacts: 2425
diff -r base post  →  BYTE-IDENTICAL
```

### Tests

- `compiler/tests/unit/region-declaration-order.test.js` — 8 tests. Pre-fix: 5 fail / 3 pass
  (the 3 passing are the unchanged-behaviour guards). Post-fix: 8 pass.
- `compiler/tests/conformance/conf-REGION-BODY-DECLARATION-ORDER.test.js` — 4 tests, codes +
  EXECUTED runtime. Pre-fix: 3 fail / 1 pass. Post-fix: 4 pass.

---

## 2026-08-02 — findings surfaced, NOT built (out of scope)

1. **The canonical body-form `<request>` never reaches Step 5c.** `emitRequestNode` returns an
   empty line array when `url=` is absent and `api=` is absent (`emit-reactive-wiring.ts:1704`,
   the GITI-001 guard) — the fetch IS the `${}` body, which the Step-4b top-level-logic pass
   emits, in source order. So the bucket defect bit the compiler-generated-fetch forms
   (`url=` and §60.4 `api=`), not the §6.7.7 canonical body form.
2. **A body-form `<request>` still emits an empty section header.** Pre-existing (the legacy
   pass emitted it once too, guarded on `requestNodes.length > 0`). Post-fix an INTERLEAVED file
   can emit it once per run. Cosmetic; suppressing it is a comment-only artifact diff and was
   deliberately NOT folded in, because it would break U1a's byte-identity and is a separate
   landing. Corpus impact today: zero (no corpus file interleaves).
3. **⚠️ A `<timer>` / `<poll>` body is ALSO emitted at MODULE SCOPE — it runs once at load.**
   Verified pre-existing on main (`60cd90e3`), for BOTH tags. The body's statements appear once
   at module init AND once inside the `_scrml_timer_start` callback. SPEC §6.7.5: *"The timer
   body (the `${}` logic block) executes on each interval tick"* — no mount execution. SPEC
   §6.7.6: *"The poll body is a `${}` logic block that executes on each tick."* So
   `<timer interval=1000>${ @tick = @tick + 1 }</>` increments `@tick` at load, before the first
   tick, contradicting both clauses.
   Cause: `collectTopLevelLogicStatements` (`codegen/collect.ts:205`) descends into
   `node.children` for EVERY node, so a `<timer>`/`<poll>`'s `${}` body is collected as a
   top-level logic statement, and Step 4b emits it. For `<request>` the same descent is the
   DESIGNED behaviour (the body IS the fetch, §6.7.7 canonical form — and it emits exactly
   once, verified); for `<timer>`/`<poll>` it is a duplicate.
   Reproducer: `/tmp/…/scratchpad/u1b2/u1b2.scrml` (poll) and `u1b/u1b.scrml` (timer).
   Not touched here — out of scope. **Gap-candidate, surfaced to PA rather than filed.**
   It is also a U1b PREREQUISITE (see below).

---

## 2026-08-02 — U1b: SCOPED, NOT BUILT

### Verdict on the PA-asserted loci (these were "located, not traced")

| PA claim | verdict |
|---|---|
| *"`${}` blocks and `on mount` are assembled into module-init `lines[]` by `emit-client.ts`"* | **REFINED.** `emit-client.ts` assembles the array, but the PRODUCER is `emitReactiveWiring` **Step 4b** (`emit-reactive-wiring.ts:402-728`), the same function that owns Steps 5/5c. `emit-client.ts:2355` is a single `for (const line of reactiveLines) lines.push(line)`; it emits no §6.7.2.1 body of its own. Everything it pushes before (`:2330` functions, `:2341` export consts, `:2351` registry footer, enum/engine/worker/session/CSRF substrate) and after (`:2367` match dispatchers, `:2384` each dispatchers, `:2405` engine hydration, `:2431` onTimeout arms, `:2448` opener effects, `:2466` bind-rewire, `:2499` link-boost, `:2512` theme-switch) is out of §6.7.2.1's set. |
| *"`cleanup()` lowers via `emit-logic.ts`'s `cleanup-registration`"* | **HELD as a fact, REFINED as an ordering claim.** `emit-logic.ts:3651-3655` is the lowering, but it is a STATEMENT kind reached from `emitLogicNode(stmt, …)` inside Step 4b's group loop (`emit-reactive-wiring.ts:507`). `cleanup()` is not a third ordering stream — it rides Step 4b at its source position. |
| *"Getting declaration order ACROSS those three emitters is the harder half"* | **WRONG as stated.** There are not three ordering streams; there are **TWO**, and both are produced by ONE function from ONE tree. |

### The mechanism — ONE seam, not a registry

Post-U1a, `emitReactiveWiring` emits two source-ordered streams, back to back:

- **Stream A (Step 4b, `:402-728`)** — `collectTopLevelLogicStatements(fileAST)` (`collect.ts:205`),
  a pre-order DFS. Yields `${}` statements, `state-decl` cell inits, `cleanup()` registrations
  and `on mount` bodies (`_onMountEffect`, handled at `:536`) **in source order**. Grouped by
  `_placeholderId` into contiguous runs before emission.
- **Stream B (Steps 5 + 5c, `:851-940`)** — `classifyMarkupNodes`, also a pre-order DFS over the
  SAME `getNodes(fileAST)` tree. Yields `<timer>`/`<poll>`/`<request>` **in source order** (U1a).

Both streams are individually correct. The whole residual §20.8.8-step-3 violation is that
**Stream A is emitted wholesale before Stream B.** Measured (`u1b.scrml`, post-U1a):

```
declared:  <timer early>  →  ${}+cleanup()  →  <request late>  →  on mount
emitted:   ${} :24  ·  cleanup :26  ·  on mount :29  ·  timer :33  ·  request :64
```

The fix shape is therefore a **single merged walk** yielding `{logic-group | wiring-node}` items
in source order, then one dispatching emission loop — NOT a new ordered registry, and NOT a
restructuring of how `emit-client.ts` assembles `lines[]`. That is the U2 shape the route-region
arc stopped on and it is **not needed here.**

### Touch-points

| file:line | what changes |
|---|---|
| `codegen/emit-reactive-wiring.ts:402-430` | the `<request>` state-object HOIST must STAY ahead of everything (a file-scope `const x = <#id>.data` reads it at module init) — it is a separate pass, no conflict |
| `codegen/emit-reactive-wiring.ts:432-449` | the `_placeholderId` grouping must survive: a group is a contiguous run from ONE logic block, and a markup sibling cannot appear inside a logic block, so group boundaries and wiring nodes never overlap — **except** for the timer/poll-body case in finding 3 |
| `codegen/emit-reactive-wiring.ts:451-728` | the per-group emission loop becomes one arm of the merged dispatch |
| `codegen/emit-reactive-wiring.ts:851-940` | the U1a merged pass becomes the other arm |
| `codegen/collect.ts:205` | needs a source-position (or a shared single walk) so Stream A items can be interleaved with Stream B items — today the two walks are independent |

### ⛔ PREREQUISITE — finding 3 blocks a clean U1b

A `<timer>`/`<poll>` body's statements are collected by Stream A **at a source position INSIDE
the timer node's own span.** A positional merge therefore has to decide whether the duplicate
body-copy sorts before or after the timer's `_scrml_timer_start` — and there is no right answer,
because the copy should not exist at all. **Fix finding 3 first**; U1b's merge is ill-defined
until then. (For `<request>` there is no such problem: its body-in-Stream-A is the designed
canonical-form fetch and it emits exactly once.)

### Cost band

| unit | band | driver |
|---|---|---|
| finding-3 prerequisite (stop collecting `<timer>`/`<poll>` bodies as top-level logic) | **S** | one predicate in `collect.ts`'s descent; but it is `semantics-changed` and WILL move corpus artifacts — every `.scrml` with a `<timer>`/`<poll>` body loses a module-init statement |
| U1b merged walk | **M** | not the M–L the SCOPING doc banded for U2: one function, one tree, two already-source-ordered walks. The cost is in the grouping/lift/tilde machinery of Step 4b's loop (`:451-728`, ~280 lines), not in cross-emitter plumbing |

Blast radius for U1b itself: the brief's measured **3** files
(`examples/32-external-api.scrml`, `samples/compilation-tests/gauntlet-r10-elixir-chat.scrml`,
`samples/compilation-tests/gauntlet-r10-go-contacts.scrml`) — NOT re-measured by this dispatch.

### Decision: NOT BUILT

Per the brief's gate. Not because it needs the registry (it does NOT — that claim is refined
above), but because of the finding-3 prerequisite: the merge has an undefined position for the
duplicated timer/poll body, and fixing that is its own `semantics-changed` landing with a
non-zero corpus artifact diff. Building U1b on top of a known-wrong duplicate would bake the
ambiguity in.

---

## 2026-08-02 — FULL-SUITE verification (name-set comparison, same worktree)

Both runs in THIS worktree, `bun test compiler/tests/`. Baseline produced by reverting
`emit-reactive-wiring.ts` to `60cd90e3` and moving the two new test files out.

| | tests | files | pass | skip | todo | **fail** |
|---|---|---|---|---|---|---|
| BEFORE (pre-change) | 29851 | 1319 | 29585 | 216 | 1 | **49** |
| AFTER  (post-change) | 29863 | 1321 | 29597 | 216 | 1 | **49** |

`diff` of the sorted failure NAME SETS (not the counts): **IDENTICAL — 49 names both sides,
zero added, zero removed.** All 49 are pre-existing (happy-dom runtime `<engine>` §51.0.S cases,
Bug-60 nested-compound bind, §20.8.2 rehydration, the §4 per-route-chunk NEGATIVE control, etc.).

Delta is +12 passing / +2 files — exactly the 8 unit + 4 conformance tests this landing adds.

Browser tier: `bun scripts/browser-baseline.ts --check` →
**PASS — browser failure name set matches the baseline (48 asserted, 0 of 2 env-excluded observed).**
