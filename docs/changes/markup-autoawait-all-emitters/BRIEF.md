> # ⛔ DO NOT DISPATCH AS WRITTEN — dpa-020 RATIFIED S319
>
> **This brief is WRONG on its central mechanism.** It targets Group B only and mandates the #391
> `clientAsyncFnNames` threading pattern. Per the ratified `dpa-020` verdict, **threading will NOT fix
> the server-fn case at all** — the branch it feeds *does not exist* for client server fns. As written
> it buys the 4 markup sites for cross-module async imports and **leaves every server-fn shape bare in
> the same four emitters**.
>
> **Root cause (ratified):** `emit-expr.ts` `emitCall` has four sibling auto-await branches and **no
> `mode === "client" && ctx.serverFnNames` branch**; the client server-fn rename is a whole-buffer regex
> post-pass that runs *after* every emitter, so at emit time the compiler cannot see it is emitting a
> server call.
>
> **Re-author against the ratified 3-unit plan (U1/U2/U3)** in
> `scrml-support/docs/deep-dives/autoawait-choke-point-vs-heterogeneous-2026-08-04.md`.
> **Precondition, non-negotiable:** a stranded `await` is a whole-bundle SyntaxError — every sync host
> must set `peerAwaitable: false` BEFORE U1 lands, gated by `node --check` per position.
> **Do NOT widen `combinatorIsAsyncName` in U1** (§8 newly-rejecting under freeze).

---

# BRIEF — complete the markup autoawait: enumerate EVERY markup emitter, not the three I found

change-id: `markup-autoawait-all-emitters`
authored: 2026-08-03 (S316-bryan) · agent: `scrml-js-codegen-engineer` (iso worktree, opus, bg)
gap: `g-markup-autoawait-misses-attr-and-each-body` (HIGH, `docs/known-gaps.md`)
predecessor: **#391 `27adae9e`** — read its diff first; it is the pattern to mirror, and it is incomplete.
DONE-PROBE: bun test compiler/tests/integration/crossmodule-async-markup-position-autoawait.test.js
probe-intent: green, with the suite EXTENDED to one case per markup position enumerated below —
including a `<match>` arm and an `<each>` body with a **non-empty** collection. The existing suite
passes on the broken build; it only exercises the one position #391 fixed.

---

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` in full; follow §"Task-Shape Routing" for a compiler-source codegen
task.

**Map currency:** maps stamp `e80b692e` (2026-08-02). HEAD is `4b2c5df0`. **Eight codegen/ast-builder
commits have landed since the stamp** — #385, #386, #387, #388, #389, #390, **#391 (your direct
predecessor)**, plus `e155e1e7`. The map does NOT know about #391's changes to
`emit-event-wiring.ts`. Treat map content as a verify-against-source hypothesis throughout; on this
task the source wins over the map every time.

Report: `Maps consulted: [list]; load-bearing finding: <one sentence>` OR `Maps consulted but not
load-bearing.`

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: `<ABSOLUTE-WORKTREE-PATH>` (echo your real `pwd` and use THAT).

## Startup verification (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is
   under any other repo, STOP and report (the S90 CWD-routing failure). Save as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git status --short` — clean.
4. `bun install` (worktrees do NOT inherit `node_modules`).
5. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`).

If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- **Edit via Edit/Write on WORKTREE-ABSOLUTE paths.** ⚑ Ignore older briefs in `docs/changes/` that
  mandate Bash-only edits — that S126 mitigation is **RETIRED** (S314); the isolation guard now refuses
  Bash heredocs and the `path-discipline.sh` hook covers Edit/Write.
- NEVER a bare relative path. NEVER a main-rooted absolute path. NEVER `cd` into the main repo — use
  `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
- FIRST commit message carries your verbatim startup `pwd`.

# CRASH RECOVERY
Commit after EVERY meaningful edit. Append-only timestamped `progress.md` under
`docs/changes/markup-autoawait-all-emitters/`. Clean `git status` before reporting DONE.

---

# THE BUG

A cross-module inferred-async CLIENT import consumed in a markup interpolation must be awaited. #391
fixed **one** markup position. The others still emit the call **BARE**, so the interpolation reads a
field off a **Promise** and renders `undefined` — **compile exit 0, zero diagnostics.**

## Reproducer

`lib.scrml` — `fetchStatus` is inferred-async (reaches the Promise-returning `scrml:http` `get`):

```scrml
${
  import { get } from 'scrml:http'
  export function fetchStatus(url) {
    return get(url)
  }
}
```

`m1.scrml` — the same interpolation in every markup position:

```scrml
<program>
${
  import { fetchStatus } from './lib.scrml'
  type Phase:enum = { A, B }
  <url> = "/x"
  <items>: string[] = ["a"]        // MUST be non-empty — see the trap below
  <phase>: Phase = .A
}
<p>${ fetchStatus(@url).status }</p>
<div title=${ fetchStatus(@url).status }>attr</div>
<each in=@items>
  <p>${ fetchStatus(@url).status }</p>
</each>
<match for=Phase on=@phase>
  <A><p>${ fetchStatus(@url).status }</p></>
  <B><p>b</p></>
</>
</>
```

Compile both files together, then inspect `m1.client.js` for each `fetchStatus(` call site.

# WHAT I MEASURED — and where I was WRONG

⚠️ **Read this section as a HYPOTHESIS, not a map (pa-base §5). I got the attribution backwards once
already**, credited a bare site to `<each>` when it was the `<match>` arm, and recorded a position as
BARE that had never actually been exercised. **Re-derive the table yourself; do not trust it.**

| position | emitter (verify) | measured |
|---|---|---|
| `<p>${ … }</p>` top-level text | `emit-event-wiring.ts:1889` (reactive) + `:2021` (one-shot) | `(await …)` ✅ — #391's fix |
| `<div title=${ … }>` value-attr | `emit-event-wiring.ts:1665` | **BARE** ❌ |
| `<match>` arm body | **`emit-variant-guard.ts:569`** (a THIRD emitter) | **BARE** ❌ |
| `<each>` body | `emit-each.ts` | **UNRESOLVED** — see the trap |

**THE TRAP that cost me the wrong table:** with `<items> = []` (empty), **no each mount is emitted at
all**, so the position produces no call site and reads as "clean". I then re-probed with `["a"]` and
**still** saw no each mount — so the `<each>` path is genuinely unresolved, not verified-clean. Resolve
it: find out whether an `<each>` body interpolation reaches a call-expression emitter at all, and if so
which. Do not mark it clean because nothing appeared.

# THE MANDATE — enumerate, do not patch three sites

**Do NOT just fix the two confirmed bare sites.** That reproduces the very defect this arc exists to
close: #391 fixed one position of a class and shipped, and its own test passed the whole time. The S288
rule is the scope: *enumerating shapes inside a function is not the same as enumerating the functions a
class of defect can inhabit.*

**Enumerate every markup lowering that emits a call expression into client JS**, and for each, decide
and record: does an inferred-async cross-module call reach it, and is the await injected? Start from
every `emitExprField(` / `emitExpr(` call site in the markup emitters (`emit-event-wiring.ts` has ~18;
only **two** thread `clientAsyncFnNames` today) and in `emit-variant-guard.ts` / `emit-each.ts` /
`emit-html.ts`. **Produce the table as a deliverable** — it is worth as much as the fix, and it is what
makes "complete" checkable rather than asserted.

# THE PATTERN TO MIRROR (#391, `emit-event-wiring.ts:1889`)

1. `emitFunctions` stashes the peer-await set on `ctx` as `_clientPeerAwaitNames`; `emitEventWiring`
   reads it (`:622`). `emit-variant-guard.ts` also receives `ctx: CompileContext` (entry points at
   `:287 :298 :399 :996 :1461`), so it can reach the same set — verify the emit ORDER puts
   `emitFunctions` first for whichever emitter you touch, or the set will be empty.
2. Thread it into the `emitExprField` ctx as `clientAsyncFnNames`.
3. **Decide the async wrap by DIFFING the emit with vs without the set** — NOT by a `NAME(` textual
   predicate. #391's own commit records why, and it was caught by the S239 pass rather than the tests:
   a predicate misses a client-async fn passed as a bare combinator callback (`@items.map(fetchStatus)`
   → `await _scrml_mapAsync(...)`), which strands an unwrapped `await` in a sync effect.
4. Route through a nested async IIFE **without** an outer `await` (the inner await is already injected —
   no `await await`). Server-fn wrapping takes precedence where both apply.

## ⚠️ THE HAZARD — a stranded `await` is a WHOLE-BUNDLE SyntaxError

Every one of these sites sits inside a **synchronous** callback (`_scrml_effect(function() { … })`, a
`setAttribute` wrapper, an arm `_wire_` fn). Injecting an `await` without also providing the async
context does not fail locally — it is a **parse error that kills the entire client bundle**. This is
strictly worse than the bug being fixed. Every position you touch needs its own async-context shape,
and `node --check` on the emitted bundle is a MINIMUM gate per position, not a nice-to-have.

# DIRECTION OF CHANGE

`semantics-changed` (pa-base §8, the silent class): same source, different runtime behaviour, no
diagnostic delta. Compute the artifact diff over the corpus and report it. **Corpus reality:** a
cross-module inferred-async import consumed in markup is rare — measure the count rather than assuming
it, and expect most artifacts byte-identical. Any artifact that changes and is NOT one of these shapes
is a finding, not noise.

# VERIFICATION — all five

1. **The enumeration table**, with measured status per position, including `<each>` resolved either way.
2. **Per-position emitted-code check** — each formerly-bare site now awaited, `node --check` clean on
   the whole bundle for each.
3. **Executed**, not just emitted (S265/S268/U3 — "emitted ≠ runs" has bitten this project three
   times): the interpolation must resolve to the real value, not `undefined`.
4. **Negative controls, unchanged:** a SYNC cross-module import must NOT gain an await; a server-fn
   interpolation keeps its existing outer-await shape; the combinator-callback form must still parse.
5. **Full gated subset** `bun test compiler/tests/{unit,integration,conformance}` — 0 failures — plus
   **R26**: recompile `../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` + `examples/` and diff
   artifacts against `main`. **Do not mark DONE without R26**, and paste the counts.

# REPORT BACK

- The enumeration table (the main deliverable), and whether my three-emitter claim held / was refined /
  was wrong.
- What the `<each>` path actually does.
- Per-position before/after emitted snippets + the execution result.
- Corpus artifact-diff counts.
- Files touched, final SHA, clean `git status`.
- Anything this brief got wrong — I have already been wrong once here, so assume there is more.

# DO NOT

- Do not fix only the sites this brief names. Enumerating the class IS the task.
- Do not use a textual `NAME(` predicate for the async decision — use the diff.
- Do not leave any position "assumed clean" because no call site appeared; prove why.
- Do not `git push`, open a PR, or touch `main`. The PA lands this after an independent adversarial
  pass — the pass that found this incompleteness in the first place.
