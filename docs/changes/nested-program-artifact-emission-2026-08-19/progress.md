# progress — nested-program-artifact-emission-2026-08-19

Base: `9f6130d0` (origin/main). Branch: `worktree-agent-a217c8b99ee5560a0`.

---

## Step 0 — setup (DONE)

- `pwd` = worktree root, `git rev-parse --show-toplevel` matches, tree clean.
- Base `9f6130d0` — matches the brief's floor exactly, no fetch/merge needed.
- `bun install` — 217 packages.
- `bun run pretest` — 13 test samples compiled into `samples/compilation-tests/dist/`
  (fresh worktrees lack this gitignored tree; populating it up front removes the
  known 7-phantom-failure ENV-GAP class).
- Brief archived verbatim → `docs/changes/nested-program-artifact-emission-2026-08-19/BRIEF.md`
  (commit `d201f377`).

---

## Item 1 — worker bundles generated and never written

### Reproduction on base (EXECUTED, not read)

Compiled `repro-worker.scrml` (a §4.12.4 inline worker: `<program name="doubler">`
with `when message(data) { send({ result: data.value * 2 }) }`) with
`bun run compiler/src/cli.js compile … -o dist/`.

Exit 0. Output dir:

```
repro-worker.client.js
repro-worker.css
repro-worker.html
scrml-runtime.01aqbhx3.js
```

`repro-worker.client.js:19`:

```js
const _scrml_worker_doubler = new Worker("doubler.worker.js");
```

No `doubler.worker.js` anywhere in the output dir. Confirmed: the reference 404s.

### Sidecar carve-out — confirmed still correct on base

`<program name="ml" lang="go" build="…" port="9001" health="/health">` compiles to
**zero** `Worker` occurrences in the client bundle and zero `.worker.js` files.
The §23.4 carve-out at `codegen/index.ts:~1405` splices the node without
registering a worker, exactly as documented. My fix must not disturb this — pinned
by a test.

> **Incidental finding (NOT fixed, surfaced only).** SPEC §4.12.5's worked example
> writes `port=9001` **unquoted**. That does not compile: it fails with
> `E-SCOPE-001: Unquoted identifier '9001' in attribute 'port' cannot be resolved
> in the current scope.` `port="9001"` compiles. So the SPEC's own §4.12.5 sample
> is not a compiling program. Out of scope for this dispatch; see RESIDUALS.

### Naming decision — `<sourceBase>.<workerName>.worker.js`, NOT `<workerName>.worker.js`

The brief names `<name>.worker.js` **and** says "through the same `writeOutput`
path and the same hashing / asset-ref-rewriting rules the sibling artifacts use."
Those two cannot both hold: `writeOutput(filePath, suffix, contents)` composes
`pathFor(...).base + suffix`, where `base` is the SOURCE basename. A bare
`doubler.worker.js` cannot be expressed as `base + suffix`.

I took the source-base-prefixed form. Reasons, in order of weight:

1. **A bare `<name>.worker.js` introduces a new build failure for a legal
   program.** Two sibling pages that each declare `<program name="doubler">` both
   compute to `dist/doubler.worker.js`. Routed through `writeOutput`, the second
   raises `E-CG-015: conflicting output paths`. `doubler` / `parser` / `worker`
   are exactly the generic names two pages would independently pick. Trading a
   404 for a hard build error on a legal program is not a fix.
2. `<base>.<suffix>` is the convention **every** sibling artifact already uses
   (`.client.js`, `.server.js`, `.css`, `.test.js`, `.machine.test.js`).
3. It rides `pathFor` unchanged, so the `pages/` strip, nested output dirs, and
   the E-CG-015 duplicate guard all come for free rather than being re-derived.
4. **SPEC does not name the file.** §4.12.4 says only "The nested program is
   compiled as a separate worker bundle." `grep 'worker\.js' compiler/SPEC.md`
   returns nothing. The filename is an implementation choice, so no SPEC amendment
   is implicated.
5. Blast radius of the rename is zero: the file was never written, so nothing can
   depend on the old name. One unit test asserted the literal string
   (`nested-program-e2e.test.js:93`); it is updated in the same commit.

### Two-sided bite proof

New test: `compiler/tests/integration/nested-program-worker-artifact-emission.test.js`
(8 tests). Its central invariant is deliberately shape-independent — "every
`new Worker("…")` specifier in a **written** client bundle names a file that
**exists** on disk" — so it keeps biting through any future rename.

**RED (base `9f6130d0`, before the fix): 2 pass / 6 fail.**

```
(fail) worker bundles are WRITTEN … > a nested <program name> emits a worker file on disk with real content
(fail) worker bundles are WRITTEN … > every new Worker() ref in the written client bundle resolves to a file on disk
(fail) worker bundles are WRITTEN … > the written worker bundle EXECUTES: postMessage in, doubled value out
(fail) worker bundles are WRITTEN … > two workers in one file emit two distinct bundles, both on disk
(fail) worker bundles are WRITTEN … > two SIBLING pages each with a same-named worker do not collide (E-CG-015)
(fail) worker bundles under --content-hash-assets > worker file is content-hashed and the client ref is rewritten to match
 2 pass
 6 fail
```

Representative red failure (the anti-dangling invariant, on bytes on disk):

```
+   "exists": false,
    "spec": "doubler.worker.js",
```

The 2 that pass red are the two *preservation* assertions — the §23.4 sidecar
carve-out, and the client-bundle hash-covers-its-own-bytes integrity check. Both
must stay green through the change; they are guards, not bite.

**GREEN: see below.**
