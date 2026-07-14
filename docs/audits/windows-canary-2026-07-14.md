---
status: current
last-reviewed: 2026-07-14
author: pjoliver11 (Peter) — Windows canary session
baseline: origin/main 7bb9e58 (S253) · CI gate green · conformance 433/433 (Linux)
env: bun 1.3.14 · node v24.17.0 · MINGW64_NT-10.0-26200 (Windows 11)
---

# Windows canary pass — findings (2026-07-14, Peter's clone)

> **Why this doc exists:** Peter's Windows clone is the sole non-Linux path; bryan + CI are Linux/Mac,
> so OS-path (`\` vs `/`) bugs (the #25/#26 class) only surface here. This is a read-only canary pass —
> NO `main` changes were made. Next round picks up from here. Uncommitted-pending: Peter to review +
> decide whether to commit / route to bryan / open issues.

## TL;DR
Ran the pre-commit gate suite (unit+integration+conformance) on Windows: **17953 pass · 54 skip · 1008 fail.**
The failures collapse to a small set of root causes, NOT 1008 bugs. The compiler *core* is mostly
Windows-clean; fragility is concentrated in 4 spots + the test suite itself.

| # | Finding | Confidence | Kind | Fix / next |
|---|---|---|---|---|
| A | Test harness `testDir` doubled-drive → `EPERM mkdir 'C:'` | **CONFIRMED** | test-infra | `.pathname` → `fileURLToPath`; 143 files |
| B | `#25` `pages/` strip skipped on Windows → route 404 | **CONFIRMED (repro)** | compiler | normalize sep before strip (api.js:2724-2729) |
| C | `scrml:path` stdlib leaks OS separators | **CONFIRMED impl** | **spec fork (R2)** | rule POSIX vs OS-native → maybe `path.posix` |
| D | path-KEY normalization (module-resolver diagnostics, output-map lookups) | **AMBIGUOUS** | compiler? / test-key? | repro module-resolver cycle to split |
| E | mpa-shell emits absolute `C:\...` into HTML | candidate | compiler? | repro the `<program>`-shell shape |
| F | 18 POSIX-path test assumptions | n/a | test-only | non-portable tests, not defects |

---

## A — Test-harness doubled-drive bug (~914 of 1008 fails, INFRA)
143 test files compute:
```js
const testDir = dirname(new URL(import.meta.url).pathname);   // conf-*.test.js, integration/*
```
On Windows `.pathname` = `/C:/Users/.../conformance` (leading-slash drive, fwd slashes). Then
`resolve(testDir, "_tmp_x")` = `C:\C:\Users\...\_tmp_x` (**doubled drive**) → `mkdirSync(...,{recursive:true})`
walks to the phantom `C:` → `EPERM: operation not permitted, mkdir 'C:'`. Invisible on Linux/Mac
(`.pathname` == fs path there). Same root cause also breaks:
- `git -C /C:/Users/.../integration rev-parse` (self-host / self-compilation tests — POSIX path to git)
- double-drive `Cannot find module C:\C:\...` (self-host-meta-checker, self-host-module-resolver)

**Verified:** `fileURLToPath("file:///C:/.../conf-AUTH-001.test.js")` → correct `C:\Users\...\conformance`.
**Fix:** `new URL(import.meta.url).pathname` → `fileURLToPath(import.meta.url)` (import from `node:url`), or
`import.meta.dirname`. Mechanical across **143 files** (131 files already use the safe form — mixed codebase).
**Impact:** the conformance gate is NON-RUNNABLE on Windows → the canary can't run the gate it's meant to run.

## B — #25 CONFIRMED: `pages/` strip breaks routing on Windows (COMPILER)
`pathFor` in `compiler/src/api.js:2703-2732`:
```js
const relDirRaw = dirname(relative(outputBaseDir, filePath));   // Windows: "pages\customer" (backslashes!)
let relDir = relDirRaw;
if (relDirRaw === "pages") { relDir = "."; }
else if (relDirRaw.startsWith("pages/")) { relDir = relDirRaw.slice("pages/".length); }  // <-- fwd-slash literal → FALSE on Windows
```
`path.relative` returns **OS-native backslashes** on Windows. The `pages/` strip's `startsWith("pages/")`
compares against a forward-slash literal → false on `"pages\customer"` → **strip skipped** → files land at
`dist/pages/customer/home.html` while route URLs are inferred `/customer/home` (§47.9.2) → **404 at serve.**

**Trigger condition (why it hides):** only fires when a **top-level file** (e.g. `app.scrml`) forces
`computeOutputBaseDir` up to the ROOT, so the relative path *includes* the `pages/` prefix. A pure `pages/`
dir compiles fine (base lands AT `pages/`, nothing to strip). This is THE canonical multi-page app shape
(`examples/23-trucking-dispatch`: `app.scrml` + `pages/`).

**Repro (embedded below as repro-1c.mjs):** on Windows →
```
computeOutputBaseDir: "C:/Users/.../repro-1c-canary"   (root, fwd slashes)
relative(base, c):     "pages\customer\home.scrml"     (backslashes)
WROTE: /pages/customer/home.html   ← wrong (should be /customer/home.html)
customer/home.html exists: false   pages/customer/home.html exists: true   ❌
```
**Fix:** normalize `relDirRaw` separators before the strip, e.g.
`const relDirRaw = dirname(relative(outputBaseDir, filePath)).split(/[\\/]/).join("/");`
(or `.replaceAll("\\","/")`). Then `=== "pages"` / `startsWith("pages/")` work cross-platform.
**Note:** same root cause explains `mpa-shell-clean-urls.test.js` `reference/index.html` non-emission.
**Adversarial-verify gate (contract §8):** any fix here needs the S239 adversarial review + a conformance
case pinning the Windows behavior — but conformance can't run on Windows until A is fixed. So **A likely
gates B's verification.**

## C — scrml:path stdlib leaks OS separators (SPEC FORK — R2, needs a ruling)
`compiler/runtime/stdlib/path.js:20` — `import nodePath from "node:path"` (OS-native). So on Windows:
`join("src","index.js")` → `"src\index.js"`; `normalize`, `relative`, `resolve` all leak backslashes.
The file header claims "**cross-platform** path utilities"; the tests (`stdlib-path.test.js`, ~12 fails)
expect POSIX (`src/index.js`, `/usr/bin`). Internal inconsistency.
**THE RUNG (R2 fork — bryan/Peter rule, PA does not gut-decide):** should `scrml:path` be
(i) POSIX / web-portable (→ switch impl to `path.posix`, tests stay) or
(ii) server-fs-native (→ the POSIX tests are wrong)?
For a web language, (i) is the lean, but it changes what the stdlib module fundamentally guarantees →
axiom-ish → belongs to the user. Cross-ref: `stdlib/path/index.scrml` (the scrml-source mirror) intent +
§12.2 SERVER_ONLY classification.

## D — path-KEY normalization cluster (AMBIGUOUS — 1 repro splits it)
Failures (~30 across files): `module-resolver.test.js` — cycle detection + `E-IMPORT-002/004` diagnostics
**NOT firing**, re-export `kind` not collapsing (stays `"re-export"`), topo order wrong; plus
`htmlFor/outFor/htmlByFile(result,"routes/index.scrml") → undefined` (multipage-multirole,
cross-file-expansion, m6.4a, w3-splitter, test-bind); plus `serverJs → ""` (inline-sql-in-branch-cps,
channel-server-fn-write, s144-server-fn-nested-block-lowering).
**Hypothesis:** the compile-result output-map + the import graph are keyed by OS-native (backslash) paths,
so POSIX-form lookups miss → undefined outputs + unmatched graph edges → no cycle detected, no diagnostics.
**Why it matters / why confirm:** if only the *tests* use POSIX keys → test bug. If the compiler's own
edge-matching misses → **real correctness bug (Windows users silently miss import-cycle / invalid-import
errors).** #26 was ALSO a module-resolver Windows bug → this area is genuinely fragile.
**NEXT REPRO (do this first next round):** build a real 2-file import cycle on Windows, run the resolver
API directly (mirror `module-resolver.test.js §B/§G`), check whether `E-IMPORT-002` genuinely fails to
fire (real bug) or the test just feeds POSIX keys the resolver stores as backslash (test bug).

## E — mpa-shell absolute `C:\...` paths in HTML (CANDIDATE — needs shell repro)
`mpa-shell-clean-urls.test.js` shows `<script src="C:\Users\pjoli\...\app.client.js">` instead of a
relative `src="app.client.js"`. Did NOT reproduce in the `compile-output-tree` shape (my repro-1c HTML was
correctly relative `src="app.client.js"`) — the `<program>`-shell codepath differs. Serious if real
(broken asset URLs on any Windows-built shell app). **NEXT REPRO:** compile a `<program>`-shell + nested
`pages/` app on Windows, grep emitted HTML for `src="[A-Za-z]:\`.

## F — Test-only POSIX assumptions (18, NOT compiler bugs)
`computeOutputBaseDir` tests hardcode `/a/b`, get `C:/a/b` (compiler logic verified working via
repro-tree.mjs: `a/home.html` + `b/home.html` written correctly); `dev-hot-reload` `deriveWatchFiles`
expects `/proj/...`; `findOutputFiles` `endsWith` sep mismatch; `input-state-read-path-bug-ac` sample-path;
`p3-follow` allowlist keyed POSIX. Non-portable tests — fix by normalizing the test's expected/actual, or
skip on Windows. Low priority.

---

## Queued for next round (priority order)
1. **Confirm D** (module-resolver cycle repro) — highest correctness stakes; splits real-bug vs test-key.
2. **Confirm E** (mpa-shell HTML absolute-path repro).
3. **Rule C** (scrml:path POSIX-vs-OS-native) — bryan/Peter fork.
4. **Land A** (143-file harness fix) — unblocks running the gate on Windows; prerequisite to verifying B/D
   via conformance. Mechanical, Linux-safe.
5. **Land B** (#25 pages/-strip normalization) — needs A first (adversarial + conformance gate).
   NB landing anything needs coordination with bryan's `main` authority (commit-lock) OR Peter with
   explicit authz + S254 board registration + lock acquire.

## Reproduction assets (scratchpad was session-isolated — scripts embedded here to survive)

### repro-1c.mjs — #25 confirmation (finding B)
```js
import { compileScrml, computeOutputBaseDir } from "file:///C:/Users/pjoli/Documents/GitHub/scrml/compiler/src/api.js";
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "fs";
import { join, relative, dirname } from "path";
import { tmpdir } from "os";
const TMP = join(tmpdir(), "repro-1c-canary");
rmSync(TMP, {recursive:true, force:true});
function fx(rel){ const abs=join(TMP,rel); mkdirSync(join(abs,".."),{recursive:true}); writeFileSync(abs,'h1 "fx"\n'); return abs; }
const app = fx("app.scrml"), c = fx("pages/customer/home.scrml"), v = fx("pages/driver/home.scrml");
const outDir = join(TMP, "dist");
const base = computeOutputBaseDir([app,c,v]);
console.log("base:", base, "\nrelative:", relative(base,c), "\ndirname:", dirname(relative(base,c)));
const result = compileScrml({ inputFiles:[app,c,v], outputDir: outDir, write:true, log:()=>{} });
console.log("errors:", (result.errors||[]).map(e=>e.code||e.message));
console.log("customer/home.html:", existsSync(join(outDir,"customer/home.html")), "(want true)");
console.log("pages/customer/home.html:", existsSync(join(outDir,"pages/customer/home.html")), "(want false)");
// Run: bun repro-1c.mjs   → shows files land under dist/pages/ (bug)
```

### Suite re-run command (finding A + full triage)
```
bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance > winsuite.log 2>&1
# then: grep -c "EPERM: operation not permitted, mkdir 'C:'" winsuite.log   (finding A count)
#       grep -E "^\(fail\)" winsuite.log | grep -v mkdir                     (genuine fails)
```
