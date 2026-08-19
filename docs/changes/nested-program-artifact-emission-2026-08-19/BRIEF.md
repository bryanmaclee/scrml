# BRIEF (verbatim, archived at dispatch time)

Change-id: `nested-program-artifact-emission-2026-08-19`

---

Build the nested-`<program>` codegen gap fix in the scrml compiler. Change-id: `nested-program-artifact-emission-2026-08-19`.

## 0. SETUP — do this first, exactly

Your worktree is cut from `origin/main`. Confirm before anything else:

```
pwd && git rev-parse --short HEAD && git log --oneline -1
```

You must be based on `origin/main` at `9f6130d0` or later. `git fetch origin && git merge --ff-only origin/main` if you are behind.

**Archive this brief verbatim** to `docs/changes/nested-program-artifact-emission-2026-08-19/BRIEF.md` and keep a running `docs/changes/nested-program-artifact-emission-2026-08-19/progress.md` as you go.

**Discipline (non-negotiable):**
- **Commit and push after EVERY item.** Do not batch. Your branch + `progress.md` are the only crash-recovery anchor; agents on this repo have died at a 600s watchdog and the batching ones lost hours while the incremental ones lost nothing.
- The pre-commit hook runs ~2 min. If a commit appears to time out, **run `git log -1` before retrying — it usually landed.**
- **NEVER `--no-verify`, and never override `core.hooksPath` or otherwise disable a hook.** If you believe you need it, stop and report instead.
- **Write ONLY inside your worktree.** Never use an absolute path into `/home/bryan-maclee/scrmlMaster/scrml` (that is the PA's live checkout). Verify with `pwd` before file operations.

## 1. THE CONFIRMED BUG — worker bundles are generated and never written

**This half has no design question. Build it.**

PA-verified by execution and by reading the code:

- `compiler/src/codegen/index.ts:~1500` generates worker bundles: `generateWorkerJs(name, def.children, def.whenMessage)` → `workerBundlesPerFile.set(filePath, bundles)`, surfaced on the compile output as `workerBundles` (`index.ts:289`, `:1973`, `:2534`).
- **`grep -rn 'workerBundles' compiler/src/` returns hits in `codegen/index.ts` ONLY.** Nothing else in the tree consumes it.
- `compiler/src/api.js`'s write path (~`:3195-3280`) writes `toolJs`, `serverJs`, `libraryJs`, `clientJs`, `html`, `css`, `clientJsMap`, `serverJsMap` — and has **zero** mentions of `worker`.

Net effect, reproduced on `main`:

```scrml
<program db="postgres://localhost/app">
  <program name="worker">
    <items> = []
  </program>
</program>
```

compiles exit 0, emits `new Worker("worker.worker.js")` into the client bundle (`emit-client.ts:2393`), and **never writes `worker.worker.js`**. The reference 404s at runtime.

**Task:** write the generated worker bundles to the output directory as `<name>.worker.js`, through the same `writeOutput` path and the same hashing / asset-ref-rewriting rules the sibling artifacts use. Check whether the `new Worker("<name>.worker.js")` reference in `emit-client.ts` needs the same content-hash rewrite the `.client.js` refs get (`api.js:~3250`) — if `.client.js` is emitted hashed, a bare `worker.worker.js` reference will break in exactly the same way and must be rewritten consistently.

Also confirm and preserve the deliberate carve-out at `index.ts:~1405`: a nested `<program>` with `port=` and not `mode="wasm"` is a SIDECAR and is spliced WITHOUT registering a worker, precisely so it does not emit a reference to a never-emitted bundle. Your fix must not resurrect a dangling reference for that case — and it is the existing proof that this repo already treats "reference an unemitted bundle" as a bug to be avoided.

## 2. THE DESIGN FORK — do NOT decide this one; investigate it and surface it

A `<channel>` inside a nested `<program>` emits a **client WebSocket connection and no server route**:

```scrml
<program db="postgres://localhost/app">
  <channel name="canonical-feed">
    <messages> = []
  </channel>
  <program name="worker">
    <channel name="nested-feed">
      <items> = []
    </channel>
  </program>
</program>
```

→ server emits only `_scrml_route_ws_canonical_feed`; client dials **both** `/_scrml_ws/canonical_feed` and `/_scrml_ws/nested_feed`. The client sets `_ws.onclose = () => { _reconn = setTimeout(_connect, 2000); }`, so the runtime symptom is a **silent infinite 2s reconnect against a route that does not exist**. Exit 0, no diagnostic.

Mechanism (my hypothesis — VERIFY it, do not assume): the channel is registered globally by the symbol-table pass, so the client emits a connection; then `extractWorkerPrograms` (`index.ts:1387`) splices the nested `<program>` node out of the main tree before server-route emission; and `generateWorkerJs` (`compiler/src/codegen/emit-worker.ts:22`) only handles **function declarations + the `when message` hook** — it has no channel handling at all. So the channel falls into a hole between the two emitters.

**The language question you must NOT answer alone:**

- §4.12.3 says a nested `<program name=>` with **no `lang=`** is an **inline web worker** — client-side. A worker cannot host a server-backed WebSocket route, so a `<channel>` there may be *incoherent* rather than *unimplemented*.
- But §4.12.2 lists `route=` as valid in nested position ("Declares the nested program as a server endpoint"), and `db=` too — so some nested programs ARE server-side. The answer plausibly depends on the §4.12.3 execution-context TYPE.
- ⚑ And note precisely: §4.12.1's normative sentence is **scoped** — *"subject to the same grammar rules as a top-level `<program>` (§4.1, §4.2, §4.3, §4.11)"*. **§38 (channels) is not in that enumeration.** A recent ruling leaned on this sentence read as general. Do not re-decide that; just report what the text says.

**What to do for item 2:** make it **fail closed**. Whatever the eventual semantics, emitting a client that dials a nonexistent route is wrong under every reading. Implement the smallest fail-closed behaviour that removes the dangling reference — either emit the server half where the execution-context type makes it coherent, or refuse with a clear diagnostic where it does not.

If your fix requires a NEW error code: it needs a §34 catalog row, and `scripts/s34-census.ts --check-new` gates it — every new row needs an emitter provenance note naming the real emit site (`emitted at \`compiler/src/...\``), an explicit spec-ahead declaration, or strikethrough. Prefer reusing an existing code if one genuinely fits. **Report the tradeoff; state clearly in `progress.md` which option you took and what the alternative would cost.**

## 3. VERIFICATION BAR (this repo's standard — it is strict)

- **Two-sided bite proof for every behavioural change.** A test that passes after the fix but was never shown to fail before it does not count. State the red-half and green-half output explicitly in `progress.md`.
- **Execute, don't grep.** A prior session shipped a feature that was dead on arrival because it verified by grepping emitted text for a marker instead of running the bundle. For the worker bundle: confirm the file is actually written to the output dir, and that its contents are the generated bundle rather than an empty or placeholder file.
- Run targeted tests + `bun conformance/run.ts`. Do NOT run the full suite repeatedly; memory is contended.
- ⚑ **Fresh worktrees lack gitignored build artifacts.** If a test fails, check whether it fails for that reason before calling it a regression — this exact ENV-GAP produced 7 phantom failures earlier today (`compiler/tests/unit/form-for-expander.test.js` shows 7 fails in a fresh worktree and 26 pass / 0 fail in a populated one).
- Do not modify `docs/known-gaps.md`, `handOffs/delta-log.md`, `handOffs/dpa-queue.md`, `master-list.md`, or `hand-off.md` — those are PA-owned. Surface anything you would have written there in `progress.md` instead.

## 4. DELIVERABLE

Push your branch and report:
- the branch name and final SHA
- what you built for item 1, with the bite proof
- what you did for item 2, which option you took, and the design fork stated cleanly for the operator
- residuals and anything you deliberately did not do

There is an open gap entry for this: `g-nested-program-emits-artifacts-it-never-produces` (HIGH). Blast radius is **0 corpus instances** across all 2260 `.scrml`, so you are not under time pressure and you must not trade correctness for speed.
