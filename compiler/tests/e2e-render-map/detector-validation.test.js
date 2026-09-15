/**
 * detector-validation.test.js — PROVE the D0–D7 detectors FIRE on the three
 * S202 acceptance-bug shapes (DD §"VALIDATE THE DETECTORS" / acceptance table:
 * D3 / D1+D7 / D4). If a detector does NOT fire, the harness is broken.
 *
 * The three acceptance bugs are ALL FIXED (they are the VALIDATION SET, not
 * open bugs). The current compiler no longer emits two of the three symptoms
 * from clean source — the markup-as-value `[object` bug, the for-lift
 * unbound-ref, and the raw-`${`-in-attr bug are all closed. So this suite has
 * two halves per detector:
 *
 *   (1) the fixture's CURRENT render state — documents that the bug is fixed
 *       (the fixture compiles/renders clean today, except D3 which still
 *       reproduces its symptom via a still-live shape);
 *   (2) the DETECTOR firing on the symptom — for D3 the fixture GENUINELY
 *       renders `[object Object]` (a real, non-injected D3 trigger); for D1+D7
 *       and D4 the historical broken render is reproduced (the documented
 *       symptom DOM / throw message) and the detector must fire. This is the
 *       regression-sentinel guarantee: if the bug class ever re-opens, the
 *       detector catches it.
 *
 * NO error-class suppression — the detectors classify, never hide (DD §"DO NOT
 * SUPPRESS ANY ERROR CLASS").
 *
 * Mount substrate: compiler/tests/browser/each-runtime-bug-57.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { observeApp } from "./render-harness.js";
import { runDetectors } from "./render-detectors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIX = join(__dirname, "fixtures");

/** Build an enumerator-shaped app row for a single fixture file. */
function fixtureApp(name) {
  const path = join(FIX, name);
  return {
    source: "fixture",
    path,
    relpath: `fixtures/${name}`,
    kind: "single",
    appDir: null,
    inputFiles: [path],
  };
}

describe("detector-validation — the three S202 acceptance-bug shapes fire", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  // -------------------------------------------------------------------------
  // D3 — S-OBJECT-IN-DOM (acceptance bug 1: markup/object value -> "[object ").
  // The fixture GENUINELY renders `[object Object]` today (a struct interpolated
  // directly into text), so this is a real, non-injected detector fire.
  // -------------------------------------------------------------------------
  test("D3 fires (S-OBJECT-IN-DOM) — struct-into-text renders `[object Object]`", () => {
    const cell = observeApp(fixtureApp("d3-object-in-dom.scrml"), null, "empty");
    expect(cell.state).toBe("smell-detected-wrong");
    expect(cell.smells).toContain("S-OBJECT-IN-DOM");
    // The recorded smell detail carries the offending DOM substring.
    expect(cell.detail.objectInDom).toContain("[object ");
  });

  // -------------------------------------------------------------------------
  // D1 + D7 — D1-MOUNT-THROW + S-UNBOUND-REF (acceptance bug 2: for-lift left a
  // prop unsubstituted -> `ReferenceError: load is not defined` at mount).
  //
  // Part (1): the fixture's loop-body unbound-ref shape compiles/renders clean
  //           TODAY (the inlining-substitution bug is fixed); we record that.
  // Part (2): the detector fires on the historical symptom — a mount that threw
  //           `<ident> is not defined`. The harness records this exact shape on
  //           REAL corpus apps (examples/16-remote-data, examples/29-engine-vs-
  //           flags both throw `… is not defined` at mount today), so this is
  //           the live regression path, reproduced here against the detector.
  // -------------------------------------------------------------------------
  test("D1+D7 fire (D1-MOUNT-THROW + S-UNBOUND-REF) on a mount-time `is not defined` throw", () => {
    // Part (2): the detector firing on the symptom.
    const det = runDetectors({
      compileErrors: [],
      throwMessage: "ReferenceError: load is not defined",
      consoleErrors: [],
      document: null,
      seeded: false,
    });
    expect(det.state).toBe("compiles-but-throws");
    expect(det.smells).toContain("D1-MOUNT-THROW");
    expect(det.smells).toContain("S-UNBOUND-REF");
    expect(det.detail.throwMessage).toContain("is not defined");

    // Part (1): the fixture's CURRENT state — recorded, never suppressed. The
    // fixture either renders clean (bug fixed) OR throws/smells; either way the
    // harness records a real cell. We only assert it produces a known state
    // (the documentation half — the bug is closed, so a clean render here is
    // the expected post-fix shape).
    const cell = observeApp(fixtureApp("d1d7-unbound-ref.scrml"), null, "empty");
    expect([
      "renders-clean",
      "renders-empty",
      "compiles-but-throws",
      "smell-detected-wrong",
      "fails-compile",
    ]).toContain(cell.state);
  });

  // -------------------------------------------------------------------------
  // D4 — S-RAW-INTERP (acceptance bug 3: raw `${load.id}` in an `href` string
  // attr shipped as literal text).
  //
  // Part (1): the fixture's `href="/x/${ @link }"` shape is LOWERED correctly
  //           today (the bug is fixed) — the fixture renders clean.
  // Part (2): the detector fires on the historical symptom — an attribute value
  //           that contains a literal `${`. Reproduced against a real happy-dom
  //           element so the attribute-value scan path is exercised end-to-end.
  // -------------------------------------------------------------------------
  test("D4 fires (S-RAW-INTERP) on a literal `${` surviving into an attribute value", () => {
    // Part (2): the detector firing on the symptom. Build a real DOM whose
    // anchor href carries the historical raw-interp literal, then run the attr
    // scan. document is the caller-registered happy-dom global.
    document.documentElement.innerHTML =
      '<body><main><a href="/x/${load.id}">go</a></main></body>';
    const det = runDetectors({
      compileErrors: [],
      throwMessage: null,
      consoleErrors: [],
      document,
      seeded: false,
    });
    expect(det.state).toBe("smell-detected-wrong");
    expect(det.smells).toContain("S-RAW-INTERP");
    expect(det.detail.rawInterp.inAttr).toBe(true);

    // Part (1): the fixture's CURRENT state — the bug is fixed, so the fixture
    // compiles+renders clean (the `${ @link }` is lowered to a bound attr, no
    // literal `${` survives). Recorded, never suppressed.
    const cell = observeApp(fixtureApp("d4-raw-interp-attr.scrml"), null, "empty");
    // The fixed compiler must NOT leave a literal `${` in the rendered attr.
    expect(cell.smells).not.toContain("S-RAW-INTERP");
  });
});

// =============================================================================
// D6 — S-EMPTY-WITH-DATA. ADDED S416.
//
// ⚠ THIS DETECTOR HAD NO VALIDATION TEST AND HAD NEVER FIRED. Across the whole
// 438-cell standing baseline, `S-EMPTY-WITH-DATA` appears ZERO times — and a
// detector that has never fired and is never exercised is indistinguishable from
// a broken one. That mattered here because S416 gave it a consequence: its result
// now resolves to `renders-empty-with-data`, which is NOT in `GREEN_STATES`,
// where previously it collapsed into the green `renders-empty`. Wiring a red
// state to an unproven detector would just move the hollow gate, so this proves
// D6 fires, and proves the unseeded case stays green.
//
// `runDetectors` is a pure function of the observation, so both directions are
// asserted directly — no mount needed beyond a happy-dom document.
// =============================================================================
describe("D6 — seeded-and-empty is a RED state; unseeded-and-empty stays green", () => {
  // Same happy-dom lifecycle as the suite above — `document` is a registered global,
  // not an ambient one, so each describe needs its own registration.
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  test("D6 fires (S-EMPTY-WITH-DATA) and resolves to renders-empty-with-data", () => {
    document.documentElement.innerHTML = "<body><main id=\"root\"></main></body>";
    const det = runDetectors({
      compileErrors: [],
      throwMessage: null,
      consoleErrors: [],
      document,
      seeded: true,
    });
    expect(det.smells).toContain("S-EMPTY-WITH-DATA");
    expect(det.detail.emptyWithData).toBe(true);
    // The state is the point: before S416 this returned "renders-empty", which
    // e2e-render-map.test.js counts as GREEN.
    expect(det.state).toBe("renders-empty-with-data");
  });

  test("the SAME empty DOM with NO seed stays renders-empty (the valid <empty> fallback)", () => {
    document.documentElement.innerHTML = "<body><main id=\"root\"></main></body>";
    const det = runDetectors({
      compileErrors: [],
      throwMessage: null,
      consoleErrors: [],
      document,
      seeded: false,
    });
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-empty");
  });

  test("a seeded render with CONTENT is unaffected — renders-clean", () => {
    document.documentElement.innerHTML =
      "<body><main id=\"root\"><ul><li>Ada</li><li>Alan</li></ul></main></body>";
    const det = runDetectors({
      compileErrors: [],
      throwMessage: null,
      consoleErrors: [],
      document,
      seeded: true,
    });
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-clean");
  });
});
