# DISPATCH BRIEF — 0a/0b: standalone-tool library imports + `<foreign lang>` CLI library-mode

**Change-id:** `g-tool-import-drop-foreign-lang-cli-mode-2026-07-04`
**Dispatched:** S239 (2026-07-04). **Agent:** scrml-js-codegen-engineer, isolation:worktree.
**Two COUPLED gaps** (flogence Surface-2 CLI R26). Both block flogence's 100%-scrml port of `fleet --route` (a `kind="tool"` that imports fsp-core + a `<foreign lang>` lib). Fix BOTH in one landing — they share files (`api.js`, `ast-builder.js`, `emit-tool.ts`, `codegen/index.ts`).

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (S88/S90/S99/S126)

Your worktree path is under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.

## Startup verification (BEFORE any other tool call)
1. `pwd` via Bash. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it's under any OTHER repo (e.g. `scrml-support/.claude/worktrees/`) STOP and report — S90 CWD-routing failure. Save the output as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `bun install` — worktrees don't inherit node_modules (pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
5. `bun run pretest` — populates `samples/compilation-tests/dist/` (gitignored; browser tests need it). Use `bun run test` (chains pretest) NOT bare `bun test` for full-suite baselines.

## Path discipline (S99/S126 — leak class has hit 15+ times)
- **Apply ALL file edits via Bash** (`perl`/`python3`/heredoc/`cp`) on **worktree-absolute paths that include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools, NOT main-rooted absolute paths. Echo the target path before each write; `git diff`/`grep` after to verify.
- **NEVER `cd` into the main repo** (or anywhere). Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively. A `cd` leaks the S90 CWD-routing class even for Bash edits.
- Your first commit message MUST include the verbatim `pwd` output: `WIP(tool-imports): start at $(pwd)`.
- Translate any main-rooted path from this brief (e.g. `compiler/src/api.js`) to `$WORKTREE_ROOT/compiler/src/api.js` before writing.

## Commit discipline (S83) — incremental, per-fix
- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` → `git -C "$WORKTREE_ROOT" add <file>` → commit IMMEDIATELY. Don't batch.
- Before reporting DONE: `git -C "$WORKTREE_ROOT" status` MUST be clean. "work in worktree, no commits" is NOT an acceptable terminal report.

---

# MAPS
`.claude/maps/primary.map.md` is ~12 commits STALE (watermark `66a3afb1`; S238 CSRF/typer/tool-impls not reflected). **This brief gives you exact fire sites — treat any map content as a starting hypothesis to verify via `dock`/grep/Read against current source, not ground truth.** Read primary.map.md's Task-Shape Routing for "compiler-source bug fix" if useful, but the fire sites below are authoritative.

Use `bun scripts/dock.ts --units <file>` (S227 investigation-as-query) to enumerate the real def-extents of each file you touch BEFORE editing (anti-blind-grep); declare your OWNED blocks; run `bun scripts/dock.ts --diff-scope <base>..HEAD --owns <blocks>` post-landing to catch strays.

---

# SPEC (Rule 4 — SPEC is normative)
- **§64** Standalone Tool Target (`<program kind="tool">` — plain runnable module, no html/client/CSRF/routes). Read it IN FULL before touching emit-tool.ts.
- **§23.6** Library Foreign-Language Declaration (`<foreign lang="ts" />` — the library complement of `<program lang=>`). Read before the CLI mode-detect fix.
- **§21.5 / §21.8** pure-fn module + cross-file import shapes.
Verify every claim below against the SPEC text; if the SPEC contradicts this brief, the SPEC wins — surface it.

---

# THE TWO GAPS + VERIFIED REPRODUCERS

Both reproduce on live HEAD (`6f8adc5c`) via the CLI (`bun compiler/src/cli.js compile <file>`). The §23.6/§64 tests drove the `compileScrml({mode})` **API**; flogence consumes via the **CLI** — API-green but CLI-broken. **Your R26 MUST exercise the CLI, not just the API.**

## Blocker B — `g-foreign-lang-cli-mode-detect` (the SURGICAL one)
A `<foreign lang="ts" />` library compiled via the CLI falls to BROWSER mode → export null-stubbed, no `lib.js`.

**Root:** the CLI has no `--mode library`; its only route to library mode is the W5a auto-detect predicate at `compiler/src/api.js:1199-1224`. The predicate (`:1211-1216`) requires `nodes.every((n) => n && n.kind !== "markup")`. A top-level self-closing `<foreign lang="ts" />` IS a markup node (`kind:"markup", tag:"foreign"`) → predicate false → auto-detect skips → browser mode. (`<db src>` survives because its `${}` children are the top-level nodes; a bare `<foreign lang>` is itself a top-level markup node.) The sibling `isPureModuleFile` in `compiler/src/ast-builder.js:17756` has the same `nodes.every(n => n.kind !== "markup")` shape.

**Fix (small + local):** teach BOTH predicates to treat a top-level `<foreign lang>` node (markup, tag:"foreign", carrying a `lang=` attr) as a **library-context declaration**, NOT disqualifying markup — the same tolerance `<db src>` effectively gets. Do NOT admit arbitrary markup — only the `<foreign lang>` library-decl form (mirror how §23.6 defines it).

**Repro (`lanes.scrml`):**
```
<foreign lang="ts" />
${ export fn runOpen(model, prompt) { const out = _={ in: { model, prompt } model + " " + prompt }= return out } }
```
- BEFORE: `compile lanes.scrml --verbose` → `[mode: browser (auto)]`, emits `lanes.client.js`/`lanes.server.js`/`lanes.html`, export null-stubbed (`const out = null; // foreign-init …`), NO `lanes.js`.
- AFTER (success): `[MODE] auto-detected library` fires → emits a runnable `lanes.js` with a real `runOpen` export, `_{}` lowered, no browser artifacts.

## Blocker A — `g-tool-import-drop` (A1 emit-imports + A2 lib-must-emit-runnable-.js)
A `<program kind="tool">` that imports from a `.scrml` lib emits a `tool.js` that REFERENCES the symbol but emits NO `import` statement → `ReferenceError` at runtime.

**Root A1 — no import emission:** `compiler/src/codegen/emit-tool.ts` `generateToolJs` builds a db-handle header + runtime-helper header but NEVER consults `fileAST.imports`. Import nodes are dropped. (A normal browser `<program>` wires imports via the `_scrml_modules[...]` runtime registry — see `emit-client.ts:48`; a standalone tool has NO registry, so it needs REAL ES `import` statements.)
- Import AST shape (`ast-builder.js:10203`): `{ kind:"import-decl", raw, span, names:[], specifiers:[{imported, local, pinned}], source, isDefault }`. `source` = the raw import path (e.g. `"./libpure.scrml"`).
- **Fix A1:** in `generateToolJs`, build an import header from `fileAST.imports`: emit `import { <local> } from "<source .scrml→.js>";` (named + default forms). `pinned` is a scrml binding-modifier — irrelevant to the ES import shape (drop it). Map the `.scrml` source to `.js` (the tool imports the runnable lib artifact). `scrml:NAME` stdlib imports must pass through unchanged so `rewriteStdlibImports` (api.js:578) rewrites them at the write path — confirm they're preserved. NOTE: `rewriteRelativeImportPaths` (api.js:531) only matches `.js` specifiers and rewrites dist-relative paths — so emit `.js` directly; it will fix the relative path when outDir≠srcDir.

**Root A2 — imported lib doesn't emit a runnable `.js` in a tool build:** `generateLibraryJs` runs ONLY when the build-wide `mode === "library"` (codegen/index.ts:921); `toolJs` emits per-file unconditionally via `isToolProgram` (codegen/index.ts:893; `isToolProgram` at `tool-program.ts:115`). A mixed build (tool + imported lib) → `allPureFnModules` false (the tool isn't a pure-fn module) → mode=browser → the imported lib emits `lib.client.js`/`lib.server.js`, NO `lib.js`. So the tool's `import "./lib.js"` points at a non-existent file.
- **Fix A2:** in a build that contains a `kind="tool"` entry, an imported library-shaped `.scrml` dependency must emit its **library module (`lib.js`)** — route it through `generateLibraryJs` regardless of the build-wide browser mode. **SURVEY-FIRST (S59 depth-of-survey discount):** find the cleanest per-file hook. **HARD CONSTRAINT: do NOT change browser-app import behavior** — a normal browser `<program>` importing a lib relies on `clientJs` + the `_scrml_modules` registry (emit-client.ts); that path MUST stay byte-identical. The A2 library-emit is scoped to a tool's imported deps. **If A2 genuinely requires decoupling the build-wide `mode` flag into a large refactor, STOP and report** — do not force a big architecture change blind; a localized "emit libraryJs for a library-shaped file when the build has a tool entry" is the target.

**Repro A (`libpure.scrml` + `toolpure.scrml`, same dir):**
```
// libpure.scrml
${ export fn addup(a, b) { return a + b } }
```
```
// toolpure.scrml
<program kind="tool" lang="ts">
import { addup } from "./libpure.scrml"
function main(args: string[]): number {
  const n = addup(2, 3)
  _={ in: { n } console.log("sum=" + n) }=
  return 0
}
</program>
```
- BEFORE: `compile toolpure.scrml` → `dist/toolpure.js` has `const n = addup(2, 3);` with NO `import addup` → `bun dist/toolpure.js` throws `ReferenceError: addup is not defined`. `dist/libpure.client.js`/`.server.js` emit, NO `dist/libpure.js`.
- AFTER (success): `dist/toolpure.js` has `import { addup } from "./libpure.js";`; `dist/libpure.js` exists (runnable); `bun dist/toolpure.js` prints `sum=5`, exit 0.

## Flag C — cross-import await-coloring (verify AFTER A+B)
A `<foreign lang>` lib fn compiles to `export async function`. A tool that calls it emitted `const msg = greet(who)` UNAWAITED (the tool's `computeAsyncFnNames` in emit-tool.ts scans only LOCAL fn bodies; imported async fns aren't in `fns`, so the caller isn't marked async and the call isn't awaited). AFTER A+B wire the import: verify a tool calling an async imported lib fn `await`s it. If it doesn't, propagate await-coloring across the import boundary (localized fix — the tool must know which imported names are async). If it needs more than a localized fix, surface it (don't over-reach — flag C was "likely moot until A wires the import").

---

# VERIFICATION (mandatory before DONE)

## Phase 3 — R26 empirical (S138), via the CLI (flogence's real path)
Re-compile the repros above on your post-fix baseline and CHECK THE EMITTED JS + RUN IT:
1. `bun compiler/bin/scrml.js compile <repro> --verbose` (or `compiler/src/cli.js`) for each of: lanes.scrml (B), libpure+toolpure (A), and a COMBINED case (a tool importing a `<foreign lang>` lib — A+B+FlagC).
2. B: assert `[MODE] auto-detected library` fires + `lanes.js` emitted with real export.
3. A: assert `toolpure.js` has `import { addup } from "./libpure.js"` + `libpure.js` exists + `bun dist/toolpure.js` prints `sum=5` exit 0.
4. Flag C: assert the tool awaits the async imported fn.
Put the repros in the worktree's scratch, NOT in main. **DO NOT mark DONE without R26 passing on the CLI.**

## Adversarial (S215) — MANDATORY (this is codegen; adjacent shapes matter)
Enumerate the import-emit blast radius and construct edge repros: default import (`import X from "./m.scrml"`), aliased (`import { a as b }`), multiple named, pinned import, a tool importing a stdlib `scrml:` module (must still route via rewriteStdlibImports), a tool importing BOTH a lib AND `scrml:`, a tool with NO imports (must stay byte-identical), a `<db src>` lib import (already library-mode-detectable). Run `/code-review` high on the diff. Land only if adversarial is clean.

## Full suite (S198 brief-template)
Run the FULL `bun run test` (NOT just the pre-commit subset — the within-node parity canary + browser/lsp live only in the full suite). This touches codegen; if any within-node fixture goes OVER-BUDGET (`[within-node] OVER-BUDGET <relpath>: {...}`), re-baseline the `M6.5.b.0` allowlist entry to the printed `raw` values IN THE SAME LANDING (in-place, preserve key order). Report final pass/skip/fail counts.

---

# SCOPE FENCE
- **IN:** api.js W5a predicate (B) + isPureModuleFile (B) + emit-tool.ts import-emit (A1) + the per-file library-emit-in-tool-build hook (A2) + cross-import await-coloring (Flag C) + §34/§64/§23.6 SPEC prose updates if a claim changes + tests + conformance case(s).
- **OUT (do NOT touch — serialized behind this):** type-system.ts freeze-blockers (fail-variant-arity, hostmethod-poison); clean-print primitive; E-ROUTE-001-on-tool. If you find yourself in type-system.ts, STOP.
- Add `<foreign>` to `attribute-registry.js` ONLY if the B fix empirically needs it (the gap says empirically no leak today — don't add speculatively).

# REPORT (final)
WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · the R26 CLI transcript (before/after emitted JS + `bun` run output for each repro) · full-suite counts · `/code-review` result · dock owned-blocks + stray-check · any A2 architecture surface you hit + how you resolved it · deferred items. Maps: "consulted [list]; load-bearing finding: <one sentence>" or "not load-bearing."
