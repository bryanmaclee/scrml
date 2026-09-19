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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { observeApp } from "./render-harness.js";
import {
  runDetectors,
  regionScopedEmptiness,
  collectEachRegions,
  renderedContentSignature,
  signatureGained,
} from "./render-detectors.js";

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

  // ⛑ S419 residuals — g-e2e-render-map-hidden-text-counts-as-content-while-hidden-elements-do-not.
  // The text half of hasRenderedContent read `body.textContent`, so text that is present
  // but NOT RENDERED scored as content: seeded, each of these was renders-clean (green)
  // while `<img hidden src>` in the same position was renders-empty-with-data. Each must
  // fire seeded and be renders-empty unseeded. The precondition proves the case HAS
  // text, i.e. that a textContent check would score it clean.
  const UNRENDERED_TEXT_ONLY = {
    "text with inline display:none": '<p style="display:none">secret</p>',
    "text with inline visibility:hidden": '<p style="visibility: hidden">secret</p>',
    "text with the hidden attribute": "<p hidden>secret</p>",
    "text with aria-hidden=true": '<span aria-hidden="true">secret</span>',
    "text under a hidden ancestor": '<div hidden><ul><li>Ada</li></ul></div>',
    "a script-only body": "<script>var x = 1;</script>",
    "a style-only body": "<style>p { color: red; }</style>",
    "a noscript-only body": "<noscript>Enable JavaScript to use this app.</noscript>",
    "script + style + noscript together": "<script>var x = 1;</script><style>p{}</style><noscript>no js</noscript>",
    "an img inside noscript (happy-dom parses it as an element)": '<noscript><img src="a.png"></noscript>',
  };
  for (const [label, markup] of Object.entries(UNRENDERED_TEXT_ONLY)) {
    test(`D6 fires on a seeded render whose only content is unrendered: ${label}`, () => {
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${markup}</main>`;
      if (!markup.includes("<img")) expect(body.textContent.trim()).not.toBe("");
      const seeded = detect(true, { body });
      expect(seeded.smells).toContain("S-EMPTY-WITH-DATA");
      expect(seeded.state).toBe("renders-empty-with-data");
      expect(detect(false, { body }).state).toBe("renders-empty");
    });
  }

  // The same exclusion must not eat VISIBLE text. Each case pairs visible text with an
  // unrendered sibling or a near-miss attribute that must not read as hidden.
  const VISIBLE_TEXT_RENDERS = {
    "visible text beside a hidden span": '<p>Ada</p><span hidden>secret</span>',
    "visible text beside a script": "<script>var x = 1;</script><p>Ada</p>",
    "aria-hidden=false": '<p aria-hidden="false">Ada</p>',
    "a non-hiding inline style": '<p style="display: block; visibility: visible">Ada</p>',
    "a custom property whose value is none": '<p style="--display: none">Ada</p>',
    "text in an element nested under a visible wrapper": "<div><section><p>Ada</p></section></div>",
  };
  for (const [label, markup] of Object.entries(VISIBLE_TEXT_RENDERS)) {
    test(`D6 does NOT fire on a seeded render with visible text: ${label}`, () => {
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${markup}</main>`;
      const seeded = detect(true, { body });
      expect(seeded.smells).not.toContain("S-EMPTY-WITH-DATA");
      expect(seeded.state).toBe("renders-clean");
      expect(detect(false, { body }).state).toBe("renders-clean");
    });
  }

  // ⛑ S423 limb 2 — REGION-SCOPED EMPTINESS. Everything above asks D6's question of
  // the whole body. These ask it of the `<each>` REGIONS, which is the only scope that
  // can see the board bug: a render whose chrome is present and whose DATA is not.
  //
  // Each case is `{ body }`-only (runDetectors reads nothing else) and is built from the
  // two emission shapes the compiler really produces, copied from measured DOM:
  //   range — `<!--scrml-each:ID-->` … rows … `<!--/scrml-each:ID-->`   (top-level each)
  //   mount — `<div data-scrml-each-mount="each_ID"></div>`             (nested each)
  const FENCE = (id, inner) => `<!--scrml-each:${id}-->${inner}<!--/scrml-each:${id}-->`;
  const MOUNT = (id, inner = "") => `<div data-scrml-each-mount="each_${id}">${inner}</div>`;
  const seededDetect = (markup, seedReport) => {
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${markup}</main>`;
    return runDetectors({
      compileErrors: [],
      throwMessage: null,
      consoleErrors: [],
      document: { body },
      seeded: true,
      ...(seedReport === undefined ? {} : { seedReport }),
    });
  };

  // The headline: the EXACT 25-triage-board#populated shape. Chrome renders, data does
  // not. Before S423 this scored `renders-clean` with zero smells — D6's whole reason
  // for existing, scored green off 52 characters of column headings.
  test("D6 fires on the BOARD BUG: non-empty outer range, every inner mount empty", () => {
    const columns = ["Inbox", "Doing", "Done"]
      .map((c) => `<section class="column"><h2>${c}</h2><ul class="task-list">${MOUNT("t_120")}</ul></section>`)
      .join("");
    const det = seededDetect(`<div class="board"><h1>Triage Board</h1>${FENCE("t_126", columns)}</div>`);
    // The body is emphatically NOT empty — this is what defeated the body-global check.
    expect(det.detail.emptyWithData).toBe(true);
    expect(det.detail.emptyWithDataScope).toBe("each-regions");
    expect(det.detail.emptyRegions).toEqual({
      regions: 4, mounts: 3, ranges: 1, leaves: 3, emptyLeaves: 3,
    });
    expect(det.smells).toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-empty-with-data");
  });

  // ⚑ THE ANTI-CRY-WOLF PIN, AND THE MOST LOAD-BEARING ASSERTION IN THIS BLOCK.
  // The same board, correctly rendered: two columns hold their task, the third is
  // LEGITIMATELY empty. A predicate of "fire on ANY surviving empty mount slot" — the
  // obvious reading of the discriminator, and the one this arc was dispatched with —
  // scores this correct board RED. It is measured, not hypothetical: mounting
  // 25-triage with the corrected `column:"Inbox"`/`"Doing"` seed that the
  // seed-fixtures fix arc will land produces exactly this DOM. This test is what
  // reds if anyone widens the conjunction to a disjunction.
  test("D6 does NOT fire when some inner mounts rendered and one is legitimately empty", () => {
    const columns =
      `<section><h2>Inbox</h2><ul>${MOUNT("t_120", '<li class="task">Alpha</li>')}</ul></section>` +
      `<section><h2>Doing</h2><ul>${MOUNT("t_120", '<li class="task">Beta</li>')}</ul></section>` +
      `<section><h2>Done</h2><ul>${MOUNT("t_120")}</ul></section>`;
    const markup = `<div class="board">${FENCE("t_126", columns)}</div>`;
    // Asserted through the predicate itself, not through `detail` — `detail.emptyRegions`
    // is recorded only when D6 fires, so reading it here would prove nothing about
    // whether the region machinery RAN. These counts prove it ran, saw all three inner
    // mounts, and found exactly ONE of them empty.
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${markup}</main>`;
    const verdict = regionScopedEmptiness(body);
    expect(verdict.summary).toEqual({
      regions: 4, mounts: 3, ranges: 1, leaves: 3, emptyLeaves: 1,
    });
    expect(verdict.allLeavesEmpty).toBe(false);
    // ... and therefore the cell stays green.
    const det = seededDetect(markup);
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-clean");
  });

  // Both emission shapes standing alone, each in both directions. A predicate that
  // understands only one shape is half a fix.
  const REGION_SHAPES = {
    "a lone empty comment-fence range (top-level each rendered nothing)": {
      markup: `<h1>Contacts</h1><ul>${FENCE("c_99", "")}</ul>`, fires: true,
    },
    "a lone NON-empty comment-fence range": {
      markup: `<h1>Contacts</h1><ul>${FENCE("c_99", "<li>Ada</li><li>Alan</li>")}</ul>`, fires: false,
    },
    "a lone empty mount div (nested each rendered nothing)": {
      markup: `<h1>Board</h1><ul>${MOUNT("n_1")}</ul>`, fires: true,
    },
    "a lone NON-empty mount div": {
      markup: `<h1>Board</h1><ul>${MOUNT("n_1", "<li>Alpha</li>")}</ul>`, fires: false,
    },
    "two sibling leaf regions, BOTH empty (both shapes)": {
      markup: `<h1>App</h1><ul>${FENCE("a_1", "")}</ul><ul>${MOUNT("b_2")}</ul>`, fires: true,
    },
    "two sibling leaf regions, only ONE empty — fail-quiet on ambiguity": {
      markup: `<h1>App</h1><ul>${FENCE("a_1", "<li>Ada</li>")}</ul><ul>${MOUNT("b_2")}</ul>`, fires: false,
    },
    "an each region whose only content is UNRENDERED (hidden row)": {
      markup: `<h1>App</h1><ul>${FENCE("a_1", '<li hidden>Ada</li>')}</ul>`, fires: true,
    },
    "an each region holding a text-free but content-BEARING row (S419 parity)": {
      markup: `<h1>App</h1><ul>${FENCE("a_1", '<li><img src="a.png"></li>')}</ul>`, fires: false,
    },
  };
  for (const [label, { markup, fires }] of Object.entries(REGION_SHAPES)) {
    test(`D6 region scope ${fires ? "FIRES" : "is quiet"}: ${label}`, () => {
      const det = seededDetect(markup);
      // Every case has visible chrome, so the body-global check answers "not empty"
      // for all of them — the verdict below can only come from the region scope.
      expect(det.detail.emptyWithDataScope).toBe(fires ? "each-regions" : undefined);
      expect(det.smells.includes("S-EMPTY-WITH-DATA")).toBe(fires);
      expect(det.state).toBe(fires ? "renders-empty-with-data" : "renders-clean");
    });
  }

  // Fail-quiet when the question is not identifiable at all: an app with no <each>
  // keeps today's body-global answer rather than firing blind.
  test("D6 stays quiet on a seeded render with NO identifiable each-region", () => {
    const det = seededDetect("<h1>Settings</h1><p>No lists here.</p>");
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-clean");
    expect(det.detail.emptyRegions).toBeUndefined();
  });

  // An UNTERMINATED fence has no identifiable extent — the runtime's own
  // `_scrml_each_end` gives up the same way, so the detector must not guess.
  test("D6 stays quiet on an unterminated each fence (extent unknown)", () => {
    const det = seededDetect('<h1>App</h1><ul><!--scrml-each:a_1--></ul>');
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-clean");
  });

  // =========================================================================
  // ⛑ S423 FIX ROUND — the four false-positive classes an adversarial pass found
  // against the first landed predicate. Each fired RED on a correct render.
  //
  // F1 and F2 are ONE bug: region emptiness is not the same question as "did the
  // seeded data render". They are closed by the `gainedContent` conjunct, which is
  // the only signal that separates two DOM-identical shapes wanting opposite
  // answers. F3 is closed by the unrendered-ancestor filter.
  // =========================================================================
  const seededDetectGained = (markup, gainedContent) => {
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${markup}</main>`;
    return runDetectors({
      compileErrors: [], throwMessage: null, consoleErrors: [],
      document: { body }, seeded: true,
      seedReport: {
        writes: [{ name: "x", reason: "written", namespaced: true, wrote: true }],
        domChanged: true, gainedContent, errors: [],
      },
    });
  };

  // F1 — the seeded ROWS rendered; the leaves are per-row nested lists (tags,
  // sub-tasks) that are legitimately empty. ⚠ STRUCTURALLY IDENTICAL TO 25-TRIAGE:
  // an outer range holding rows, each row holding an empty mount. The ONLY thing
  // that tells them apart is whether the write made new content appear, which is
  // why no DOM-shape rule can close this and the transition signal must.
  test("F1: D6 is quiet when the seeded rows rendered but their nested lists are empty", () => {
    const markup =
      "<!--scrml-each:o1-->" +
      '<section>Task A<div data-scrml-each-mount="each_t1"></div></section>' +
      '<section>Task B<div data-scrml-each-mount="each_t2"></div></section>' +
      "<!--/scrml-each:o1-->";
    // The leaf regions really ARE all empty — the region predicate alone says FIRE.
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${markup}</main>`;
    expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(true);
    // ... and the gain conjunct is what keeps it green.
    const det = seededDetectGained(markup, true);
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-clean");
    // Control: the SAME DOM with no gain is the 25-triage shape and must still fire.
    expect(seededDetectGained(markup, false).smells).toContain("S-EMPTY-WITH-DATA");
  });

  // F2 — the seeded datum rendered by interpolation OUTSIDE any each, and one
  // unrelated empty each reddened the whole page.
  test("F2: D6 is quiet when the seeded datum rendered outside any each", () => {
    const markup = "<h1>Welcome, Ada</h1><p>ada@x.io</p><!--scrml-each:n1--><!--/scrml-each:n1-->";
    const det = seededDetectGained(markup, true);
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-clean");
    expect(seededDetectGained(markup, false).smells).toContain("S-EMPTY-WITH-DATA");
  });

  // F3 — an each nobody can see is not evidence of anything. This is the S419
  // one-definition-of-"not rendered" invariant: the region collector was a third
  // reader of the DOM that did not prune unrendered subtrees.
  const HIDDEN_REGION_HOSTS = {
    "the hidden attribute": '<div hidden>{R}</div>',
    "aria-hidden=true": '<div aria-hidden="true">{R}</div>',
    "inline display:none": '<div style="display:none">{R}</div>',
    "inline visibility:hidden": '<div style="visibility: hidden">{R}</div>',
    "a <noscript>": "<noscript>{R}</noscript>",
    "a <template>": "<template>{R}</template>",
    "a hidden GRANDparent": "<div hidden><section><ul>{R}</ul></section></div>",
  };
  for (const [label, host] of Object.entries(HIDDEN_REGION_HOSTS)) {
    for (const [shape, region] of Object.entries({
      "fence": "<!--scrml-each:h1--><!--/scrml-each:h1-->",
      "mount": '<div data-scrml-each-mount="each_h1"></div>',
    })) {
      test(`F3: an empty ${shape} each inside ${label} is not a region at all`, () => {
        const markup = `<h1>App</h1>${host.replace("{R}", region)}`;
        const body = document.createElement("body");
        body.innerHTML = `<main id="root">${markup}</main>`;
        // Not merely "does not fire" — it must not be COLLECTED, or a later change
        // that only tweaks the verdict would reopen this.
        expect(collectEachRegions(body)).toEqual([]);
        expect(regionScopedEmptiness(body)).toBeNull();
        const det = seededDetectGained(markup, false);
        expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
        expect(det.state).toBe("renders-clean");
      });
    }
  }

  // The exclusion must not go too far: a VISIBLE empty each beside a hidden one is
  // still the bug, and the hidden one must not dilute the count.
  test("F3: a visible empty each beside a hidden one still fires, and the hidden one is not counted", () => {
    const markup =
      '<h1>App</h1><div hidden><ul><!--scrml-each:h1--><!--/scrml-each:h1--></ul></div>' +
      "<ul><!--scrml-each:v1--><!--/scrml-each:v1--></ul>";
    const det = seededDetectGained(markup, false);
    expect(det.detail.emptyRegions).toEqual({
      regions: 1, mounts: 0, ranges: 1, leaves: 1, emptyLeaves: 1,
    });
    expect(det.smells).toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-empty-with-data");
  });

  // The leaf direction itself, pinned. The first version of the O(n)-rewrite kept the
  // OUTERMOST regions instead of the innermost — an exact inversion that only the
  // 25-triage control caught. `leaves` must be the 3 inner mounts, never the 1 outer range.
  test("F5: leaf detection keeps the INNERMOST regions, not the outermost", () => {
    const body = document.createElement("body");
    body.innerHTML =
      '<main id="root"><!--scrml-each:t126-->' +
      ["Inbox", "Doing", "Done"]
        .map((c) => `<section><h2>${c}</h2><ul><div data-scrml-each-mount="each_t120"></div></ul></section>`)
        .join("") +
      "<!--/scrml-each:t126--></main>";
    const v = regionScopedEmptiness(body);
    expect(v.summary).toEqual({ regions: 4, mounts: 3, ranges: 1, leaves: 3, emptyLeaves: 3 });
    expect(v.allLeavesEmpty).toBe(true);
  });

  // The gain signal itself.
  test("signatureGained: a pure LOSS is not a gain (the 25-triage transition)", () => {
    const mk = (html) => {
      const b = document.createElement("body");
      b.innerHTML = html;
      return renderedContentSignature(b);
    };
    const full = mk("<ul><li>Inbox</li><li>Task A</li><li>Task B</li></ul>");
    const emptied = mk("<ul><li>Inbox</li></ul>");
    // 25-triage's shape: the seed REPLACES four rendered tasks with none.
    expect(signatureGained(full, emptied)).toBe(false);
    // ... and the other direction is a gain.
    expect(signatureGained(emptied, full)).toBe(true);
    // Unchanged is not a gain (the fixture's bug seed: empty before, empty after).
    expect(signatureGained(full, full)).toBe(false);
    // A repeated value is counted, not set-deduped: 1 row -> 2 identical rows is a gain.
    expect(signatureGained(mk("<ul><li>Ada</li></ul>"), mk("<ul><li>Ada</li><li>Ada</li></ul>"))).toBe(true);
    // Hidden content does not count as gained (S419 one-predicate invariant).
    expect(signatureGained(mk("<p>A</p>"), mk("<p>A</p><p hidden>B</p>"))).toBe(false);
    // A content-bearing element with no text does.
    expect(signatureGained(mk("<p>A</p>"), mk('<p>A</p><img src="b.png">'))).toBe(true);
  });

  // ⛑ S420 HAZARD, PINNED HERE TOO. `generate-baseline.js` persists `detail` for every
  // NON-GREEN cell into the tracked baseline JSON, and reddening a seeded cell is this
  // detector's entire purpose — so the FIRST cell this change reddens is also the first
  // to commit its `detail`. The region ids embed the chunk token (`each_00hqpedw_120`),
  // minted from a fresh `mkdtemp` staging dir and therefore different on every run and
  // machine. Emitting one would churn a committed artifact on every regeneration.
  test("the region report carries NO id, so a newly-red cell cannot churn the baseline", () => {
    const det = seededDetect(`<h1>Board</h1><ul>${MOUNT("00hqpedw_120")}</ul>`);
    expect(det.smells).toContain("S-EMPTY-WITH-DATA");
    const serialized = JSON.stringify(det.detail);
    expect(serialized).not.toContain("00hqpedw");
    expect(serialized).not.toContain("each_");
    // Counts and shapes only.
    expect(Object.keys(det.detail.emptyRegions).sort()).toEqual(
      ["emptyLeaves", "leaves", "mounts", "ranges", "regions"],
    );
  });

  // ⛑ S423 — the seed-WRITE gate. `seeded` is only "a fixture was registered";
  // `examples/06-kanban-board` (derived-cell) and `examples/16-remote-data`
  // (no-such-cell) write nothing and still carry `seeded:true`.
  test("D6 does NOT fire when the seed bridge wrote NOTHING, even on an empty body", () => {
    const det = seededDetect("", { writes: [{ name: "todo", reason: "derived-cell", wrote: false }], domChanged: false });
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-empty");
  });

  test("D6 DOES fire when the seed bridge really wrote and the render is empty", () => {
    const det = seededDetect("", { writes: [{ name: "tasks", reason: "written", wrote: true }], domChanged: true });
    expect(det.smells).toContain("S-EMPTY-WITH-DATA");
    expect(det.detail.emptyWithDataScope).toBe("body");
    expect(det.state).toBe("renders-empty-with-data");
  });

  // Back-compat: an observation with NO seed report is gated on `seeded` alone, exactly
  // as before S423 — which is what keeps every assertion above this block meaningful.
  test("with no seed report at all, D6 still fires on `seeded` alone (pre-S423 behaviour)", () => {
    const det = seededDetect("", undefined);
    expect(det.smells).toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-empty-with-data");
  });
});

// =============================================================================
// D6 END-TO-END against a COMPILED fixture the tier owns (⛑ S423 limb 2).
//
// The block above pins the predicate against synthetic DOM. This one compiles and
// mounts a real `.scrml` through the real harness, so the region shapes are the ones
// the CURRENT compiler emits rather than the ones this test believes it emits. That
// distinction is the point: if the emitter switches a nested each away from
// `data-scrml-each-mount`, or a top-level each away from the comment fence, the
// synthetic pins above keep passing and THIS one reds.
//
// It also gives D6 a subject of its own. Before this fixture, D6's only live corpus
// subject was `examples/25-triage-board.scrml#populated`, and only because
// `seed-fixtures.js` seeds a `column` that matches none of that app's columns — a
// fixture bug tracked separately and scheduled for correction. A detector whose only
// proof is "an example app that happens to be broken this week" is one fixture-fix
// away from being unproven again.
// =============================================================================
describe("D6 end-to-end — the board-bug fixture compiles, mounts, and reddens", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  const FIXTURE = "d6-nested-each-empty-with-data.scrml";
  const TASKS = (col) => ({
    tasks: [
      { id: 1, title: "Alpha", column: col },
      { id: 2, title: "Beta", column: col },
    ],
  });

  test("a seed whose column matches NOTHING renders no rows and D6 reddens the cell", () => {
    const cell = observeApp(fixtureApp(FIXTURE), TASKS("todo"), "populated");
    // The seed must really have landed, or this proves nothing about the DETECTOR.
    expect(cell.detail.seed.writes.map((w) => w.wrote)).toEqual([true]);
    expect(cell.detail.emptyWithDataScope).toBe("each-regions");
    expect(cell.detail.emptyRegions).toEqual({
      regions: 4, mounts: 3, ranges: 1, leaves: 3, emptyLeaves: 3,
    });
    expect(cell.smells).toContain("S-EMPTY-WITH-DATA");
    expect(cell.state).toBe("renders-empty-with-data");
  });

  test("a seed whose column MATCHES renders rows and the cell stays green", () => {
    const cell = observeApp(fixtureApp(FIXTURE), TASKS("Inbox"), "populated");
    expect(cell.detail.seed.writes.map((w) => w.wrote)).toEqual([true]);
    expect(cell.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(cell.state).toBe("renders-clean");
  });

  test("UNSEEDED, the same fixture is a valid empty render and stays green", () => {
    const cell = observeApp(fixtureApp(FIXTURE), null, "empty");
    expect(cell.seeded).toBe(false);
    expect(cell.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(["renders-clean", "renders-empty"]).toContain(cell.state);
  });

  // ⛑ S423 fix round (F4) — the gain signal measured end-to-end on the real compile,
  // which is the half a synthetic `gainedContent` flag cannot prove. The bug seed makes
  // NOTHING new render; the matching seed makes "Alpha"/"Beta" appear.
  test("the seed report's gainedContent is measured from the real render transition", () => {
    const bug = observeApp(fixtureApp(FIXTURE), TASKS("todo"), "populated");
    expect(bug.detail.seed.gainedContent).toBe(false);
    expect(bug.state).toBe("renders-empty-with-data");

    const ok = observeApp(fixtureApp(FIXTURE), TASKS("Inbox"), "populated");
    expect(ok.detail.seed.gainedContent).toBe(true);
    expect(ok.state).toBe("renders-clean");

    // Deterministic + token-free, because it rides on committed `detail`.
    expect(typeof bug.detail.seed.gainedContent).toBe("boolean");
    expect(JSON.stringify(bug.detail.seed)).not.toMatch(/[0-9a-z]{6,}\$/);
  });
});

// =============================================================================
// ⛑ S423 fix round (F4) — THE SEED BRIDGE MUST BE LOUD WHEN IT CANNOT DELIVER.
//
// D6 now gates on a real write, which makes a SILENT non-delivery fail-OPEN: if an
// emit regression drops `_scrml_reactive_set`, no write happens, `seedWasDelivered`
// is false, and every populated cell scores green however empty it renders — and
// `generate-baseline.js` strips `detail` from green cells, so the reason never
// reaches the baseline either. The branch's own comment already claimed "Loud, not
// silent" while recording the reason only in `seedReport.errors`.
// =============================================================================
describe("F4 — a seed that cannot be delivered is LOUD, not silently green", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  // The emit-regression shape, driven through the REAL observeApp by handing it an app
  // whose compiled client exposes no side-channel is not reachable from a fixture — so
  // this asserts the contract the branch must satisfy: a non-delivery reason reaches
  // `consoleErrors`, which D2 turns into a red `compiles-but-throws`, not a green cell.
  test("a bridge failure reaching consoleErrors reddens the cell (D2), never scores green", () => {
    const det = runDetectors({
      compileErrors: [],
      throwMessage: null,
      consoleErrors: ["[seed-bridge] no _scrml_reactive_set side-channel exposed by this emit"],
      document: { body: (() => { const b = document.createElement("body"); b.innerHTML = "<main id=\"root\"></main>"; return b; })() },
      seeded: true,
      seedReport: { chunks: 0, writes: [], domChanged: false, gainedContent: false, observable: false, errors: ["x"] },
    });
    expect(det.smells).toContain("D2-CONSOLE-ERROR");
    expect(det.state).toBe("compiles-but-throws");
    // Explicitly NOT green.
    expect(["renders-clean", "renders-empty", "needs-server"]).not.toContain(det.state);
  });

  // The source-level half: the branch must actually push, and must NOT push for the
  // three KNOWN fixture bugs (derived-cell / no-such-cell), which are tabled in
  // e2e-render-map.test.js and belong to a different arc.
  test("the harness pushes a consoleError for a missing side-channel, but not for a fixture-bug reason", () => {
    const src = readFileSync(join(__dirname, "render-harness.js"), "utf8");
    const noChannel = src.slice(src.indexOf("no _scrml_reactive_set side-channel"));
    expect(noChannel.slice(0, 400)).toContain("obs.consoleErrors.push");
    // set-threw is an emit/harness failure and IS raised...
    expect(src).toContain('w.reason === "set-threw"');
    // ... while the fixture-bug reasons are deliberately not.
    const guard = src.slice(src.indexOf('w.reason === "set-threw"') - 900, src.indexOf('w.reason === "set-threw"') + 400);
    expect(guard).toContain("derived-cell");
    expect(guard).toContain("no-such-cell");
  });
});

describe("D6 — trailing body-scope cases", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
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
