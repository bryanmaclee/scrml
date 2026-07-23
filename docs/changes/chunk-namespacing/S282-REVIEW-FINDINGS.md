# S282 — adversarial review findings + the landing ruling

**status:** `current` · **last-reviewed:** 2026-07-23
**Branch under review:** `worktree-agent-a91ad13968b46ab5d` @ `e3584cc5` (base `e8fdd44c`)
**Verdict: DO NOT LAND AS-IS. Held pending a bryan ruling + a fix round.**

Two independent adversarial reviewers (distinct lenses: blast-radius, and inertness/tests) plus a
PA-run empirical check. They converged on the same defects independently, which is why these are
recorded as CONFIRMED rather than plausible.

---

## 0. THE HEADLINE — the acceptance test does not pass on the shippable tree

The dispatch report presented a premise-check table showing `SURVIVED` under both module formats.
**That table was measured with N2 WIRED** (commit `45e4c556`), before `1dc0a7ce` held N2 back out.
In `progress.md` it correctly sits inside the N2 section; the final report re-presented it as the
arc's acceptance result.

PA re-ran it on the shippable tree:

```
alpha BEFORE import : {"rows":["a1","a2"],"h2":"Alpha"}
alpha AFTER  import : {"rows":["b1","b2"],"h2":"Alpha"}
VERDICT: alpha's rendered rows WERE CLOBBERED
```

Root cause is not a regression — it is the scoping's own prediction. Emitted artifacts:

```
each tokens:  each_004951nv_9  vs  each_00kgitr5_9   <- N1 working, namespaced per page
cell keys:    "rows"           vs  "rows"            <- N2 unwired, still colliding
```

SCOPING §2: *"N2 collides even when N1 does not — it needs no numeric coincidence at all. Both must
be namespaced. A fix for either alone still clobbers."* Correct, and load-bearing.

**Consequence:** adopter #27 stays blocked either way, so landing N1 alone realises no benefit while
spending the whole byte-churn budget. OQ-3 authorised **one** global churn gated by one artifact-diff
and classified `semantics-changed` — the class pa-base calls the most dangerous and the one gates are
weakest against. Splitting into N1-now / N2-later spends that twice. **Land N1 and N2 together, as the
single event OQ-3 authorised.**

---

## 1. The arc is FOUR namespaces, not two — the finding that should drive the ruling

| # | namespace | keyed by | status |
|---|---|---|---|
| **N1** | numeric node ids (`each_9`, `scrml-each:9`, `_scrml_arm_v_N`, `_scrml_meta_N`) | per-unit counter | **built + wired** on the branch |
| **N2** | reactive cell-store keys (`_scrml_reactive_get("rows")`) | source cell NAME | built, proven, **held unwired** |
| **N3** | author top-level type names (`const Phase`, `Phase_variants`) | author-chosen name | **filed, unfixed.** Classic-mode redeclaration `SyntaxError` kills the second chunk outright |
| **N4** | engine names (`data-scrml-engine-mount="itemsPhase"`, `_scrml_engine_itemsPhase_dispatch`) | engine cell NAME | **newly found S282, unfiled.** Neither N1 nor N2 touches it |

N4 was found in `examples/29-engine-vs-flags` output. `emit-engine.ts:2595,2646` pass
`idPrefix: meta.varName`, so `emit-variant-guard.ts` emits a name-keyed, document-wide
`document.querySelector('[data-scrml-engine-mount="itemsPhase"]')`. Two routes both declaring an
engine cell named `phase` collide on the mount attribute AND on top-level function names.

**Why this should move the N2 ruling.** Three of the four (N2, N3, N4) collide on an author-chosen
NAME, not on a compiler counter. Per-token prefixing (option A) fixes them one at a time and re-opens
every time an emitter is added. A chunk-local scope (option B) closes N2/N3/N4 structurally in one
move. When the arc was scoped as two namespaces, A vs B was close; at four it is not obviously so.

---

## 2. CONFIRMED defects in N1 as built

**D1 · HIGH · the basename fallback deterministically reinstates the collision the ruling rejected.**
Reproduced independently by both reviewers. `distRelativeSourcePath` falls back to `basename(filePath)`
when the dist-relative prefix does not match, and `computeOutputBaseDir` (`api.js:197-212`) returns
`"/"` when the input set's common directory is the filesystem root (also: any single-file compile ->
`dirname(file)`). Reproduction:

```
scrml compile /tmp/.../appA/pages/home.scrml  /home/.../scrmlrev/pages/home.scrml -o dist
-> both: <!--scrml-each:00rb1wn9_24-->   and   _scrml_each_renderers["each_00rb1wn9_24"]
```

`00rb1wn9 = fnv1aHash("home.scrml")`. The module docstring rejects basename BY NAME for exactly the
`pages/driver/home` vs `pages/dispatch/home` case — and then falls back to it. Same trigger on Windows
across drive letters.

**D2 · MED/HIGH · no collision check, and the entropy is 32 bits not 41.**
`fnv1a-hash.ts` claims *"~41 bits (base36^8)"*; it is 32-bit FNV-1a `padStart(8,"0")` and 36^7 > 2^32,
so the 8th char is always `0` — every observed token starts with `0`. Birthday ~1.2e-4 at 1k units,
~1.2e-2 at 10k. §47.1.5 / `E-CG-010` is documented as NOT covering this call site. On collision the
failure is silent and IS the bug being fixed. A pairwise-distinctness assert over the build's file set
is ~5 lines.

**D3 · MED · the token is not stable across input-set changes — the defect used to reject build-index.**
The token is relative to `computeOutputBaseDir(inputs)` = longest common directory of the INPUT SET.
Adding one file at a shallower path rotates EVERY file's token -> every id, every fence, every §47.5
content-addressed chunk hash. Measured:

```
compile wide/ (dir)                        -> 004951nv_24 / 00kgitr5_24
compile wide/pages/{alpha,beta}.scrml      -> 0029h1ws_24 / 016nno5s_24
```

SCOPING §4 rejects build-index as *"unstable across incremental builds, breaks content-addressed
caching."* This inherits that. Determinism WITHIN a fixed input set is fine (two full compiles
byte-identical; same tree from a different absolute path yields identical tokens).

**D4 · MED · the OQ-3 artifact-diff gate compared 8 of 115 files.**
`artifact-diff.mjs:26-34` — `walk()` recurses but pushes `relative(root, p)` against the SUB directory,
so nested files enter the set as bare basenames; `readFileSync(join(BASE, "home.html"))` then throws and
is swallowed by `catch { continue; }`. On `examples/23-trucking-dispatch` the shipped gate reported
`identical: 8` against a 115-file tree — 107 silently skipped, and same-basename files collapsed in the
Set. **The gate that OQ-3 made the merge condition was itself hollow** (pa-base v2.4 §"three ways a gate
reports green while verifying nothing"). A reviewer re-ran it with the walk fixed and a shape-anchored
fold: 23-trucking `87 identical / 28 token-only / 0 residual`, and `0 residual` across 7 more corpora —
**the conclusion survives; the evidence as shipped did not support it.** Also LOW: the gate's fold regex
is unanchored and eats any 8-char lowercase word before `_<digits>`.

**D5 · MED · SPEC §22.10 violated with no amendment.**
`SPEC.md:16342` is normative: *"`<scopeId>` is a string literal of the form `"_scrml_meta_N"` where N is
a stable integer."* The change emits `_scrml_meta_004951nv_3`; the diff touches no SPEC text. This is the
ONLY normatively-pinned shape the change touches — `scrml-each`, `each_renderers`, `data-scrml-match-mount`
have zero SPEC hits and are genuine D3 implementation freedom. Needs a SPEC amendment or a carve-out
(governing-sentence gate, pa-base §1 Rule 4).

**D6 · LOW/MED · the per-file reset is not exception-safe.**
`codegen/index.ts:2024`, no `try/finally`, and neither `codegenStage` nor `api.js stage()` catches. A throw
anywhere in emit leaves the last file's token in the module singleton for the rest of the process.
`progress.md` itself calls this reset *"load-bearing, not hygiene: without it, ~17 emitter unit tests that
drive synthetic ASTs in the same process inherit whichever file compiled last"* — so the exceptional path
is precisely the stated contamination scenario, unguarded. Affects `bun test` (one process, 1251 files)
and `scrml dev`.

**D7 · LOW · dead exports + a documented guarantee that does not exist.**
`withChunkNamespace`, `nsCellLiteral`, `stripCellNamespace`, `nsCell`, `currentChunkNamespace` have zero
`src` call sites. `withChunkNamespace`'s docstring claims it protects *"a nested emit of another unit's
AST — the memoized cross-file dependency walk does this"*; nothing provides that. Both reviewers traced
the loops and found no nested cross-unit emit today, so the docstring OVERSTATES rather than describing a
live hole — but it should not ship as a claim about code that does not run. Consequently the whole
`cellOwners` machinery is dead, yet `buildChunkNamespaceState` RUNS its `importBindings x exportRegistry`
walk (with a lazy `require("../module-resolver.js")` per relative import) on every file of every compile
to build a Map nothing reads.

**D8 · LOW · two test normalizers weakened.** Unanchored `[0-9a-z]{8}_(\d+)` folds in
`parser-conformance-each-contextual-sigil` + `native-each-promotion` can eat the trailing 8 chars of any
identifier before `_<digits>`. Applied symmetrically so they can only MASK a delta, never fabricate one;
probed against real output, 24 matches / 2 distinct / zero collateral — real exposure, currently
unexercised. Anchor to `\b0[0-9a-z]{7}_(\d+)` (every token starts `0`).
`colon-shorthand-inside-opener-s154b.test.js:558` is worse: its new first pass turns `_scrml_reactive_1`
into `_scrml_NS_1`, which the second pass can no longer match, so a structural-identity test became
sensitive to counter drift it used to ignore. Also: `each-in-block-form-match.browser.test.js:40`
weakened `[data-scrml-match-mount="match_7"]` -> `^="match_"`, losing which-match specificity;
`$="_7"` would keep it.

---

## 3. What the reviewers attacked and could NOT falsify — N1's core mechanism is sound

- **SSR<->client token identity** (the highest-risk property). One derivation per file, threaded via
  module state; both sides read `_state.token`. On `examples/23-trucking-dispatch`: 19 fences / 19
  `_scrml_find_each_anchor` args / 19 registry keys, **zero orphans in either direction**, each anchor's
  fence in its own `.html`. Same on `wide` and `wide --module-format=esm`.
- **No emit outside the install window.** All three generators run in the main loop after the install;
  post-reset work (shell composition, `augmentHtmlForChunks`) is purely textual and emits no id-derived
  token; the worker loop does not re-enter `runCG`; no early return.
- **No missed `nsId` site.** Every `.id}` interpolation in codegen grepped — only diagnostic labels
  remain. `emit-variant-guard` derives every name from the namespaced `idPrefix`. `route-splitter.ts` /
  `emit-client-esm.ts` / `runtime-esm.ts` do not rewrite these tokens.
- **The number->string call shape is safe and actually FIXES a latent bug.** No `===` against a number,
  no arithmetic, no array index. `_scrml_each_anchor_cache` is a `Map` and every emitted call site now
  passes a string consistently — which repairs a prior cross-chunk cache clobber.
- **`genVar` markers are not in this collision class** — `resetVarCounter()` is per-`runCG`, so they are
  monotonic across all files in a build.
- **N2 is genuinely inert.** Whole-tree grep: three sites, none an `src` import, so it is never loaded
  during a compile. No env var, flag, or default parameter reaches it. No import side effects.
- **Test migration is clean.** Every changed assertion is strictly NARROWER (now also requires the token)
  and each fails against pre-fix output. One got STRONGER (`ssr-a-terminus.test.js:196` adds a `\1`
  backreference tying the fill-mount id to the render-fn name). No `toContain` downgrades, no removals,
  no expected VALUE changed, nothing skipped or deleted.
- **The colliding fixture genuinely collides pre-fix** — both pages emit node id 24, differing only by
  token. The `23-trucking-dispatch`-style false-green trap was avoided.
- **Zero test regressions.** Branch 31 failures; all 31 reproduce identically on base `e8fdd44c` by name.
  Pass 28640 -> 28659 = exactly +19, the new file. Skip and todo unchanged.

## 4. Could not rule out

- Real-browser execution of **N1 alone** (the recorded Chromium proof is N2's). N1 has happy-dom coverage
  only — the execute-don't-grep bar is met at happy-dom level, not Chromium.
- Cross-file component containing an `<each>` — the shape fails today (`E-IMPORT-004` /
  `E-COMPONENT-035`), so it could not be exercised. If it lands, "which file owns the fence vs the
  renderer" re-opens.
- `scrml dev --watch` incremental rebuild interaction with token churn (see D3).
- `--emit-per-route` interaction with `computeChunkHash` beyond what the suite exercises.
- `acorn` is imported by `cell-namespace-pass.ts` but is not declared in `package.json` — pre-existing
  (5 other `src` files already do this), this adds a sixth consumer.

---

## 5. Recommended next session

1. **Rule N2's landing shape** — A (key prefix, ~1210 assertions across 198 files) vs B (chunk-local
   accessor shadowing). §1 above is the new input: it is four namespaces, three of them name-keyed, and
   B closes N2/N3/N4 structurally. B's known complications: the SSR seed calls the GLOBAL setter, and
   `wrapClientBodyInIife` (index.ts:469) is conditional because of `_scrml_modules` registration and the
   `var session` singleton — so B is a hybrid, not a swap.
2. **Rule N3 + N4** — both are author-visible names; namespacing them is adopter-visible.
3. **Fix round D1-D8** on the same branch, then RE-REVIEW (S239).
4. **Re-run the acceptance test** on the combined tree, in real Chromium, both module formats, and re-run
   the artifact-diff with the fixed walk.
5. Land N1+N2 together as the single OQ-3 churn event.

**Do not re-derive:** N1's mechanism is verified sound (§3). The work to redo is the defect list, not the
design.
