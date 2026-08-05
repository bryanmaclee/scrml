# U1 — progress log (append-only)

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a9c144ab82648e947`
Branch: `worktree-agent-a9c144ab82648e947`
Base: `20a15c15`

---

## 2026-08-05 — startup + baseline capture

Done:
- Startup verification clean: pwd == worktree root == `git rev-parse --show-toplevel`, tree clean,
  HEAD `20a15c15` (matches brief). `bun install` (217 pkgs), `bun run pretest` (13 samples) both OK.
- Read `.claude/maps/primary.map.md`. Routing row for "the CPS auto-await choke point" says: do NOT
  build on it without `hand-off.md`'s S320 top block; PR #405 HELD/unmerged pending bryan's ruling on
  fix locus. **That ruling is what dispatched U1** (dpa-020 RATIFIED = the `emitCall` root-fix locus).
- Read the brief. NOTE: `docs/changes/u1-emitcall-client-serverfn-await/BRIEF.md` does NOT exist in
  this worktree — it is UNTRACKED in the main checkout (created 07:56, after the worktree cut). Read
  it from main (read-only; no writes to main).
- Wrote `scripts/u1-corpus-emit.sh` — compiles every `examples/*.scrml` +
  `samples/compilation-tests/*.scrml` into a per-file out dir, for the emit differential.

**PRE-CHANGE BASELINE (unmodified tree @ 20a15c15):**
- 329 corpus sources; `COMPILED_OK=312`, `COMPILE_FAIL=17` (negative fixtures — list saved).
- 708 emitted `.js`; `node --check` → **CHECKED=708 FAILED=2**.
- Both baseline `node --check` failures are downstream of a FAILED compile
  (`gauntlet-s79-signup-form.client.js`, `helpers/dnd-setup.client.js`) — partial/garbage emission,
  pre-existing, not U1's.
- Baseline tree saved at `<scratchpad>/u1-baseline`.

Next: verify the ★ host-coloring precondition (`emit-functions.ts:1192-1205` →
`computeAsyncFnNames`/`callsServerFn`) BEFORE writing any branch.

Blockers: none.

---

## 2026-08-05 — ★ HOST-COLORING PRECONDITION: **HELD (with a scope refinement)**

This is the question that gates the whole change. Verdict: **HELD** for U1's surface,
**REFINED** on its boundary. Not "wrong", and nothing here blocks the branch.

### Mechanism (source-read, chain confirmed link by link)

```
emit-functions.ts:1192-1195   _serverFnNames ← routeMap routes with boundary==="server"
emit-functions.ts:1199-1206   computeAsyncFnNames(_clientFns, …, _serverFnNames)
emit-library-shared.ts:173-177  callsServerFn(callees) — true if any structural callee is a server fn
emit-library-shared.ts:196      → async.add(name)          (the SEED)
emit-library-shared.ts:200-217  → fixpoint over local peer calls
emit-functions.ts:1298          _fnIsAsync = _clientAsyncFnNames.has(name)
emit-functions.ts:1299/1312     → `async ` prefix on the emitted function
emit-functions.ts:1353          → clientAsyncBody: true   (the gate my branch reads)
```

`_fnIsAsync` drives BOTH the emitted `async` keyword AND `clientAsyncBody`. They are the
same boolean, so the gate cannot disagree with the host's actual coloring.

### Empirical confirmation (pre-change bundles, NOT reasoning)

Every probe host was ALREADY `async` while its server call was emitted BARE:

| probe | emitted host (pre-change) | server call site (pre-change) |
|---|---|---|
| u1p2 receiver-tail | `async function _scrml_refresh_5()` | `_scrml_fetch_loadRows_4().length` |
| u1p3 return-typed fn | `async function _scrml_rowCount_5()` | `const rows = _scrml_fetch_loadRows_4();` |
| u1p4 nested arg | `async function _scrml_refresh_7()` | `_scrml_pick_6(_scrml_fetch_loadRows_5())` |
| u1p5 sync callback | `async function _scrml_refresh_5(ids)` | `ids.map((id) => _scrml_fetch_scoreOf_4(id))` |

So the dominant stranded-`await` risk **is** largely pre-mitigated on this surface: the
host is async ALREADY, purely from the structural callee walk, and has been all along.
The bug was never the coloring — it was that the CALL SITE never got its `await`.

### The refinement (the precondition's real boundary)

The precondition holds **only for call sites lexically inside a top-level client fn body**
— the domain of `_clientFns`. It does NOT hold for client-mode `emitCall` positions
OUTSIDE a client fn body. Reproduced, u1p6:

```js
"_scrml_attr_onclick_2": function(event) { _scrml_fetch_bumpCount_4(); },
```

A server fn called straight from an event-handler attribute emits into a **non-async**
`function(event)`. That path is `emit-event-wiring.ts`, which never threads
`ctx.serverFnNames` and does its own `exprUsesServerFn`-driven async wrapping
(`:1809`/`:1870`/`:1916`).

**This does NOT become "a shape to fix before the branch lands", because the branch
cannot fire there.** `clientAsyncBody` is set at exactly three places — an async client
fn body (`emit-functions.ts:1353`), the scheduler's equivalent (`scheduling.ts:789`), and
a callback being RE-EMITTED as an `isAsync:true` lambda (`emit-expr.ts:2892`/`:2948`) —
all of which are genuinely async hosts. Outside them the gate is false and emission is
byte-identical to today.

The gate is therefore **fail-safe by construction**: walk sees the server callee → host is
`async` AND the branch may fire; walk misses it → host is sync AND the branch cannot fire.
It can only ever SUPPRESS an await (leaving today's silent bug), never STRAND one.

**Surfaced as DEFERRED, not widened into:** the event-wiring / markup-interpolation
surface is a SEPARATE locus with its own async-wrapping mechanism. Pulling it into U1
would be scope expansion; per the brief I am stopping at the boundary and reporting it.

Next: thread the set on the `emitFnShortcutBody` path (emit-functions.ts `fnOpts`), then
re-run probes + corpus differential + `node --check`.

---

## 2026-08-05 — implementation + full verification

### Landed

- `emit-expr.ts` — `isClientServerFnCall` (shared gate) + `isAwaitedClientServerFnCall`
  (receiver mirror); the new `emitCall` branch; added to the `emitReceiver` disjunction;
  the false `:3094-3096` comment CORRECTED; `serverFnNames` field doc updated to state
  its new client-mode meaning and that every consumer must declare which mode it means.
- `scheduling.ts` — `_clientServerFnNames(routeMap)` helper; threaded into the client
  plain-`function` body ctx, ONLY when `clientAsyncBody`.
- `emit-functions.ts` — threaded into the `emitFnShortcutBody` path, gated on `_fnIsAsync`.
- `emit-client.ts` — GITI-001 IIFE matcher now absorbs an emitter-supplied `await`.
- `compiler/tests/browser/browser-u1-client-server-fn-await.test.js` — NEW, 3 runtime tests.

`combinatorIsAsyncName` NOT touched. No new injector added.

### The regression the corpus differential caught (test suite stayed GREEN)

First pass changed 4 corpus files. Once `emit-expr` awaited at the call site, GITI-001's
reactive-set-RHS matcher no longer recognised the value, so those sites silently LOST
their `.catch(… → _scrml_error_boundary_log)` arm. The enclosing handler calls the fn
with NO `.catch` (`… function(event){ …; _scrml_submit_14(); }`), so that reintroduced
the exact browser-level `unhandledrejection` silent drop ss32-item-1 was written to kill.

Fixed by teaching that matcher to consume an optional leading `await`, keeping it the
owner of that position. **Corpus emit differential is now 708/708 BYTE-IDENTICAL** — which
is what U1's definition of done requires of the no-tail case.

Worth stating plainly: the full gated suite was green in BOTH states. Only the emit
differential caught this.

### Verification results

| gate | result |
|---|---|
| corpus compile | `COMPILED_OK=312 / COMPILE_FAIL=17` — failure SET identical to baseline |
| corpus emit differential | **708/708 byte-identical** |
| `node --check` | **CHECKED=708 FAILED=2** — the SAME two files as baseline, both downstream of an already-failing compile. **Zero stranded awaits.** |
| gated suite (unit+integration+conformance) | **22045 pass / 70 skip / 1 todo / 0 fail** |
| pre-commit hook (full suite) | green on every commit |
| R26 runtime | 3/3 pass post-fix; **3/3 FAIL pre-fix with `Received: undefined`** |

### Gaps — reproduced, not reasoned

**CLOSED — `g-reactive-write-member-server-call-no-autoawait` (MED, open).**
Reproducer `u1g2` covers both halves the gap text names:
- nested (inside a client fn): base `_scrml_fetch_loadRows_6().length` → post
  `(await _scrml_fetch_loadRows_6()).length`. **U1 fixed this half.**
- top-level (`on mount`): base ALREADY `(await …).length` — fixed before U1.
Post-fix neither half reproduces. U1's contribution is the nested half.

**NOT CLOSED — `g-server-fn-argument-position-not-awaited-and-statement-dropped` (HIGH).**
Reproduced the filed `on mount` Case A on the BASE compiler: it already emits
`_scrml_eq_5("x", await _scrml_fetch_tag_4())`. **Already awaited before U1 — U1 does
not close it, and I am not claiming it.** (Case B, the silently DROPPED statement, is a
separate defect the gap itself says "deserves a separate look"; not investigated.)
U1 DOES fix argument position inside a CLIENT FN BODY (probe u1p4, base emitted
`_scrml_pick_6(_scrml_fetch_loadRows_5())` bare) — a different position from the filed repro.

This is exactly why reproduction was mandated: reasoning from the gap title alone would
have over-claimed the HIGH.

**NEW, UNFILED gap found + fixed:** a return-typed `function` body (`emitFnShortcutBody`)
bypasses `scheduleStatements` entirely, so the statement-level injector never saw it —
a server call there emitted bare with zero diagnostics (probe u1p3). Recommend filing
retroactively so the fix has an anchor.

### Newly-rejecting change — needs a PA ruling

Probe `u1p5` (`ids.map(id => scoreOf(id))`, a server call in a SYNC callback) previously
compiled and emitted a bare Promise; it now HARD-ERRORS with
`E-ASYNC-STDLIB-IN-SYNC-CALLBACK`, because the branch's `peerAwaitable === false` path
records into `_clientSyncPeerCalls`, which `emit-functions.ts:1490` drains as an error.

That fail-closed record was explicitly ratified by the brief. Blast radius measured:
**ZERO corpus files** newly reject (failure set byte-identical to baseline). Flagging it
anyway because a newly-rejecting change is a §8 freeze concern and is PA's call, not mine.

### Deliberately NOT done (scope)

- The event-wiring / markup-interpolation surface (`u1p6`: a server fn called straight
  from an `onclick=` emits into a NON-async `function(event)`). Separate locus with its
  own async-wrapping mechanism. The `clientAsyncBody` gate provably cannot fire there.
- Client-side indirect/alias/dispatch-table server-call shapes
  (`serverFnPeerAliasNames` / `serverFnPeerDispatchObjs` are server-surface only).
- Retiring any existing injector — that is a later U-step, not U1.
- Case B (statement silently dropped) of the argument-position gap.

---

## 2026-08-05 — S239 FIX ROUNDS 2 + 3 (read this first if you are a cold successor)

Base `20a15c15`. Round-1 head was `0c677fa3` (what the reviewers froze against).

### MY ROUND-1 SAFETY ARGUMENT WAS WRONG — internalise before touching this

I claimed the gate "can only SUPPRESS an await, never STRAND one". FALSE.
`clientAsyncBody` describes **the FUNCTION's coloring**, NOT **the emitted host at the
call site**. A lowering can interpose its own host between the two — the client `match`
arm lowers into a SYNC IIFE while being handed the enclosing fn's FULL opts. That is F1,
and it was build-breaking. Whenever you thread an await-enabling flag, ask *what host will
these bytes actually land in*, not *is the function async*.

### Fixed this round

| id | defect | fix | verified |
|---|---|---|---|
| **F1** | match arm = sync IIFE host → **stranded await, build break** | `emit-control-flow.ts` match IIFE becomes `await (async function(){…})()` when an arm body **actually emitted** an await (decision read off emitted bytes, erring toward async) | p3/p16/p17/p18 compile; `node --check` clean |
| **F2** | `setTimeout(() => loadRows(), 100)` newly hard-errored | authorized `combinatorIsAsyncName` client-server-fn disjunct | p11 → `setTimeout(async () => await …_loadRows_5(), 100)` |
| **F4** | `if flag { @count = loadRows().length }` byte-identical to base (missed await) | **ROOT** = the `emit-logic.ts` if/for **dispatch hop** forwarded `serverFnNames` but not `clientAsyncBody`; the 5 emit-control-flow sites were the symptom. Fixed at both | p20 → `(await …).length` in if **and** for |
| **F5** | **cross-file server-fn name collision (HIGH)** — `routeMap` spans the whole import graph; the owning file lives ONLY in the map key, which both builders dropped | filter on the key's filePath in **both** `scheduling.ts:_clientServerFnNames` and `emit-functions.ts:1192` (they must agree — the gate is derived from that coloring) | xf: spurious await GONE; xf2: false hard-fail GONE |
| **F7** | last unguarded `serverFnNames` read | explicit `mode === "server"` guard at `emit-logic.ts:3147` | — |

**F1 vs F4 cross-checked against each other** (coordinator's warning — same root, opposite
directions). Verified in ONE run: p20 awaits inside if/for AND p3's match IIFE stays async.
Normalising the threading did not re-open F1.

### Where I DISAGREE with the review — needs a ruling

**F3 / p13 (`run(() => loadRows().length)`, user-defined HOF) is NOT a false positive.**
Reviewer grouped it with F2. Substantively different:
- p11 `setTimeout` **DISCARDS** the callback's return → a bare async call is harmless →
  the hard error contradicted the diagnostic's own text → genuine false positive → FIXED.
- p13's `run` **CONSUMES** the return. Base emitted
  `_scrml_run_5(() => _scrml_fetch_loadRows_4().length)` — `.length` off a Promise,
  silently `undefined`. There is no legal await position and no way for the compiler to
  know `run` awaits its callback. The hard error is the fail-closed contract working.
  "Fixing" it means re-shipping a silent miscompile.

It IS newly-rejecting vs base, which is a §8 freeze question for PA — but the answer
should be an explicit ruling, not a silent revert. Same for `.sort` and member-callee HOFs.

### Structural root worth naming (do not fix here)

**Three disagreeing "is this name async in client mode?" predicates:**
`isClientServerFnCall` (INCLUDES client server fns) · `combinatorIsAsyncName` (now
includes, after F2) · the drain's `isAsyncName` (EXCLUDES — `computeAsyncFnNames` uses
`serverFnNames` as a seed TRIGGER only and never adds it to the result). F2 fixed two of
three; **the drain stays blind.** Unifying them is the real dpa-020 follow-on.

### Recorded, deliberately NOT fixed (F8 + carried)

- **Param default** `function f(x = loadRows())`: recorded by NEITHER path
  (`paramSignature` splices raw text so the emitter never sees it; the drain's predicate
  does not know server fns). So *"coloured async ⟹ awaited OR diagnosed"* is **not**
  restored for client server fns. Pre-existing, out of scope.
- **The absorb discards my own await at the dominant position.** `emit-client.ts`'s
  GITI-001 absorb strips the inline `await` and re-emits the DETACHED fire-and-forget
  IIFE. So `@rows = loadRows(); @count = @rows.length` still reads stale. My round-1
  "708/708 byte-identical" was achieved partly BY that suppression — an honest number
  that flattered the change. Making the absorb defer to the inline await would fix
  sequencing but re-open the `.catch`/error-boundary hole I closed in round 1; that is a
  §13.2-vs-§19.6 design call, not a codegen detail. **FILE IT.** (Distinct from
  `g-auto-await-read-before-resolve-race`, which was dissolved for the DERIVED-cell case.)
- **`rewriteCodeSegments` fence** on the GITI-001 scan (addendum 4) — not done.
- **Wide-corpus harness** (`examples/**` + `samples/**` + `conformance/**`) — NOT done.
  The 708-bundle corpus is too narrow and WILL hand you a false green: it contains zero
  `setTimeout(`, and zero instances of every shape in rounds 2-3.
- **`.catch` client-fn-body test** (addendum 5) — still owed.
- Latent: the absorb is unconditional on any `_scrml_reactive_set(name, await …)` and is
  safe only because U1's branch is currently the SOLE producer of a bare `await` in arg-1.

### Verification status at this commit

F1/F2/F4/F5 probes verified; `node --check` clean on F1 outputs. **Full gated suite +
wide-corpus differential NOT yet re-run for rounds 2-3** — that is the next action.
