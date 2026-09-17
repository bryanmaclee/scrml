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
 * Elements that CAN carry content without any text. Being in this list is only
 * candidacy: `elementCarriesContent` decides whether a given element actually holds
 * anything. Structural wrappers (the `<main id="root">` mount shell,
 * div/section/ul/li/span/...) and bare `[value]` / `[checked]` attributes on
 * non-form elements are deliberately NOT candidates — an empty wrapper is still an
 * empty render, and `<div value="">` renders nothing.
 */
export const CONTENT_CANDIDATE_SELECTOR = [
  "input", "textarea", "select", "progress", "meter",
  "img", "picture", "video", "audio", "svg", "canvas", "iframe", "object", "embed",
].join(",");

function attr(el, name) {
  return el && typeof el.getAttribute === "function" ? el.getAttribute(name) : null;
}
function nonEmpty(v) {
  return v != null && String(v).trim() !== "";
}

/**
 * Is `el` (or an ancestor up to `stopAt`) hidden by markup? happy-dom does no
 * layout, so this reads what the DOM states: the `hidden` attribute,
 * `aria-hidden="true"`, and inline `display:none` / `visibility:hidden`.
 */
function isHiddenByMarkup(el, stopAt) {
  for (let n = el; n && n !== stopAt; n = n.parentElement) {
    if (typeof n.hasAttribute === "function" && n.hasAttribute("hidden")) return true;
    if (String(attr(n, "aria-hidden") ?? "").toLowerCase() === "true") return true;
    const style = String(attr(n, "style") ?? "");
    if (/(^|;)\s*display\s*:\s*none\b/i.test(style)) return true;
    if (/(^|;)\s*visibility\s*:\s*hidden\b/i.test(style)) return true;
  }
  return false;
}

/**
 * Does this candidate element HOLD content (not merely exist)?
 *   - text-like input / textarea: a non-empty value (live `.value`, else the attribute).
 *     A placeholder is not content. `<input type="hidden">` never counts.
 *   - checkbox / radio: checked. (An unchecked box carries no seeded datum the DOM
 *     can show; its label, if any, is text and counts on its own.)
 *   - select: at least one `<option>`.
 *   - progress / meter: a value attribute.
 *   - img: src or srcset. picture / video / audio: a src/srcset on itself or a
 *     `<source>`/`<img>` child.
 *   - svg: at least one child element (a non-empty drawing).
 *   - iframe / embed: src. object: data.
 *   - canvas: counts on presence — a canvas is painted by script and the DOM exposes
 *     no signal of whether it was; treating it as empty would score every seeded
 *     chart red.
 */
export function elementCarriesContent(el) {
  const tag = String(el.tagName ?? "").toLowerCase();
  switch (tag) {
    case "input": {
      const type = String(attr(el, "type") ?? "text").toLowerCase();
      if (type === "hidden") return false;
      if (type === "checkbox" || type === "radio") {
        return el.checked === true || (typeof el.hasAttribute === "function" && el.hasAttribute("checked"));
      }
      return nonEmpty(el.value) || nonEmpty(attr(el, "value"));
    }
    case "textarea":
      return nonEmpty(el.value) || nonEmpty(el.textContent);
    case "select":
      return typeof el.querySelector === "function" && el.querySelector("option") != null;
    case "progress":
    case "meter":
      return nonEmpty(attr(el, "value"));
    case "img":
      return nonEmpty(attr(el, "src")) || nonEmpty(attr(el, "srcset"));
    case "picture":
    case "video":
    case "audio":
      return (
        nonEmpty(attr(el, "src")) ||
        nonEmpty(attr(el, "srcset")) ||
        (typeof el.querySelector === "function" &&
          el.querySelector("source[src], source[srcset], img[src], img[srcset]") != null)
      );
    case "svg":
      return el.children != null && el.children.length > 0;
    case "iframe":
    case "embed":
      return nonEmpty(attr(el, "src"));
    case "object":
      return nonEmpty(attr(el, "data"));
    case "canvas":
      return true;
    default:
      return false;
  }
}

/**
 * Did the render produce ANYTHING content-bearing? True when `body` holds non-
 * whitespace text, OR a CONTENT_CANDIDATE_SELECTOR element that is not hidden by
 * markup and actually carries content (elementCarriesContent).
 *
 * ⛑ S419 — D6 used to key on `body.textContent.trim() === ""` alone
 * (g-e2e-render-map-d6-keys-on-textcontent-so-a-text-free-render-scores-red): a
 * seeded render of inputs holding the seeded values, a checkbox list, an image
 * gallery or an SVG chart has no TEXT and scored the RED `renders-empty-with-data`.
 * The filed fix (`querySelectorAll("*").length === 0`) would have gone the other way
 * and never fired on the real board-bug shape, whose empty render still contains
 * the mount shell.
 * ⛑ S419 review (M1) — the first version of this counted element PRESENCE, which
 * was over-broad in the opposite direction: `<select></select>` (the seeded options
 * loop rendered nothing — exactly D6's bug), a bare `<input>`, an aria-hidden empty
 * svg, an empty `<button>`/`<progress>`, a hidden img, `<div value="">` and a src-less
 * overlay iframe all scored green. An element now counts only when it HOLDS content.
 *
 * Known limit (pre-existing, not changed here): the text test reads
 * `body.textContent`, which includes `<script>`/`<style>`/`<noscript>` text and text
 * inside hidden elements.
 */
export function hasRenderedContent(body) {
  if (!body) return false;
  if ((body.textContent ?? "").trim() !== "") return true;
  if (typeof body.querySelectorAll !== "function") return false;
  const els = body.querySelectorAll(CONTENT_CANDIDATE_SELECTOR);
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (isHiddenByMarkup(el, body)) continue;
    if (elementCarriesContent(el)) return true;
  }
  return false;
}

/**
 * A no-server mount of a server-DEPENDENT app leaves a server-only binding/data
 * source null; the client then throws (or console-errors) a null/undefined-ACCESS.
 * That is server-ABSENCE (harness-realism, S203 b+c — NOT a compiler bug). A
 * ReferenceError ("is not defined") or TDZ ("before initialization") is a genuine
 * codegen bug and stays red even for a server app — so those are EXCLUDED here.
 * Used only when obs.serverDependent is true (see the needs-server state).
 */
export function isServerAbsenceMessage(msg) {
  const s = String(msg);
  if (/is not defined/.test(s)) return false; // ReferenceError -> codegen, stays red
  if (/before initialization/.test(s)) return false; // TDZ -> codegen, stays red
  return (
    /Cannot destructure property .* from null or undefined/.test(s) ||
    /\bis not iterable\b/.test(s) ||
    /(?:null|undefined) is not an object/.test(s) ||
    /Cannot read propert(?:y|ies) of (?:null|undefined)/.test(s)
  );
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
 * @param {boolean} obs.serverDependent — does the app have a server side (emits
 *   serverJs / uses a `?{}` SQL block)? Gates the needs-server classification.
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
    const msg = String(obs.throwMessage);
    detail.throwMessage = msg.slice(0, 400);
    // needs-server: a server-dependent app mounted with NO server throws a
    // null/undefined-ACCESS because a server-only binding/data source is null.
    // Harness-realism non-gap (S203 b+c — NOT a compiler bug). EXCLUDES
    // ReferenceError/TDZ (genuine codegen, stays red) via isServerAbsenceMessage.
    if (obs.serverDependent && isServerAbsenceMessage(msg)) {
      smells.push("NEEDS-SERVER");
      detail.needsServer =
        "server-dependent app mounted with no server — a server-only binding/data source resolved to null";
      return { state: "needs-server", smells, detail };
    }
    smells.push("D1-MOUNT-THROW");
    // D7: an unbound-ref ReferenceError specifically (the board bug-2 shape).
    if (/is not defined/.test(msg)) {
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
  // "Empty" means nothing content-bearing rendered, not merely no text (⛑ S419,
  // see hasRenderedContent).
  if (obs.seeded && !hasRenderedContent(body)) {
    smells.push("S-EMPTY-WITH-DATA");
    detail.emptyWithData = true;
    // Continue — but if no harder smell fired, this is the renders-empty state.
  }

  // ---- Resolve the cell state from the accumulated smells (worst-wins) ----
  if (consoleErrors.length > 0) {
    // needs-server: a server-dependent app whose ONLY mount error is a server-
    // absence null/undefined-access console error — no genuine codegen error
    // (ReferenceError/TDZ) and no hard render smell. Harness-realism non-gap
    // (S203 b+c). The guards ensure a real bug is never masked: a codegen error
    // or a smell keeps the cell red (compiles-but-throws).
    const hasCodegenError = consoleErrors.some((m) =>
      /is not defined|before initialization/.test(String(m)),
    );
    const hasHardSmell =
      smells.includes("S-OBJECT-IN-DOM") ||
      smells.includes("S-RAW-INTERP") ||
      smells.includes("S-NULLISH-TEXT");
    if (
      obs.serverDependent &&
      !hasCodegenError &&
      !hasHardSmell &&
      consoleErrors.some(isServerAbsenceMessage)
    ) {
      smells.push("NEEDS-SERVER");
      detail.needsServer =
        "server-dependent app mounted with no server — console error from a null server-only data source";
      return { state: "needs-server", smells, detail };
    }
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
    // ⛑ S416 — SEEDED-AND-EMPTY IS NOT THE SAME ANSWER AS EMPTY, AND IT USED TO
    // COLLAPSE INTO IT. Both branches returned `renders-empty`, which
    // `e2e-render-map.test.js` counts as GREEN — so D6, the detector written to
    // catch the board-bug class (data was seeded, the loop body reached nothing,
    // the page came back blank), FIRED and then had its answer scored as a pass.
    // The gate was not wrong, it just was not answering its own question: the
    // §8 hollow-gate shape. A distinct state keeps the unseeded case green — an
    // empty render with no data IS a valid `<empty>` fallback — while making the
    // seeded case a real red.
    return { state: "renders-empty-with-data", smells, detail };
  }
  // No smell, no throw, no compile error. If the body is empty WITHOUT a seed,
  // that's a valid empty/partial render (records as renders-empty, NOT a fail).
  //
  // ⛑ S419 review (L1) — "empty" here uses the SAME predicate as D6. This branch used
  // `bodyText.trim() === ""`, so a seeded render that passed D6 on content with no
  // text (`<input value="Alice">`) fell through to `renders-empty` — the state that
  // means "no data, valid fallback". It now resolves to `renders-clean`.
  // Deliberately applied to UNSEEDED cells too: an unseeded page showing a filled
  // input or an image is not an `<empty>` fallback either, and one definition of
  // "empty" cannot drift into two meanings the way text-vs-content just did. Both
  // states are green, so no gate outcome can change; any cell that moves is recorded.
  if (!hasRenderedContent(body)) {
    return { state: "renders-empty", smells, detail };
  }
  return { state: "renders-clean", smells, detail };
}

/**
 * The states `runDetectors` can return.
 *
 * ⚠ S416 — THIS WAS A DEAD EXPORT FOR ITS WHOLE LIFE. Its comment said "for
 * baseline schema validation" and `grep -rn RENDER_STATES compiler/ scripts/`
 * returned exactly one hit: this definition. Nothing imported it, and the §1
 * schema test asserted only `typeof cell.state === "string"` — so the baseline
 * could carry any string at all and did: a `HARNESS-TIMEOUT` cell
 * (`samples/gauntlet-r18/rails-dev.scrml#empty`, MOUNT-HANG, subprocess killed
 * at 20s) sat in it against no vocabulary. A named vocabulary that nothing
 * checks is not a gate; it is a comment. It is wired into §1 now.
 */
export const RENDER_STATES = [
  "fails-compile",
  "compiles-but-throws",
  "smell-detected-wrong",
  "needs-server",
  "renders-empty",
  "renders-empty-with-data",
  "renders-clean",
];

/**
 * States the HARNESS records when it could not obtain a render at all. These are
 * deliberate and must never be suppressed (DD §"DO NOT SUPPRESS ANY ERROR
 * CLASS") — they are emitted by `generate-baseline.js` / `observe-one.js`, not by
 * `runDetectors`, which is why they are a separate list rather than members of
 * `RENDER_STATES`.
 */
export const HARNESS_STATES = ["HARNESS-TIMEOUT", "HARNESS-ERROR"];

/** Every state a baseline cell may legally carry. */
export const ALL_BASELINE_STATES = [...RENDER_STATES, ...HARNESS_STATES];
