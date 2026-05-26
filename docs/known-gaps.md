# Known gaps — spec-vs-implementation drift

> **Honest current state.** The README describes the nominal language at the time of any version release ("does not describe what the compiler is perfectly capable of doing"). This document is the running ledger of the largest places where the compiler does NOT yet match the nominal spec. Entries are added as gaps surface (e.g., during dogfood passes, adopter bug reports, audit passes), and removed when the gap closes via a landed implementation arc.
>
> **Severity legend:** HIGH = adopter-visible breakage on a documented pillar feature or silent-wrong-output class. MED = silent acceptance + missing safety guarantees, or working-but-incomplete surface. LOW = ergonomic / cosmetic drift.
>
> **Per-gap status:** `spec'd` = SPEC normative + compiler does nothing · `partial-impl` = some sub-units shipped, others pending · `scoping` = SCOPING.md authored, OQs open · `in-impl` = implementation arc actively in flight · `deferred` = ratified to defer pending a precondition · `blocked` = waiting on something else · `nominal` = SPEC-only Nominal section (deliberately spec-ahead-of-implementation per author)
>
> Updated 2026-05-25 (S130 — comprehensive refresh post-S110-S130; supersedes prior S109 ledger; previously-closed S107-S109 items rotated out).

---

## §0 At-a-glance — open-gap inventory (counts)

| Severity | Open | Closed-this-arc | Notes |
|---|---|---|---|
| HIGH | 2 | E-TYPE-001 lifecycle fire (S130 Landing 1 SHIPPED) · §29 vanilla-interop framing-corrected (S132 — §2.1 false present-tense claim removed; §29 marked Nominal; NOT retired) · **E-FN-003 attributed-markup-return in `fn` (RESOLVED S133 `dbef4f4d`)** · **Bug 17 E-META-001 runtime-meta scoping gap (RESOLVED S134 `6c6c0073`)** | compiler-managed-async (deferred A9-class) · 6nz-V class:NAME on for-lift (GENUINE) |
| MED | 6 | Bug 15 `~snapshot` codegen leak (S131 SHIPPED) | Bug 1 Tailwind residuals · V-kill READ-side fire · E-SCHEMA-003 enforcement · MCP V0 partial-impl deferrals · Generator policy · L19 multi-statement-handler |
| LOW | 4 | (rotate out below) | Bug 4 bare-`/` · GITI-015 · §11-folded-citation sweep · `bun scrml promote --engine` Tier-1→2 deferred |
| Nominal (spec-ahead-of-impl) | 7 | — | Build Story §58 · `import:host` §21.3.1 · Quoted-text §4.18 compiler fire · `_{}` foreign code · WASM call-char sigils · Sidecar process decls · RemoteData enum |

---

## §1 HIGH — adopter-visible / silent-wrong-output

### Bug 17 — E-META-001 only fires in compile-time meta blocks; runtime blocks silently accept JS-host globals — `RESOLVED S134 (commit 6c6c0073)` (was HIGH)

**Surfaced S133 Step A** (commit `80b168e6`) — after closing the META_BUILTINS membership divergence, the Step A agent surfaced a second-order architectural gap. SPEC §22.12 line 14687 reads as **categorical**:

> "JS-host ambient globals (`bun`, `process`, `setInterval`, `fetch`, etc.) are NOT in the META_BUILTINS set and trigger `E-META-001`."

But pre-S134 meta-checker fired E-META-001 only inside **compile-time** meta blocks (`bodyUsesCompileTimeApis === true` from `reflect` / `emit` / `emit.raw` API references). A pure **runtime** meta block — `^{ const x = bun.eval(...); /* no reflect/emit */ }` — got early-returned in `checkMetaBlock` without consulting META_BUILTINS membership. The block emitted unchanged into the generated `_scrml_meta_effect` body. At JS runtime: `bun` is not a Bun-runtime global (only `Bun` capital-B is), so the call **silently failed with ReferenceError** at runtime.

- **Fix (S134 `6c6c0073`):** Approach A — new exported `checkMetaBlockForJsHostGlobals` walker (`compiler/src/meta-checker.ts` +160L) that runs UNCONDITIONALLY on every `^{}` body (compile-time AND runtime), parallel to `checkMetaBlock`. Scans against a new `JS_HOST_FORBIDDEN` Set (9 idents: `bun` / `Bun` / `process` / `console` / `setInterval` / `setTimeout` / `clearInterval` / `clearTimeout` / `fetch`). Respects local-decl shadowing, JS keywords, META_BUILTINS membership; recurses into nested `^{}`. Per-identifier hint messages (timer idents → `meta.interval`/`meta.timeout`; `fetch` → server-fn boundary; rest → generic 'not available'). Wired in `runMetaChecker` between `checkMetaBlock` and `checkReflectCalls` — preserves S133 Step A compile-time semantics verbatim. SPEC §22.11 catalog row broadened to enumerate the three E-META-001 fire conditions (disposition I; closes S114-introduced catalog drift). Regression tests at `compiler/tests/unit/meta-checker-bug17.test.js` (NEW, 33 tests = 1 set composition + 8 idents × runtime-fire + 2 bare-expr + 4 negative controls + 4 diagnostic-message + 1 reproducer end-to-end). Tests: 21,585 → 21,618 (+33, 0 fail). Full-suite gate green.
- **Corpus migration silent under prior gate:** 25 pre-existing tests in `meta-integration.test.js` (13 sites) + `runtime-meta-integration.test.js` (19 sites) used `console.log(...)` inside runtime `^{}` bodies as a "force runtime classification + observe pipeline emission" pattern. Post-fix, these correctly fire E-META-001. Migrated cleanly to `meta.emit(...)` (canonical scrml-native surface per §22.5.1) — semantically equivalent for the codegen-shape assertions these tests carry. Same migration shape adopters with similar test/sample code would need.
- **Open follow-ups (NOT regressions; separate concerns):**
  1. `meta.runtime=false` diagnostic at `meta-checker.ts:~1622` still uses pre-S134 phrasing — broaden for §22.5/§22.11 consistency. Polish.
  2. BS-path: `${ ^{} }` inside `<program>` markup interpolation produces only a `text` node (no meta block enters the pipeline). Latent issue separate from this fix. The canonical V5-strict shape (`p "test"\n^{ ... }\n`) surfaces the meta block correctly.
  3. `compileScrml({source, filePath})` vs `({inputFiles:[filePath]})` API surface divergence — the `source` path may take a shortcut bypassing the meta-checker pipeline. Surfaced for awareness.
- **Self-host parity DEFERRED** post-v1.0 per pa.md — `stdlib/compiler/meta-checker.scrml` + `compiler/self-host/meta-checker.scrml` mirrors carry pre-S134 META_BUILTINS as DATA only (no walker structure).
- **Original brief shape (preserved for forensic):**
  - Move the META_BUILTINS check OUTSIDE the `bodyUsesCompileTimeApis` early-return in `checkMetaBlock` (`compiler/src/meta-checker.ts`) — make it fire E-META-001 for runtime meta blocks too.
    - OR: add a sub-walker that runs unconditionally on every `^{...}` body and checks against META_BUILTINS / known-runtime-meta-API set.
    - Add regression-guard tests covering all 4 removed builtins × runtime context: `process` / `fetch` / `setInterval` / `setTimeout` / `Bun` / `console` (6 cases) inside `^{ ... }` with NO `reflect`/`emit`/`emit.raw` → assert E-META-001 fires.
    - Verify existing 14,566 baseline holds + add new tests (+6-8 logical assertions).
    - Per `feedback_restate_prerequisites_not_conclusions` — restate this entry's pre-dispatch sweep findings in the brief (corpus is empirically clean; no fallout expected).
  - **(c) / (d) REJECTED in deliberation:** (c) had no use case (the `meta.*` API covers runtime needs); (d) is a half-measure that doesn't close the silent-crash class.
- **Cross-refs:** Step A commit `80b168e6` agent report `OPEN follow-ups #1`; SPEC §22.12 line 14687 (the categorical statement); §22.5 + §22.5.1 (runtime meta surface); `compiler/src/meta-checker.ts` `checkMetaBlock` + early-return condition.
- **Not blocking adopters today** — pre-S133 adopters didn't write `bun.eval(...)` (the user-facing surface retired S130); post-S133 they're more likely to hit it via reflex. Watch adopter bug reports for first sighting; treat as load-bearing trigger if it shows up.

### Bug 9 — Compiler-managed async transitive coloring (A9-class) — `deferred`

When a client function calls a server function, the client function should be auto-async-and-awaited (per the "compiler owns the async wiring" pillar). Today the compiler doesn't fully thread this: `scheduling.ts::hasServerCallees` reads `route.functionName` (which is phantom — set in only some pipeline paths). The result: `serverFnNames` is sometimes empty; transitive client functions calling server functions never get `async`/`await` added, and the runtime silently runs the call as sync — returns a `Promise` where the call site expects the resolved value.

- **Workaround:** explicit `async`/`await` in client functions that call server functions (the very thing the language is supposed to do for you). Inelegant; the compiler IS supposed to handle this.
- **Reproducer:** the dashboard cluster (per S126 diagnostic). Any client function in a fn-body that calls a server-classified function.
- **Status:** DEFERRED to A9-class compiler-managed-async work per pa.md Rule 3 (3-layer fix; L3 = NEW transitive async-coloring subsystem; not blind-patched). Filed S126 + carried forward S127-S130. Not in any current implementation arc; queued for v0.7+ post-M6.

---

### Bug 10 — §29 vanilla-interop — SPEC vs implementation drift — `Nominal / framing-corrected S132`

**Originally (S110):** SPEC §2.1 + §29 asserted in the present tense that plain `.js`/`.html`/`.css` files "are valid alongside `.scrml` files; the compiler processes `.scrml` files and integrates or passes through the rest." Verified S110 the compiler did NOT do this — a pure-vanilla file is rejected (`Cannot find file or directory`); a mixed-project build compiles the `.scrml` and silently DROPS the vanilla files (not copied to dist). The bug was the FALSE present-tense CLAIM, not a missing feature.

- **Workaround:** keep all source in `.scrml`; for vanilla CSS use `#{}` blocks; for vanilla JS use `${}` blocks or `import` from `.js` modules (which IS live + load-bearing per §21).
- **Reproducer:** any project with a `.js` or `.html` file alongside `.scrml`.
- **Status:** **Nominal / framing-corrected S132.** Ratified option (c): the §2.1 false present-tense pass-through claim is REMOVED (reframed to explicit Nominal-future + S132 amendment note), and §29 is MARKED Nominal/spec-ahead-of-implementation (KEPT in SPEC, NOT retired — reaffirms S131 Q-W3-4 defer; re-trigger ≥2 adopter friction reports). NOT "RESOLVED-by-implementation": the feature is still NOT implemented; the spec now honestly says so. Vanilla-JS interop today is via §21 import (live + distinct from §29). The spec no longer makes a false claim, so this is no longer a spec-vs-impl drift — it is correctly-framed-as-Nominal.

---

### Bug 11 — 6nz-V `class:NAME` on for-lift reused DOM nodes — `confirmed GENUINE`

When a `for...of` loop with `lift` produces DOM nodes that get reused across renders, the `class:NAME` reactive class binding is not re-evaluated against the new iteration item — the original binding's evaluated class state persists on the reused node. Codegen IS correctly per-item-scoped; the gap is in the runtime lift/reconcile path.

- **Workaround:** use static class strings inside for-lift bodies; bind reactive classes outside the loop or via a per-item wrapper component that gets full re-mount.
- **Reproducer:** filed by 6nz S126; `class:active=@item.selected` inside `for (let item of @items) { lift <li class:active=...>...</li> }`.
- **Status:** GENUINE; runtime bug (lift/reconcile path), not codegen. Queued MED; not currently in implementation. Filed S126.

---

### Bug 12 — E-FN-003 false-positive on attributed-markup-return inside `fn` — `RESOLVED S133 (commit dbef4f4d)` (was HIGH)

A `fn` that returned (or `let`-bound) markup carrying ANY attribute (`class`, `id`, `href`, …) false-fired `E-FN-003: fn body writes to '<attr>'`. The fn-purity write-check `checkOuterScopeMutation` (`compiler/src/type-system.ts` ~12780-12813) ran a text-heuristic `ASSIGN_RE` regex over the SERIALIZED statement text (`nodeText` → `emitStringFromTree`, which re-serializes returned markup including attributes); markup `name="…"` / `name={…}` was indistinguishable from an assignment LHS to that regex. Blocked the canonical "fn returns markup" idiom (PRIMER §6.4 sub-shape 4 / kickstarter §11.11).

- **Fix (S133 `dbef4f4d`):** skip the text heuristic when the statement's serialized text starts with `<` (markup-shaped — `kind:"escape-hatch"` raw markup per `shouldSkipExprParse` at `ast-builder.js:122`). The structured assignment-kind path (`type-system.ts:12785-12798`) and the `@cell`-mutation path (`13013-13064`) are untouched — real purity enforcement preserved. Approach B (predicate-based skip) chosen over Approach A (excise serialized markup substrings) because markup-in-expression-position is stored as escape-hatch raw text, not as structured `kind:"markup"` AST. Regression tests (`compiler/tests/unit/fn-constraints.test.js` §8b — 4 tests incl. negative control asserting `counter = counter + 1` alongside attributed markup STILL fires on `counter`, not `class`). Tests: 21,584 → 21,588 (+4, 0 fail).
- **Known structural gap (separate enhancement):** outer-scope writes embedded inside markup interpolations (e.g. `<a href={counter = counter + 1}>`) are not detected pre- or post-fix; the markup escape-hatch isn't structurally parsed. Pre-fix, the regex's first match captured the attribute name (false-attributing the write); post-fix, the heuristic is skipped on markup-shaped statements. The reactive `@-cell` write path at `13013-13064` similarly doesn't reach into markup interpolations. To close this, the markup escape-hatch ExprNode would need structural parsing — separate enhancement, NOT a regression from this fix.

---

## §2 MED — silent acceptance / incomplete surfaces

### Bug 1 — Tailwind arbitrary-value classes — `partial-impl` (remaining: ring-offset + gradient + safelist + string-shaped)

Major families shipped S108-S109: grid / flex / aspect / transition / timing / individual transforms + shorthand + directional / outline / ring (length/color/var/keyword). The `W-TAILWIND-UNRECOGNIZED-CLASS` floor lint catches typos + unsupported arbitrary-values today.

**Still open:**
- **`ring-offset-*`** + **`bg-gradient-*` / `from-*` / `to-*` / `via-*`** — require Tailwind's preflight `*, ::before, ::after` custom-property layer (`--tw-ring-offset-shadow` / `--tw-ring-shadow` / `--tw-gradient-stops`). scrml has no preflight CSS emission infrastructure.
- **String-shaped arbitrary values** — `content-["text"]` + `font-[Inter]` need bracket-parser extension.
- **Safelist / `@apply`** — to distinguish custom user-defined classes from typos so the lint is precise on mixed Tailwind+custom-CSS codebases.

- **Workaround:** drop a `#{}` CSS shim block with the rules written by hand.
- **Status:** preflight blocker is the load-bearing piece; ring-offset + gradient unblock together when preflight infrastructure lands. Filed S108-S109; queued.

---

### Bug 12 — V-kill READ-side fire — `deferred`

S123 V-kill landed write-side enforcement (`@x = expr` at default-logic body-top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`). The READ-side fire (rejecting bare `@x` reads against undeclared cells inside `${...}` bodies) is deferred — the engine var-name canonicalization machinery is the unblocker.

- **Workaround:** declare all cells structurally with `<x> = init` before reading via `@x` in `${...}` bodies (which is the canonical V5-strict pattern anyway; the workaround IS the correct usage).
- **Status:** deferred S123; engine var-name canonicalization unblocks. Not adopter-visible if V5-strict patterns are followed; only surfaces if adopter typos `@x` against a name that doesn't have a `<x>` decl.

---

### Bug 13 — E-SCHEMA-003 enforcement — `spec'd` (no fire site)

S130 HU-2 Q7 ratified `<schema>` placement as immediate child of `<program>` (per F-019). SPEC §34 E-SCHEMA-003 catalog row updated S130. The compiler currently has NO fire site for E-SCHEMA-003 — a misplaced `<schema>` block compiles clean and emits unexpected SQL/runtime behavior instead of the loud compile error the SPEC promises.

- **Workaround:** verify `<schema>` is an immediate child of `<program>` at write-time; if you see runtime SQL anomalies in mixed-placement projects, check schema placement first.
- **Status:** flagged at S130 HU-2 Q7 as Phase 2 implementation follow-on. Filed; not yet dispatched.

---

### Bug 14 — MCP V0 partial-impl + deferred items — `partial-impl`

MCP V0 sub-units A+B+C+D shipped S125-S130. V0.E (E2E + adopter docs + fixture multi-page app) pending. V0.D (this session S130) has 3 deferred items that limit current capability:

1. **Runtime-helper registration on globalThis** — today's boot reads `globalThis._scrml_reactive_get` which is never set (runtime is module-scoped per generated `.server.js`). Tool resolvers gracefully degrade for V0 (descriptor sidecars carry topology data; runtime cell reads return undefined).
2. **`scrml dev` (in-process Bun.serve)** gets NO MCP wiring — boot lives only in build-time `_server.js`. Use `scrml build` + run the server entry to get MCP working in dev.
3. **"dev-only" semantics use RUNTIME NODE_ENV gate** (not compile-time) — no §58 Build Story hook exists yet; revisit when §58 implementation lands.

- **Workaround:** for V0.E specifically, no workaround — the adopter setup doc + E2E examples don't exist. For deferred items: use `<program mcp="always">` to override the dev-only gate; build via `scrml build` not `scrml dev`.
- **Status:** V0.E queued (~10-12h per SCOPING §3.E). Deferred items revisit at §58 land.

---

### Bug 16 — Generator policy — `open` (S114)

`yield` / `yield*` / `function*` are NOT covered by the S114 "no async/await" rule (preserved in the JS-subset bound at M4.3 per S114). Semantic policy is open: do generators belong in scrml, and if so under what discipline (compiler-managed iteration vs user-authored protocol)?

- **Workaround:** use generators if needed; they parse. Compiler doesn't generate diagnostic surface around them either way.
- **Status:** open. Filed S114; not dispatched.

---

### Bug 17 — L19 multi-statement-handler relaxation — `queued for HU`

L19 forbids multi-statement event handlers (`onclick=` must be a single expression, not a multi-statement block). The rule was ratified pre-engines; engines + body-split CPS may have changed the design constraints. Carry-forward question: should L19 relax under modern scrml composition?

- **Workaround:** wrap multi-statement handlers in a named function (`function handle() { ... }; <button onclick=handle()>`).
- **Status:** open HU follow-on; small enough to fold into iteration HU or its own sub-session.

---

## §3 LOW — ergonomic / cosmetic

### Bug 4 — Bare `/` in markup-text body parses as element closer — `spec'd`

The `?{` half closed S108 via Approach C-narrow (markup-text-mode locus gate per SPEC §3.1 + §8.1). Bare `/` half remains open. Writing scrml-about-scrml prose where `/` appears in text (e.g., "`""` / `0` / `[]` are all defined values") can still confuse the BS-layer's `looksLikeCloser` heuristic in edge cases.

- **Workaround:** entity-encode (`&#47;`) when `/` appears at scrml-content-as-data positions in prose.
- **Status:** Q-BUG4-OPEN-5 in deep-dive `scrml-support/docs/deep-dives/bug-4-docs-mode-escape-2026-05-19.md`; broad-C extension if friction surfaces beyond the single dogfood citation.

---

### Bug 18 — GITI-015 — `queued`

LOW-severity adopter bug filed by giti per S124 carry-forward. Details in `handOffs/incoming/read/`. Queued; not currently in implementation.

---

### Bug 19 — §11-folded-citation sweep — `cosmetic`

5 dev.to articles cite SPEC `§11` for `<db>` / `protect=` / state-authority content. §11 is folded (content distributed to §6.12 + §52 per SPEC-INDEX row 44). The E-codes those articles cite are correct; only the bare section number is stale. Lowest-priority cleanup item.

- **Workaround:** none needed; the articles' E-code citations still resolve.
- **Status:** filed S115 article-truthfulness audit §3.4; safe to fold into any future article edit pass; not dispatched separately.

---

### Bug 20 — `bun scrml promote --engine` (Tier-1→2 sibling) — `deferred`

The `bun scrml promote --match` CLI shipped S66 (Tier-0→1 lift mechanical). The companion `--engine` flag (Tier-1→2 lift) is deferred — it pairs with `W-MATCH-TRANSITIONS-ACCRUING`, a sibling lint that needs its own §34 catalog + implementation groundwork. The CLI flag stays registered but prints a clear "deferred" message until that lands.

- **Workaround:** manual conversion from `<match for=Type>` block-form to `<engine for=Type initial=.Variant>` — state-children carry forward verbatim; add `initial=` + per-arm `rule=`.
- **Status:** deferred; queued post-W-MATCH-TRANSITIONS-ACCRUING.

---

## §4 Nominal — SPEC sections deliberately spec-ahead-of-implementation

These are SPEC-only surfaces — designed, normatively documented, NOT yet implemented in the compiler. The author has explicitly ratified them as "spec-ahead-of-implementation" (Nominal sections). Adopters should treat as roadmap, not present capability.

### Nominal-1 — Build Story §58 — `nominal`

S118 landed SPEC §58 "Build Story" as a Nominal section. Compilation as a pure function `compile(source, buildStory) → artifact`; content-addressed Merkle closure (Approach B); `[story]` manifest table; per-`<program>` `story=` attribute; `build-story.lock` sidecar; cryptographic SHA-256 closure hash. **No compiler implementation exists.** Includes a §58.12 determinism-gap analysis flagging the `*`-marked claims.

- **Status:** Nominal. Implementation arc estimated ~90-200h (per S124 build-story-research-roughing); M6-gated (M6 cutover precedes substantive build-story work).

### Nominal-2 — `import:host` §21.3.1 — `nominal`

S114 ratified `import:host` declaration form as the manifest-gated self-host bootstrap bridge (Approach C carve-out). **Zero references in `compiler/native-parser/` or `compiler/src/`** per S129 D8b finding — the syntax is SPEC-only.

- **Status:** Nominal. Implementation arc is part of the self-host bootstrap migration (post-v1.0 — see master-list).

### Nominal-3 — Quoted-text model §4.18 compiler fire — `nominal`

SPEC §4.18 landed Wave 1 S111 — the code-default body mode + `"..."` display-text literal + `E-UNQUOTED-DISPLAY-TEXT` error code. The compiler fire is spec-ahead-of-implementation; Waves 2+ ship with the native parser (v0.4.x → v0.5).

- **Status:** Nominal until native parser default-flip + quoted-text BS-retrofit / native-implementation lands. The examples in dev.to articles + samples that show bare display prose inside engine/match arm bodies are NOT wrong against today's compiler.

### Nominal-4 — `_{}` foreign code — `nominal`

§23 — embed non-JS code inline with level-marked braces (`_{}`/`_={...}=`). Enables inline Rust, Python, SQL extensions. Specced, not yet implemented.

### Nominal-5 — WASM call-char sigils — `nominal`

§23.3 — single-character sigils (`r{}`, `c{}`, `z{}`) for invoking compiled WASM functions from Rust, C, Zig. Specced, not yet implemented.

### Nominal-6 — Sidecar process declarations — `nominal`

§23.4 — `use foreign:name { fn }` for declaring server-side sidecar processes (HTTP/socket services). Specced, not yet implemented.

### Nominal-7 — `RemoteData` enum — `nominal`

§13.5 — built-in `Loading / Loaded(T) / Failed(Error)` enum for modeling async fetch state. Pattern-matchable with exhaustive checking. Specced, not yet implemented.

---

## §5 Lifecycle annotation surface — partial-implementation status

S130 lifecycle DD + HU-1 ratified `(A to B)` extension scope to non-engine cells (Approach C); 3 landings planned:

| Landing | Scope | Status |
|---|---|---|
| 1 | E-TYPE-001 fire (per-access transition-state tracking in `type-system.ts`) | **SHIPPED S130** (`1feaedc9`) — see §7 rotation |
| 2 | Approach C extension to fn params + fn return + schema fields + channel cells + `->` → `to` glyph migration + new §14.X subsection + `E-TYPE-LIFECYCLE-ON-ENGINE-CELL` engine-cell rejection | queued (next dispatch) |
| 3 | PRIMER + kickstarter flagship section (per F-023) | queued post-Landing 2 |

Authority: lifecycle DD at `scrml-support/docs/deep-dives/lifecycle-annotation-extension-and-flagship-scope-2026-05-25.md`; HU-1 at `docs/heads-up/lifecycle-annotation-extension-2026-05-25.md`.

---

## §6 Adopter bugs queued (filed but not yet fixed)

- **6nz-V** — `class:NAME` on for-lift reused DOM nodes — see Bug 11 (HIGH). Confirmed GENUINE S126.
- **6nz-U** — filed S126; queued. (Details in `handOffs/incoming/read/`.)
- **6nz-L / 6nz-T** — filed S126; M6-deferred. (Details in `handOffs/incoming/read/`.)
- **GITI-015** — filed S124; LOW. (See Bug 18.)

---

## §7 Closed in S110-S131 (rotation; will rotate out next refresh)

**S131:**
- **Bug 15 (MED) — `~snapshot` raw-sigil codegen leak** — SHIPPED per HU-5 Q-W35-1 (a) ratification. Two-part defensive codegen fix: (1) `emit-logic.ts:bare-expr` skips the spurious orphan `~` bare-expr the live parser peels off `~snapshot = {...}` leads; (2) `emit-expr.ts:emitIdent` adds a defensive marker `null /* ~ orphaned — codegen-fallback */` for any nested-expression orphan that bypasses the bare-expr branch. Regression test `compiler/tests/integration/tilde-snapshot-codegen-fix.test.js` (3 tests, all pass). SPEC §32 unchanged per pa.md Rule 4 — `~snapshot` is NOT a new language form; the native parser already handles the unified `~ IDENT = expr` lead, mirroring that in the live parser surfaceable as a separate follow-up. Closes the S125 Wave 14 DD-surfaced silent-correctness class for the tilde-decl reactive-deps path.

**S130:**
- **Bug 8 (HIGH) — E-TYPE-001 lifecycle access-before-transition fire** — Landing 1 SHIPPED (`1feaedc9`). Per-access transition-state tracking implemented in `compiler/src/type-system.ts` (+666 LOC + design pick β symbol-table side-table mirroring `checkFunctionBodyStateCompleteness` precedent). +33 new tests (27 unit / 6 integration) / +50 expect() calls. Closes the ~6+ week SPEC §14.3 line 7106 spec-vs-impl gap that the mutability-contracts article publish-twin's status banner had been acknowledging. Diagnostic message names binding + field name + struct type + pre-state type + post-state type + resolution path + SPEC anchor. Landing 2 (extension to non-engine cell positions + `->` → `to` glyph migration + engine-cell rejection diagnostic) queued.
- **Phase 2 Cluster A — V-kill SPEC sweep** — A1-A6 all 6 amendments landed (`b0244869`). Grammar production relocated to §6.1.5; §52.4.1 grammar folds in; ~90 worked-example sites migrated SPEC-wide. Closes F-001 / F-008 / F-009 / F-016 (1a/1b LB).
- **Phase 2 Cluster B-code — Approach C source-cascade** — 9 of 10 sites cleaned (`35262911`). Site 1 (`rewriteBunEval` function retirement) DEFERRED pending three prerequisite sub-tasks (META_BUILTINS purge → 5 meta-eval call drops → Pass 4 drop + test retire). Agent's Phase-0 root-cause confirmation caught the brief's "zero callers" assumption was wrong (7 active callers); banked-rule earning its keep. Closes F-002 / F-003 / F-009 (1a) / F-010 (compiler half).
- **F-021 PIPELINE `deriveEngineVarName`** — PIPELINE doc-only fix per HU-2 Q6 ratification. Compiler already aligned with SPEC §51.0.C.
- **F-019 `<schema>` placement** — SPEC §39 prose rewrite per HU-2 Q7 ratification (no longer documents "alongside not inside"; immediate child of `<program>`). E-SCHEMA-003 catalog row updated. (Compiler-side enforcement still open — see Bug 13.)
- **F-018 §55.5 validity surface predictability** — SPEC + PIPELINE prose alignment per HU-2 Q8. Compiler already implements unconditional synthesis.
- **F-003 Approach C SPEC subsumption** — §22.4 + §30 + §7.2 + §22.12 + §34 amendments per HU-2 Q4 ratification. `bun.eval()` retires as user-facing surface. (Compiler-source cleanup of 8 sites in flight S130 Cluster B-code dispatch.)
- **MCP V0.D** — `<program mcp>` attribute wiring + auto-install per SCOPING §3.D. (V0.E still pending — see Bug 14.)
- **Lifecycle annotation HU-1** — 7 ratifications closed; Phase 2 amendment scope crystallized (3 landings).

**S129:**
- **HU-2 batch (6 questions + lifecycle thread)** — F-001 / F-008 / F-009 / F-016 V-kill cluster ratifications; F-023 + F-024 lifecycle annotation flagship + `(A to B)` syntax.
- **D8a-i function `-> ReturnType` annotation** — native parser fix; 4 corpus files closed; +21 tests.

**S128:**
- **D3 `:>`-arm separator** — native parseMatchArm now accepts `:>` per live-parity.
- **D6 string-literal import specifier** — `import { "kebab" as alias }` per SPEC §38.12.5.
- **D7 `given` presence-guard** — `given ident => { body }` per §42.2.3.

**S126:**
- **Bug W (CRITICAL)** — precedence-aware `emitBinary`; `(2+3)*4` no longer silently drops grouping parens.
- **GITI-017 (CRITICAL silent-corruption class)** — `not` keyword no longer corrupts regex literals; lowering pass now skips regex bodies + comments + string interiors.
- **6nz-P** — runtime chunker tree-shake gap; declarative `CHUNK_DEPENDENCIES` table with `scope → [timers, animation]` edge.
- **GITI-019** — lift-loop coalesce parens before `?? ""`.
- **GITI-018** — multi-`scrml:` library-mode imports now all rewrite.
- **6nz-S** — `return not` statement-glue at both lowering sites.

**S123:**
- **Bug Q (V-kill / Unit CC)** — silent runtime → loud compile error. Bare `@x = expr` at default-logic body-top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`.

**S110-S122:**
- Native parser arc M1-M3 + MK1-MK3 (compiler-internal; opaque to adopters except as parse-completeness wins)
- v0.4.0 / v0.5.0 / v0.6.0 release cuts (S114/S115/S118)
- L22 family — formFor (S102-103) + schemaFor (S104) + tableFor (S105)
- Match block-form Phase 3+4+5 codegen
- Tailwind arbitrary-value families (grid / flex / aspect / transition / transforms / outline / ring length/color/var/keyword) — Bug 1 partial-impl per §2

---

## §8 Where this list comes from

- **Dogfood bug reports** filed when the user/PA hits friction on real adopter-shaped work — see `handOffs/incoming/read/` for archived reports.
- **Spec-vs-impl audit passes** when sweeping a SPEC section (e.g., the S107 §18.0 surface audit that discovered the match block-form gap; the S129 grammar-consolidation Phase 1a/1b/1c audits).
- **Adopter bug reports** (6nz + giti to date; queued in `handOffs/incoming/read/`).
- **PA self-discovery** during implementation work when a planned fix surfaces a deeper gap (e.g., the W-MATCH-RULE-INERT lint attempt surfacing the broader §18.0.1 unparsed state; S130 lifecycle DD surfacing the E-TYPE-001 unimplemented fire).
- **Deep-dive critical findings** (e.g., S130 lifecycle DD's `type-system.ts:1444` per-access transition-state gap).

## §9 Where to discuss / report

- **New gaps in adopter code:** file a GitHub Issue at https://github.com/bryanmaclee/scrmlTS
- **Cross-reference with phase status:** [`master-list.md`](../master-list.md) §0 LIVE DASHBOARD
- **Per-gap implementation arcs:** [`docs/changes/`](./changes/) — each gap with an active impl arc has a SCOPING.md + progress.md there
- **Per-session landings:** [`docs/changelog.md`](./changelog.md)
- **Audit + deep-dive doc inventory:** [`docs/audits/`](./audits/) + `scrml-support/docs/deep-dives/`
