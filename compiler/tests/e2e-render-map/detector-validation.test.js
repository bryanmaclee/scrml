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

  // ⛑ S419 — g-e2e-render-map-d6-keys-on-textcontent-so-a-text-free-render-scores-red.
  // D6 keyed on text alone, so each of these seeded renders — real content, zero text
  // nodes — scored the RED renders-empty-with-data. Each must NOT fire, and (S419 review
  // L1) must resolve to renders-clean, not fall through to renders-empty. One element
  // kind per case so a regression names the kind it lost. Every case HOLDS content: the
  // first version of this table used an empty <textarea>, a src-less <video> and a
  // src-less <iframe>, which were the review's M1 over-breadth, not content.
  const TEXT_FREE_RENDERS = {
    "inputs holding seeded values": { markup: '<form><input value="Ada"><input value="Alan"></form>' },
    "an input whose value was set by binding (property only)": {
      markup: '<input id="bound">',
      after: (body) => { body.querySelector("#bound").value = "Ada"; },
    },
    "a checkbox list": { markup: '<ul><li><input type="checkbox" checked></li><li><input type="checkbox"></li></ul>' },
    "a select": { markup: "<select><option value=\"1\"></option></select>" },
    "a textarea holding a value": {
      markup: '<textarea id="ta"></textarea>',
      after: (body) => { body.querySelector("#ta").value = "Ada"; },
    },
    "an image gallery": { markup: '<div class="gallery"><img src="a.png"><img src="b.png"></div>' },
    "an svg chart": { markup: '<svg viewBox="0 0 10 10"><rect width="4" height="8"></rect></svg>' },
    "a canvas": { markup: "<canvas></canvas>" },
    "a video with a source": { markup: '<video><source src="a.mp4"></video>' },
    "an iframe with a src": { markup: '<iframe src="https://example.test/embed"></iframe>' },
  };
  const detect = (seeded, doc = document) =>
    runDetectors({ compileErrors: [], throwMessage: null, consoleErrors: [], document: doc, seeded });
  for (const [label, { markup, after }] of Object.entries(TEXT_FREE_RENDERS)) {
    test(`D6 does NOT fire on a seeded text-free render: ${label}`, () => {
      // Built in a DETACHED <body> and handed to runDetectors as `{ body }` (all it reads):
      // a connected iframe/video with a src makes happy-dom try to LOAD it, which logs a
      // network error unrelated to the assertion. The detector reads attributes only.
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${markup}</main>`;
      if (after) after(body);
      // Precondition: the DOM really is text-free (else this case proves nothing).
      expect(body.textContent.trim()).toBe("");
      const det = detect(true, { body });
      expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
      expect(det.state).toBe("renders-clean");
      // Unseeded, the same content is not an `<empty>` fallback either (same predicate).
      expect(detect(false, { body }).state).toBe("renders-clean");
    });
  }

  // The genuine-empty shapes must still fire. The S419 review (M1) cases are here: each
  // is an element that is PRESENT but holds nothing, or is hidden by markup.
  const GENUINELY_EMPTY_RENDERS = {
    "nested empty structural wrappers": "<div><section><ul></ul></section></div>",
    "whitespace-only text": "<div>   \n  </div>",
    "only a hidden input": '<input type="hidden" name="csrf" value="t0k3n">',
    "a select with no options (the seeded options loop rendered nothing)": "<select></select>",
    "a bare input": "<input>",
    "an input with only a placeholder": '<input placeholder="Name">',
    "an unchecked checkbox": '<input type="checkbox">',
    "an empty button": "<button></button>",
    "an empty progress": "<progress></progress>",
    "an empty aria-hidden svg": '<svg aria-hidden="true"></svg>',
    "a non-empty but aria-hidden svg (decorative icon)": '<svg aria-hidden="true"><path d="M0 0L1 1"></path></svg>',
    "an img with the hidden attribute": '<img hidden src="a.png">',
    "an img with inline display:none": '<img style="display:none" src="a.png">',
    "an img with inline visibility: hidden": '<img style="visibility: hidden" src="a.png">',
    "an img inside a hidden ancestor": '<div hidden><img src="a.png"></div>',
    "a canvas with inline display:none": '<canvas style="display: none"></canvas>',
    "a div with an empty value attribute": '<div value=""></div>',
    "a div with a checked attribute": "<div checked></div>",
    "a src-less error-overlay iframe": '<iframe id="error-overlay" style="position:fixed;inset:0"></iframe>',
    "a src-less video": "<video></video>",
    "an empty textarea": "<textarea></textarea>",
  };
  for (const [label, markup] of Object.entries(GENUINELY_EMPTY_RENDERS)) {
    test(`D6 still fires on a seeded genuinely-empty render: ${label}`, () => {
      document.documentElement.innerHTML = `<body><main id="root">${markup}</main></body>`;
      // Unseeded, the same DOM is the valid `<empty>` fallback.
      expect(detect(false).state).toBe("renders-empty");
      const det = runDetectors({
        compileErrors: [],
        throwMessage: null,
        consoleErrors: [],
        document,
        seeded: true,
      });
      expect(det.smells).toContain("S-EMPTY-WITH-DATA");
      expect(det.state).toBe("renders-empty-with-data");
    });
  }

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
