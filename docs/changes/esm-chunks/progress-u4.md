# ESM-chunks U4 — `import()` nav-time chunk loader — progress log

Append-only, timestamped. Branch `worktree-agent-a37b70b679f3bb3f1`, base `8ade2355`.

---

## 2026-07-22 — STARTUP

- Worktree verified: `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a37b70b679f3bb3f1`,
  toplevel matches, `git status --short` clean, HEAD `8ade2355` (as briefed).
- `bun install` OK (218 packages). `bun run pretest` OK (13 samples -> `samples/compilation-tests/dist/`).
- **BRIEF-PREMISE (documentation):** `docs/changes/esm-chunks/U4-BRIEF.md` **does not exist** — not at
  HEAD and not in any branch (`git log --all -- <path>` returns nothing). Only `BRIEF.md`,
  `U1-BRIEF.md`, `U2-BRIEF.md`, `U3-BRIEF.md` are present. Proceeded on the inline dispatch brief.
- Map (`.claude/maps/primary.map.md`, stamp `9481bc69`) read. Load-bearing finding used:
  **the `data-scrml-outlet` MARKER (never the tag) identifies the composition slot**, and `<outlet>`
  is a plain `kind:"markup"` node, not an AST type. Confirmed against source
  (`runtime-template.js:_scrml_nav_outlet` -> `querySelector("[data-scrml-outlet]")`). The map's
  explicit "`W-NAV-CHUNK-LOAD-FAILED` is NOT implemented" note is also still true at this base.
  Everything about the ESM arc is invisible to the map, as flagged.

---

## 2026-07-22 — STOP: the brief's central premise is FALSE (empirically, in a real browser)

### The premise under test

> "each-ids, cell-names and fn-names are assigned PER FILE … but `_scrml_each_renderers` and the cell
> store are SHARED classic globals … **Module scope dissolves that** — hence the loader is built on
> the **esm path only**." (S279 ruling, Option B; restated in `docs/known-gaps.md`
> `g-navigate-soft-nav-full-reload`.)

### What is actually true

Module scope dissolves the **lexical** collision only (two chunks each declaring a top-level
`function _scrml_each_render_9` / `const Phase_toEnum` — gap `g-nav-chunk-lexical-collision`).

It does **not** dissolve the collision the S279 ruling describes, because the colliding state does not
live in the chunks. It lives in the **runtime**, and under `--module-format=esm` the runtime is a
single ES module that every chunk imports — a **singleton by design**:

- `compiler/src/runtime-template.js:2129` — `const _scrml_each_renderers = {};`
- the reactive cell store (`_scrml_state`, keyed by the *source-level* cell name) — same module.

Chunks write those registries through **member expressions on an imported binding**
(`_scrml_each_renderers["each_9"] = …`, `_scrml_reactive_set("rows", …)`), which is perfectly legal
under ESM and completely unguarded — `emit-client-esm.ts`'s fail-loud
`SHARED_MUTABLE_RUNTIME_GLOBALS` scan only inspects **bare-identifier** assignment targets
(`collectAssignmentTargets` skips `MemberExpression` by design, `emit-client-esm.ts:235`).

### Reproduction — real Chromium, real emitted artifacts

Fixture (an outlet-bearing shell + two routes that both contain an `<each>`, i.e. exactly the R26
symptom-check shape from the dispatch brief):

```
fx/index.scrml        <program> … <outlet/> …          (shell)
fx/pages/alpha.scrml  <page> <rows> = ["a1","a2"] <ul><each in=@rows><li>${@.}</li></each></ul>
fx/pages/beta.scrml   <page> <rows> = ["b1","b2"] <ul><each in=@rows><li>${@.}</li></each></ul>
```

`scrml compile fx -o fx-esm --module-format=esm` (clean; 1 warning, 2 ghost-pattern lints).

Emitted artifacts — **identical identifiers, different data**:

| | `alpha.client.js` | `beta.client.js` |
|---|---|---|
| render fn | `function _scrml_each_render_9()` | `function _scrml_each_render_9()` |
| fence lookup | `_scrml_find_each_anchor(document, 9)` | `_scrml_find_each_anchor(document, 9)` |
| registry write | `_scrml_each_renderers["each_9"] = …` | `_scrml_each_renderers["each_9"] = …` |
| cell write | `_scrml_reactive_set("rows", …["a1","a2"])` | `_scrml_reactive_set("rows", …["b1","b2"])` |
| DOM fence | `<!--scrml-each:9-->` in `alpha.html` | `<!--scrml-each:9-->` in `beta.html` |

Cause confirmed at source: `ast-builder.js:18125` — `const counter = { next: 0 };` inside `buildAST`,
which runs **per file**. (Note: `examples/23-trucking-dispatch` does *not* collide — its pages differ
in node count, so the ids happen to miss each other. Absence of collision there is luck, not design;
a two-route app with symmetric routes collides immediately, as above.)

Harness: `scratchpad/premise-check.mjs` — Bun static server + **puppeteer against the installed
Chromium 146.0.7680.153** (`/home/bryan/.cache/puppeteer/chrome/linux-146.0.7680.153/chrome-linux64/chrome`;
puppeteer's own default resolved to an uninstalled 150.x, so the path is pinned explicitly). It loads
the real `alpha.html` (`waitUntil: networkidle0`, all three `type="module"` scripts executed by the
browser), then performs **exactly the operation a U4 `import()` loader performs for a cross-chunk
target** — `await import("./beta.client.js")` into the live document — and re-reads the DOM.

Result (verbatim):

```
alpha BEFORE import : {"rows":["a1","a2"],"h2":"Alpha"}
alpha AFTER  import : {"rows":["b1","b2"],"h2":"Alpha"}
console/page events : [http 404] http://localhost:38307/favicon.ico
VERDICT: alpha's rendered rows WERE CLOBBERED by beta's chunk (module scope did NOT isolate)
```

No page errors, no module link errors; the only 404 is `favicon.ico`. Route A's `<li>`s render route
B's rows, **in route A's own fence, with no navigation at all** — the S279 symptom, reproduced on the
esm path, in a real browser.

### Two independent mechanisms, both live

1. **Cell store.** Both routes declare `<rows>`; the store is keyed by the source name in the shared
   runtime module. B's module-init overwrites A's cell and notifies A's still-subscribed effects.
2. **Each registry + fence id.** `_scrml_each_renderers["each_9"]` is one slot; `<!--scrml-each:9-->`
   is one id. `_scrml_find_each_anchor(document, 9)` scans the **whole document** and returns the
   first match, so B's renderer targets A's fence.

### A third problem `import()` introduces that `<script>` injection did not

`import()` evaluates a module **at most once** per URL. A → B → A cannot re-run A's module-init, so
A's cells can never be re-seeded from A's chunk after B clobbered them. The classic
`createElement("script")` injector could at least re-execute. On this axis `import()` is *worse* than
the machinery the brief asks it to supersede — the opposite of the brief's assumption.

### Verdict

**Refused to build.** Landing the U4 loader as briefed would ship a soft-nav that is broken by
construction for the exact scenario named as its own acceptance test ("navigate between two routes
that BOTH contain an `<each>`, navigate BACK, confirm route A still renders A's rows"). It would fail
that test on the esm path for the same reason it failed on classic.

### What the real gate is

`docs/known-gaps.md:2773` already states the constraint correctly in its second disjunct:

> "cross-chunk nav requires per-module chunk scope (esm) **OR** per-chunk id/cell namespacing"

The first disjunct is the falsified one. **Per-chunk id/cell namespacing is required, and it is
required regardless of module format.** Concretely, a prerequisite unit must make the following
compile-unit-unique (or route-chunk-scoped) rather than per-file:

- markup node ids (the `<!--scrml-each:N-->` fence id and `each_N` registry key) — `ast-builder.js`
  `counter`, currently reset per `buildAST` call;
- reactive cell names as used for the runtime store key;
- any other per-file-numbered runtime-registry key with the same shape (fn-name mangling, mount ids).

That unit is a codegen-wide change that moves classic bytes, so it cannot ride inside U4's
"classic stays byte-identical" constraint and must be scoped and ruled on separately.

**Corollary worth surfacing:** because the blocker is orthogonal to module format, fixing it also
unblocks the HELD Wave-1c classic loader. S279's Option B did not remove the blocker; it relocated
the same blocker onto the esm path. The choice between classic and esm for the loader is a real
choice, but it is not the thing that decides soundness.

### Not touched

No compiler source, runtime, SPEC, or test file was modified. Nothing to keep byte-identical, because
nothing was emitted differently. The only tracked change in this branch is this log.
