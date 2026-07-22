# ESM chunks — arc scoping + first-unit dispatch brief

`change-id: esm-chunks · authored S278 (bryan) · status: SCOPED, not dispatched`

DONE-PROBE: grep -q 'type="module"' /home/bryan-maclee/scrmlMaster/scrml/compiler/src/codegen/index.ts

> The DONE-PROBE is a real shell command (per the S278 boot finding that prose probes
> read as false-OPEN). It fires DONE once the script-tag emit carries `type="module"`.

---

## 0. Decision context (read first)

**bryan RULED ESM chunks (S278)** — replace the hand-rolled classic-script `_scrml_modules`
global registry with the platform's ES module system for client-side chunks.

This ruling SUPERSEDES the S276 IIFE-wrap ruling. The S277 hand-off justified that
supersession with a premise — *"the emitted chunk system uses shared top-level lexical scope
AS its cross-chunk linkage mechanism, so a blanket IIFE severs every importer"* — which S278
**empirically disproved**: cross-chunk linkage is the `_scrml_modules` registry + load order
(registry-mediated, never bare-lexical), and shell↔page in a composed MPA share NO linkage at
all (the compiler forbids a page referencing a shell declaration — `E-SCOPE-001`). So ESM does
NOT rest on the linkage-rescue argument. It rests on its own merit: **`_scrml_modules` is a
hand-rolled module system and the platform has one** — a right-beats-easy call bryan made
deliberately. (Full premise-correction trail: delta-log S278; the probe evidence is in this
brief §2.)

**Language-spec-free (the reversibility fact).** Per the D3 conformance contract (RATIFIED
S230, governing sentence): *"Two implementations must agree on (a) which diagnostic CODES fire
and (b) the RUNTIME effect — full stop. Message text, emitted-JS shape, and AST are all
explicit implementation freedom."* Client chunk module format = emitted-JS shape =
**implementation freedom**. So this arc touches ONLY the compiler spec, never the language
spec; it is NOT a language-version event; it does NOT touch adopter source; it is fully
reversible. It is also NOT on the V1 critical path (S233 bar: language frozen + conformance-
tested + impl#1 conformant; client module format is not in that bar) — it is a compiler-quality
investment that can land before or after freeze without cost.

**Zero adopter-source change.** Every adopter `.scrml` is byte-identical before/after. Adopters
recompile (as every build does) and get a different-shaped `.js` bundle. n=1 real adopter
(Peter) + the examples/website corpus.

---

## 1. What ESM buys (the actual wins, honestly scoped)

1. **Dissolves `g-nav-chunk-lexical-collision` by construction.** Two chunks declaring the same
   `type Phase:enum` → both emit top-level `const Phase_toEnum`; under classic scripts loaded
   into one document that is a hard `SyntaxError` that kills the page (PA-reproduced in real
   Chromium, S278). Module scope makes each chunk-local — no collision, no IIFE needed.
2. **Simplifies the Wave-1c loader** (`import(url)` replaces manual `createElement("script")`
   injection). `import()` returns a per-call promise, which natively retires
   `g-nav-chunk-loading-flag-race` (no shared mutable boot boolean to race) and the manual
   load-event + `_SCRML_NAV_CHUNK_TIMEOUT_MS` machinery. Net loader lines likely NEGATIVE.
3. **Retires the hand-rolled registry.** `_scrml_modules[dist-key] = {…}` + `const {x} =
   _scrml_modules[dist-key]` → native `export {…}` / `import {…}`.

**NOT a win (do not claim):** ESM does NOT "collapse three gaps." It collapses ONE by
construction (lexical collision). `g-nav-chunk-basename-collision-key` (fix: *key the loaded-set
on the resolved ABSOLUTE url*) and `g-nav-chunk-loading-flag-race` (fix: *a depth counter* OR
`import()`) have format-independent fixes; ESM makes the flag-race moot via `import()`, but the
basename-collision fix is needed regardless.

---

## 2. Empirical survey (S278 — what is PROVEN, so the estimate is earned not guessed)

Ran a depth-of-survey probe (primer §12 discipline) against REAL emitted artifacts in real
Chromium (`playwright-core` + `chromium-1228`; happy-dom is the wrong tool — it can't model
script/module semantics, the very `g-nav-browser-harness-fidelity` gap).

| probe | result |
|---|---|
| classic control: two chunks, same `const Phase_toEnum`, one document | `SyntaxError: Identifier 'Phase_toEnum' has already been declared` → **boot never fires, dead page** (the collision gap, in a real engine) |
| ESM: same two chunks as modules | no error — module scope dissolves it; boot fires; order `shell → page → BOOT` |
| deferred-module boot vs `DOMContentLoaded`-gated boot | **fires correctly** — the S277 "boot ordering changes" worry does NOT manifest |
| `_scrml_modules` registry across module boundaries | **works** — a module imports the registry, reads another module's registration |
| **real emitted runtime + 2 real chunks, mechanically converted, in Chromium** | **all 3 link; reactivity roundtrips** (`_scrml_init_set`→`_scrml_reactive_set(42)`→`get`→`42`; subscribe fired) |

**Conversion mechanics measured on real code:**
- Runtime → module: **1 mechanical edit** (append `export { …all 69 top-level symbols… }`).
- Each chunk → module: **1 mechanical edit** (prepend `import { <surface> } from "./runtime.mjs"`).
- Import surfaces are SMALL and auto-computable: 4 symbols (reactivity page), 8 symbols (MPA
  shell w/ link-boost). Computed by `(runtime-top-level ∩ chunk-refs) − chunk-own-decls`.
- Runtime "gnarly pattern" scan: 0 `window._scrml` pollution; 3 `typeof _scrml_X !== "undefined"`
  self-guards (removable under ESM); the `var _scrml_modules = (typeof _scrml_modules !==
  "undefined") ? …` redeclare-guard SIMPLIFIES to `export const _scrml_modules = {}`; 22
  `globalThis` refs, of which the perf/debug hooks are unchanged and **exactly one** is the real
  rework (below).

**The one non-mechanical piece (named residual risk R1).** Meta-block `^{}` dep-tracking
(`runtime-template.js` L2926–3045) monkey-patches `globalThis._scrml_reactive_get` to intercept
reactive reads during meta evaluation. Under classic scripts the bare function (`function
_scrml_reactive_get`, L794) and `globalThis._scrml_reactive_get` are the SAME binding; under ESM
they DIVERGE (module binding ≠ globalThis property), so the interception would be invisible to
chunk reads that call the module binding. **Blast radius = exactly `^{}` meta-block dep-tracking**
(a specific feature; normal reactive reads are unaffected — proven working). **Fix (bounded):**
route the exported `_scrml_reactive_get` through a mutable `globalThis` override slot when set
(so meta-tracking keeps working), OR give meta-emitting chunks a `readGet()` indirection.

**Residual risk R2 (identified, NOT prototyped): SSR hydration ordering under deferred modules.**
The survey proved reactive set/get/subscribe roundtrip + all-modules-link + SSR markup present
(`bodyLen` non-zero), but did NOT drive a full interactive-element hydration from the SSR seed
(`window.__scrml_ssr_state`) end-to-end. Deferred modules run after full parse, right before
`DOMContentLoaded` — the boot pattern is `DOMContentLoaded`-gated so this is EXPECTED-fine, but
it must be verified end-to-end in Unit 5 (harness) before claim-closed.

---

## 3. Estimate (revised by the survey)

**~3 sessions (range 2.5–4).** The survey shaved the top of the pre-survey ~3–4 by proving the
runtime-globals conversion is largely mechanical (depth-of-survey discount realized). Dominant
residual = R1 (meta-block rework) + R2 (hydration-ordering verify).

| Unit | Scope | Cost | Risk |
|---|---|---|---|
| **U1** runtime → module | `runtime-template.js`: export surface + remove typeof-guards + registry init simplify + **R1 meta-block rework** | ~0.75 sess | R1 (bounded) |
| **U2** chunk emit | `emit-client.ts`: registry footer/header → `export`/`import`; per-chunk import-surface computation; enum-rep collision dissolves | ~0.5 sess | low |
| **U3** script-tag emit | `codegen/index.ts` L1717–1731 + L2259–2272 (composed MPA) + `emit-html.ts` role-bootstrap: `type="module"`; unify non-`.scrml` JS import path (already ES `import`); stdlib `_scrml/*.js` load path; chunks.json/content-addressed tags | ~0.5 sess | low |
| **U4** nav loader → `import()` | held branch `8fd5fd07` (`_scrml_nav_missing_chunks`/`_scrml_chunk_loading`): classic injection → `import(url)`; retires flag-race + timeout machinery; rebase held branch onto U1–U3 emit | ~0.75 sess | med (held-branch rebase) |
| **U5** browser harness | rebuild the `eval`/`new Function` harness to run modules (playwright pattern PROVEN S278); **R2 hydration-ordering verify** | ~0.75 sess | R2 |
| **U6** land gate | S239 adversarial + independent R26 (recompile trucking-dispatch/website/adopter `.scrml`) + conformance runtime-half | ~0.5 sess | mandatory |

---

## 4. Dispatch protocol (every source unit)

- **Agent:** `scrml-js-codegen-engineer`, `model: "opus"`, `isolation: "worktree"`,
  `run_in_background`.
- **F4 block** (verbatim "CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE"): `bun install` +
  `bun run pretest` in the fresh worktree; edit via Bash on worktree-absolute paths; NEVER `cd`
  into main; symlink gitignored `dist/` from main for browser tests.
- **MAPS — REQUIRED FIRST READ** block: `.claude/maps/primary.map.md` (fill `<COMMIT-SHA>` +
  `<DATE>` from its line 3 at dispatch; currency-check HEAD vs the map SHA first).
- **Anti-pattern briefing:** `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` +
  `docs/articles/llm-kickstarter-v2-2026-05-04.md` — "read both before any code."
- **Refusal-is-welcome** clause (empirically load-bearing — dev agents corrected the PA 4× at
  S277): "if any premise in this brief is wrong, STOP and report — do not build past it."
- **Crash-recovery:** commit-after-each-change + `progress.md` + WIP-commits-expected.
- **Empirical Phase-3 (R26):** recompile real `.scrml` (`examples/23-trucking-dispatch/app.scrml`
  as a dir, `docs/website` as a dir) on the post-change baseline; the symptom-check is
  bundle-EXECUTION in real Chromium (the S265 "emitted ≠ runs" lesson — grepping emitted text is
  NOT sufficient), NOT "tests pass." DO NOT mark DONE without empirical R26 passing.
- **PA-side S239 adversarial** `/code-review high` (or finder fan-out) on `git diff
  origin/main..<agent-branch>` BEFORE landing EVERY unit — the dev-agent cannot run it in-agent.

---

## 5. First dispatch — Unit 1 (runtime → module, behind a flag)

**Feature-flag discipline (load-bearing, mirrors `--parser=scrml-native`).** The ESM emit is a
`semantics-changed` landing (pa-base §8), and a module-shaped runtime loaded via a classic
`<script src>` throws on `export`. So EVERY unit lands behind a **`--module-format=classic|esm`
build flag (default `classic`)** — main stays byte-identical + green through U1–U5, and the
**default-flip is a single discrete, reviewable, revertable commit at U6**, gated on R26 +
S239. This also gives a clean A/B (compile both ways, diff) for the land gate. U1 introduces the
flag + the `esm` runtime shape; U2/U3 add chunk + script-tag emit under the same flag.

**Goal:** introduce `--module-format` (default `classic`, byte-identical to today) and, under
`esm`, emit `compiler/src/runtime-template.js` as a valid ES module that exports every symbol
chunks reference, with the R1 meta-block interception reworked to survive module bindings. NO
chunk/emit change yet (U2). U1 is provable in isolation by the survey harness (flag on).

**Exact loci (verified S278):**
- `function _scrml_reactive_get` L794 (the binding meta-tracking diverges from under ESM).
- Meta-block auto-tracking L2926–3045 (the `globalThis._scrml_reactive_get` monkey-patch — R1).
- `var _scrml_modules = (typeof _scrml_modules !== "undefined") ? …` L2872 (→ `export const
  _scrml_modules = {}`; drop the redeclare-guard).
- Perf hooks L608–611 (`globalThis._scrml_perf_*` — leave as-is, globalThis works in modules).
- 3 × `typeof _scrml_X !== "undefined"` self-guards (removable — modules init once, in order).

**Acceptance (Unit 1):**
- The emitted runtime parses as `type="module"` (add the export surface; no bare re-declare
  guards firing).
- A meta-block-using app (`^{}` dep-tracking) still tracks deps correctly after R1 rework —
  verify with a real `^{}` sample recompiled + executed (NOT grep).
- The survey harness pattern (`scratchpad/survey/run.mjs`, S278) re-run against the newly-emitted
  module: `linked:true`, reactive roundtrip green, subscribe fires.

**DONE-PROBE for Unit 1** (real command, for its own sub-thread if split out):
`bun test compiler/tests/unit/*runtime* 2>&1 | grep -q pass` — placeholder; the U1 dispatch names
the exact test.

---

## 6. Sequencing note

U1→U2→U3 are the emit spine (main-branch, PR-per-unit). U4 rebases the held Wave-1c branch onto
the new emit — do U4 AFTER U1–U3 land so the rebase target is stable. U5 (harness) can run
parallel to U2–U3 (it's test-infra, file-disjoint). U6 is the per-unit land gate, not a final
unit. Wave-1c pieces 2+3 (→ adopter #27) unblock when U4 lands.
