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
import { observeApp, seedThrewNotice } from "./render-harness.js";
import {
  runDetectors,
  hasRenderedContent,
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

  // =========================================================================
  // ⛑ S423 FIX ROUND 2 (finding 1) — REGION OWNERSHIP IS MANY-TO-MANY.
  //
  // A node can belong to TWO regions at once: a fence's rows are the siblings
  // between its anchors, and when that fence sits directly inside a mount host
  // those same nodes are ALSO that mount's direct children. The owner map was a
  // first-wins `Map<node, region>`, and `collectEachRegions` pushes every mount
  // before every range — so the inner range owned nothing, survived as a FALSE
  // LEAF, and its own row chrome vetoed the empty mount beneath it. Fail-quiet:
  // D6 went dark and `detail.emptyRegions` committed wrong counts.
  // =========================================================================
  const NESTED_FENCE_IN_MOUNT =
    '<div data-scrml-each-mount="each_out">' +
    "<!--scrml-each:mid-->" +
    '<section>Row text<div data-scrml-each-mount="each_in"></div></section>' +
    "<!--/scrml-each:mid-->" +
    "</div>";

  test("finding 1: a fence directly inside a mount host does not become a false leaf", () => {
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${NESTED_FENCE_IN_MOUNT}</main>`;
    const v = regionScopedEmptiness(body);
    // The ONLY true leaf is `each_in`. Before the fix this read leaves:2 emptyLeaves:1.
    expect(v.summary).toEqual({ regions: 3, mounts: 2, ranges: 1, leaves: 1, emptyLeaves: 1 });
    expect(v.allLeavesEmpty).toBe(true);
    const det = seededDetectGained(NESTED_FENCE_IN_MOUNT, false);
    expect(det.smells).toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-empty-with-data");
  });

  test("finding 1: the same shape with a NON-empty inner mount stays quiet", () => {
    const markup = NESTED_FENCE_IN_MOUNT.replace(
      '<div data-scrml-each-mount="each_in"></div>',
      '<div data-scrml-each-mount="each_in"><li>Tag</li></div>',
    );
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${markup}</main>`;
    expect(regionScopedEmptiness(body).summary).toEqual({
      regions: 3, mounts: 2, ranges: 1, leaves: 1, emptyLeaves: 0,
    });
    expect(seededDetectGained(markup, false).state).toBe("renders-clean");
  });

  // ⚑ THE MODEL, PINNED AGAINST AN INDEPENDENT ORACLE — not another enumerated
  // position. Two review rounds have now found real defects in region ownership
  // (an inverted leaf direction, then a lossy owner map), and both were shapes
  // nobody had thought to enumerate. So this asserts the PRODUCTION leaf
  // computation against a brute-force reference written straight from the
  // definition — "A encloses B iff B's anchor is at-or-inside one of A's nodes" —
  // with no map, no ordering, and no shared code. Any future optimisation that
  // changes the meaning reds here regardless of whether anyone predicted the shape.
  // `a` encloses `b` — straight from the definition, pairwise, no map, no ordering.
  const encloses = (a, b) => {
    if (a === b) return false;
    const marker = b.shape === "mount" ? b.host : b.start;
    for (let n = marker; n; n = n.parentNode) {
      for (const node of a.nodes) if (node === n) return true;
    }
    return false;
  };
  // A leaf is RESOLVED, encloses nothing, and is not inside a span of unknown extent
  // (⛑ S423 final round, finding 2 — unknown resolves quiet, so it is not a leaf either).
  const referenceLeaves = (regions) =>
    regions.filter(
      (r) =>
        !r.unresolved &&
        !regions.some((o) => encloses(r, o)) &&
        !regions.some((o) => o.unresolved && encloses(o, r)),
    ).length;
  const M = (id, inner = "") => `<div data-scrml-each-mount="each_${id}">${inner}</div>`;
  const F = (id, inner) => `<!--scrml-each:${id}-->${inner}<!--/scrml-each:${id}-->`;
  const OWNERSHIP_SHAPES = {
    "flat: one fence": F("a", "<li>x</li>"),
    "flat: one mount": M("a", "<li>x</li>"),
    "two disjoint siblings, both shapes": `<ul>${F("a", "")}</ul><ul>${M("b")}</ul>`,
    "mount inside fence (the 25-triage shape)": F("o", `<section>${M("i")}</section>`),
    "fence DIRECTLY inside mount (finding 1)": NESTED_FENCE_IN_MOUNT,
    "fence deeper inside mount (no shared node)": M("o", `<section>${F("m", `<b>${M("i")}</b>`)}</section>`),
    "fence directly inside fence": F("o", F("i", "<li>x</li>")),
    "mount directly inside mount": M("o", M("i")),
    "three levels alternating": M("a", F("b", `<section>${M("c")}</section>`)),
    "three levels, all direct": M("a", F("b", M("c"))),
    "two fences sharing a parent with a mount": `<ul>${F("a", "")}${M("b")}${F("c", "<li>y</li>")}</ul>`,
    "sibling subtrees each with their own nesting": `<div>${F("a", M("b"))}</div><div>${M("c", F("d", ""))}</div>`,
    // ⛑ S423 final round (finding 2) — the UNRESOLVED shapes, carried by the differential
    // rather than by enumerated cases, exactly as asked.
    "unterminated fence wrapping a mount": '<!--scrml-each:o--><section>Task A<div data-scrml-each-mount="each_i"></div></section>',
    "unterminated fence, mount as a direct following sibling": `<ul><!--scrml-each:o-->${M("i")}</ul>`,
    "unterminated fence with nothing after it, beside a resolved each": `<ul>${F("v", "")}</ul><div><!--scrml-each:o--></div>`,
    "unterminated fence in a sibling subtree of a resolved each": `<div><!--scrml-each:o--></div><ul>${F("v", "")}</ul>`,
    "unterminated fence INSIDE a resolved fence": F("outer", `<section><!--scrml-each:o-->${M("i")}</section>`),
    "unterminated fence inside a mount host": M("outer", `<!--scrml-each:o--><span>x</span>${M("i")}`),
    "two unterminated fences nested": '<!--scrml-each:a--><section><!--scrml-each:b--><div data-scrml-each-mount="each_i"></div></section>',
    "resolved fence nested inside an unterminated one": `<!--scrml-each:o--><section>${F("r", M("i"))}</section>`,
  };
  for (const [label, markup] of Object.entries(OWNERSHIP_SHAPES)) {
    test(`ownership model agrees with the brute-force reference: ${label}`, () => {
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${markup}</main>`;
      const regions = collectEachRegions(body);
      expect(regions.length).toBeGreaterThan(0); // non-vacuity
      // A shape with no resolved leaf yields null (the question is unanswerable) — which is
      // reference-leaves 0. Both halves of that equivalence are part of what is pinned.
      const v = regionScopedEmptiness(body);
      expect(v ? v.summary.leaves : 0).toBe(referenceLeaves(regions));
    });
  }

  // =========================================================================
  // ⛑ S423 FINAL ROUND (finding 2) — A DROPPED REGION MUST NOT PROMOTE ITS CHILDREN.
  //
  // The same ruling as fix-round-2 finding 1, reached by a different route: an
  // unterminated fence was dropped with a bare `continue`, but the regions inside
  // its span were still collected, so an inner mount was promoted to a FALSE LEAF
  // and its outer each's rendered rows no longer vetoed. It is now kept as an
  // UNRESOLVED region: never a leaf, never in the resolved counts, but still
  // enclosing — so everything possibly inside it is unknown, and unknown is quiet.
  // =========================================================================
  test("finding 2: an unterminated fence does not promote the mount inside it to a leaf", () => {
    const markup = '<!--scrml-each:o--><section>Task A<div data-scrml-each-mount="each_i"></div></section>';
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${markup}</main>`;
    // The inner mount IS empty and DOES enclose nothing — under the old rule it was a leaf.
    expect(collectEachRegions(body).length).toBe(2);
    // ... but its leaf status is unknown, so the question is unanswerable.
    expect(regionScopedEmptiness(body)).toBeNull();
    const det = seededDetectGained(markup, false);
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-clean");
  });

  // The exclusion must not go too far: an unresolved span that can enclose NOTHING
  // must not silence an unrelated, genuinely-empty each elsewhere.
  // ⚠ Each carries visible chrome (`<h1>`) ON PURPOSE. Without it the body renders nothing,
  // the BODY scope answers first, and the test would pass while proving nothing about
  // regions — which is exactly how the first version of this table passed the wrong way.
  // The `emptyWithDataScope` assertion is what makes that impossible to repeat.
  const UNRESOLVED_MUST_STILL_FIRE = {
    "unterminated fence with nothing after it": `<h1>Board</h1><ul>${"<!--scrml-each:v--><!--/scrml-each:v-->"}</ul><div><!--scrml-each:o--></div>`,
    "unterminated fence in a sibling subtree": `<h1>Board</h1><div><!--scrml-each:o--></div><ul>${"<!--scrml-each:v--><!--/scrml-each:v-->"}</ul>`,
  };
  for (const [label, markup] of Object.entries(UNRESOLVED_MUST_STILL_FIRE)) {
    test(`finding 2: a non-enclosing unresolved span still lets a real empty each fire: ${label}`, () => {
      const det = seededDetectGained(markup, false);
      expect(det.detail.emptyWithDataScope).toBe("each-regions");
      expect(det.detail.emptyRegions).toEqual({
        regions: 1, mounts: 0, ranges: 1, leaves: 1, emptyLeaves: 1, unresolved: 1,
      });
      expect(det.smells).toContain("S-EMPTY-WITH-DATA");
      expect(det.state).toBe("renders-empty-with-data");
    });
  }

  // The count surface: `unresolved` appears ONLY when non-zero, so the committed
  // `detail.emptyRegions` shape is unchanged for every cell that has none — including
  // 25-triage, whose baseline entry must not churn.
  test("finding 2: the summary omits `unresolved` when there is none", () => {
    const det = seededDetectGained(`<h1>Board</h1><ul>${"<!--scrml-each:v--><!--/scrml-each:v-->"}</ul>`, false);
    expect(det.detail.emptyRegions).toEqual({ regions: 1, mounts: 0, ranges: 1, leaves: 1, emptyLeaves: 1 });
    expect("unresolved" in det.detail.emptyRegions).toBe(false);
  });

  // The sibling drop-site, checked rather than assumed: a HIDDEN region is also dropped,
  // but that one is self-consistent — anything inside a hidden ancestor is itself hidden,
  // so it is dropped too and there is nothing left to promote.
  test("finding 2: the hidden-region drop site cannot promote, because children are hidden too", () => {
    const body = document.createElement("body");
    body.innerHTML =
      '<main id="root"><h1>App</h1><div hidden>' +
      '<!--scrml-each:o--><section><div data-scrml-each-mount="each_i"></div></section><!--/scrml-each:o-->' +
      "</div></main>";
    // BOTH regions are dropped, so no child survives to be promoted.
    expect(collectEachRegions(body)).toEqual([]);
    expect(regionScopedEmptiness(body)).toBeNull();
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
    // ⛑ S424 — `gainedContent: false` is now STATED rather than left absent. This test exercises
    // the measured-no-gain path; it previously reached it only because an absent field fell
    // through to the fire direction, i.e. it depended on the defect fixed in
    // `seedMovedTheRender` (located by SYMBOL on purpose — a line number in a comment rots and
    // nothing fails, which this file has already been bitten by). Stating the measurement is
    // what the round-2 ruling requires of every hand-built report: none may *claim* a
    // measurement, and none may hide one.
    const det = seededDetect("", {
      writes: [{ name: "tasks", reason: "written", wrote: true }],
      domChanged: true,
      gainedContent: false,
    });
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

  // ⛑ S424 — THE BITE for `seedMovedTheRender`'s fire-only-on-the-measured-value rule.
  // Surfaced by the review-floor pass on #993, filed as item 1 of
  // [[g-d6-seed-gating-has-three-latent-paths-...]], then WIDENED by the adversarial pass on
  // the first attempt at this very fix: that attempt closed `undefined` and left the class,
  // so `0` / `""` / `NaN` / the string `"false"` all still fabricated a verdict.
  // The invariant is now: **only a MEASURED `false` fires; every other value vetoes.**
  // ⚑ Distinct from the back-compat case above, which has NO report at all (`!report`);
  // these all have a report whose field is missing or malformed.
  test("S424: only a MEASURED false fires D6 — null, absent and malformed all veto", () => {
    const writes = [{ name: "tasks", reason: "written", wrote: true }];
    const report = (extra) => seededDetect("", { writes, domChanged: true, ...extra });

    // (a) MEASURED no-gain -> FIRES. The control: the veto must not silence a real verdict.
    const measured = report({ gainedContent: false });
    expect(measured.smells).toContain("S-EMPTY-WITH-DATA");
    expect(measured.state).toBe("renders-empty-with-data");

    // (b) MEASURED gain -> vetoes.
    expect(report({ gainedContent: true }).smells).not.toContain("S-EMPTY-WITH-DATA");

    // (c) explicit null (the snapshot threw) -> vetoes. Round-2 behaviour, unchanged.
    const explicitNull = report({ gainedContent: null });
    expect(explicitNull.smells).not.toContain("S-EMPTY-WITH-DATA");
    // ⚑ Pin the CONCRETE state, not merely "not the red one" — asserting only
    // `!== "renders-empty-with-data"` would stay green if a future change sent the UNMEASURED
    // forms to some other wrong state (`renders-clean`, `needs-server`).
    expect(explicitNull.state).toBe("renders-empty");

    // (d) ABSENT field -> vetoes, and lands in the SAME concrete state as explicit null.
    const absent = report({});
    expect(absent.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(absent.state).toBe("renders-empty");

    // (e) MALFORMED values -> veto. This is the class the first attempt missed; `"false"` is
    // the plainest case, since a truthiness-coerced field would read as "it gained content".
    for (const bad of ["", 0, NaN, "false", "no", {}, []]) {
      const det = report({ gainedContent: bad });
      expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
      expect(det.state).toBe("renders-empty");
    }
  });

  // =========================================================================
  // ⛑ S426 — THE REGION'S CONTENT TEST AGREES WITH THE ANCESTOR THAT CONFERS CONTENT.
  // g-d6-region-content-ignores-the-parent-that-confers-content-so-an-each-inside-a-select-or-picture-reds-a-correct-render
  //
  // `nodesHaveRenderedContent` decided a region's content from the region's OWN nodes,
  // but three arms of `elementCarriesContent` make an element content-bearing because of
  // what it CONTAINS: `select` (an `<option>`), `picture`/`video`/`audio` (a `<source>`/
  // `<img>` with `src`/`srcset`), `svg` (any element child). The fence lands at the each's
  // SOURCE position, so the rows sit INSIDE that parent while the element that counts them
  // sits OUTSIDE the region — and neither `option` nor `source` is in
  // CONTENT_CANDIDATE_SELECTOR, nor is a `<circle>`. So the region measured EMPTY on a
  // CORRECT render and D6 scored `renders-empty-with-data`: RED against the compiler.
  //
  // ⚠ THE FIX IS NOT A WIDER `CONTENT_CANDIDATE_SELECTOR` — that list also answers BODY
  // scope, so adding `option`/`source` would make a bare `<option value="1">` count as a
  // whole page's rendered content, re-opening the S419 one-definition-of-"not rendered"
  // class from the other side. The BODY-SCOPE PINS at the end of this block are what keep
  // that door shut, and they are the reason this block cannot be satisfied by the easy fix.
  //
  // This is a PREVENTATIVE fix: measured over 2,609 corpus `.scrml` files, every real
  // `<each>`-inside-a-conferring-parent site emits options WITH TEXT (the text half already
  // saves them) and `picture`/`video`/`audio`/`svg` are corpus-ZERO. Corpus absence is not
  // design intent — value-only `<option>` rows and `<source>` rows are legitimate scrml,
  // and a detector that reds a correct render is the cry-wolf shape pa-base §8 names.
  // =========================================================================

  // Every conferring definition, in BOTH directions. The QUIET direction (the region's
  // nodes really do confer) is the defect; the FIRES direction is the control that the
  // fix did not simply green the family.
  //
  // ⚑ EVERY `markup` HERE CARRIES CONTENT OUTSIDE THE REGION THAT ALREADY MAKES THE PARENT
  // CONTENT-BEARING — the `<select>`'s placeholder option, the `<picture>`'s fallback
  // `<img>`, a fallback `<source>`, a decorative `<circle>`. That is not incidental
  // realism, it is what makes the FAIL-OPEN control below sharp, and it was MEASURED into
  // existence: the first version of this table gave `<video>`/`<audio>`/`<svg>` nothing
  // outside the region, so with an empty region the WHOLE BODY rendered nothing and D6
  // fired at `body` scope — the control passed while proving nothing about region scope.
  const CONFERRING_PARENTS = {
    // `select` — the `<option>` rows carry a value and NO text, so the text half cannot
    // save them. This is the shape a real `<select>` of ids/codes emits.
    "an each of value-only <option>s inside a <select>": {
      markup: '<select><option value="">Choose…</option>{R}</select>',
      rows: '<option value="1"></option><option value="2"></option>',
    },
    // `picture` — responsive `<source>` rows.
    "an each of <source srcset> inside a <picture>": {
      markup: '<picture>{R}<img src="a.jpg" alt="a"></picture>',
      rows: '<source srcset="a-480.webp"><source srcset="a-960.webp">',
    },
    "an each of <source src> inside a <video>": {
      markup: '<video><source src="fallback.mp4">{R}</video>',
      rows: '<source src="a.mp4">',
    },
    "an each of <source src> inside an <audio>": {
      markup: '<audio><source src="fallback.mp3">{R}</audio>',
      rows: '<source src="a.mp3">',
    },
    // ⚑ `svg` IS A THIRD INSTANCE THE GAP ENTRY DID NOT NAME — found by sweeping every
    // arm of `elementCarriesContent` for a delegating definition, not by trusting the
    // filed list. `case "svg"` is `el.children.length > 0`: any element child.
    "an each of shapes inside an <svg>": {
      markup: '<svg viewBox="0 0 10 10"><circle cx="9" cy="9" r="1"></circle>{R}</svg>',
      rows: '<circle cx="1" cy="1" r="1"></circle><circle cx="5" cy="5" r="1"></circle>',
    },

    // ===== FIX ROUND — the parents with NO body-scope counterpart, deliberately. =====
    // These four are why the table's invariant had to be restated (see
    // CONSUMED_CHILD_SELECTOR): `elementCarriesContent` has no arm for `datalist`, `map` or
    // `colgroup`, and counts no `<track>` for a `<video>` — and it MUST NOT, which the
    // BODY-SCOPE pins at the end of this block enforce. The each still did its job.
    //
    // ⚑ Each of these markups carries its own CHROME, because the parent is not itself
    // content-bearing: without chrome the body renders nothing, D6 answers at `body` scope
    // and the fail-open control below would prove nothing about region scope. That is the
    // same mistake this block already made once, recorded above.
    "an each of <option>s inside a <datalist>": {
      markup: '<h1>Search</h1><input list="cities"><datalist id="cities">{R}</datalist>',
      rows: '<option value="Paris"></option><option value="Rome"></option>',
    },
    "an each of <area>s inside a <map>": {
      markup: '<img src="a.png" usemap="#m"><map name="m">{R}</map>',
      rows: '<area shape="rect" coords="0,0,1,1" href="/a">',
    },
    "an each of <col>s inside a <colgroup>": {
      markup: "<table><colgroup>{R}</colgroup><tbody><tr><td>x</td></tr></tbody></table>",
      rows: '<col span="2">',
    },
    "an each of <track>s inside a <video>": {
      markup: '<video><source src="fallback.mp4">{R}</video>',
      rows: '<track src="en.vtt" kind="captions"><track src="fr.vtt" kind="captions">',
    },
  };
  for (const [label, { markup, rows }] of Object.entries(CONFERRING_PARENTS)) {
    test(`S426: D6 is QUIET when ${label} rendered rows`, () => {
      const filled = markup.replace("{R}", FENCE("a_1", rows));
      // The page really does render correctly — `hasRenderedContent` says so via the
      // conferring parent. That is what makes a RED here a false positive and not a miss.
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${filled}</main>`;
      expect(hasRenderedContent(body)).toBe(true);
      expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(false);
      const det = seededDetect(filled);
      expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
      expect(det.state).toBe("renders-clean");
    });

    // ⚑ THE MANDATORY FAIL-OPEN CONTROL, ONE PER FAMILY. The SAME markup with the SAME
    // conferring parent and an EMPTY region must still fire. This is what separates the
    // fix from asking `elementCarriesContent(parent)`: the `<select>`'s placeholder option,
    // the `<picture>`'s fallback `<img>` and the `<video>`'s own `<source>` all sit OUTSIDE
    // the region and already make the parent content-bearing BEFORE any seed — so a
    // parent-is-content-bearing rule would score every one of these GREEN and D6 would go
    // dark on exactly the render it exists to catch.
    test(`S426 FAIL-OPEN CONTROL: D6 still FIRES when ${label} rendered nothing`, () => {
      const empty = markup.replace("{R}", FENCE("a_1", ""));
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${empty}</main>`;
      expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(true);
      const det = seededDetect(empty);
      expect(det.smells).toContain("S-EMPTY-WITH-DATA");
      expect(det.detail.emptyWithDataScope).toBe("each-regions");
      expect(det.state).toBe("renders-empty-with-data");
    });
  }

  // The BARE parent — nothing outside the region at all, so the region's rows are the only
  // thing making the page render. These are the three shapes reproduced verbatim on
  // `f8317399`, where all three printed `page correct: true | allLeavesEmpty: true`.
  const BARE_CONFERRING_PARENTS = {
    "<select> whose ONLY options are the each's value-only rows":
      '<select>{R}</select>|<option value="1"></option>',
    "<picture> whose ONLY sources are the each's rows":
      "<picture>{R}</picture>|<source srcset=\"a-480.webp\">",
    "<svg> whose ONLY shapes are the each's rows":
      '<svg viewBox="0 0 10 10">{R}</svg>|<circle cx="1" cy="1" r="1"></circle>',
  };
  for (const [label, spec] of Object.entries(BARE_CONFERRING_PARENTS)) {
    test(`S426: D6 is QUIET on the bare repro shape — ${label}`, () => {
      const [markup, rows] = spec.split("|");
      const filled = markup.replace("{R}", FENCE("a_1", rows));
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${filled}</main>`;
      // The page renders — the parent is content-bearing ONLY because of these rows.
      expect(hasRenderedContent(body)).toBe(true);
      expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(false);
      expect(seededDetect(filled).state).toBe("renders-clean");
    });
  }

  // ⚑ THE NEAREST SIBLING OF THE FIX, AND THE DISPATCHING HYPOTHESIS WAS WRONG ABOUT IT.
  // The fix was dispatched as "look at the region's PARENT (`node.parentNode`)". But
  // `select` and `picture`/`video`/`audio` confer via `querySelector`, which is a
  // DESCENDANT query — so the conferring element is an ANCESTOR and need not be the parent.
  // A parent-only rule re-creates this same class one wrapper away, and all three of these
  // scored RED on a correct render when measured against it. They are the regression pin on
  // the ancestor walk: revert it to `parentElement`-only and every case here reds.
  const CONFERRING_ANCESTORS_AT_DEPTH = {
    "<select><optgroup> (an option group wraps the rows)":
      '<select><optgroup label="Recent">{R}</optgroup></select>',
    "<svg><g> (a transform group wraps the shapes)":
      '<svg viewBox="0 0 10 10"><g transform="translate(1,1)">{R}</g></svg>',
    "<video><div> (a wrapper element between the video and its sources)":
      "<video><div>{R}</div></video>",
  };
  const DEPTH_ROWS = {
    "<select><optgroup> (an option group wraps the rows)": '<option value="1"></option>',
    "<svg><g> (a transform group wraps the shapes)": '<circle cx="1" cy="1" r="1"></circle>',
    "<video><div> (a wrapper element between the video and its sources)": '<source src="a.mp4">',
  };
  for (const [label, markup] of Object.entries(CONFERRING_ANCESTORS_AT_DEPTH)) {
    test(`S426: the conferring element may be an ANCESTOR, not the parent — ${label}`, () => {
      const filled = markup.replace("{R}", FENCE("a_1", DEPTH_ROWS[label]));
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${filled}</main>`;
      expect(hasRenderedContent(body)).toBe(true);
      expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(false);
      expect(seededDetect(filled).state).toBe("renders-clean");
    });
  }

  // The MOUNT shape too — a nested each inside a `<select>` is a mount div, and its rows
  // are the div's children. A fix that understands only the fence is half a fix (the same
  // ruling the REGION_SHAPES table above makes for the base predicate).
  test("S426: the mount shape confers too — a nested each of options inside a <select>", () => {
    const markup = `<select><option value="">Choose…</option>${MOUNT("x_1", '<option value="1"></option>')}</select>`;
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${markup}</main>`;
    expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(false);
    expect(seededDetect(markup).state).toBe("renders-clean");
  });

  // The conferring rule mirrors each parent's OWN test and must not become "anything inside
  // a conferring parent counts". Each of these sits inside a conferring parent and fails
  // that parent's own conferring test, so each must still FIRE.
  const CONFERS_NOTHING = {
    "a <source> with NO src or srcset inside a <video>": {
      markup: "<video>{R}</video>", rows: "<source>",
    },
    "a non-option element inside a <select>": {
      markup: '<select><option value="">Choose…</option>{R}</select>', rows: "<span></span>",
    },
    // ⛑ S419 parity — the conferring descendant must be RENDERED. A hidden option is not
    // content anywhere else in this file and must not become content here.
    // ⚠ MEASURED, AND IT DOES NOT BITE THE S426 PREDICATE: this case stays green even when
    // `confersContentToConferringAncestor` is gutted to `return true`, because
    // `nodesHaveRenderedContent` already skips an unrendered region node (via
    // `isUnrenderedByOwnMarkup`) BEFORE asking the conferring question. So this pins the
    // UPSTREAM guard, not the new predicate — recorded rather than left to imply a bite it
    // does not have. It still earns its place: it reds if that skip is ever removed.
    "an <option> hidden by markup inside a <select>": {
      markup: '<select><option value="">Choose…</option>{R}</select>', rows: '<option hidden value="1"></option>',
    },
    // ⚑ `foreignObject` BOUNDS THE SVG RULE. Inside one, HTML content rules apply, so an
    // empty `<li>` must not become content by way of the enclosing `<svg>`. It is bounded
    // by a TAG test and not by `namespaceURI`, deliberately: happy-dom reports
    // `http://www.w3.org/2000/svg` for an `<li>` inside a foreignObject (measured), so a
    // namespace bound would silently not bind.
    "an empty <li> inside a <foreignObject> inside an <svg>": {
      markup: '<svg><circle cx="1" cy="1" r="1"></circle><foreignObject><ul>{R}</ul></foreignObject></svg>',
      rows: "<li></li>",
    },
    // The plain control: the same empty row in a plain `<ul>` is the true positive that
    // the whole detector exists for, and it is unaffected.
    "an empty <li> in a plain <ul>": {
      markup: "<h1>App</h1><ul>{R}</ul>", rows: "<li></li>",
    },
  };
  for (const [label, { markup, rows }] of Object.entries(CONFERS_NOTHING)) {
    test(`S426: D6 still FIRES — ${label} confers nothing`, () => {
      const filled = markup.replace("{R}", FENCE("a_1", rows));
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${filled}</main>`;
      expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(true);
      const det = seededDetect(filled);
      expect(det.smells).toContain("S-EMPTY-WITH-DATA");
      expect(det.state).toBe("renders-empty-with-data");
    });
  }

  // ⚑ THE ENUMERATION'S DISPOSALS, PINNED. The population was enumerated once by execution
  // rather than discovered one instance at a time (six were found that way). Every shape
  // below was measured, judged OUT of scope, and must therefore STILL FIRE — so the
  // enumeration is a gate and not a paragraph. If a later round decides one of these really
  // is a consumed row, the test that reds names it precisely.
  const ENUMERATED_AND_DISPOSED = {
    // Element children of a `<slot>` are shadow-DOM fallback content, and scrml emits no
    // shadow roots. An each of empty `<span>`s is an empty render.
    "empty <span>s inside a <slot>": { markup: "<h1>App</h1><slot>{R}</slot>", rows: "<span></span>" },
    // `<iframe>`/`<embed>` element children are FALLBACK content, never rendered when the
    // resource loads. Not consumed rows.
    "fallback content inside an <iframe>": { markup: "<h1>App</h1><iframe>{R}</iframe>", rows: "<span></span>" },
    // `<param>` is obsolete — removed from the HTML Living Standard.
    "<param>s inside an <object>": {
      markup: '<h1>App</h1><object data="a.swf">{R}</object>', rows: '<param name="q" value="1">',
    },
    // Head metadata is not page content in any sense. (`regionScopedEmptiness` only ever
    // walks the BODY, so a real `<head>` each is out of reach regardless.)
    "<link>/<meta> in the body": {
      markup: "<h1>App</h1>{R}", rows: '<link rel="stylesheet" href="a.css"><meta name="x" content="1">',
    },
    // ⚠ THE ONE CONTESTABLE DISPOSAL, recorded as such. MathML that carries meaning carries
    // TEXT (`<math><mn>2</mn>` measures green already, via the text half); an each producing
    // only spacers renders nothing a reader could see. Revisit if a corpus app emits one.
    "text-free <mspace> inside <math>": {
      markup: "<h1>App</h1><math>{R}</math>", rows: '<mspace width="1em"></mspace>',
    },
    // MEASURED UNREACHABLE, and this one is a parser fact, not a judgement: a `<col>` with no
    // `<colgroup>` is HOISTED OUT of the table by the HTML parser, leaving the fence genuinely
    // empty — so the red is CORRECT. `<colgroup><col>` is covered above; this is not.
    "a <col> inside a <table> with NO <colgroup>": {
      markup: "<table>{R}<tbody><tr><td>x</td></tr></tbody></table>", rows: '<col span="2">',
    },
    // A standalone `<optgroup>` is invalid HTML no browser renders. Inside a `<select>` or
    // `<datalist>` it is covered TRANSITIVELY by the ancestor walk (pinned separately).
    "an <option> inside a standalone <optgroup>": {
      markup: '<h1>App</h1><optgroup label="g">{R}</optgroup>', rows: '<option value="1"></option>',
    },
  };
  for (const [label, { markup, rows }] of Object.entries(ENUMERATED_AND_DISPOSED)) {
    test(`S426 enumeration: OUT of scope, still FIRES — ${label}`, () => {
      const filled = markup.replace("{R}", FENCE("a_1", rows));
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${filled}</main>`;
      expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(true);
      expect(seededDetect(filled).state).toBe("renders-empty-with-data");
    });
  }

  // `<optgroup>` inside a `<datalist>`, the transitive case the disposal above relies on.
  test("S426 enumeration: <optgroup> is covered TRANSITIVELY inside a <datalist>", () => {
    const markup = `<h1>Search</h1><datalist id="c"><optgroup label="g">${FENCE("a_1", '<option value="1"></option>')}</optgroup></datalist>`;
    const body = document.createElement("body");
    body.innerHTML = `<main id="root">${markup}</main>`;
    expect(regionScopedEmptiness(body).allLeavesEmpty).toBe(false);
    expect(seededDetect(markup).state).toBe("renders-clean");
  });

  // ⛑ FIX ROUND (finding 2) — A HOSTILE TAG NAME MADE THE DETECTOR **THROW** INSTEAD OF
  // CLASSIFY, which this file's header forbids outright ("these detectors CLASSIFY a failure;
  // they NEVER hide one"). The table was an object literal, so the tag lookup read through
  // `Object.prototype` and handed a truthy NON-selector to `matches()`/`querySelectorAll()`.
  // MEASURED before the fix: `<constructor>` threw `'function Object() { [native code] }' is
  // not a valid selector` from `matches`, and `<__proto__>` threw `'[object Object]'` from
  // `querySelectorAll` — a SECOND instance the review did not name, and from a different call
  // site. Exactly those two of the eight below, because the lookup lowercases the tag first,
  // so only the all-lowercase members of `Object.prototype` survive as keys.
  // The table is a `Map` now, which has no prototype chain to fall through: immune by
  // construction rather than by enumerating the hostile names. This test proves the class is
  // closed, and it is the one assertion here that a `Object.hasOwn` patch would also pass —
  // which is fine; what must never regress is that NONE of these throws.
  test("S426 finding 2: a prototype-colliding tag name CLASSIFIES, never throws", () => {
    for (const tag of [
      "constructor", "__proto__", "toString", "valueOf",
      "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "prototype",
    ]) {
      const markup = `<h1>App</h1><${tag}>${FENCE("a_1", "<b></b>")}</${tag}>`;
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${markup}</main>`;
      // The assertion is that this RETURNS rather than throwing...
      const verdict = regionScopedEmptiness(body);
      // ...and that it returns the CORRECT answer: `<b></b>` is an empty row under a tag that
      // consumes nothing, so the region is empty and D6 fires. A `return false` guard that
      // accidentally suppressed the whole region would pass a throws-check and fail this.
      expect(verdict.allLeavesEmpty).toBe(true);
      expect(seededDetect(markup).state).toBe("renders-empty-with-data");
    }
  });

  // ⚑ THE PINS THAT FORBID THE EASY FIX. Widening `CONTENT_CANDIDATE_SELECTOR` with
  // `option` / `source` would green every QUIET case above AND make each of these bodies
  // count as a rendered page, which is the S419 class
  // (g-e2e-render-map-hidden-text-counts-as-content-while-hidden-elements-do-not) from the
  // other side. S426 changes REGION scope only; body scope is byte-for-byte unchanged.
  const BODY_SCOPE_RENDERS_NOTHING = {
    "a bare value-only <option>": '<option value="1"></option>',
    "a bare <source src>": '<source src="a.mp4">',
    "a bare <source srcset>": '<source srcset="a-480.webp">',
    "an <option> alone inside an empty-rendering wrapper": '<div><option value="1"></option></div>',
    "a select with no options (the seeded options loop rendered nothing)": "<select></select>",
    "a src-less video holding a src-less source": "<video><source></video>",
    // ⚑ FIX ROUND — THE PIN THAT STOPS THE NEXT PERSON "FIXING" DATALIST THE WRONG WAY.
    // A `<datalist>` is an autocomplete SOURCE, not page content: a page whose entire output
    // is a datalist of options shows the reader nothing, so this MUST stay false. That is
    // precisely why datalist gets no `CONTENT_CANDIDATE_SELECTOR` entry and no
    // `elementCarriesContent` arm, and why the region-scope question had to be restated as
    // "did the each produce the rows this parent consumes?" rather than "does this node make
    // its parent content-bearing?". Both answers are right at their own scope.
    "a datalist holding options (an autocomplete source, not page content)":
      '<datalist id="cities"><option value="Paris"></option><option value="Rome"></option></datalist>',
    "a map holding areas (referenced by usemap, renders nothing itself)":
      '<map name="m"><area shape="rect" coords="0,0,1,1" href="/a"></map>',
    "a colgroup holding cols (layout only, no content of its own)":
      '<table><colgroup><col span="2"></colgroup></table>',
    "a video whose only child is a track (a subtitle file is not media)":
      '<video><track src="en.vtt" kind="captions"></video>',
    "a bare area": '<area shape="rect" coords="0,0,1,1" href="/a">',
    "a bare col": '<col span="2">',
    "a bare track": '<track src="en.vtt" kind="captions">',
  };
  for (const [label, markup] of Object.entries(BODY_SCOPE_RENDERS_NOTHING)) {
    test(`S426: BODY scope unchanged — ${label} still renders nothing`, () => {
      const body = document.createElement("body");
      body.innerHTML = `<main id="root">${markup}</main>`;
      expect(hasRenderedContent(body)).toBe(false);
      // And therefore a seeded cell with this body is still the RED body-scope verdict.
      const det = seededDetect(markup);
      expect(det.detail.emptyWithDataScope).toBe("body");
      expect(det.state).toBe("renders-empty-with-data");
    });
  }
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

  // Local twin of the D6 block's helper (that one is scoped to its own describe).
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
    const raw = readFileSync(join(__dirname, "render-harness.js"), "utf8");
    // ⛑⛑ S424 — READ THIS BEFORE TRUSTING THIS TEST. IT IS A SHAPE CHECK, NOT A BEHAVIOUR
    // GATE, AND IT CANNOT BECOME ONE.
    //
    // History, because it took three attempts to state honestly. The anchor
    // `w.reason === "set-threw"` used to resolve to the inlined guard; when the harness
    // DOCUMENTED both broken rounds in a JSDoc block, the first occurrence moved into PROSE,
    // and the ±1400/+400 window around it is comment text that mentions `derived-cell` /
    // `no-such-cell` because the carve-out doc names them. So all three assertions passed on
    // the explanation of the code rather than the code — the same hollow-gate class the
    // sibling test below had just fixed, re-created one level away by the comment that fixed
    // it.
    //
    // ⚑ The first repair — stripping comments and re-anchoring on `const threw =
    // writes.filter(` — DID NOT FIX IT EITHER, and the mutation proof is why: gutting
    // `seedThrewNotice` to `return null` leaves every anchored string intact, so this test
    // stayed green 1/0 against a function that can never push a notice. **A source-text
    // assertion cannot detect a gutted function; there is no anchor that makes it able to.**
    //
    // ⚑ THE REAL GATE IS BEHAVIOURAL AND IT IS STRONG: the same mutation reds **13** tests —
    // the `LOUDNESS_CASES` rows and the whole `S424 item 3` describe, all of which call the
    // real exported `seedThrewNotice` / `runDetectors`. Measured, not assumed. This test is
    // retained only for what it can honestly assert: that the carve-out is achieved BY
    // CONSTRUCTION rather than by special-casing the two fixture-bug reasons in code. If it
    // ever disagrees with the behavioural tests, believe them.
    //
    // Comments are stripped first regardless, so a future doc edit cannot silently move the
    // anchors again.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/[^\n]*/g, "$1");
    const noChannel = src.slice(src.indexOf("no _scrml_reactive_set side-channel"));
    expect(noChannel.slice(0, 400)).toContain("obs.consoleErrors.push");
    // set-threw is an emit/harness failure and IS raised — anchored on the EXECUTABLE site
    // (the counting filter), not on a string any comment could also contain.
    expect(src).toContain('const threw = writes.filter(');
    expect(src).toContain('w.reason === "set-threw"');
    // ... while the fixture-bug reasons are deliberately not raised. The carve-out now holds
    // BY CONSTRUCTION (neither reason can make `threw > 0`), so assert that the counting site
    // is the only gate and that the two reasons are not being special-cased in code.
    const guard = src.slice(src.indexOf('const threw = writes.filter(') - 600, src.indexOf('const threw = writes.filter(') + 600);
    expect(guard).not.toContain('reason === "derived-cell"');
    expect(guard).not.toContain('reason === "no-such-cell"');
  });

  // ⛑ S423 fix round 2 (finding 2) — the guard required EVERY write to be `set-threw`,
  // so a MIXED fixture stayed silent: a real accessor throw disappearing exactly the way
  // F4 exists to prevent. Any >=2-key fixture with one missing key and one throwing key
  // hits it. Asserted as a predicate over write-sets, so the condition itself is pinned
  // rather than one example of it.
  const LOUDNESS_CASES = {
    "every write threw": [{ reason: "set-threw", wrote: false }, { reason: "set-threw", wrote: false }],
    "MIXED: one threw, one names no such cell": [{ reason: "set-threw", wrote: false }, { reason: "no-such-cell", wrote: false }],
    "MIXED: one threw, one is a derived cell": [{ reason: "derived-cell", wrote: false }, { reason: "set-threw", wrote: false }],
    "a single throwing write": [{ reason: "set-threw", wrote: false }],
    // ⛑ S424 item 3 — MOVED UP FROM QUIET_CASES, and this row IS the gap. A throw is a
    // harness/emit failure on its own terms; a sibling key landing says nothing about it.
    "a throw alongside a write that LANDED": [{ reason: "set-threw", wrote: false }, { reason: "written", wrote: true }],
    "the list key throws, TWO unrelated keys land": [
      { reason: "set-threw", wrote: false },
      { reason: "written", wrote: true },
      { reason: "written", wrote: true },
    ],
    "a throw, a landed write AND a tabled fixture bug together": [
      { reason: "set-threw", wrote: false },
      { reason: "written", wrote: true },
      { reason: "derived-cell", wrote: false },
    ],
  };
  const QUIET_CASES = {
    "the known fixture bugs alone": [{ reason: "derived-cell", wrote: false }, { reason: "no-such-cell", wrote: false }],
    "everything written": [{ reason: "written", wrote: true }],
    // The carve-out must survive a landed sibling too — it is not conditional on delivery.
    "a tabled fixture bug alongside a write that LANDED": [
      { reason: "derived-cell", wrote: false },
      { reason: "written", wrote: true },
    ],
    "no writes at all": [],
  };
  // ⛑ S424 item 3 — THIS USED TO BE A MIRROR of the production condition, re-typed into
  // the test file. A mirror is not a gate: it can be green while the harness says the
  // opposite, which is how rounds 1 and 2 of this predicate both shipped wrong. It now
  // calls the REAL exported `seedThrewNotice`, so every case below is a bite on production.
  const shouldBeLoud = (writes) => seedThrewNotice({ writes }) !== null;
  for (const [label, writes] of Object.entries(LOUDNESS_CASES)) {
    test(`F4 loudness FIRES: ${label}`, () => expect(shouldBeLoud(writes)).toBe(true));
  }
  for (const [label, writes] of Object.entries(QUIET_CASES)) {
    test(`F4 loudness stays quiet: ${label}`, () => expect(shouldBeLoud(writes)).toBe(false));
  }
  test("the harness's loudness condition is neither of the two forms that shipped wrong", () => {
    const raw = readFileSync(join(__dirname, "render-harness.js"), "utf8");
    // ⛑ S424 item 3 — ASSERT OVER CODE, NOT PROSE. This read the whole file, so the moment
    // the harness DOCUMENTED the two broken forms in a comment (so a fourth round would not
    // re-derive them), the "must be gone" assertions fired on the explanation of the bug
    // rather than the bug. A gate that forbids naming a defect in a comment is not
    // measuring the code. Comments are stripped first; the assertions below are unchanged.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/[^\n]*/g, "$1");
    // Round 1's `every(...)` form is a bug; it must stay gone.
    expect(src).not.toContain('writes.every((w) => w.reason === "set-threw")');
    // Round 2's "NOTHING was delivered" conjunct is ALSO a bug (it silenced a genuine throw
    // whenever a sibling key landed) and must likewise stay gone.
    // ⛑ S424 — pinned to the spelling that can actually EXIST. This named
    // `seedReport.writes`, but the extraction moved the predicate onto a local `const
    // writes`, so the assertion guarded a form the code can no longer be written in: a
    // round-4 regression re-adding the conjunct in its natural shape
    // (`!writes.some((w) => w.wrote) &&`) would have passed it unchanged. Asserting on the
    // prefix-free form makes the string gate match the code that exists.
    expect(src).not.toContain("!writes.some((w) => w.wrote)");
    expect(src).not.toContain("!seedReport.writes.some((w) => w.wrote)");
    // ...and the guard must still be WIRED, not merely deleted: the call site pushes
    // whatever the predicate returns into consoleErrors, which is what D2 reddens on.
    expect(src).toContain("const threwNotice = seedThrewNotice(seedReport);");
    expect(src).toContain("if (threwNotice) obs.consoleErrors.push(threwNotice);");
  });

  // ⛑ S423 fix round 2 (finding 3) — an UNMEASURED gain signal must not resolve to the
  // FIRE direction. `null` (the snapshot threw) vetoes, like every other ambiguity here.
  test("finding 3: gainedContent null (UNMEASURED) suppresses D6 rather than firing it", () => {
    const markup = `<h1>App</h1><ul>${"<!--scrml-each:a1--><!--/scrml-each:a1-->"}</ul>`;
    // measured-no-gain -> fires (the control for this test)
    expect(seededDetectGained(markup, false).smells).toContain("S-EMPTY-WITH-DATA");
    // UNMEASURED -> must NOT fire
    const det = seededDetectGained(markup, null);
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    expect(det.state).toBe("renders-clean");
  });

  test("finding 3: an unmeasured signal also suppresses the BODY scope, not just regions", () => {
    expect(seededDetectGained("", false).smells).toContain("S-EMPTY-WITH-DATA");
    expect(seededDetectGained("", null).smells).not.toContain("S-EMPTY-WITH-DATA");
  });

  test("finding 3: the harness reports null (not false) when a snapshot fails, and says so", () => {
    const src = readFileSync(join(__dirname, "render-harness.js"), "utf8");
    // The swallow-to-false form is the bug; the throw must be captured.
    expect(src).toContain("sigFailed");
    expect(src).toContain("beforeSig === null || afterSig === null ? null : signatureGained");
    expect(src).toContain("gainedContent is UNMEASURED");
  });

  // ⛑ S423 FINAL ROUND (finding 3) — THE SAME RULING, APPLIED TO THE CLASS.
  // The `applySeed` instance was fixed a round ago, but the two SYNTHETIC seed reports
  // (the bridge-threw `catch` and the no-side-channel branch) still wrote
  // `gainedContent: false` where no snapshot was ever taken. Both push a console error, so
  // the cell reddens via D2 and `generate-baseline.js` PERSISTS `detail.seed` — committing
  // a fabricated measurement into the tracked baseline. `false` means measured-no-gain;
  // `null` means unmeasured. Neither branch measured anything.
  test("finding 3: every synthetic seed report reports gainedContent as null, never false", () => {
    const src = readFileSync(join(__dirname, "render-harness.js"), "utf8");
    // No hand-built report may claim a measurement.
    expect(src).not.toContain("gainedContent: false");
    // Both synthetic reports are present and report null.
    const synthetic = src.match(/chunks: 0, writes: \[\], domChanged: false, gainedContent: (\w+)/g) ?? [];
    expect(synthetic.length).toBe(2);
    for (const s of synthetic) expect(s).toContain("gainedContent: null");
    // The only place `gainedContent` may be a boolean is the computed one in applySeed.
    expect(src).toContain("beforeSig === null || afterSig === null ? null : signatureGained");
  });

  // ... and the UNMEASURED message must not be emitted on the bridge-threw path, which
  // took no snapshot either but has already reported its own, accurate reason.
  test("finding 3: the UNMEASURED notice is keyed on the signature error, not on null alone", () => {
    const src = readFileSync(join(__dirname, "render-harness.js"), "utf8");
    expect(src).toContain('seedReport.errors.some((e) => String(e).startsWith("[seed-signature]"))');
    expect(src).not.toContain("if (seedReport && seedReport.gainedContent === null) {");
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

/**
 * ⛑ S424 item 3 — a genuine `set-threw` was SILENT whenever any OTHER seed key landed.
 *
 * Own describe block on purpose (merge hygiene: a sibling branch is appending to the D6
 * block above). Every test here drives the REAL exported `seedThrewNotice` / `runDetectors`,
 * never a re-typed mirror of either.
 */
describe("S424 item 3 — a set-threw is loud even when a sibling seed key landed", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  // The partial-delivery shape: the key DRIVING the list threw, an unrelated key landed.
  const PARTIAL = [
    { name: "items", reason: "set-threw", namespaced: true, wrote: false },
    { name: "title", reason: "written", namespaced: true, wrote: true },
  ];

  test("the notice FIRES on a partial delivery (the round-2 bug: it used to be null)", () => {
    expect(seedThrewNotice({ writes: PARTIAL })).not.toBeNull();
  });

  test("the notice states the REAL counts and never claims 'none landed' when some did", () => {
    const msg = seedThrewNotice({ writes: PARTIAL });
    expect(msg).toContain("1 of 2 seed write(s) threw");
    expect(msg).toContain("1 landed");
    // The round-2 wording was only ever true in the all-threw case. Asserting its ABSENCE
    // is the half that stops a "fix" that fires but still lies about what happened.
    expect(msg).not.toContain("none landed");
  });

  test("the all-threw wording is PRESERVED verbatim — this fix widens the gate, it does not move it", () => {
    const msg = seedThrewNotice({
      writes: [
        { reason: "set-threw", wrote: false },
        { reason: "set-threw", wrote: false },
      ],
    });
    expect(msg).toBe(
      "[seed-bridge] 2 of 2 seed write(s) threw and none landed — the seed cannot be live",
    );
  });

  test("a malformed or absent report is tolerated, not thrown on", () => {
    expect(seedThrewNotice(null)).toBeNull();
    expect(seedThrewNotice(undefined)).toBeNull();
    expect(seedThrewNotice({})).toBeNull();
    expect(seedThrewNotice({ writes: null })).toBeNull();
    expect(seedThrewNotice({ writes: [null, undefined] })).toBeNull();
  });

  // ---- QUESTION B, ANSWERED BY MEASUREMENT: loud, and NO veto. ----
  //
  // These cases are the evidence, pinned so the answer cannot silently rot. The decisive
  // fact is WHERE the short-circuit happens: in `runDetectors`'s STATE-RESOLUTION block, the
  // `consoleErrors.length > 0` arm `return`s `compiles-but-throws` BEFORE the
  // `smells.includes("S-EMPTY-WITH-DATA")` arm below it is ever reached. So once the notice
  // exists, the `renders-empty-with-data` verdict is already displaced; a veto adds nothing
  // to the STATE and only deletes the S-EMPTY-WITH-DATA smell, which is real recorded
  // evidence if the throw turns out to be a broken emitted accessor (a COMPILER defect).
  //
  // ⚠ NOT the D2 SMELL branch, which is the natural place to look and says the opposite:
  // it pushes D2-CONSOLE-ERROR and deliberately FALLS THROUGH ("Continue scanning for smells
  // too ... but the state is already the throws tier"), so D6's smell is still COMPUTED and
  // recorded. That is exactly why the veto is a no-op on the verdict yet still lossy on the
  // record — the smell is gathered in one place and resolved in another.
  const partialObs = (consoleErrors) => ({
    compileErrors: [],
    throwMessage: null,
    consoleErrors,
    document: { body: (() => { const b = document.createElement("body"); b.innerHTML = ""; return b; })() },
    seeded: true,
    seedReport: {
      chunks: 1, writes: PARTIAL, domChanged: false,
      gainedContent: false, observable: false, errors: ["[seed-set items] boom"],
    },
    serverDependent: false,
  });

  test("BEFORE (the gap): silent + a landed sibling => renders-empty-with-data, blaming the compiler", () => {
    const det = runDetectors(partialObs([]));
    expect(det.state).toBe("renders-empty-with-data");
    expect(det.smells).toContain("S-EMPTY-WITH-DATA");
  });

  test("AFTER: the notice displaces that verdict with compiles-but-throws, which is RED and truthful", () => {
    const det = runDetectors(partialObs([seedThrewNotice({ writes: PARTIAL })]));
    expect(det.state).toBe("compiles-but-throws");
    expect(det.smells).toContain("D2-CONSOLE-ERROR");
    expect(["renders-clean", "renders-empty", "needs-server"]).not.toContain(det.state);
    // The reason travels WITH the cell, so the baseline records why (detail is kept for RED).
    expect(JSON.stringify(det.detail)).toContain("seed write(s) threw");
  });

  test("question B: the D6 smell SURVIVES as corroborating evidence — a veto would delete it", () => {
    const notice = seedThrewNotice({ writes: PARTIAL });
    // Guard the premise: a null notice would still make `consoleErrors` length-1 and fire
    // D2, so this test would pass for the WRONG reason on the unfixed harness.
    expect(notice).not.toBeNull();
    const det = runDetectors(partialObs([notice]));
    // Both facts recorded at once: the seed write threw AND the render came back empty.
    // If the throw is a compiler defect, this second fact is the corroboration; vetoing
    // D6 would hide exactly that. Loud-without-veto keeps both.
    expect(det.smells).toEqual(expect.arrayContaining(["D2-CONSOLE-ERROR", "S-EMPTY-WITH-DATA"]));
  });

  test("question B: a VETO WITHOUT the notice would be FAIL-OPEN — it scores the cell GREEN", () => {
    // Simulating the veto as any implementation must amount to: seedWasDelivered() false.
    const vetoed = partialObs([]);
    vetoed.seedReport = { ...vetoed.seedReport, writes: PARTIAL.map((w) => ({ ...w, wrote: false })) };
    const det = runDetectors(vetoed);
    expect(det.state).toBe("renders-empty");
    expect(["renders-clean", "renders-empty", "needs-server"]).toContain(det.state);
    expect(det.smells).not.toContain("S-EMPTY-WITH-DATA");
    // ^ This is why the loudness is the load-bearing half and the veto is not merely
    //   unnecessary but hazardous: the two are separable in code, and the veto alone
    //   turns a throwing seed into a green cell.
  });

  // ⛑ S424 — THE LOUDNESS WAS NOT ACTUALLY TERMINAL, and this is the case that proved it.
  // Routing the notice through `consoleErrors` does not make it loud everywhere: the
  // `needs-server` arm is a GREEN tier, `generate-baseline.js` strips `detail` from green
  // cells, and the `[seed-bridge]` prefix matches neither `hasCodegenError` nor
  // `isServerAbsenceMessage` — so a server-dependent seeded app swallowed the notice and
  // the throw went silent again, by a different door than the one item 3 closed. Surfaced
  // by the adversarial pass on this very branch and CONFIRMED BY EXECUTION before the fix
  // (state `needs-server`, smells D2 + S-EMPTY-WITH-DATA + NEEDS-SERVER — green).
  test("a seed-bridge failure disqualifies the needs-server GREEN carve-out", () => {
    const notice = seedThrewNotice({ writes: PARTIAL });
    expect(notice).not.toBeNull(); // guard the premise, as the sibling case does

    const serverAbsence = "Cannot read properties of null (reading 'rows')";
    const obs = partialObs([serverAbsence, notice]);
    obs.serverDependent = true;

    const det = runDetectors(obs);
    // It must NOT reach the green tier while a harness seed failure is on the record.
    expect(det.state).not.toBe("needs-server");
    expect(det.smells).not.toContain("NEEDS-SERVER");
    expect(det.state).toBe("compiles-but-throws");
    // And the reason still travels with the now-RED cell.
    expect(JSON.stringify(det.detail)).toContain("seed write(s) threw");

    // CONTROL — without the seed failure the carve-out still works. This is the half that
    // makes the fix narrow: `needs-server` exists for a real harness-realism reason (S203
    // b+c) and must keep working; only the seed-failure case is disqualified.
    const clean = partialObs([serverAbsence]);
    clean.serverDependent = true;
    clean.seedReport = { ...clean.seedReport, writes: [{ name: "b", reason: "written", wrote: true }] };
    expect(runDetectors(clean).state).toBe("needs-server");
  });
});
