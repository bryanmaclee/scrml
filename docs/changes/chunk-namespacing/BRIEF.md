# BRIEF — per-chunk id/cell namespacing (`chunk-namespacing`)

**Dispatched:** S282 (2026-07-22) · base `e8fdd44c` · agent `scrml-js-codegen-engineer`, `isolation: worktree`
**Full scoping:** [`SCOPING.md`](./SCOPING.md) — read it IN FULL first. All three OQs are RULED; do not re-open them.

DONE-PROBE: grep -qE "namespaceToken|chunkNamespace" compiler/src/ast-builder.js

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST, in full, before any source edit. Follow its
**Task-Shape Routing** section to pick the additional maps for this task shape (this is a
codegen/compiler-internals change touching the AST builder, five emitters, the runtime
template and the API — route accordingly; `structure.map.md`, `build.map.md` and
`dependencies.map.md` are likely the relevant ones).

Map stamp: `commit: a0344d75` / `2026-07-22T17:10:00Z`. HEAD at dispatch is `e8fdd44c`.
The three commits since the stamp are `d3e961de` (#141 `<each>` multi-root codegen — the map
files WERE refreshed inside that landing, so they already reflect it), `1531b341` and
`e8fdd44c` (both test-only). **Treat the maps as current for this task**; treat map content as
a verify-against-source hypothesis, not as truth, wherever it disagrees with what you read.

Report the load-bearing map finding in your final report — including "not load-bearing" if
that is the honest answer.

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. First action: `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Also confirm `git rev-parse --show-toplevel` equals that same worktree root and the tree is clean.
   If ANY check fails, STOP and report — do not proceed.
2. Every Read/Write/Edit uses an ABSOLUTE path under the worktree root. A relative path resolves
   against the shared checkout via the additional-working-directories list and LEAKS.
3. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `--cwd "$WORKTREE_ROOT"` for `bun`
   and `git -C "$WORKTREE_ROOT"` for git.
4. Startup deps (a fresh worktree inherits neither): `bun install`, then `bun run pretest`
   (populates the gitignored `samples/compilation-tests/dist/` browser fixtures — without it you
   get ~130 ECONNREFUSED-shaped failures). Use `bun run test` for baselines, not bare `bun test`.
5. Echo the startup pwd in your first commit message (`WIP(chunk-namespacing): start at $(pwd)`).

**Crash recovery:** commit after EACH meaningful change (WIP commits expected — the branch is the
checkpoint) and keep an append-only timestamped `progress.md` in `docs/changes/chunk-namespacing/`.
A clean `git status` before you report DONE is mandatory.

---

## The problem

Adopter issue **#27** (cross-page nav full-reloads) needs a soft-nav loader. Two route chunks that
coexist at runtime **clobber each other**, so no loader can work until this is fixed. This was
empirically proven in real Chromium with NO navigation at all — just the `await import()` a loader
performs.

**Two INDEPENDENT namespaces collide. Fixing either alone still clobbers.**

- **N1 — numeric node ids.** `ast-builder.js:18125` `const counter = { next: 0 }` is local to each
  compilation unit. Every route chunk restarts at 1, so two routes emit the same `each_9` /
  `_scrml_each_render_9` / `<!--scrml-each:9-->`.
- **N2 — reactive cell keys.** The cell store is keyed by the **source-level cell name**. Two routes
  that both declare `<rows>` share one slot. This collides even when N1 does not — it needs no
  numeric coincidence at all.

## The ruled design — do NOT re-litigate

- **Token = FNV-1a of the dist-relative source PATH, base36, 8 chars.** Same hash function §47
  already uses for content-addressed chunk filenames, applied to path-identity rather than content.
  Rejected and why: chunk basename (NOT unique — 7 duplicate basenames measured across the corpora;
  `pages/driver/home.scrml` and `pages/dispatch/home.scrml` would namespace identically, failing in
  exactly the multi-page layout that needs it most); build index (unstable across incremental builds);
  content hash (answers "has this changed", not "which unit is this"; churns every id on any one-line
  edit, and risks circularity if the emitted chunk is ever hashed since the ids live in it).
- **ALWAYS-ON.** Namespacing moves classic bytes for every app including single-page ones that can
  never collide — accepted. Conditional namespacing means two emit shapes to test and the condition
  ("can these chunks ever coexist?") is wrong at the edges.
- **Byte-identity:** accept a one-time global churn, gated by an artifact-diff that mechanically
  asserts the ONLY delta is id tokens. Classify the landing **`semantics-changed`**.

## The constraint that shapes the design — SSR/client token agreement

The fence `<!--scrml-each:N-->` is emitted into **HTML** while `_scrml_each_renderers["each_N"]` is
registered in **JS**. The namespace MUST be identical on both sides and stable between the SSR pass
and the client emit. Any scheme that derives the token differently in the two emitters silently
breaks rehydration — **and that failure is invisible to a grep, so only execution catches it.**

## Measured surface (~390 touch points, 8 files)

`counter.next` sites in `ast-builder.js` **205** · id consumers: `emit-each.ts` 47, `runtime-template.js`
22, `emit-match.ts` 8, `emit-variant-guard.ts` / `emit-client.ts` / `emit-ssr-render.ts` 4 each,
`api.js` 1 · cell-store key sites: `emit-client.ts` 28, `runtime-template.js` 64.

Mechanical once the token scheme is settled. The hard parts are the SSR/client agreement above and
the byte-churn review — not the edit volume.

---

## PHASE 3 — EMPIRICAL VERIFICATION (do NOT mark DONE without this passing)

**"Tests pass" is NOT the symptom check. The symptom check is EXECUTION.** S280 learned this twice:
a ref-resolution audit is blind to a ref that was never emitted, and a marker-grep is blind to a
bundle that throws at load.

1. **The collision repro IS the acceptance test.** Fetch it:
   `git -C "$WORKTREE_ROOT" fetch origin evidence/u4-premise-falsified`
   `git -C "$WORKTREE_ROOT" checkout origin/evidence/u4-premise-falsified -- docs/changes/esm-chunks/u4-premise-check/`
   Then, per its README:
   ```
   bun run compiler/bin/scrml.js compile docs/changes/esm-chunks/u4-premise-check/fx -o /tmp/fx-esm --module-format=esm
   bun docs/changes/esm-chunks/u4-premise-check/premise-check.mjs /tmp/fx-esm
   ```
   It currently prints:
   ```
   alpha BEFORE import : {"rows":["a1","a2"],"h2":"Alpha"}
   alpha AFTER  import : {"rows":["b1","b2"],"h2":"Alpha"}
   VERDICT: alpha's rendered rows WERE CLOBBERED by beta's chunk
   ```
   **It must flip to isolated — alpha's rows UNCHANGED after the import — executed in a real
   browser, under BOTH module formats (`--module-format=esm` AND classic.)** The harness pins
   `executablePath` to the installed Chromium; fix the path if your environment differs.

2. **Corpus choice is load-bearing — do not repeat the S280 mistake.**
   - `docs/website` is the WRONG corpus: it has no cross-file `.scrml` deps, so the changed code
     never fires there. A sweep over it returns a confident, vacuous green.
   - `examples/23-trucking-dispatch` **does not collide BY LUCK** — its pages differ in node count
     so the per-file ids happen to miss. It will also false-green you.
   - **A purpose-built colliding fixture is mandatory.** The `u4-premise-check/fx` above is one;
     add more if you need a shape it doesn't cover.

3. **Artifact-diff gate (OQ-3).** Across the full corpus, assert mechanically that the ONLY delta
   is id tokens. Anything else in the diff is a finding, not noise.

4. Full suite green: `bun run test`. Add regression tests for BOTH namespaces (N1 and N2
   independently — a test that only covers N1 would have passed the whole time this bug existed).

---

## Report back

Worktree path · final commit SHA · files touched · the premise-check output BEFORE and AFTER
(verbatim, both module formats) · the artifact-diff result · anything you deferred and why · the
load-bearing map finding.

**If the design as ruled turns out not to work, STOP and report rather than improvising a different
scheme.** The last agent on this arc refused to build something unsound and was right to; that is
the expected behaviour, not a failure.
