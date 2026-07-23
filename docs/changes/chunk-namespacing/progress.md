# progress — chunk-namespacing

Append-only. Timestamps UTC.

## 2026-07-22T?? — start

Startup at `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a91ad13968b46ab5d`,
base `e8fdd44c`, tree clean, `bun install` + `bun run pretest` OK.

Fetched the collision repro from `origin/evidence/u4-premise-falsified` into
`docs/changes/esm-chunks/u4-premise-check/`. Its `executablePath` was pinned to
`/home/bryan/.cache/...` which does not exist here (the real home is
`/home/bryan-maclee`), so the harness now resolves Chromium via `$SCRML_CHROME`
else the first build under `$HOME/.cache/puppeteer/chrome`.

BASELINE (esm) reproduced verbatim:

```
alpha BEFORE import : {"rows":["a1","a2"],"h2":"Alpha"}
alpha AFTER  import : {"rows":["b1","b2"],"h2":"Alpha"}
VERDICT: alpha's rendered rows WERE CLOBBERED by beta's chunk (module scope did NOT isolate)
```

## N1 — LANDED (node-id-derived tokens)

Implemented at EMISSION, not at id allocation. The brief's DONE-PROBE greps
`ast-builder.js` for the token, which assumes the other approach: mutate what
`counter.next` produces at all 205 allocation sites. That was rejected on
correctness grounds — `node.id` is a number carried through the whole AST and
used for identity, ordering (`emit-ssr-render.ts` sorts on it) and diagnostics.
Making it a namespaced string would have a blast radius far past codegen. The
namespace belongs where a unit-local id becomes a PROCESS-GLOBAL token, which is
the emitter. `nsId(node.id)` at ~12 sites replaces 205.

Files: `codegen/chunk-namespace.ts` (new), `emit-each.ts`, `emit-match.ts`,
`emit-ssr-render.ts`, `emit-server.ts`, `emit-html.ts`, `emit-logic.ts`,
`codegen/index.ts`.

State install/reset is at the top of BOTH per-file loops in `codegen/index.ts`
and a reset when the main loop ends. The reset is load-bearing, not hygiene:
without it, ~17 emitter unit tests that drive synthetic ASTs in the same process
inherit whichever file compiled last.

## N2 — BUILT, PROVEN, HELD OUT OF THE EMIT PATH

`codegen/cell-namespace-pass.ts` — one Acorn-located, text-spliced pass over the
assembled chunk. Not the 189 emission lines across 23 modules: a
half-namespaced store is worse than none, and a per-site fix re-opens the moment
anyone adds an emitter. Not a regex either — `_scrml_reactive_get("rows")` occurs
inside runtime doc comments today and could occur inside author string data
tomorrow.

### It works. Executed, both module formats, real Chromium:

```
esm     BEFORE   alpha AFTER import : {"rows":["b1","b2"]}   CLOBBERED
esm     AFTER    alpha AFTER import : {"rows":["a1","a2"]}   SURVIVED
classic BEFORE   alpha AFTER import : {"rows":["b1","b2"]}   CLOBBERED
classic AFTER    alpha AFTER import : {"rows":["a1","a2"]}   SURVIVED
```

The classic BEFORE line is the classic harness mode run against the PRE-FIX
artifacts, so the AFTER green is not vacuous.

### Why it is not wired: a scope finding PA needs to rule on

SCOPING §3 measured N2 as "cell-store key sites — emit-client.ts 28,
runtime-template.js 64". The real surface is:

| measured here | count |
|---|---|
| codegen emission lines minting a cell key | **189** across **23** modules |
| runtime entry points whose first arg IS a store key | **33** |
| test files pinning the bare key | **198** |
| test assertions pinning the bare key | **~1210** |
| new test failures when the pass is wired | **1209** |

The assertions are of the form
`expect(clientJs).toContain('_scrml_reactive_get("items")')` — 604 of them carry
the closing paren, so NO placement of the token inside the quotes (prefix or
suffix) leaves them passing. They treat the bare key as the observable lowering
contract.

Bulk-rewriting 1209 assertions would launder any real regression hiding among
them, which is exactly what the S239 adversarial-verify rule exists to prevent.
So the pass is held out of the emit path (one line in `codegen/index.ts`, marked
`To enable:`) rather than landed red.

### The fork

**Shape A — key prefix (implemented, proven).** `_scrml_reactive_get("<token>$rows")`.
Correct, exhaustive, artifact-diff clean. Cost: a 198-file test migration. The
intent-preserving form of that migration is to fold the token out of the
compiler OUTPUT at each test's read site (assertions stay verbatim; the
chunk-identity axis they never covered gets its own tests, already written) —
NOT to rewrite the assertions. Roughly 198 one-line-ish edits, varied in shape,
plus a full-suite verification loop.

**Shape B — chunk-local accessor shadowing (NOT implemented; needs review).**
Leave the emitted key BARE and wrap the chunk body in a scope whose prologue
shadows the accessors:

```js
(function () {
  // cell reads/writes are scoped to this chunk's slice of the store
  const _scrml_reactive_get = (n) => _scrml_store_get("a1b2c3d4", n);
  const _scrml_reactive_set = (n, v) => _scrml_store_set("a1b2c3d4", n, v);
  ...                                  // the existing chunk body, UNCHANGED
  _scrml_reactive_get("rows")          // byte-identical to today
})();
```

Near-zero assertion churn, and arguably MORE readable (author cell names survive
in the body). The machinery exists: `codegen/index.ts:469 wrapClientBodyInIife`
already wraps cross-file-linked classic chunks, per known-gaps-#6 (S152).

Hazards that make this a review item rather than an improvisation:
  - that IIFE is CONDITIONAL today (`isCrossFileLinked`) precisely because
    wrapping hides top-level declarations from the classic global lexical env —
    `_scrml_modules` registration, the `var session` singleton (Issue #15) and
    cross-chunk global sharing all live on that boundary;
  - the SSR seed side still needs REAL key namespacing regardless, because
    `_scrml_ssr_seed_apply` calls the GLOBAL `_scrml_reactive_set`, not the
    chunk-local shadow — so Shape B is a hybrid, not a pure alternative;
  - imported cells still need the owner map in the prologue.

Both shapes keep the RULED token (FNV-1a of the dist-relative source path,
base36, 8 chars) and always-on. The fork is about where the token is applied,
which is the same axis on which N1 already chose emission over ast-builder.

## OQ-3 artifact-diff gate — PASS

`docs/changes/chunk-namespacing/artifact-diff.mjs`, 10 corpora: **54 files
byte-identical, 10 differing BY TOKEN ONLY, ZERO non-token deltas.** The single
deliberate call-shape change is folded explicitly in the gate:
`_scrml_find_each_anchor(document, 9)` -> `(document, "9")` (the runtime already
concatenates the argument, so no runtime change was needed).

## Out of scope, but found: a THIRD colliding namespace

`docs/changes/chunk-namespacing/collision-scan.mjs` on two pages that both
declare `type Phase:enum` reports, after N1+N2:

```
topLevel     COLLIDING=3  ["Phase_toEnum","Phase_variants","Phase"]
cellKeys     COLLIDING=0
registryKeys COLLIDING=0
htmlMarkers  COLLIDING=0
```

Author-declared top-level names (types and their derived `_variants` /
`_toEnum` tables) collide in the CLASSIC global lexical env. Two chunks each
emitting `const Phase = ...` is a `SyntaxError: Identifier 'Phase' has already
been declared` — the SECOND chunk never evaluates at all. Same class as the
Issue #15 `_scrml_session` redeclaration that `emit-client.ts:1708` already
works around by hand.

This is NOT N1 or N2 and is outside the ruled design: these are AUTHOR-chosen
names, referenced across files through imports, so namespacing them is an
adopter-visible decision needing its own ruling. Filing it, not fixing it.
Note that Shape B above would close it incidentally (the IIFE makes those
declarations chunk-local), which is a point in its favour.


---

# S282 FIX ROUND (base `e8fdd44c`, branch `worktree-agent-a91ad13968b46ab5d`)

Every measurement below names the commit it was taken at. That discipline exists
because the previous report did not carry it: the `SURVIVED` premise-check table
was measured at `45e4c556` with N2 WIRED, then re-presented as the arc's
acceptance result after `1dc0a7ce` had held N2 back out.

## Where the four namespaces actually stand

| # | namespace | status at `HEAD` |
|---|---|---|
| N1 | numeric node ids | **CLOSED and wired** |
| N2 | reactive cell-store keys | **OPEN** — needs the ruled chunk-local scope |
| N3 | author top-level type names | **OPEN** — closed incidentally by that same scope |
| N4 | engine names | **OPEN, patch written and executed-verified, held** |

**The acceptance test therefore still CLOBBERS on this tree, under both module
formats.** The u4 fixture's collision is N2 (`<rows>` in both pages), and N2 is
open. Verbatim, measured at `HEAD` and at base:

```
BASE  e8fdd44c  esm      alpha AFTER import : {"rows":["b1","b2"]}   CLOBBERED
BASE  e8fdd44c  classic  alpha AFTER import : {"rows":["b1","b2"]}   CLOBBERED
HEAD            esm      alpha AFTER import : {"rows":["b1","b2"]}   CLOBBERED
HEAD            classic  alpha AFTER import : {"rows":["b1","b2"]}   CLOBBERED
```

## R2 / D1 / D3 — the anchor is now the PROJECT ROOT

`scrml.toml`, else `.git` (accepting both the directory and the worktree/submodule
FILE form), resolved once per build and memoized. Reproductions, both at `HEAD`:

- **D1** — two `home.scrml` in unrelated trees, compiled together:
  base `scrml-each:00rb1wn9_24` twice; now `005ft5t6_6` / `00mssdnh_6`.
- **D3** — the same three files as a DIR vs as an explicit file list: `00bnovk3_24`
  / `00jek2uh_24` in BOTH invocations. The token no longer moves with the input set.

### DEVIATION — the no-project-root tier

The ruling says an unresolvable root SHALL be a hard compile error. **Measured: as
literally written that fails 434 test files**, which compile fixtures from
`mkdtemp`/`/tmp` where neither marker exists. The third tier anchors at the
FILESYSTEM ROOT (the absolute path) instead.

This is not the degrade the ruling rejects. Its objection is that a degrade
*"reinstates the precise collision the ruling rejected basename for"* — and an
absolute path is strictly MORE injective than a project-relative one, never less;
two distinct files cannot share one. What is given up is cross-machine token
reproducibility, and only for files outside any project, where there is no shared
build to reproduce. `assertChunkTokensDistinct` is the real guarantee in every
tier. **Needs ratification or an override.**

## D2 — injectivity assert + the entropy correction

`assertChunkTokensDistinct` over the build's file set; `E-CG-018` on collision.
**`E-CG-018` needs a §34 catalog row, which I did not add** — the catalog is
normative SPEC and that is a PA/bryan call.

`fnv1a-hash.ts` corrected: **32 bits, not "~41"**. 36^7 (78,364,164,096) exceeds
2^32, so the 8th base36 digit is never needed and **every token begins with `0`**.
Consumers matching by shape must anchor on `0[0-9a-z]{7}`.

## D4 — the gate was hollow; it now compares 446 files

`walk()` recursed but re-anchored `relative()` on the SUBdirectory, so nested
files entered as bare basenames, `readFileSync` threw, and `catch { continue; }`
swallowed it. Every hollow-gate mode is designed out: the walk keeps the original
root, an unreadable file is a FINDING, a zero-file run FAILS, duplicate relative
paths are reported, and the compared count is printed.

Measured at `HEAD`, 10 corpora:

| corpus | walked | compared | identical | token-only | residual |
|---|---|---|---|---|---|
| 23-trucking-dispatch | 115 | 115 | 87 | 28 | **0** |
| website | 295 | 295 | 295 | 0 | **0** |
| 8 others | 36 | 36 | 26 | 10 | **0** |

23-trucking's 87/28/0 reproduces the reviewer's independent re-run exactly. The
fold regex is anchored to `0[0-9a-z]{7}_` and folds NAME-keyed tokens too.

## D5 — SPEC §22.10: the meta scopeId CANNOT be exempted

Investigated, not amended. `runtime-template.js:3068` resolves it with a
**document-wide** `querySelector('[data-scrml-meta="' + scopeId + '"]')`, and it is
also the key of the process-global `_scrml_cleanup_registry` plus the timer and
rAF registries (`:1332-1348`). Two pages each carrying a `^{}` block:

```
BASE e8fdd44c : data-scrml-meta="_scrml_meta_4"      (BOTH pages)
                _scrml_meta_effect("_scrml_meta_4"   (BOTH pages)
HEAD          : _scrml_meta_01a9vemp_4 / _scrml_meta_01c6hd7r_4
```

So alpha's `meta.emit()` writes into whichever placeholder the document holds
first, and the two blocks share cleanup/timer slots. Same cross-chunk class as
`data-scrml-each-mount` / `data-scrml-match-mount`, which have zero SPEC hits —
this one has a normative sentence. **Recommendation: amend §22.10:16342** to
`"_scrml_meta_<chunkToken>_N"`, or to a form that admits a namespace prefix. Not
mine to write.

## D6, D7, D8

- **D6** — the reset is in a `try/finally` around the emit loop. Body re-indent is
  whitespace-only; review with `git diff -w`.
- **D7** — `withChunkNamespace`, `nsCell`, `nsCellLiteral`, `stripCellNamespace` and
  the whole `cellOwners` machinery deleted, including the
  `importBindings x exportRegistry` walk (with a per-import lazy `require`) that ran
  on every file of every compile to build a Map nothing read.
  `cell-namespace-pass.ts` DELETED — R1 supersedes key-prefixing for N2.
- **D8** — normalizers anchored to `0[0-9a-z]{7}_` and made STRIPPING.
  `colon-shorthand-inside-opener-s154b.test.js` was the bad one: `_[0-9a-z]{8}_(\d+)`
  matched `_reactive_1` (`reactive` is itself 8 base36 chars), so `_scrml_reactive_1`
  became `_scrml_NS_1`, which the next pass could no longer collapse — a
  structural-identity test had silently become sensitive to the counter drift it
  exists to ignore. The browser selector is back to `$="_7"`.

## N4 — diagnosed, patched, EXECUTED, and then HELD

Bigger than the review found. `idPrefix: nsName(meta.varName)` covers the mount
attribute plus every derived render/wire/dispose/dispatch name, but **nine more
top-level consts** are minted by exported helpers keyed on the same author name:
`__scrml_engine_<var>_{transitions,timers,idle,msg_arms,internal_transitions,history_map,fire_hooks,once_N}`.
Namespacing inside each helper keeps the definition site and every lookup site in
agreement by construction.

Executed, real Chromium, classic, on `compiler/tests/fixtures/chunk-namespacing/engine/`
(beta deliberately uses a DIFFERENT type name with `var=phase`, so N3 cannot mask N4):

```
BASE e8fdd44c : [pageerror] Identifier '__scrml_engine_phase_transitions'
                has already been declared                    -> INCONCLUSIVE
patch applied : no page errors, alpha's mount untouched      -> isolated
```

**Held out of this landing.** R3 rules all four land together; N2 and N3 are not
built, so N4 alone does not complete the arc, and applying it costs a **28-file /
250-occurrence** test migration (measured) that would be spent now and re-reviewed
later regardless. The patch is one line per helper plus `emitEngineMountHtml`.

A finding worth keeping: **N3 masks N4 at base.** The first N4 run reported
`SURVIVED` only because beta's chunk threw `Identifier 'Phase_toEnum' has already
been declared` and never evaluated. `collision-exec.mjs` now scores any pageerror
as INCONCLUSIVE — a chunk that dies before its first statement leaves the page
pristine, so a before==after check false-greens. Execute-don't-grep, inverted.

## N2 — the chunk-local scope, designed but NOT built

The ruled mechanism and the five sub-problems it must solve, so the next round
implements rather than rediscovers:

```js
(function () {
  // cell keys in this chunk resolve into this chunk's slice of the shared store
  const { _scrml_reactive_get, _scrml_reactive_set } =
    _scrml_cell_scope("0a1b2c3d", { appPhase: "0eeeffff" });  // owner map
  ...                                    // the existing chunk body, UNCHANGED
  _scrml_reactive_get("rows")            // byte-identical to today
})();
```

1. **The IIFE must go unconditional.** `wrapClientBodyInIife` (`index.ts:469`) fires
   today only for cross-file-LINKED classic chunks — which is why shell+page
   composition, whose chunks coexist without importing each other, is the open hole.
   `--embed-runtime` needs a carve-out: it inlines the runtime, so wrapping would
   make the runtime's own declarations chunk-local.
2. **`_scrml_shell_cells` must escape.** The runtime probes it with
   `typeof _scrml_shell_cells !== "undefined"`; inside an IIFE it is invisible and
   the soft-nav shell-skip breaks.
3. **The SSR seed is a hybrid.** `_scrml_ssr_seed_apply` calls the GLOBAL
   `_scrml_reactive_set` with the seed's own keys, so the SERVER side still needs
   real key-prefixing, and it must agree with the chunk's scope.
4. **Imported cells need the owner map.** Lexical scope gets imported FUNCTIONS
   right for free (their bodies capture the exporter's scope), but a directly-read
   imported cell is emitted inline in the importer. Verified empirically that this
   is the ONLY cross-unit cell path: a page reading a shell-composed cell is a hard
   `E-STATE-UNDECLARED`, whose text says "import the name if it is cross-file".
5. **ESM.** The chunk imports runtime names, so the shadow must not collide with
   the import binding — an alias in `emit-client-esm.ts`.

N3 falls out of (1) for free: the IIFE makes `const Phase` chunk-local.


---

# S282 RESUME — N2 + N3 built via the chunk-local scope

**Commit `dc0b85b9`.** All four namespaces are now isolated, executed. The tree is
**RED**: the mechanism works, the test corpus has not been migrated to it yet.

## The acceptance test FLIPS — measured at `dc0b85b9`

```
classic  BASE e8fdd44c  alpha AFTER import : {"rows":["b1","b2"]}  CLOBBERED
classic  dc0b85b9       alpha AFTER import : {"rows":["a1","a2"]}  SURVIVED
esm      BASE e8fdd44c  alpha AFTER import : {"rows":["b1","b2"]}  CLOBBERED
esm      dc0b85b9       alpha AFTER import : {"rows":["a1","a2"]}  SURVIVED
```

Plus the three purpose-built fixtures, executed in real Chromium, classic.
`INCONCLUSIVE` means the second chunk THREW and never evaluated — the page looks
pristine, which is why `collision-exec.mjs` refuses to score that as isolation:

| fixture | BASE `e8fdd44c` | `dc0b85b9` |
|---|---|---|
| `types/` (N3 — both pages `type Phase:enum`) | `[pageerror] Identifier 'Phase_toEnum' has already been declared` -> INCONCLUSIVE | **isolated** |
| `engine/` (N4 — both pages an engine cell `phase`) | `[pageerror] Identifier '__scrml_engine_phase_transitions' has already been declared` -> INCONCLUSIVE | **isolated** |
| `wide/` (N1+N2 — same source both pages) | `[pageerror] Phase_toEnum …` -> INCONCLUSIVE | **isolated** |

## The mechanism

The store stays a SINGLETON; only the KEY SPACE is per-chunk. Each chunk opens
with a prologue that SHADOWS the global accessors:

```js
const { _scrml_reactive_get, _scrml_reactive_set } =
  _scrml_cell_scope("0a1b2c3d", { appPhase: "0eeeffff$appPhase" });
```

Every call site in the body is byte-identical to the pre-namespacing output —
`_scrml_reactive_get("rows")` — while the key reaching the store is
`0a1b2c3d$rows`. That is what keeps the ~1210 assertions across 198 files valid
unmodified. Effects, handlers and render fns are all created during module init
and capture this scope lexically; nothing is dynamically scoped.

### The two complications, solved

- **`_scrml_ssr_seed_apply` calls the GLOBAL setter** and never sees a chunk-local
  shadow. The SERVER now bakes the resolved key (`nsSsrSeedKey`), matching what
  `_scrml_cell_key` produces on the client.
- **`wrapClientBodyInIife` was conditional** for `_scrml_modules` + the `var
  session` singleton. Both are ASSIGNMENTS and still escape an IIFE. Rather than
  assume that was the whole list, I audited the runtime for bare references to
  chunk-declared globals: **201 declared, 209 referenced, exactly ONE real
  chunk-declared global — `_scrml_shell_cells`**, which `emit-reactive-wiring`
  now also publishes on `globalThis`. The other seven are property names
  (`node._scrml_key`, `container._scrml_item_by_key`, `_scrml_ssr_adopt`), not
  bindings.

### A pre-existing bug this surfaced

`emit-client-esm.ts`'s `topLevelDecls` only handled
`decl.id.type === "Identifier"`, so a DESTRUCTURED top-level `const` bound
nothing as far as the collector was concerned. The prologue is exactly that
shape, so every esm chunk emitted `import { _scrml_reactive_get }` NEXT TO the
`const` and died with three hard `E-CODEGEN-INVALID-LOGIC`. It now routes through
the existing `collectAssignmentTargets` pattern walker.

## What is NOT done: the test migration

`bun run test` at `dc0b85b9`: **27692 pass / 673 fail** (base is 33 fail), i.e.
**~635 new failures across 143 files**. Every one traced so far is test-corpus
drift, not a runtime break. Taxonomy:

| class | files | what changed |
|---|---|---|
| **harness** | **71** | a happy-dom harness captures a cell accessor AFTER the chunk runs, then drives cells by BARE name. Those cells now live under `<token>$name`, so the captured GLOBAL accessor sees nothing. |
| **engineName** | 20 | asserts `__scrml_engine_<name>_*` / `_scrml_engine_<name>_render_*`, now namespaced (N4). |
| **iifeShape** | 13 | byte/structural comparisons that now see the IIFE + prologue. |
| **ssrSeed** | 4 | asserts `_scrml_ssr_state["accounts"]`, now the resolved key. |
| **other** | 35 | mostly the harness shape my first classifier missed (`window.X = _scrml_…` rather than `globalThis.X = …`). |

### The harness recipe — PROVEN, not proposed

Applied to `compiler/tests/browser/browser-todo.test.js`: **10 pass / 0 fail**,
six lines. The chunk states its own token in the prologue, so the harness reads
it out rather than hardcoding one:

```js
const nsMatch = /_scrml_cell_scope\("([0-9a-z]{8})"/.exec(clientJs);
const key = (name) => (nsMatch ? `${nsMatch[1]}$${name}` : name);
return {
  get: (name) => window._scrml_reactive_get(key(name)),
  set: (name, val) => window._scrml_reactive_set(key(name), val),
};
```

An unnamespaced chunk yields no match and the bare name is used, so synthetic
fixtures are unaffected.

**This is the remaining work and it is mechanical, but it is ~143 files with a
4-5 minute verification loop — a dispatch of its own, not a tail-end task.** It
should be done with a full budget and an adversarial re-review, not squeezed in.

## Still open

- `E-CG-018` (token collision) needs a §34 catalog row — normative SPEC, not mine.
- SPEC §22.10:16342 needs the meta-scopeId amendment (see the previous section —
  the id is document-wide `querySelector`-resolved and keys three process-global
  registries, so it cannot be exempted).
- The R2 no-project-root tier is a ratified deviation pending bryan's veto.


---

# S282 FINAL ROUND — the migration

**Head `fc423b6d`.** All four namespaces isolated and executed. Migration
673 -> **197** failures. NOT finished: 63 files remain.

## Acceptance — measured at `fc423b6d`, real Chromium

```
classic  BASE e8fdd44c  alpha AFTER import : {"rows":["b1","b2"]}  CLOBBERED
classic  fc423b6d       alpha AFTER import : {"rows":["a1","a2"]}  SURVIVED
esm      BASE e8fdd44c  alpha AFTER import : {"rows":["b1","b2"]}  CLOBBERED
esm      fc423b6d       alpha AFTER import : {"rows":["a1","a2"]}  SURVIVED
```

All three fixtures, classic, base vs `fc423b6d` (`INCONCLUSIVE` = the second
chunk THREW and never evaluated, so the page looking pristine proves nothing):

| fixture | BASE `e8fdd44c` | `fc423b6d` |
|---|---|---|
| `types/` (N3) | `[pageerror] Identifier 'Phase_toEnum' has already been declared` | **isolated** |
| `engine/` (N4) | `[pageerror] Identifier '__scrml_engine_phase_transitions' has already been declared` | **isolated** |
| `wide/` (N1+N2) | `[pageerror] Phase_toEnum …` | **isolated** |

## Artifact-diff gate — PASS, 446 files, at `fc423b6d`

OQ-3's condition was "the only delta is the id token". The ruled mechanism adds a
SECOND: the chunk-scope wrapper. Both are now declared explicitly, and the shared
runtime is counted separately rather than folded — its bytes really did change
(`_scrml_cell_scope`), which moves its §47 content-address.

| corpus | compared | identical | token-only | residual |
|---|---|---|---|---|
| 23-trucking-dispatch | 115 | 53 | 61 | **0** |
| website | 295 | 98 | 196 | **0** |
| 8 others | 36 | 10 | 18 | **0** |

## FIVE real bugs the migration surfaced

Every one was found because an "unclassified" test was treated as a FINDING
rather than forced. Forcing them would have shipped five live defects.

1. **SSR seed wire format.** Baking the resolved key server-side worked but leaked
   the token into every SSR document. The seed now stays BARE and the CHUNK maps
   at apply time (`_scrml_ssr_seed_apply_scoped`) — the chunk that consumes the
   seed is exactly the one that knows the namespace.
2. **§41.12 inline message overrides — silently dead.** The Level-1 table is keyed
   `cell::validator`, but `_scrml_messages_register_inline` takes the cell FIRST
   and `_scrml_message_for` takes it THIRD. Namespacing only the register side
   split the pair, so every override fell through to the Level-3 default.
3. **§51.0.N engine history restore — broken three ways.**
   `_scrml_engine_history_capture_on_exit` gets an already-namespaced varName and
   then rebuilds two more keys by CONCATENATION, while the historyMap's values are
   bare — so it wrote one slot and read another that does not exist. Plus two
   codegen sites indexing `_scrml_state` / the pending-restore registry DIRECTLY.
4. **`cancelTimer` mined a CELL name out of a namespaced MARKER.** The arm-context
   id is `<idPrefix>:<armTag>` with `idPrefix` namespaced, so it emitted
   `_scrml_engine_clear_named_timer("0a1b2c3d_appMode", …)` which the scope then
   namespaced a SECOND time. The named timer was never found.
5. **`emit-client-esm.ts` `topLevelDecls` ignored destructuring** — a pre-existing
   bug, latent until the prologue became the first destructured top-level `const`.

## Migration recipes (all in `compiler/tests/helpers/chunk-scope.js`)

| recipe | for | files |
|---|---|---|
| `captureInsideChunkScope` | a harness that captures an accessor AFTER the chunk and drives cells by bare name — splice the capture INSIDE the scope so every call site stays untouched | 64 |
| `unwrapChunkScope` | a harness that executes a chunk with NO runtime to probe pure lowering, and reads a top-level decl | 7 |
| `unNamespaceEngineNames` | assertions on `__scrml_engine_<name>_*` (N4) | 11 |
| `unNamespaceCellKeys` | assertions on a site indexing the store DIRECTLY | 2 |
| `chunkCellKey` | a harness that cannot inject code at all | — |

All READ the token from the chunk's own prologue and degrade to the bare name
when a chunk carries none, so a token-shape change cannot silently desynchronise
the corpus from the compiler.

## REMAINING — 63 files, 197 failures, 160 new names vs base

Zero base failures were fixed or masked (`base-only` diff is 0), so nothing has
been laundered.

| class | files | failures | shape |
|---|---|---|---|
| harness | 25 | 109 | bespoke capture shapes the two scripts did not match; several capture `_scrml_state` itself and index it by bare name, which needs a stripped-key snapshot view rather than an accessor splice |
| iifeShape | 13 | 38 | byte/structural comparisons that now see the wrapper — most want `unwrapChunkScope` at the read site |
| engineName | 10 | 24 | the 8 files whose compile helper does not return an object literal, so the scripted normalization had no anchor |
| unclassified | 15 | 26 | needs individual reading — this is the bucket that produced all five bugs above, so it should NOT be batch-forced |


---

# S282 ROUND 2 — bug-yield-ordered migration

**Head `a399555a`.** 197 -> **162** failures (160 unique, 129 new vs base).
`base-only-now-passing` is **0**, so nothing has been masked.

## BUG 6 — SHIP-BLOCKING, FOUND, NOT FIXED

Working the unclassified bucket first produced a sixth bug, and it is the first
one that blocks landing rather than just needing a fix.

**`_scrml_cell_scope` lives in the CORE runtime chunk and hardcodes all ~33
cell-keyed accessors.** Two independent measured symptoms:

| symptom | pinned by |
|---|---|
| a CORE-ONLY assembly now contains `_scrml_message_for` / `_scrml_messages_register_inline` — §C10.1 tree-shaking no longer holds | `c10-error-message-resolution.test.js` |
| the SPA-shape shared runtime is **18,346 B gzip** against a documented **16,384 B** budget (it was under before) | `v0-3-x-spa-tree-shake-phase-b.test.js` |

I attempted two fixes and **reverted both** rather than ship them:

- **(a) generic core + prologue-supplied impls.** Right on tree-shaking, but it
  hits a temporal-dead-zone wall: the prologue's `const` bindings shadow those
  names for the whole chunk block, so the argument supplying them cannot
  reference them. Classic can dodge it by evaluating the argument on the IIFE
  call; **ESM cannot**, because its `export`s must stay at module top level, so
  the body cannot be wrapped at all.
- **(b) a registration table** — each helper registers itself beside its own
  definition, travelling with its chunk. Fixed §C10.1 and dodges the TDZ
  entirely, but did **not** fix the size budget (18,568 B — slightly WORSE; the
  registration lines cost more than the inline literal) and broke six C10.6
  default-catalog tests.

So the ~2 KB gzip cost looks **inherent to the ruled mechanism** rather than to
how it is spelled. That is a design question for a full-budget pass, not a third
attempt under pressure. Both symptoms are pinned by existing tests, so neither
can be lost.

## Migrated this round — 24 files

| recipe | for | files |
|---|---|---|
| `unwrapChunkScope` | harnesses that execute a chunk with no runtime and read a top-level decl | 11 |
| `normalizeChunkToken` | BYTE-PARITY comparisons of two compiles at two temp paths — reads the chunk's own token and replaces exactly that string | 5 |
| `storeByAuthorName` | harnesses capturing the raw `_scrml_state` OBJECT and indexing it by bare name | 1 |
| (compiler fix) | the prologue comment contained a bare `" and "`, tripping `boolean-keywords-lowering`'s guard that emitted JS carries no bare boolean keyword in operator position. The guard is right; the comment should not fire it. | 1 |

Also fixed an import path the earlier script got wrong for files at the tests
ROOT (`helpers/…` needs a leading `./`) — that one failed to LOAD rather than
failing an assertion, which is a louder failure than it looked.

## Verification at `a399555a`

```
classic  BASE e8fdd44c  CLOBBERED   ->  a399555a  SURVIVED
esm      BASE e8fdd44c  CLOBBERED   ->  a399555a  SURVIVED
```

All three fixtures isolated; all three `INCONCLUSIVE` at base (the second chunk
threw and never evaluated). Artifact-diff gate: **PASS on all 10 corpora, 446
files compared**.

## Remaining — 46 files, 160 failures

| class | files | failures |
|---|---|---|
| harness | 25 | 106 |
| engineName | 10 | 24 |
| iifeShape | 8 | 26 |
| unclassified | 3 | 4 |

The harness remainder is the bespoke-shape tail; `storeByAuthorName` covers one
of its sub-shapes and two more files want it. The 3 unclassified should be read
individually — that bucket has now produced 6 of the 6 bugs found in this arc.
