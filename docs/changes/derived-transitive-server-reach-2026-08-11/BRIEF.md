# BRIEF — §6.6.19 transitive reach: a derived cell must not recompute through a server round trip

**Dispatched:** 2026-08-11 (S338-bryan) · **Base:** `fix/derived-transitive-reach` off `origin/main`
**Ruled:** bryan S338 — *"i, and file it as dpa-023's first witnessed case"*
**Provenance:** `ruling:user-voice-scrml.md S338`

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

FIRST action, before anything else:

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED CHECKOUT: **STOP and report.**
2. `git rev-parse --show-toplevel` MUST equal that worktree path.
3. `git status --short` MUST be clean.
4. `bun install` (a fresh worktree does NOT inherit `node_modules`).
5. `bun run pretest` — then use `bun run test`, never bare `bun test`, for baselines.

Every Read/Write/Edit uses a WORKTREE-ABSOLUTE path. NEVER `cd` into the main checkout; use
`--cwd "$WORKTREE_ROOT"` and `git -C "$WORKTREE_ROOT"`. Echo your startup `pwd` in your first
commit. **Scratchpad unique to you:** `…/scratchpad/dtr-fix/` (a sibling agent deleted another
agent's worktree today by sharing a generic path).

**Crash recovery:** commit after EACH meaningful change; keep `progress.md` in this change
directory current, append-only, timestamped. Two agents died mid-task today; one lost a finding
that existed nowhere on disk. Your branch + `progress.md` are the entire recovery surface.

---

## MAPS — REQUIRED FIRST READ

`.claude/maps/primary.map.md`, then its **Task-Shape Routing** for the route-inference shape.
Map stamp `616688ea` (2026-08-09) — **HEAD is past it**. Treat map claims as hypotheses.
Report which map content was load-bearing, "none" included.

---

## THE DEFECT — PA-verified on main at BOTH emit and runtime-path level

SPEC §6.6.19 / `E-DERIVED-SERVER-ONLY-REACH` refuses a derived cell whose RHS reaches a binding
imported from an escalation server-only stdlib module. **It refuses the DIRECT reach and misses the
identical reach ONE HOP AWAY.**

```scrml
<program>
${ import { hashPassword } from 'scrml:auth' }
<pw> = "abc"
function doHash(p) { return hashPassword(p) }     // ← the hop
const <h> = doHash(@pw)
<p>${@h}</p>
</program>
```

Compiles **exit 0, zero diagnostics**, and emits:

```js
// index.client.js
async function _scrml_fetch_doHash_3(p) { … await _scrml_fetch_with_csrf_retry(…) … }
_scrml_cs_derived_declare("h", () => _scrml_fetch_doHash_3(_scrml_cs_reactive_get("pw")));
```

And the derived runtime is **synchronous by design** — `dist/scrml-runtime.js:117`:

```js
function _scrml_derived_get(name) {
  if (_scrml_derived_dirty[name]) {
    _scrml_derived_dirty[name] = false;
    const fn = _scrml_derived_fns[name];
    if (fn) { _scrml_derived_cache[name] = fn(); }   // ← no await, §6.6.4
  }
  return _scrml_derived_cache[name];
}
```

**So the Promise becomes the derived cell's value and is rendered.** Confidentiality is INTACT
(the secret stays server-side); the failure is a **silent wrong render**.

Same result via the `?{}` route: `function countRows(){ const r = ?{…}; return r.length }` +
`const <c> = countRows()`.

**The direct form is correct and must stay correct** — `const <h> = hashPassword(@pw)` fires
`E-DERIVED-SERVER-ONLY-REACH`, emits no `.server.js`, leaks nothing. That is #500 working. Do not
regress it.

**§6.6.19's own comment already states why this must not happen** (`route-inference.ts:4539`):
*"Escalating its RHS would make that recompute a server round trip, i.e. asynchronous, which the
derived model has no way to express — so 'place it on the server' is not an available answer."*
One level of indirection walks straight past that reasoning.

---

## THE FIX

**Extend the refusal transitively.** A derived cell's RHS that reaches — through any number of
local function hops — a function that route inference has escalated to the server is refused, with
the same reasoning and the same reversibility as the direct form.

**Locus (PA-located, VERIFY — not traced):** `compiler/src/route-inference.ts`, Step 3b at `:4526`,
which iterates `collectDerivedCellDecls(fileAST)` and calls
`collectDerivedRhsServerOnlyRefs(declNode, _bindings)` against the per-file escalation-server-only
BINDING set. The binding set is why the hop escapes: `doHash` is a local function, not an imported
server-only binding. **Report whether that hypothesis held, was refined, or was wrong.**

**Design constraints, in priority order:**

1. **Reuse the escalation result — do NOT re-derive it.** Route inference already computes which
   functions are server-placed. Consume that, do not re-implement a second reachability walk. This
   session found the same class five times (a hand-maintained parallel walker blind to positions
   outside it) and the fix for it reproduced it. If you find yourself writing a second traversal,
   stop and report.
2. **Rule 7 binds you** (`pa-scrml-overlay.md`, ruled S338): *a regex over SOURCE TEXT in a
   POST-AST stage requires a one-line justification or the structural route.* Route inference is
   post-AST. **Walk the tree.** If you reach for a regex over an RHS's source text, that is the
   defect this session exists to stop.
3. **Fail CLOSED and stay REVERSIBLE.** Newly-rejecting is the walk-back-able direction; accepting
   is a one-way door.
4. **Transitivity must terminate.** Handle cycles (`f` calls `g` calls `f`) and cap or memoize.
   A stack overflow is not a diagnostic.
5. The refusal message SHALL name the HOP CHAIN, not just the endpoint — `const <h>` → `doHash` →
   `hashPassword` (from `scrml:auth`). An adopter who sees only the endpoint cannot find the edit.

**Carve-outs that must survive:** `isToolProgram(fileAST)` (§64 — no client boundary) stays.
Verify it still short-circuits.

---

## DIRECTION-OF-CHANGE — this is NEWLY-REJECTING and owes a MEASURED migration

Grep the real corpus for the shape BEFORE landing and report the COUNT and the FILES. **Assumed-zero
is not measured-zero.** A non-zero count is a separate ruling, not something to migrate unilaterally
— stop and report it.

The governing sentence exists (§6.6.19 + its stated reasoning above), so this is conformance
restoration in spirit — but it ADMITS a shape that previously compiled, so treat it as
newly-rejecting and measure it.

---

## PROVENANCE + FILING

- The SPEC amendment (if §6.6.19's text needs to say "transitively") carries
  `> **Provenance:** ruling:user-voice-scrml.md S338` inline at the amended section.
- **`docs/known-gaps.md` — DO NOT TOUCH IT.** A concurrent agent owns it. Report the gap text in
  `progress.md`; the PA files it.
- This defect is **dpa-023's first witnessed case** (already filed in `handOffs/dpa-queue.md` — do
  not edit that file either). Your refusal is explicitly **REVERSIBLE and PROVISIONAL**: it must not
  be written or documented in a way that forecloses the `pending` type-state rung whose direction
  was ratified S337. Say so in the code comment.

---

## VERIFICATION — DO NOT REPORT DONE WITHOUT THIS

1. All three reproducers above (`doHash` hop · `?{}` hop · the DIRECT control) compiled on your
   branch AND on `origin/main`, with the diagnostic multiset both sides.
2. A **multi-hop** case (`a` → `b` → `c` → server) and a **cycle** case, both compiled.
3. A **negative control**: a derived cell calling a purely-client local function must still compile
   clean. Over-refusing is the failure mode to hunt here.
4. `bun scripts/corpus-emit-differential.ts` vs `origin/main` — N of M, each change classified. State
   the instrument's power honestly rather than presenting green as safety.
5. Migration count + files for the newly-rejecting shape.
6. Bite proofs, both directions, for every new test.
7. `bun run test` — compare failure **NAME SETS** against `origin/main`, not counts.

**Report:** files touched, final SHA, what landed vs deferred, every locus above that turned out
wrong, and anything you think this brief gets wrong. **You are explicitly authorized to argue
against it** — including arguing that the refusal is the wrong answer and the `pending` rung should
be built instead. An agent on this repo recommended reverting its own completed work today when the
measurement said so, and that was the right call.
