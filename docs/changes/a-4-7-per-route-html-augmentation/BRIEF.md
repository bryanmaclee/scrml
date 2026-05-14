# A-4.7 — Per-route HTML augmentation + role-detection bootstrap + W-CG-CHUNK-* lints + runtime helper closure

**Status:** STAGED (ready to fire AFTER A-4.4 + A-4.6 land — though FILE-DISJOINT with A-4.5 so technically dispatch-able post-A-4.4-and-A-4.6).
**Authored:** S91 mid-session (2026-05-14).
**Sequence:** A-4.7 closes the A-4 wave. Per SCOPING §7.1's dependency graph it depends on A-4.2 (initial chunk content for the HTML script tag), A-4.4 (data-scrml-prefetch wiring expected by hover-prefetch runtime), and A-4.6 (real chunk-filename hashes for the HTML script src). A-4.3 + A-4.5 contribute the tier-1 prefetch + tier-N dispatch surfaces consumed by the HTML bootstrap.
**Estimated walltime:** **8-14h** per A-4 SCOPING §3.7.
**Dispatch agent:** `scrml-js-codegen-engineer` with `isolation: "worktree"`.

---

# What A-4.7 closes — including the A-4.2 forward-looking gap

A-4.7 is the closure of the A-4 wave. Beyond SCOPING §3.7's primary scope (HTML augmentation, role-bootstrap, lints), this brief expands the scope to **close the runtime-helper gap A-4.2 surfaced**:

**A-4.2 deferred item (verbatim from A-4.2 landing commit):**
> *"The atom-emitter output references `_scrml_chunk_mount(id, tag)` and `_scrml_vendor_require(unit)` runtime helpers that DO NOT YET exist in SCRML_RUNTIME. The chunk JS is structurally correct + deterministic (satisfies §40.9.7 + §40.9.8 contracts) but ACTIVATING the chunks in a running browser requires these helpers."*

A-4.7 ADDS these helpers to `compiler/src/runtime-template.js` because they're the natural pairing for the per-route HTML role-detection bootstrap. The bootstrap loads the per-role chunk; the chunk's IIFE invokes `_scrml_chunk_mount` and `_scrml_vendor_require`; without the helpers the chunk fires nothing. They MUST land together for adopter apps to actually run.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4 — RE-EMPHASIZED)

Your worktree path MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`.

## CRITICAL: F4 LEAK PREVENTION

**F4 path-discipline leak occurred in S91 once** — a sibling dispatch wrote work to MAIN's working tree while ALSO committing to its worktree branch. PA cleaned via `git checkout HEAD --`; the agent's work landed properly when it completed.

**Defense for THIS dispatch:**

- Save `WORKTREE_ROOT` from `pwd` at startup verification.
- For EVERY Write/Edit call, the file path MUST start with `$WORKTREE_ROOT/`.
- NEVER use absolute paths starting with `/home/bryan-maclee/scrmlMaster/scrmlTS/` directly.
- Before EACH Write/Edit, audit the absolute path begins with `$WORKTREE_ROOT/`.

## Startup verification (BEFORE any other tool call)

1. `pwd` — MUST equal worktree path AND MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under another repo: STOP and report. Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` — must equal WORKTREE_ROOT.
3. `git status --short` — confirm tree clean.
4. `bun install`.
5. `bun run pretest`.

If ANY check fails: STOP. Report. Exit.

---

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` (~118 lines).

Relevant maps:
- `primary.map.md` — project orientation + S91 status
- `domain.map.md` — Task-Shape Routing; A-4.x status (A-4.1..A-4.6 closure entries expected by A-4.7 dispatch time)
- `dependencies.map.md` — codegen + runtime-template.js consumers
- `structure.map.md` — `compiler/src/codegen/emit-html.ts` position + emit-* family layout
- `error.map.md` — existing W-CG-* warning catalog (W-CG-001, W-CG-UNDEFINED-INTERPOLATION) for the new W-CG-CHUNK-* family pattern

Feedback in final report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "Maps consulted but not load-bearing".

---

# ANTI-PATTERNS + KICKSTARTER (mandatory pre-read)

- `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`
- `docs/articles/llm-kickstarter-v1-2026-04-25.md`

**Absolute rules** (HARD):
- `null` and `undefined` do NOT exist in scrml. TS impl + runtime-template.js is JS-host; JS-host null/undefined are fine there.
- For emitted runtime JS, all scrml absence is canonically JS `null` per §42.5/§42.8.
- Self-host is from-scratch rewrite.
- try/catch is NOT in scrml's vocabulary. Runtime JS in runtime-template.js — audit existing style before authoring.

---

# Commit discipline — TWO-SIDED RULE (mandatory)

> After EVERY edit: `git diff <file>`; `git add <file>`; commit IMMEDIATELY. Don't batch.
> Before reporting DONE: `git status` MUST be clean.
> NO `--no-verify` without explicit user authorization. **This brief does NOT authorize it.**

---

# Required prior reading

1. **`docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md`** — §3.7 (A-4.7 row) IN FULL + §5 OQ-A4-E ratification (hybrid: ONE HTML per route + role-detection bootstrap loads per-role initial chunk).
2. **`compiler/src/codegen/emit-html.ts`** — read end-to-end. Current per-file HTML emitter. A-4.7 augments the chunk-aware paths.
3. **`compiler/src/codegen/route-splitter.ts`** at HEAD (post-A-4.1..A-4.6) — the orchestrator + ChunkOutput + chunks.json manifest you consume.
4. **`compiler/src/codegen/atom-emitter.ts`** — A-4.2's atom-emitter output references `_scrml_chunk_mount(id, tag)` and `_scrml_vendor_require(unit)`. A-4.7 implements these helpers.
5. **`compiler/src/runtime-template.js`** — audit `_scrml_prefetch_tier1` (A-4.3) + `_scrml_prefetch_tier2` (A-4.4) + `_scrml_fetch_chunk` (A-4.5) for style + naming.
6. **`compiler/src/codegen/errors.ts`** (or similar W-CG-* catalog file) — existing W-CG-001, W-CG-UNDEFINED-INTERPOLATION rows. A-4.7 adds W-CG-CHUNK-* family.
7. **SPEC §40.9.7** (per-tier output structure normative); **§40.8** (v0.3 program shape); **§47.9.2** (route URL inference).

---

# THE TASK — A-4.7 wave-closure

## Sub-task 1 — `_scrml_chunk_mount(id, tag)` + `_scrml_vendor_require(unit)` runtime helpers

In `compiler/src/runtime-template.js`, add the two helpers referenced by A-4.2's atom-emitter output. Place near the other `_scrml_*` runtime helpers. Style + naming mirror `_scrml_prefetch_tier1` / `_scrml_prefetch_tier2` (A-4.3 + A-4.4).

```js
// --- scrml chunk mount ---
//
// Mark an admitted markup node as "present in the chunk" — invoked from
// the chunk IIFE's atom-emit output (per A-4.2 emitComponentAtom).
// In v0.3 this is structurally a record-keeping helper; the actual
// markup-render wiring is handled by the per-file emit-client.ts path
// when the chunk's atoms are composed.
//
// id: stable MarkupNode id from SymTab / DG; tag: lowercase HTML tag
// name for adopter-debug tooling. Side-effect: pushes to module-scoped
// _SCRML_MOUNTS array for chunk-replay determinism + audit.
//
function _scrml_chunk_mount(id, tag) {
  if (typeof _SCRML_MOUNTS !== "object" || _SCRML_MOUNTS === null) {
    _SCRML_MOUNTS = {};
  }
  _SCRML_MOUNTS[id] = tag;
}

// --- scrml vendor require ---
//
// Reference a vendor unit declared via `use vendor:NAME`. The vendor
// unit itself is a separate per-app artifact (per SPEC §41); this
// helper marks the chunk's dependency for tree-shake / load-order
// purposes. In v0.3 the call is a no-op; the actual vendor-unit script
// inclusion happens via the per-route HTML's <script> ordering (see
// sub-task 4).
//
// unit: vendor-unit name as declared in the source (e.g., "cm6").
//
function _scrml_vendor_require(unit) {
  if (typeof _SCRML_VENDOR_REFS !== "object" || _SCRML_VENDOR_REFS === null) {
    _SCRML_VENDOR_REFS = {};
  }
  _SCRML_VENDOR_REFS[unit] = true;
}
```

(Final shape is the agent's call — these are sketches. The constraint is: existing atom-emitter output `_scrml_chunk_mount(<id>, "<tag>")` and `_scrml_vendor_require("<unit>")` calls must resolve to a real function definition in the emitted runtime. The functions can be no-ops in v0.3 as long as they exist + don't throw.)

Add `mount` + `vendor-ref` section markers in `runtime-chunks.ts` for tree-shake elision (no chunks → no atom-emitter output → helpers elided).

LOC estimate: ~30 LOC (per the brief's gap-closure expansion; SCOPING §3.7 didn't budget for this).

## Sub-task 2 — Per-route HTML augmentation in `emit-html.ts`

For each entry-point (`<page>` or SPA-program), emit HTML that includes:

### 2.A — Role-detection bootstrap script

Per OQ-A4-E ratification (hybrid): ONE HTML per route + role-detection bootstrap.

```html
<!DOCTYPE html>
<html>
<head>
  ...existing head content (CSS, meta tags, etc.)...

  <script>
    // scrml role-detection bootstrap (OQ-A4-E S91 ratification)
    //
    // Read role hint from document.cookie / localStorage / <meta> tag;
    // dispatch to the role-appropriate initial chunk via dynamic
    // <script src="..."> injection. Fallback: load the _anonymous
    // chunk per A-2.5 Component 4 sentinel.
    //
    (function () {
      function getRole() {
        // Order of preference: localStorage > cookie > meta tag > _anonymous
        try {
          var ls = localStorage.getItem("scrml_role");
          if (ls) return ls;
        } catch (e) {}
        var cookieMatch = document.cookie.match(/(?:^|;\s*)scrml_role=([^;]+)/);
        if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
        var meta = document.querySelector('meta[name="scrml-role"]');
        if (meta) return meta.getAttribute("content");
        return "_anonymous";
      }

      var role = getRole();
      var chunkUrl = window._SCRML_CHUNKS &&
        window._SCRML_CHUNKS["<entry-point-id>"] &&
        window._SCRML_CHUNKS["<entry-point-id>"][role] &&
        window._SCRML_CHUNKS["<entry-point-id>"][role].initial;
      if (!chunkUrl) {
        console.warn("scrml: no chunk for role '" + role + "' at route '<route>'");
        return;
      }
      var s = document.createElement("script");
      s.src = chunkUrl;
      s.defer = true;
      document.head.appendChild(s);
    })();
  </script>
</head>
<body>
  ...existing body content...
</body>
</html>
```

### 2.B — `_SCRML_CHUNKS` manifest inline

Inject the chunks.json content (or a subset for the current route) as an inline `<script>` BEFORE the role-detection bootstrap:

```html
<script>
  window._SCRML_CHUNKS = { ...chunks.json content... };
</script>
<script>
  // role-detection bootstrap (above)
</script>
```

This closes the A-4.4 placeholder: `_scrml_prefetch_tier2(routePath, role)` reads `_SCRML_CHUNKS` at runtime to resolve chunk URLs.

### 2.C — `<link rel="modulepreload">` for tier-1 chunks (optional belt-and-suspenders)

Per SCOPING §3.7 (2): "Tier-1 is fetched via runtime `requestIdleCallback` not via `<link rel="prefetch">` browser-driven — the SHOULD-suggest in §40.9.7 is runtime-mediated; modulepreload is an additional belt-and-suspenders surface."

Emit `<link rel="modulepreload" href="<route>/<role>.tier1.<hash>.js">` for each non-empty tier-1 chunk for the role-set. Browser prefetch + the runtime `requestIdleCallback` work in tandem.

If tier-1 admission is empty (the §40.9.9 worked-example floor), no modulepreload link emitted.

### 2.D — `data-scrml-prefetch="<route>"` attributes on `<a href>` elements

This is already in A-4.4's scope. A-4.7 verifies the attribute emission happens; doesn't re-emit. (If A-4.4 hasn't landed by A-4.7 dispatch time, surface as deferred-item.)

LOC estimate: ~80 LOC for emit-html.ts (per SCOPING §3.7).

## Sub-task 3 — Route URL inference

Per SCOPING §3.7 + SPEC §47.9.2: the HTML augmentation needs to know what URL the route lives at, what role-variant it serves, what chunk-hash matches.

Read from:
- RouteMap.pages — produced by RI (Stage 5).
- chunks.json (from A-4.6) — maps `(EntryPointId, RoleVariant, Tier) → chunk_filename`.
- `routeSegmentFromEntryPointId(epId)` helper in route-splitter.ts (A-4.1 stub; A-4.2 surfaced that the helper uses `::#page::` markers that don't match real-pipeline IDs — flagged for A-4.7). **A-4.7 should fix this helper** to properly extract the route URL from real-pipeline entry-point IDs:
  - `<file>#program` → route URL from `RouteMap.entryFile.programRoute` (probably `"/"`).
  - `<file>#page@<route>` → `<route>` directly.
  - `<file>#page-<N>` → fallback path derived from N + RouteMap pages array.

LOC estimate: ~30 LOC orchestration in route-splitter.ts (per SCOPING §3.7).

## Sub-task 4 — W-CG-CHUNK-* lint catalog

Add a new lint family for chunk-emission diagnostics:

- **W-CG-CHUNK-EMPTY** (info) — fires when an entry-point produces zero non-empty chunks across all roles (probably indicates a misconfigured `<page>` or empty content).
- **W-CG-CHUNK-LARGE** (info) — fires when an initial chunk's payload exceeds N bytes (default 100KB?). Soft signal for size budget awareness.
- **W-CG-CHUNK-NO-PREFETCH** (info) — fires when a route has internal `<a href>` links to other entry points but no tier-2 hover-prefetch is wired (probably indicates A-4.4 isn't active OR adopter explicitly opted out).
- **W-CG-CHUNK-MISSING-ROLE** (warning) — fires when an `<auth role="X">` block references a role that has no per-role chunk emitted (probably a typo or unimplemented role variant).

Pick whichever subset is genuinely useful + has a clear remediation path; document each.

Add §34 catalog rows + §40.9.11 catalog table extension (mirror W-AUTH-LOGIN-MISSING pattern from 03-contact-book S91 commit).

LOC estimate: ~20 LOC for `compiler/src/codegen/errors.ts` (or wherever W-CG-* family lives). Plus SPEC.md §34 + §40.9.11 row additions.

## Sub-task 5 — Tests

Create `compiler/tests/unit/codegen-html-augmentation.test.js` (NEW) + extend integration tests:

1. **Role-detection bootstrap present**: assert emitted HTML contains `<script>` reading `localStorage` + `document.cookie` + `<meta name="scrml-role">` in fallback order.
2. **`_SCRML_CHUNKS` inline**: assert emitted HTML contains `window._SCRML_CHUNKS = { ... }` matching chunks.json content for the current route.
3. **`data-scrml-prefetch` wired**: compile fixture with `<a href="/loads">`; assert emitted HTML has `data-scrml-prefetch="/loads"` (from A-4.4's wiring, regression-tested here).
4. **modulepreload links**: compile fixture with non-empty tier-1; assert HTML has `<link rel="modulepreload">` for each role's tier-1 chunk.
5. **Modulepreload elision**: compile fixture with empty tier-1; assert NO modulepreload link.
6. **`_scrml_chunk_mount` definition**: compile fixture; assert emitted runtime includes `function _scrml_chunk_mount(...)`.
7. **`_scrml_vendor_require` definition**: compile fixture with vendor unit references; assert emitted runtime includes `function _scrml_vendor_require(...)`.
8. **Tree-shake elision**: compile fixture with no chunks emitted; assert `_scrml_chunk_mount` + `_scrml_vendor_require` NOT in emitted runtime.
9. **End-to-end activation**: compile §40.9.9 worked example with `emitPerRoute: true`; assert emitted HTML loads role-appropriate chunk; assert the chunk's `_scrml_chunk_mount` calls resolve to the now-defined runtime helper (no ReferenceError).
10. **W-CG-CHUNK-* lint tests**: synthesize fixtures triggering each new lint code; assert appropriate diagnostic emitted.
11. **§40.9.9 worked-example HTML output**: assert per-route HTML for `/` references `Driver.initial.<hash>.js` and (separately) `Admin.initial.<hash>.js` via chunks.json + bootstrap dispatch.
12. **Determinism**: two builds of identical source → byte-identical HTML output.

Aim for 12-18 tests.

## Sub-task 6 (polish) — PIPELINE.md Stage 8 + maps polish

Update `compiler/PIPELINE.md` Stage 8 with A-4.7 wire-in note. Note: **A-4 wave fully closed** at this commit. ~5-10 lines.

Update `.claude/maps/domain.map.md` Task-Shape Routing + v0.3.0 Status with A-4.7 closure entry + A-4 wave-close summary.

Update `compiler/SPEC.md` §40.9 cross-refs if needed (most likely §40.9.11 catalog table for the W-CG-CHUNK-* rows). §34 catalog rows for the new W-CG-CHUNK-* family.

Update `master-list.md` §0.1 phase progress table — flip A-4 wave status to **CLOSED**.

---

# What NOT to do

- DO NOT modify A-4.1's CgInput.emitPerRoute / CgOutput.chunks contract (stable, consumed by tests).
- DO NOT modify A-4.6's chunk hashing or chunks.json shape.
- DO NOT modify A-4.2's atom-emitter shape (atom-emitter.ts is stable READ-ONLY for A-4.7).
- DO NOT add telemetry-version axis to the HTML output (§40.9.8 explicitly forbids non-static input).
- DO NOT touch `compiler/src/auth-graph.ts` or `compiler/src/reachability-solver.ts` (S91 closed).
- DO NOT modify the SPEC.md §40.9 prose beyond §34 + §40.9.11 catalog row additions.
- DO NOT add a separate per-(route, role) HTML file per OQ-A4-E rejection of Option (b).

# Sibling-dispatch awareness

At brief authorship: A-4.3 (Q task — tier-1 idle-prefetch) in flight; A-4.4 + A-4.5 + A-4.6 briefs staged. A-4.7 dispatches IDEALLY after A-4.6 lands (HTML script src needs real hashes from A-4.6). **Minimum viable: post-A-4.4** because A-4.7 verifies A-4.4's `data-scrml-prefetch` wiring; if A-4.4 hasn't landed, surface as deferred-item (test #3 stays `.skip` until A-4.4 ships).

Cherry-pick recovery is standard when sibling files have additive landings. Per `feedback_file_delta_vs_cherry_pick.md`.

---

# Reporting

When DONE, report:

1. Sub-task 1 — runtime helper definitions + section markers + tree-shake invariant verification.
2. Sub-task 2 — HTML augmentation breakdown (bootstrap + _SCRML_CHUNKS inline + modulepreload + data-prefetch verification).
3. Sub-task 3 — routeSegmentFromEntryPointId fix details (real-pipeline ID format handling).
4. Sub-task 4 — W-CG-CHUNK-* lints landed (which codes; fire-sites; §34 + §40.9.11 rows).
5. Sub-task 5 — test file paths + test count delta + activation test (chunk JS resolves to runtime helpers).
6. Sub-task 6 — PIPELINE.md + domain.map.md + SPEC.md + master-list.md edits.
7. **WORKTREE_PATH** + **FINAL_SHA**.
8. **FILES_TOUCHED** list.
9. Maps-consulted statement.
10. Deferred items.

---

# Crash recovery

Per pa.md "Crash Recovery: Incremental Commits + Progress Reports":
- Commit per sub-task. Don't batch.
- Update `docs/changes/a-4-7-per-route-html-augmentation/progress.md` after each step.

---

# Authority chain

- SPEC §40.9.7 (per-tier output structure normative)
- SPEC §40.8 (v0.3 program shape)
- SPEC §47.9.2 (route URL inference)
- SPEC §40.9.8 (determinism preservation — HTML output must be byte-deterministic)
- OQ-A4-E ratification (S91): hybrid — ONE HTML per route + role-detection bootstrap
- A-4 SCOPING §3.7
- A-4.2 forward-looking gap: `_scrml_chunk_mount` + `_scrml_vendor_require` runtime helpers
- A-4.4's `data-scrml-prefetch` wiring (A-4.7 verifies)
- A-4.6's real chunk-filename hashes (A-4.7 uses in script src)
- Existing W-CG-* family pattern (W-CG-001, W-CG-UNDEFINED-INTERPOLATION)

---

# A-4 wave-close acknowledgment

When A-4.7 lands, the A-4 wave is **fully closed** — Components 1-5 + outer fixpoint + canonical determinism + AuthGraph wiring + per-route artifact splitter from orchestrator scaffold through HTML augmentation. Critical path to v0.3.0 cut: substantively complete.

Per master-list §0.1 phase progress: flip A-4 to ✅ CLOSED at this dispatch.

---

# Estimated effort

8-14h walltime — plus ~30 LOC scope-creep for the runtime helper closure (which A-4.2 deferred). Total realistic walltime 10-16h. Use S83 commit-discipline two-sided rule; commit per sub-task; `git status` clean before terminal report.

Good luck. A-4.7 closes the A-4 wave AND closes the v0.3.0 critical path AND makes the chunks RUNNABLE in adopter browsers (closing the A-4.2 forward-looking gap). This is the dispatch that flips the per-route artifact splitter from "structurally complete" to "production-functional."
