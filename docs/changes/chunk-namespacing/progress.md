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
