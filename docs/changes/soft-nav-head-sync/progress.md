# progress — soft-nav-head-sync

Append-only. Newest entry at the bottom. Written for a successor who boots cold with
nothing but this file and the branch.

---

## 2026-08-19 — entry 1 — startup + premise verification (no code written yet)

**Worktree** `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0ee37b7ee9d9c856`
**Branch** `soft-nav-head-sync`, cut from `origin/fix/soft-nav-head-sync` @ `dda661b2`.

### Startup gates — all green
- `pwd` / `git rev-parse --show-toplevel` agree; tree clean at start.
- `git fetch origin fix/soft-nav-head-sync && git checkout -B soft-nav-head-sync FETCH_HEAD` → HEAD `dda661b2` as briefed.
- `bun install` OK (217 packages).
- `bun run pretest` OK (13 samples compiled into `samples/compilation-tests/dist/`).
- ⚠ `git` printed `fatal: bad tree object fb316444…` / `failed to run repack` during the
  background auto-gc kicked off by the initial `fetch`. `fb316444` is NOT reachable from my
  history (`git cat-file -t` says missing); it is a pre-existing dangling object in the shared
  object store. My branch, index and commits are intact. Non-blocking, but the PA should know
  the main repo's object store has at least one missing object.

### Both PA loci HELD — verified by reading source at HEAD
- **D1** `compiler/src/runtime-template.js` `_scrml_nav_sync_head(doc)` (≈ line 2841) syncs exactly
  `<title>`, `meta[name=description]`, `link[rel=canonical]` via `_scrml_nav_sync_head_el`.
  `link[rel=stylesheet]` is never touched. Confirmed.
- **D2** `_scrml_navigate_soft` pushes at ≈ 2713 / 2724 **before** the fetch;
  `_scrml_nav_fetch_and_swap` at ≈ 2752 does
  `if (!res.ok || res.redirected) { _scrml_navigate(res.url || path); return null; }`. Confirmed —
  the pushed entry is orphaned.
- Relative-depth premise **CONFIRMED in the emitter**: `compiler/src/codegen/index.ts:3054` emits
  `<link rel="stylesheet" href="${upToRoot}${entryBase}.css">` and `:2305` emits
  `href="${base}.css"`. So hrefs really are relative at varying depth, exactly as the brief and
  the reporter said.

### ⛔ ONE BRIEF PREMISE IS WRONG — there IS an automated gzip gate
The brief says *"The PA grepped and found NO automated gate enforcing the budget"*. **False.**
`compiler/tests/integration/v0-3-x-spa-tree-shake-phase-b.test.js:145` asserts
`expect(gzip.length).toBeLessThan(16 * 1024)` on the assembled shared runtime for an SPA-counter
fixture. It is in the **pre-commit gate** (integration tier). It WILL go red if the delta lands in
a chunk that fixture assembles.

Measured baseline at `dda661b2` (harness: gzip of the artifact `compileScrml` writes):

| artifact | raw B | gzip B |
|---|---|---|
| `SCRML_RUNTIME` whole template | 342,667 | 102,631 |
| chunk `utilities` isolated | 40,433 | 14,185 |
| chunk `core` isolated | 25,692 | 8,186 |
| assembled runtime, SPA counter (the gated artifact) | 54,773 | **15,600** |

Headroom against 16,384 B = **784 B**, not the ~185 B the gap entry remembers. Note the gated
fixture does **not** include the `utilities` chunk, so a soft-nav-only delta may not move it at
all — which is itself worth reporting, because it means the gate does not actually watch this
code.

### ⚠ SEPARATE LIVE DEFECT FOUND, OUT OF SCOPE, NOT BEING FIXED HERE
`navigate()` in an **attribute** position (`<button onclick={ navigate("/x") }>`) lowers to
`_scrml_navigate_soft("/x")` in `app.client.js`, but `detectRuntimeChunks`
(`compiler/src/codegen/emit-client.ts:1785/1790`) only lights the `utilities` chunk for a
**bare-expr** node or for `fileHasOutlet(fileAST)`. On a page with no `<outlet>`, the emitted
bundle therefore references `_scrml_navigate_soft` while the assembled runtime does not define it
→ **`ReferenceError` on click**. Reproduced by compiling and grepping both artifacts. This is the
S265 class again. Surfacing, not fixing — outside this brief.

### Test-feasibility probe — SETTLED, and it is good news
An outcome-shaped assertion ("the destination's stylesheet is *applied*") is achievable in the
existing happy-dom tier:
- happy-dom **does** fetch `<link rel=stylesheet>`, fire `load`/`error`, populate `link.sheet`, and
  feed `getComputedStyle`. Verified end-to-end.
- ⚠ It must be served by **`node:http`**, NOT `Bun.serve` — happy-dom's internal fetch uses
  node's http client and gets `NetworkError: … Parse Error` against `Bun.serve`. Probe proved
  `node:http` works and `Bun.serve` does not. Anyone reproducing must use `node:http`.

### NEXT
1. Build a realistic multi-page fixture (shell `<program>` + `<outlet/>`, pages at depth 0/1/2,
   per-page CSS) and **reproduce D1 empirically** before writing the fix.
2. Then implement D1 (resolve against target URL, await load, prune after swap) and D2.

### Blockers
None.
