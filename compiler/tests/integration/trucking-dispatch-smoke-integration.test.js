/**
 * A-5.5 — trucking-dispatch reference-app compile-smoke (Family F-6).
 *
 * Bundled within the A-5.5 wave-close. Compiles the full
 * `examples/23-trucking-dispatch/` reference application end-to-end via
 * `compileScrml` (multi-file inputFiles + emitPerRoute) and asserts:
 *
 *   1. No fatal errors — pipeline completes cleanly.
 *   2. chunks.json manifest emits + entryPoints map non-empty.
 *   3. Expected v0.2-shape diagnostic counts are stable (regression
 *      baseline; v0.2-shape `auth="role:X"` is silently inert per
 *      F-AUTH-001 — the diagnostics that DO fire on this input are
 *      EXPECTED, not regressions).
 *   4. W-AUTH-LOGIN-MISSING fires once (the canonical anonymous-page
 *      missing-login diagnostic introduced at S91 A-3.5; trucking-
 *      dispatch's `pages/auth/login.scrml` does NOT yet declare a
 *      login intent, so the lint correctly fires here).
 *   5. Per-app chunks emit (chunks.size > 0) — the splitter pass
 *      executes successfully against adopter-scale input.
 *   6. chunks.json `compiler` field stable across compiles (Q-OPEN-4
 *      package.json sourcing).
 *
 * Per OQ-A5-C (PA-lean (a) compile-smoke only): NO Playwright
 * assertions. NO v0.2 → v0.3 migration. NO modifications to
 * trucking-dispatch source. The test reads the existing v0.2-shape
 * tree and verifies the v0.3 pipeline can ingest it without fatal
 * errors and produces the expected adopter-shape baseline diagnostics.
 *
 * Per dive §4.5 R-3 + R-9 (load-bearing): trucking-dispatch is
 * structurally pre-v0.3:
 *   - F-AUTH-001 v0.2-shape: `<program auth="required">` + server-side
 *     `checkRole()` guard (NOT `<auth role="X">` element).
 *   - W-AUTH-001 ("server @var has no detectable initial load
 *     pattern") fires for every server-state declaration in the app.
 *   - W-PROGRAM-001 ("unnamed nested <program>") fires for the page-
 *     level <program> elements.
 *   - W-CG-CHUNK-PREFETCH-UNRESOLVED fires where `<a href="/route">`
 *     points at a route that does not exist in the multi-file route
 *     map (deliberate; future Wave 4.A migration tightens these).
 *
 * EXPECTED DIAGNOSTIC BASELINE (re-probed at HEAD 0aa2b18 + S94 hos-
 * restructure landing; cross-ref docs/changes/hos-restructure/SURVEY.md):
 *   I-AUTH-REDIRECT-UNRESOLVED            =  1   (was 2 pre-S94)
 *   W-ATTR-001                            = 20   (was 19 pre-S94 — hos.scrml `<page db=>`)
 *   W-AUTH-001                            = 20   (was 19 pre-S94 — hos.scrml auto-inject)
 *   W-AUTH-LOGIN-MISSING                  =  1
 *   W-CG-CHUNK-EMPTY                      =  1   (was 2 pre-S94 — hos no longer own-EP)
 *   W-CG-CHUNK-PREFETCH-UNRESOLVED        =  1   (was 2 pre-S94 — same)
 *   W-DEAD-FUNCTION                       =  1
 *   W-PROGRAM-001                         =  4   (was 24 pre-S98 — non-entry-<page> suppression)
 *   W-PROGRAM-REDUNDANT-LOGIC             = 18
 *   --- removed at S94 (no fire post-restructure) ---
 *   W-PROGRAM-SPA-INFERRED                =  0   (was 1 pre-S94 — hos.scrml's <program> gone)
 *   --- removed pre-S94 (S93 patch arc closures) ---
 *   W-CG-UNDEFINED-INTERPOLATION          =  0   (was 53; S93 codegen leak fixes)
 *   --- aggregate ---
 *   errors:    0
 *   warnings:  59   (74 pre-ss11; ss11 item 1 +3 W-INTERP-IN-RAW-CONTENT for `${...}`
 *                       authored inside `<code>` raw-content bodies (§4.17); ss11
 *                       item 7 -18 W-PROGRAM-REDUNDANT-LOGIC by dropping redundant
 *                       file-top `${ import }` page wrappers (§40.8). Net 74+3-18=59.
 *                       80 pre-ss1; ss1 dropped 6 W-SERVER-IMPORT-UNEMITTED by
 *                       emitting pure-module value exports into .server.js. was 67 @
 *                       S98, 87 pre-S98 — 20 page-file false-positives suppressed)
 *   chunks:    >= 1 (per-route)
 *   manifest entryPoints: >= 1
 *
 * If this baseline drifts: the test surfaces the change so PA can
 * decide whether the new diagnostic firing is an intended pipeline
 * sharpening (in which case update the baseline here) or a regression
 * (in which case investigate the firing site).
 *
 * Spec authority:
 *   - SPEC.md §40.1.1 — Static role classification anchor (A-3).
 *   - SPEC.md §40.9 — Closure Analysis (A-2).
 *   - SPEC.md §47.5 + §47.1.3 — content-addressing (A-4.6).
 *   - SPEC.md §52.10 / §52.13 — server-fn boundary +
 *     W-AUTH-LOGIN-MISSING anchor.
 *
 * SCOPING: scrml-support/docs/deep-dives/a-5-integration-tests-SCOPING-2026-05-14.md
 *   §3.1 family F-6 + OQ-A5-C compile-smoke ratification + §4.2
 *   A-5.5 sub-phase + §4.5 R-3 + R-9.
 *
 * Reference-app friction history:
 *   examples/23-trucking-dispatch/FRICTION.md F-AUTH-001 (v0.2-shape
 *   `auth="role:X"` silent inertia; resolved by future v0.3 migration
 *   to `<auth role="X">` element shape — NOT in A-5 scope).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Locate the trucking-dispatch directory at the repo root
// (this test file lives at compiler/tests/integration/, so up four levels).
// ---------------------------------------------------------------------------

const TD_DIR = join(import.meta.dir, "..", "..", "..", "examples", "23-trucking-dispatch");

function findScrml(dir) {
  const out = [];
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...findScrml(p));
    else if (p.endsWith(".scrml")) out.push(p);
  }
  // Sort for deterministic input order.
  return out.sort();
}

const TD_FILES = findScrml(TD_DIR);

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "td-smoke-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileTd() {
  return compileScrml({
    inputFiles: TD_FILES,
    outputDir: join(TMP, "dist"),
    write: false,
    emitPerRoute: true,
    log: () => {},
  });
}

// ---------------------------------------------------------------------------
// Per-test compile-timeout headroom (ss33 item 1, g-trucking-smoke-chunks-flake).
//
// Every assertion below drives one (or two) full multi-file (36 .scrml)
// emitPerRoute compile of the trucking-dispatch reference app via the
// SYNCHRONOUS `compileScrml`. `bun test` runs test FILES concurrently, so under
// full-suite CPU/memory pressure (~15GB) a single otherwise-fast compile here is
// STARVED and intermittently breaches the bunfig default 10s per-test timeout —
// surfacing as a flaky timeout on the `chunks.json manifest` assertion (passes
// isolated + in the blocking gate). It is NOT a code race (ss27 root-cause):
// the compile is deterministic; only its WALL TIME varies with contention.
//
// `bun:test` has no native `test.serial` (a module-level JS mutex would not
// cross the per-file worker boundary, and these compiles are already serial
// WITHIN this file), so the lowest-touch deterministic fix is starvation
// headroom — the same mechanism the S145 flake fix applied to the double-compile
// stability case below (60s; held since). One shared knob keeps every
// compile-heavy case uniformly robust under load.
const COMPILE_TIMEOUT = 60000;

/**
 * Cross-stream helper. Combines `result.errors` and `result.warnings`
 * into one array per api.js:1674-1675 partition logic.
 */
function allDiags(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}

/**
 * Histogram of diagnostic codes across both error + warning streams.
 */
function diagHisto(result) {
  const counts = Object.create(null);
  for (const d of allDiags(result)) {
    const code = d.code ?? "(no-code)";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// §1 — Pipeline-level invariants
// ---------------------------------------------------------------------------

describe("trucking-dispatch — pipeline-level invariants", () => {
  test("36 .scrml files discovered in the reference app", () => {
    // Sanity check on the fixture-discovery layer. If this drifts, the
    // expected-diagnostic-count baseline below also drifts.
    expect(TD_FILES.length).toBe(36);
  });

  // S99 A4 (commit 9860449) closed the `is some` parser-coupling gap that
  // surfaced two E-SCOPE-001 fires in invoice-card.scrml. The preprocessor in
  // expression-parser.ts now captures a whitespace-tolerant member-access
  // chain as the LHS of `is …` predicates, so `inv.paid_at is some` (which
  // the collectExpr → joinWithNewlines path emits as `inv . paid_at is some`)
  // parses to a clean BinaryExpr with a MemberExpr LHS rather than the
  // inverted member-call shape `inv.__scrml_is_some__(paid_at)`. With both
  // E-SCOPE-001 fires gone, the no-fatal-error invariant holds end-to-end.
  test("compile completes — no fatal severity:error diagnostics", () => {
    const result = compileTd();
    const fatal = result.errors.filter((e) => e.severity === "error");
    expect(fatal).toEqual([]);
  }, COMPILE_TIMEOUT);

  test("chunks.json manifest emits — splitter pass executed", () => {
    const result = compileTd();
    expect(result.chunksManifest).toBeDefined();
    expect(result.chunksManifest).not.toBeNull();
    expect(result.chunksManifest.version).toBe(1);
  }, COMPILE_TIMEOUT);

  test("manifest entryPoints map non-empty (per-app chunks emit)", () => {
    const result = compileTd();
    const epKeys = Object.keys(result.chunksManifest.entryPoints);
    expect(epKeys.length).toBeGreaterThan(0);
  }, COMPILE_TIMEOUT);

  test("at least one chunk produced", () => {
    const result = compileTd();
    expect(result.chunks).toBeDefined();
    expect(result.chunks.size).toBeGreaterThan(0);
  }, COMPILE_TIMEOUT);
});

// ---------------------------------------------------------------------------
// §2 — Expected v0.2-shape diagnostic baseline (regression guard)
// ---------------------------------------------------------------------------

describe("trucking-dispatch — v0.2-shape diagnostic baseline", () => {
  // Baseline counts probed at HEAD acbb097 (S92 A-5.4 close).
  // Refreshed at S93 BS-batch (Bug 6B) — W-PROGRAM-001 now suppressed on
  // pure-module files (no top-level markup): 34 → 23 for trucking-dispatch
  // (11 module files affected: types/utility/components/channels modules
  // in pages/ subdirs lacking <program> wrapper per S85 Q2 non-entry-file
  // canonical shape).
  // Refreshed at S93 W-CG-UNDEFINED-INTERPOLATION sweep — 53 → 0 after
  // four codegen leak sites closed: derived-engine identity + match-arm
  // forms in emit-engine.ts (switched to `== null` loose-equality); §51.9
  // projection function fallback in emit-machines.ts + property-test
  // scaffold in emit-machine-property-tests.ts (switched to `return null;`);
  // for/lift reconcile-keying in emit-control-flow.ts (`item?.id != null`);
  // channel WebSocket upgrade fallback in emit-channel.ts (`void 0` for the
  // Bun-API-required undefined-return path); structural-eq enum check in
  // emit-server.ts (`!= null`).
  // If a new pipeline pass tightens any of these counts, update this
  // map; if a count regresses, investigate the firing site.
  // S94 hos-restructure baseline shifts (2026-05-15 — DEFERRED §2 close):
  // `pages/driver/hos.scrml` migrated from legacy `<program>` wrapper to
  // canonical non-entry-page `<page db= auth=>` shape (matching the 19
  // sibling pages). Side-effects on the histo:
  //   - I-AUTH-REDIRECT-UNRESOLVED: 2 → 1 (hos.scrml no longer surfaces an
  //     independent gate redirect cross-ref)
  //   - W-ATTR-001: 19 → 20 (hos.scrml's new `<page db=>` fires the same
  //     BS-layer attribute-validation gap as every sibling page)
  //   - W-AUTH-001: 19 → 20 (hos.scrml's `<db protect=>` now auto-injects
  //     auth-mw since `<page auth=required>` is not yet recognized by the
  //     auth declaration validator — same gap as siblings)
  //   - W-CG-CHUNK-EMPTY: 2 → 1 (hos.scrml no longer participates as a
  //     separate per-route entry-point under the per-route splitter — it
  //     is now a `<page>` child of app.scrml's `<program>`)
  //   - W-CG-CHUNK-PREFETCH-UNRESOLVED: 2 → 1 (same as above)
  //   - W-PROGRAM-001: 23 → 24 (hos.scrml fires once more — file-top has
  //     no `<program>` now, mirroring sibling page behavior)
  //   - W-PROGRAM-SPA-INFERRED: 1 → 0 (hos.scrml's prior `<program>` was
  //     the sole SPA-inferred fire; gone after migration)
  //   - W-PROGRAM-REDUNDANT-LOGIC: 18 → 18 (stable; hos.scrml's inner
  //     `${...}` import wrapper now fires under `<page>` instead of
  //     `<program>`, same count)
  // Cross-ref: docs/changes/hos-restructure/SURVEY.md §Phase 3.
  //
  // S98 combined-lint-additions-s98 Item 1 (2026-05-17):
  //   - W-PROGRAM-001: 24 → 4. Per SPEC §40.8, non-entry `<page>` files do
  //     NOT carry their own `<program>` wrapper — the page route sits inside
  //     app.scrml's `<program>`. The lint previously false-positived on every
  //     such file (20 page files under examples/23-trucking-dispatch/pages/).
  //     Post-fix the lint is suppressed when the file declares a top-level
  //     `<page>` element. The remaining 4 fires are from other module-shape
  //     files (schema.scrml, seeds.scrml, etc.) that don't currently match
  //     the Bug 6B pure-module predicate — unchanged from the prior baseline
  //     minus the 20 page-file suppressions.
  //
  // S99 A2-followup (RI server-block) + A1-deferred (is-some scope) deltas:
  //   - E-ROUTE-001: 0 → 1. The RI rewriter (commit 0e1dac0,
  //     `route-inference.ts:rewriteServerBlockStubs`) clears `exprNode` on
  //     malformed `server { ... }` bare-expr stubs and leaves the raw
  //     `expr` text intact for trigger detection. RI's walkBodyForTriggers
  //     now reaches the raw text and pattern-matches `_customers[i]`-style
  //     computed member accesses inside `runSeeds()` — firing the existing
  //     E-ROUTE-001 (computed member access warning). Severity is "warning"
  //     so it lives in `result.warnings`, not fatal. Expected one fire
  //     because runSeeds() carries the only `server { ... }` block in the
  //     trucking-dispatch app.
  //   - E-SCOPE-001: 0 → 2. A2's body-population for `export fn` /
  //     `export function` synth stubs also unmasked the TS scope walker
  //     misfire on the `is some` operator: in
  //     `components/invoice-card.scrml:invoiceStatus` the conditions
  //     `inv.paid_at is some` and `inv.due_at is some` parse to
  //     `inv.__scrml_is_some__(paid_at)` / `inv.__scrml_is_some__(due_at)`
  //     where the property name surfaces as a free-ident call argument.
  //     TS treats `paid_at` / `due_at` as undeclared identifiers and fires
  //     E-SCOPE-001 twice. Pre-A2 the synth body was empty and these never
  //     surfaced. This is OUT OF SCOPE for the RI dispatch — it is an
  //     ast-builder / type-system parser-coupling bug, handled by the A1
  //     dispatch per the brief's scope. The 2 fires are baselined here
  //     until A1 lands; the "compile completes — no fatal severity:error"
  //     test stays skipped pending A1.
  //   - The seeds.scrml `server` E-SCOPE-001 (1 fire pre-this-commit) is
  //     resolved by the RI rewriter: the spurious `server` ident is
  //     cleared from exprNode, so TS's scope walker now skips the
  //     bare-expr per the existing guard at type-system.ts §2a line ~4873.
  //     Net E-SCOPE-001 movement: 3 → 2 (server gone; paid_at/due_at A1).
  //
  // S99 A4 (commit 9860449) closed the remaining 2 E-SCOPE-001 fires
  // (`paid_at` / `due_at` in invoice-card.scrml). The expression-parser
  // preprocessor now captures a whitespace-tolerant member-access chain as
  // the LHS of `is …` predicates, preserving `inv.paid_at` as a MemberExpr
  // rather than inverting it into a member-call. Net E-SCOPE-001 movement:
  // 2 → 0. With both fires gone, the no-fatal-error compile-completion
  // invariant holds end-to-end (test §1 above is now active).
  //
  // S142 gate-found-tail (C11): seeds.scrml migrated off the non-canonical
  // `function f() { server { ... } }` block-statement shape (SPEC has no
  // `server {` block-statement form) to a plain `export function runSeeds()`
  // whose `?{}` body auto-escalates to server via body-content inference
  // (Insight 26). Removing the malformed `server { ... }` bare-expr stub
  // eliminates the E-ROUTE-001 fire it caused:
  //   - E-ROUTE-001 1 → 0 (the RI computed-member-access warning on the
  //     `_customers[i]`-style accesses inside the malformed stub — see the
  //     S99 RI note above; the stub no longer exists so the trigger is gone).
  // The two W-CG-CHUNK-* warnings are UNAFFECTED (still 1 each) — they are
  // about the empty seeds route chunk under emitPerRoute, not the stub.
  //
  // typed-sql-row Tranche 1 (§14.8.7, change-id typed-sql-row-tranche1): the
  // read-site SQL projection typer now emits 6 INFO-level W-SQL-ROW-UNTYPED lints
  // for the deferred long tail — 4 computed/subquery columns (billing/invoices
  // `payment_token`/`active_payment_tokens`; customers `outstanding_count`/
  // `total_loads`) and 3 lone `SELECT id` in seeds.scrml (no `< db>` block in
  // scope -> no generated type). All other queries (board / load-detail / etc.)
  // resolve to typed projection rows and fire NO lint. NO E-PROTECT-001 fires:
  // the auth `login` selects `password_hash` but is server-escalated via §12.2
  // Trigger-2 protected-field access (it verifies the hash server-side).
  //
  // D4a (server-keyword-eliminate-2026-06-10, §12.2 Trigger 7): the four channel
  // publisher functions (`publishBoardEvent` / `publishDriverEvent` /
  // `publishLoadEvent` / `publishCustomerEvent`) are declared inside a
  // `<channel>` body whose bodies WRITE channel-declared cells. Their channel-
  // cell writes are an independent escalation trigger (Trigger 7), so the
  // function escalates server WITHOUT the `server` keyword. D4a ran
  // `scrml migrate --fix` (Migration 4) over examples/, which STRIPPED the now-
  // redundant `server` keyword from all four publishers. Each is now a plain
  // `function`, so W-DEPRECATED-SERVER-MODIFIER no longer fires anywhere in the
  // trucking-dispatch corpus — its count drops from 19 (the D2-era CHX-inlined
  // count: 4 publishers × cross-file consumer re-analysis under emitPerRoute) to
  // 0. The code is REMOVED from the baseline (a 0-count entry would also trip the
  // "no UNEXPECTED codes" inverse). The aggregate total falls 92 -> 73.
  const EXPECTED_BASELINE = {
    "I-AUTH-REDIRECT-UNRESOLVED": 1,
    "W-ATTR-001": 20,
    // ss19 #6/#7 (auth-precedence-2026-06-25): W-AUTH-001 20 -> 0, REMOVED.
    // Every protect= page in this corpus declares an EXPLICIT `<page auth=...>`
    // (`auth="required"` on the 18 app pages, `auth="optional"` on login/
    // register). The pre-fix RI Step 8b did not recognise page-level auth= and
    // auto-escalated all of them to auth="required" + fired W-AUTH-001 ("no
    // explicit auth= attribute") — a FALSE warning on every page (the S94 note
    // above explicitly recorded this as a known gap: "<page auth=required> is
    // not yet recognized by the auth declaration validator"). The fix consults
    // the explicit page-level declaration: optional/none pages keep their mode
    // (no escalation), required pages stay gated (authMiddleware still
    // registered, same values — `autoEscalated` has no downstream reader), and
    // W-AUTH-001 fires ONLY when no declaration exists anywhere. None remain in
    // this corpus, so the code is REMOVED from the baseline (a 0-count entry
    // would trip the "no UNEXPECTED codes" inverse). Aggregate 59 -> 39.
    "W-AUTH-LOGIN-MISSING": 1,
    // W2 (rs-entrypoint-routemap, §40.9.2 S221 ruling): the Reachability
    // Solver now enumerates the 20 filesystem-routed `pages/**` files as
    // entry points (previously ONLY app.scrml#program was enumerated), and
    // Component-1 descends the `<db>` connection-scope wrapper to reach each
    // page's render surface. Two route-splitter chunk diagnostics shift as a
    // direct, justified consequence of the 20 new NON-EMPTY route closures:
    //   - W-CG-CHUNK-EMPTY 1 -> 0, REMOVED: previously the lone
    //     app.scrml#program EP produced a zero-admission chunk (its Welcome
    //     landing-page markup was wrongly dropped — the §40.9.2 descent gap).
    //     With the descent fix ALL 21 EPs (app shell + 20 pages) carry
    //     non-empty closures, so W-CG-CHUNK-EMPTY fires nowhere. (A 0-count
    //     entry would trip the "no UNEXPECTED codes" inverse, so it is
    //     removed, not zeroed.)
    //   - W-CG-CHUNK-PREFETCH-UNRESOLVED 1 -> 3: more multi-route entry
    //     points whose tier-1/2 prefetch targets are not yet resolved at the
    //     splitter (A-4 codegen splitter is a later wave).
    // Aggregate 39 -> 40.
    "W-CG-CHUNK-PREFETCH-UNRESOLVED": 3,
    "W-DEAD-FUNCTION": 1,
    // S199 — the HOS `<engine for=DriverStatus server=@currentDriver.current_status>`
    // showcase (pages/driver/hos.scrml, the E-leg dog-food): @currentDriver is a
    // server-LOADED PLAIN cell (not a `<var server>` §52 cell — it rides the cookie-
    // session fetchHosData flow), so the engine's server-source nudge fires once
    // (info; the hydration mechanism works regardless — the cell IS server-owned).
    // Aggregate 73 -> 74.
    "W-ENGINE-SERVER-SOURCE-NOT-AUTHORITATIVE": 1,
    // g-interp-in-raw-content (ss11 item 1, SPEC §4.17): the new
    // W-INTERP-IN-RAW-CONTENT warning-lint fires on the three `${...}` interpolations
    // authored inside `<code>` raw-content bodies — these ship the LITERAL
    // `${...}` text to the page (the §4.17 raw-pass-through), so the lint nudges
    // toward a non-raw wrapper. Real sites:
    //   - pages/customer/profile.scrml L115  `<code ...>${@currentUser.email}</code>`
    //   - pages/driver/messages.scrml  L231  `<code ...>${@channelId}</code>`
    //   - pages/driver/profile.scrml   L175  `<code ...>${@currentUser.email}</code>`
    // (line refs post item-7 unwrap, -2 each.) Warning-level (severity:warning, W- prefix,
    // promoted from info 6nz B1 2026-06-24) — partitions into result.warnings, exit stays 0.
    // Aggregate 74 -> 77 (item 1).
    "W-INTERP-IN-RAW-CONTENT": 3,
    "W-PROGRAM-001": 4,
    // phase-b1-examples-rewrite (ss11 item 7, canonical-form pass): each trucking
    // page file carried a redundant top-level `${ import ... }` wrapper inside its
    // `<page>` body. Under v0.3 default-logic mode bare top-level imports+decls
    // auto-lift without the wrapper (SPEC §40.8), so all 18 wrappers were dropped;
    // W-PROGRAM-REDUNDANT-LOGIC no longer fires and is REMOVED from the baseline
    // (a 0-count entry would also trip the "no UNEXPECTED codes" inverse). 77 -> 59.
    "W-SQL-ROW-UNTYPED": 6,
    // S208 Fix B (W-SERVER-IMPORT-UNEMITTED, g-pure-module-server-emit) fired 6
    // distinct missing-EXPORT shapes here — a server-CALLED exported helper
    // route-inferred into a handler, so its `.server.js` emitted the ROUTE but
    // NOT the value `export` the consumer's by-name server import expected
    // (auth `rolePath`/`SESSION_*`, status-picker `validNextStates`, driver-card
    // `isValidHosTransition`). ss1 (g-route-mis-inference-server-called-pure-
    // helper) RESOLVED that: `.server.js` now ALSO emits each module's exported
    // VALUE bindings (constants + pure fns) as native ESM exports ADDITIVELY
    // (the route handler / `__ri_route_*` / `routes` / `fetch` are unchanged),
    // so every by-name import resolves and the warning no longer fires.
    // W-SERVER-IMPORT-UNEMITTED is therefore REMOVED from the baseline.
    // Aggregate 80 -> 74.
  };

  test("aggregate diagnostic count matches baseline", () => {
    const result = compileTd();
    const histo = diagHisto(result);
    const observedTotal = Object.values(histo).reduce((s, n) => s + n, 0);
    const expectedTotal = Object.values(EXPECTED_BASELINE).reduce(
      (s, n) => s + n,
      0,
    );
    expect(observedTotal).toBe(expectedTotal);
  }, COMPILE_TIMEOUT);

  test("every baseline code's count matches", () => {
    const result = compileTd();
    const histo = diagHisto(result);
    for (const [code, expected] of Object.entries(EXPECTED_BASELINE)) {
      expect(histo[code] ?? 0).toBe(expected);
    }
  }, COMPILE_TIMEOUT);

  test("no UNEXPECTED diagnostic codes fire", () => {
    const result = compileTd();
    const histo = diagHisto(result);
    const unexpected = Object.keys(histo).filter(
      (code) => !(code in EXPECTED_BASELINE),
    );
    expect(unexpected).toEqual([]);
  }, COMPILE_TIMEOUT);

  test("W-AUTH-LOGIN-MISSING fires exactly once (canonical missing-login site)", () => {
    // S91 A-3.5 ratified W-AUTH-LOGIN-MISSING + the `scrml generate
    // auth` CLI subcommand + the `stdlib/auth/templates/login.scrml`
    // template — together those close the 03-contact-book latent bug.
    // trucking-dispatch's pages/auth/login.scrml carries a login form
    // but does NOT declare a login intent the AuthGraph recognizes;
    // the lint correctly fires once for this app.
    const result = compileTd();
    const fires = allDiags(result).filter(
      (d) => d.code === "W-AUTH-LOGIN-MISSING",
    );
    expect(fires.length).toBe(1);
  }, COMPILE_TIMEOUT);
});

// ---------------------------------------------------------------------------
// §3 — Per-app chunks structure (chunks.json shape spot-checks)
// ---------------------------------------------------------------------------

describe("trucking-dispatch — chunks.json structure", () => {
  test("manifest.compiler field sources from package.json (Q-OPEN-4)", () => {
    const result = compileTd();
    expect(typeof result.chunksManifest.compiler).toBe("string");
    expect(result.chunksManifest.compiler.length).toBeGreaterThan(0);
    // package.json carries `name: "scrml"` — the compiler field is
    // expected to start with that token. Q-OPEN-4 sourcing is stable
    // across all compiles in the same test run.
    expect(result.chunksManifest.compiler).toMatch(/scrml/);
  }, COMPILE_TIMEOUT);

  // Per-test timeout override (S145 flake fix, change-id
  // s145-test-flake-parallel-safety-2026-05-30): this case runs `compileTd()`
  // TWICE back-to-back, each a full multi-file (36 .scrml) emitPerRoute
  // compile of the trucking-dispatch reference app. The whole file is ~10s in
  // isolation; this single double-compile case takes ~6.4s under full
  // parallel-suite CPU contention, which intermittently breached the bunfig
  // default 10s per-test timeout and flake-blocked the pre-push full-suite at
  // S144/S145 (forced `--no-verify`). The determinism assertion
  // (`a.chunksManifest.compiler === b.chunksManifest.compiler`) is UNCHANGED —
  // it stays exactly as strict; only the timeout headroom is widened to absorb
  // contention. 60s gives ~9x margin over the worst observed (6.4s) under load.
  test("manifest.compiler field is stable across two compiles", () => {
    const a = compileTd();
    const b = compileTd();
    expect(a.chunksManifest.compiler).toBe(b.chunksManifest.compiler);
  }, COMPILE_TIMEOUT);

  test("every chunk emits with the FNV-1a 8-char base36 hash (§47.1.3)", () => {
    const result = compileTd();
    for (const chunk of result.chunks.values()) {
      // Hash present + 8 base36 chars + not the placeholder.
      expect(chunk.chunkHash).toMatch(/^[0-9a-z]{8}$/);
      expect(chunk.chunkHash).not.toBe("00000000");
    }
  }, COMPILE_TIMEOUT);

  test("each manifest entryPoint key references chunks that exist in the chunks Map", () => {
    const result = compileTd();
    const chunkKeys = new Set([...result.chunks.keys()]);
    for (const epId of Object.keys(result.chunksManifest.entryPoints)) {
      const perRole = result.chunksManifest.entryPoints[epId];
      for (const role of Object.keys(perRole)) {
        const entry = perRole[role];
        if (entry.initial) expect(chunkKeys.has(entry.initial)).toBe(true);
        if (entry.tier1) expect(chunkKeys.has(entry.tier1)).toBe(true);
        if (entry.tier2) expect(chunkKeys.has(entry.tier2)).toBe(true);
      }
    }
  }, COMPILE_TIMEOUT);
});
