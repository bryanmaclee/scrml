/**
 * render-detectors.js — the D0–D7 universal render-invariant detector set.
 *
 * Per the e2e-known-failure-map deep dive (docs/deep-dives/
 * e2e-known-failure-map-2026-06-17.md §"L1 — crash + SMELL detectors"). Each
 * detector emits a render-state + a smell-code; NONE needs to know the correct
 * output (oracle-FREE). The three classes:
 *   - compile-fail / runtime-throw — oracle-free (a thrown ReferenceError is
 *     wrong under EVERY spec; a compile error is the compiler refusing).
 *   - smell-detected — oracle-free via universal invariants ("a correctly-
 *     rendered scrml DOM never contains `[object `, never a literal `${`, never
 *     an `undefined`/`null` text node, never an empty body where data was seeded").
 *
 * CRITICAL DISCIPLINE (DD §"DO NOT SUPPRESS ANY ERROR CLASS"): these detectors
 * CLASSIFY a failure; they NEVER hide one. There is no error-class allowlist
 * here — the SERVER_EXAMPLES suppression in examples/test-examples.js (which
 * filters out `_scrml_fetch_`/`SyntaxError`, the exact class acceptance bug 2
 * throws) is the anti-pattern this harness exists to reverse.
 *
 * The detector table (DD §L1):
 *   D0  compileScrml returns errors          -> fails-compile
 *   D1  mount throws                          -> compiles-but-throws
 *   D2  console.error / uncaught on mount     -> compiles-but-throws (soft)
 *   D3  DOM text contains `[object `          -> smell-wrong (S-OBJECT-IN-DOM)
 *   D4  rendered text/attr contains `${`      -> smell-wrong (S-RAW-INTERP)
 *   D5  a text node is "undefined" / "null"   -> smell-wrong (S-NULLISH-TEXT)
 *   D6  empty body where data WAS seeded      -> partial/empty (S-EMPTY-WITH-DATA)
 *   D7  the D1 message matches /is not defined/-> compiles-but-throws (S-UNBOUND-REF)
 *
 * Render-state (one per cell, the taxonomy's cell value):
 *   "fails-compile" | "compiles-but-throws" | "smell-detected-wrong"
 *   | "renders-empty" | "renders-clean"
 *
 * NOTE on severity ordering: a cell takes the WORST observed state. D0 wins
 * (no mount happened). Then D1/D2/D7 (threw). Then D3–D5 (smell). Then D6
 * (empty-with-data). Else renders-clean. Smell-codes accumulate regardless so
 * the map records every invariant that fired, not just the worst.
 */

/** Walk every text node under `root`, returning their string values. */
function collectTextNodes(root) {
  const out = [];
  if (!root) return out;
  // happy-dom supports createTreeWalker; fall back to a manual recursion.
  const TEXT_NODE = 3;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.nodeType === TEXT_NODE) {
      out.push(node.nodeValue ?? "");
    }
    const kids = node.childNodes;
    if (kids) {
      for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
  }
  return out;
}

/** Collect every attribute VALUE on every element under `root`. */
function collectAttrValues(root) {
  const out = [];
  if (!root || !root.querySelectorAll) return out;
  const els = root.querySelectorAll("*");
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const attrs = el.attributes;
    if (!attrs) continue;
    for (let j = 0; j < attrs.length; j++) {
      out.push(attrs[j].value ?? "");
    }
  }
  return out;
}

/**
 * Run the D0–D7 detectors against one mounted observation.
 *
 * @param {object} obs
 * @param {Array} obs.compileErrors  — result.errors from compileScrml (D0).
 * @param {string|null} obs.throwMessage — mount-throw message, or null (D1/D7).
 * @param {string[]} obs.consoleErrors — captured console.error messages (D2).
 * @param {Document|null} obs.document — the mounted happy-dom document, or null
 *                                       if mount threw / compile failed.
 * @param {boolean} obs.seeded — was a data fixture set before observing (D6)?
 * @returns {{ state: string, smells: string[], detail: object }}
 */
export function runDetectors(obs) {
  const smells = [];
  const detail = {};

  // ---- D0: fails-compile (no oracle, no mount) ----
  const compileErrors = obs.compileErrors ?? [];
  if (compileErrors.length > 0) {
    detail.compileErrorCodes = compileErrors
      .map((e) => e.code ?? "(no-code)")
      .slice(0, 8);
    detail.compileErrorMessages = compileErrors
      .map((e) => e.message ?? String(e))
      .slice(0, 4);
    return { state: "fails-compile", smells: ["D0-COMPILE-ERROR"], detail };
  }

  // ---- D1 + D7: mount threw (no oracle) ----
  if (obs.throwMessage != null) {
    smells.push("D1-MOUNT-THROW");
    detail.throwMessage = String(obs.throwMessage).slice(0, 400);
    // D7: an unbound-ref ReferenceError specifically (the board bug-2 shape).
    if (/is not defined/.test(obs.throwMessage)) {
      smells.push("S-UNBOUND-REF");
    }
    return { state: "compiles-but-throws", smells, detail };
  }

  const doc = obs.document ?? null;
  const body = doc && doc.body ? doc.body : null;

  // ---- D2: console.error / uncaught during mount+settle (soft throw) ----
  const consoleErrors = obs.consoleErrors ?? [];
  if (consoleErrors.length > 0) {
    smells.push("D2-CONSOLE-ERROR");
    detail.consoleErrors = consoleErrors.slice(0, 4).map((m) => String(m).slice(0, 300));
    // A console error during mount is a soft-throw: classify as throws.
    // Continue scanning for smells too (a console error + an [object in DOM is
    // worth recording both), but the state is already the throws tier.
  }

  // Gather DOM facts for the smell detectors.
  const bodyText = body ? (body.textContent ?? "") : "";
  const textNodes = collectTextNodes(body);
  const attrValues = collectAttrValues(body);

  // ---- D3: `[object ` in DOM text (markup-as-value -> textContent, bug 1) ----
  if (bodyText.includes("[object ")) {
    smells.push("S-OBJECT-IN-DOM");
    const idx = bodyText.indexOf("[object ");
    detail.objectInDom = bodyText.slice(idx, idx + 40);
  }

  // ---- D4: a literal `${` surviving into rendered text OR an attr value
  //          (raw interpolation shipped as text, bug 3) ----
  const rawInText = textNodes.some((t) => t.includes("${"));
  const rawInAttr = attrValues.some((v) => v.includes("${"));
  if (rawInText || rawInAttr) {
    smells.push("S-RAW-INTERP");
    detail.rawInterp = {
      inText: rawInText,
      inAttr: rawInAttr,
      sample: (textNodes.find((t) => t.includes("${")) ??
        attrValues.find((v) => v.includes("${")) ??
        "")
        .trim()
        .slice(0, 60),
    };
  }

  // ---- D5: a text node literally "undefined" / "null" ----
  // Match a trimmed text node that IS the word (not merely contains it — a
  // legitimate sentence may contain "null" as prose). The bug shape is a bare
  // interpolation that rendered the absence value as its String() form.
  const nullishNode = textNodes
    .map((t) => t.trim())
    .find((t) => t === "undefined" || t === "null");
  if (nullishNode) {
    smells.push("S-NULLISH-TEXT");
    detail.nullishText = nullishNode;
  }

  // ---- D6: empty body where data WAS seeded (S-EMPTY-WITH-DATA) ----
  // Only meaningful when the harness seeded a fixture. An empty render with NO
  // seed is a VALID partial render (the <empty> fallback) — NOT a failure.
  if (obs.seeded && bodyText.trim() === "") {
    smells.push("S-EMPTY-WITH-DATA");
    detail.emptyWithData = true;
    // Continue — but if no harder smell fired, this is the renders-empty state.
  }

  // ---- Resolve the cell state from the accumulated smells (worst-wins) ----
  if (consoleErrors.length > 0) {
    return { state: "compiles-but-throws", smells, detail };
  }
  if (
    smells.includes("S-OBJECT-IN-DOM") ||
    smells.includes("S-RAW-INTERP") ||
    smells.includes("S-NULLISH-TEXT")
  ) {
    return { state: "smell-detected-wrong", smells, detail };
  }
  if (smells.includes("S-EMPTY-WITH-DATA")) {
    return { state: "renders-empty", smells, detail };
  }
  // No smell, no throw, no compile error. If the body is empty WITHOUT a seed,
  // that's a valid empty/partial render (records as renders-empty, NOT a fail).
  if (bodyText.trim() === "") {
    return { state: "renders-empty", smells, detail };
  }
  return { state: "renders-clean", smells, detail };
}

/** The set of states the harness can record (for baseline schema validation). */
export const RENDER_STATES = [
  "fails-compile",
  "compiles-but-throws",
  "smell-detected-wrong",
  "renders-empty",
  "renders-clean",
];
