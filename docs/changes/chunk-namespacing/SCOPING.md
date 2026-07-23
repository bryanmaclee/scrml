# SCOPING — per-chunk id/cell namespacing (the real cross-chunk soft-nav gate)

**change-id:** `chunk-namespacing`
**Authored:** S280 (2026-07-22) · base `38aec2a9` · scoping only, nothing built
**Status:** `current` — **OQ-1..OQ-3 ALL RULED (bryan, S280). Dispatchable.**
**Supersedes as the nav blocker:** the S279 Option-B framing (see §1)

---

## §1 Why this arc exists

Adopter issue **#27** (cross-page navigation full-reloads) needs a soft-nav loader. Wave-1c built one on the classic path; S279 held it and ruled **Option B** — defer classic, fold nav into ESM U4 — on the premise that *"module scope dissolves the each-id collision."*

**S280 falsified that premise empirically** ([[g-esm-module-scope-does-not-isolate-chunk-state]], evidence branch `origin/evidence/u4-premise-falsified`). Module scope isolates only the **lexical** collision. The colliding state lives in the **runtime**, and under `--module-format=esm` the runtime is one ES module every chunk imports — a **singleton by necessity**, since a forked cell store / subscriber list / rehydrator registry would break reactivity outright. Chunks mutate it through member expressions on an imported binding, which is legal ESM and deliberately outside the arc's fail-loud guard.

Proven in real Chromium against real emitted artifacts, with **no navigation at all** — just the `await import()` a nav loader performs:

```
alpha BEFORE import : {"rows":["a1","a2"],"h2":"Alpha"}
alpha AFTER  import : {"rows":["b1","b2"],"h2":"Alpha"}
```

**So the gate is the SECOND disjunct of [[g-navigate-soft-nav-full-reload]] — per-chunk id/cell namespacing — and it is MODULE-FORMAT-AGNOSTIC.** Two consequences:
1. U4 as scoped cannot be built. The dispatched agent correctly refused.
2. Fixing this **also unblocks the held Wave-1c CLASSIC loader**. Option B relocated the blocker; it did not remove it. The payoff is now larger than when the arc started.

---

## §2 What actually collides — two distinct namespaces

### N1 — numeric node ids
`ast-builder.js:18125` `const counter = { next: 0 }` is **local to each compilation unit** (its comment says "to avoid cross-file collisions", which is true *within* a build pass and exactly wrong for chunks that coexist at runtime). Every route chunk restarts at 1, so two routes emit the same `each_9` / `_scrml_each_render_9` / `<!--scrml-each:9-->`.

### N2 — reactive cell keys
The cell store is keyed by the **source-level cell name**. Two routes that both declare `<rows>` share one slot. Note this collides even when N1 does not — it needs no numeric coincidence at all, so N1 alone is an incomplete fix.

**Both must be namespaced. A fix for either alone still clobbers.**

---

## §3 Measured surface

| site | count |
|---|---|
| `counter.next` assignment sites (`ast-builder.js`) | **205** |
| id consumers — `emit-each.ts` | 47 |
| id consumers — `runtime-template.js` | 22 |
| id consumers — `emit-match.ts` | 8 |
| id consumers — `emit-variant-guard.ts` / `emit-client.ts` / `emit-ssr-render.ts` | 4 each |
| id consumers — `api.js` | 1 |
| cell-store key sites — `emit-client.ts` | 28 |
| cell-store key sites — `runtime-template.js` | 64 |

**~390 touch points across 8 files**, spanning the AST builder, five codegen emitters, the runtime template, and the API. This is a codegen-wide change, not a localized one — which is exactly why it could not ride inside U4's byte-identical-classic constraint.

### The SSR coupling (the constraint that shapes the design)
The fence `<!--scrml-each:N-->` is emitted into **HTML** while `_scrml_each_renderers["each_N"]` is registered in **JS**. The namespace must therefore be identical on both sides and stable between the SSR pass and the client emit. Any scheme that derives the token differently in the two emitters silently breaks rehydration — and that failure is invisible to a grep, so it needs execution to catch.

---

## §4 Open questions — need a bryan ruling

**OQ-1 — what is the namespace token? → RULED (bryan, S280): a PATH HASH.**

**FNV-1a of the dist-relative source path, base36, 8 chars** — the same hash function §47 already uses for content-addressed chunk filenames, applied to path-identity instead of content.

The rejected options, and why:
- **(a) chunk basename — DISQUALIFIED ON CORRECTNESS, not aesthetics.** Basenames are NOT unique. Measured: `examples/23-trucking-dispatch` carries `home.scrml`, `load-detail.scrml` and `profile.scrml` in two or more route dirs each; `docs/website` duplicates `index.scrml`; 7 duplicate basenames across the corpora. `pages/driver/home.scrml` and `pages/dispatch/home.scrml` would namespace identically — so (a) fails to fix the bug in exactly the multi-page layout that needs it most. (The PA originally leaned (a) on DevTools-debuggability without testing the uniqueness premise; bryan pushed back on the principle and the measurement then killed it outright.)
- **(c) build index — unstable** across incremental builds, breaks content-addressed caching.
- **(b) content hash of the source — right instinct, wrong input.** §47 content-addressing answers *"has this changed?"* and drives cache invalidation. Namespacing answers *"which compilation unit is this?"* — and that identity IS the path, unique by construction within a build. Hashing content instead churns every id in a chunk on any one-line edit for no benefit (only the filename needed to change), and risks circularity if anyone ever hashes the EMITTED chunk, since the ids live in it.

**bryan's governing principle, recorded because it should outlast this decision:** debugging by reading compiled output is a last resort — *"like a C programmer reading the assembly"* — and needing it "suggests the compiler isn't doing its job." `sourceMap`/`clientJsMap` already exist in the codegen, so the intended adopter debug path is source maps, not token readability. The PA's ergonomics argument was optimising for a reader who should not be there. Carve-out: reading emitted output stays routine and legitimate for COMPILER developers (three times in S280 alone), but they have the repo and do not need friendly tokens.

**Accepted cost:** ~8 extra chars on every id in every chunk. Real, small, compresses well over the wire.

**OQ-2 — always-on, or only where chunks can coexist? → RULED (bryan, S280): ALWAYS-ON.**
Namespacing moves classic bytes for **every** app, including single-page ones that can never collide — accepted. Conditional namespacing would mean two emit shapes to test, and the condition ("can these chunks ever coexist?") is exactly the kind of predicate that is wrong at the edges. One shape, one test matrix; the byte-movement is a one-time reviewable event rather than a latent fork.

**OQ-3 — byte-identity story? → RULED (bryan, S280): (i) + (iii).**
Accept a **one-time global churn**, gated by an **artifact-diff that mechanically asserts the ONLY delta is id tokens**, and classify the landing **`semantics-changed`** per the §8 direction-of-change taxonomy (same source, different behaviour, no diagnostic delta). That is the class pa-base calls *"the most dangerous, and the one the gates are weakest against"* — which is precisely why the artifact-diff IS the merge gate here rather than a review step. Option (ii) (stage behind a flag) was rejected with OQ-2: it reintroduces the second emit shape.

---

## §5 Verification plan (non-negotiable, and shaped by S280's own failures)

1. **The collision repro is the acceptance test.** `origin/evidence/u4-premise-falsified` → `docs/changes/esm-chunks/u4-premise-check/`. It must flip from CLOBBERED to isolated, executed in a real browser, under **both** module formats.
2. **Corpus choice is load-bearing — do not repeat the S280 mistake.** `docs/website` is the WRONG corpus (no cross-file `.scrml` deps; the code never fires). `examples/23-trucking-dispatch` **does not collide by luck** — its pages differ in node count so the per-file ids happen to miss. **A purpose-built colliding fixture is mandatory**; a corpus sweep will return a false green.
3. **A ref-resolution / grep sweep cannot prove this.** S280 learned twice: a resolution audit is blind to a dropped ref, and a marker-grep is blind to a dead bundle. The symptom check is **execution**.
4. Artifact-diff gate per OQ-3: assert the only delta across the full corpus is id tokens.
5. S239 adversarial fan-out before landing, per the standing rule.

---

## §6 Sequencing

This arc **precedes** any nav-loader work. Once it lands, BOTH loaders unblock:
- the held Wave-1c **classic** loader (`feat/wave1c-nav`, `origin/worktree-agent-a2ed001a5de228134`), and
- **ESM U4** (`import()` loader) — noting the S280 corollary that `import()` evaluates once per URL, so A→B→A cannot re-run A's module-init to re-seed cells. That is a *separate* design question for whichever loader lands, and it does not block this arc.

**Estimate:** ~390 touch points across 8 files, but highly mechanical once the token scheme is ruled. The hard parts are the SSR/client token agreement (§3) and the byte-churn review (OQ-3), not the edit volume.


---

## §7 S282 RULINGS — supersede §4 OQ-1 and extend the arc to FOUR namespaces

Adversarial review (S282) grew the surface from 2 namespaces to 4 and found the ruled token
under-specified. bryan ruled all three follow-on questions. Full evidence:
[`S282-REVIEW-FINDINGS.md`](./S282-REVIEW-FINDINGS.md).

### R1 — mechanism: SPLIT BY KEY-KIND

The four namespaces divide on **what they are keyed by**, and that division is the design:

| keyed by | namespaces | mechanism |
|---|---|---|
| a compiler COUNTER | N1 (node ids) | **emission-time prefixing** — as built S282, verified sound, unchanged |
| an author-chosen NAME | N2 (cell keys) · N3 (author type names) · N4 (engine names) | **a chunk-local scope** |

Rationale: per-token prefixing fixes name-keyed collisions one at a time and re-opens whenever an
emitter is added — N4 was found only because a reviewer went looking for it. A chunk-local scope
closes all three structurally.

**Consequence that unblocked the arc:** under a chunk-local scope the store key stays **bare**, so
the ~1210 assertions across 198 test files pinning `_scrml_reactive_get("rows")` remain valid
unmodified. The 198-file migration that forced the S282 agent to hold N2 largely evaporates.
`cell-namespace-pass.ts` (the key-prefixing approach) is superseded and deleted.

Known complications, to be solved rather than routed around: the SSR seed calls the **global**
setter (`_scrml_ssr_seed_apply`); `wrapClientBodyInIife` (`index.ts:469`) is **conditional** because
of `_scrml_modules` registration and the `var session` singleton.

### R2 — token root: the PROJECT ROOT, no fallback

**Supersedes OQ-1's "dist-relative source path."** OQ-1 chose path-identity over content and over
basename, and that stands — but "dist-relative" was implemented against
`computeOutputBaseDir(inputs)` = the input set's common directory, which produced three defects:

- the token **rotates for every file** when a file at a shallower path joins the input set, churning
  every id, every fence and every §47.5 content-addressed chunk hash — the exact instability OQ-1
  rejected *build index* for;
- a **basename fallback** fires when the prefix does not match (and on any single-file compile),
  making `pages/driver/home.scrml` and `pages/dispatch/home.scrml` namespace **identically** — the
  exact collision OQ-1 rejected *basename* for.

Ruled: anchor to the **project root** (`scrml.toml` location, else the git root). **No fallback** —
an unresolvable root is a hard compile error, never a silent degrade. Plus a **pairwise-distinctness
assert** over the build's file set (the token is 32-bit FNV-1a, not the "~41 bits" the docstring
claims, and §47.1.5 / `E-CG-010` does not cover this call site).

### R3 — scope: all four land together

One landing, one artifact-diff gate, one `semantics-changed` classification — the single churn event
OQ-3 authorised. N3 is a live redeclaration `SyntaxError` that kills the second chunk outright, so
it is a crash rather than a follow-on.

### Still open — NOT ruled

**SPEC §22.10.** `SPEC.md:16342` normatively fixes `_scrml_meta_N` as "a string literal of the form
`_scrml_meta_N` where N is a stable integer"; N1 emits `_scrml_meta_004951nv_3`. This is the ONLY
normatively-pinned shape the arc touches. Pending: does the meta scope id need namespacing at all
(is it cross-chunk visible), or can it be exempted? If it must change, that is a SPEC amendment and a
separate ruling under the governing-sentence gate.
