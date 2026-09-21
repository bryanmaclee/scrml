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
 *   D6  seeded data rendered NOWHERE           -> partial/empty (S-EMPTY-WITH-DATA)
 *       — empty body, OR every leaf <each> region empty (⛑ S423 limb 2)
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

/**
 * Walk every text node under `root`, returning their string values.
 *
 * `skipSubtree(el)`, when given, is asked about every ELEMENT below `root` (never
 * `root` itself); a true answer drops that element and everything under it. The
 * D4/D5 smell detectors call this with no predicate (every text node);
 * `hasRenderedContent` passes `isUnrenderedByOwnMarkup` (see there).
 */
function collectTextNodes(root, skipSubtree = null) {
  const out = [];
  if (!root) return out;
  // happy-dom supports createTreeWalker; fall back to a manual recursion.
  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.nodeType === TEXT_NODE) {
      out.push(node.nodeValue ?? "");
    }
    if (skipSubtree && node !== root && node.nodeType === ELEMENT_NODE && skipSubtree(node)) {
      continue;
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

/**
 * ⛑ S426 fix round (finding 3) — THE SELECTORS TWO READERS SHARE, HOISTED SO THE SHARING IS
 * STRUCTURAL RATHER THAN DOCUMENTARY.
 *
 * `elementCarriesContent` asks these of a PARENT ("does this element hold content?") and
 * `CONSUMED_CHILD_SELECTOR` asks the same strings of a region's CHILD nodes ("did the each
 * produce the rows this parent consumes?"). They were hand-copied, with a comment saying
 * they must stay in step and nothing enforcing it — which is this very bug's own shape
 * (a definition duplicated, then one copy updated). One constant, two readers.
 */
const OPTION_SELECTOR = "option";
const MEDIA_SOURCE_SELECTOR = "source[src], source[srcset], img[src], img[srcset]";

function attr(el, name) {
  return el && typeof el.getAttribute === "function" ? el.getAttribute(name) : null;
}
function nonEmpty(v) {
  return v != null && String(v).trim() !== "";
}

/**
 * Elements whose subtree is never rendered as page content, whatever their
 * attributes: `<script>` / `<style>` text is code, `<template>` is inert, and
 * `<noscript>` shows only with scripting OFF — the mounted app runs script, so it
 * is not shown. (happy-dom parses `<noscript>` children as real elements, so a
 * `<noscript><img src=…>` is reachable by `querySelectorAll` and must be excluded
 * explicitly; `<template>` children live in `.content` and are already invisible.)
 */
const UNRENDERED_CONTAINER_TAGS = new Set(["script", "style", "noscript", "template"]);

/**
 * Does THIS element (ignoring its ancestors) keep its subtree off the rendered page?
 * happy-dom does no layout, so this reads what the DOM states: an unrendered
 * container tag (UNRENDERED_CONTAINER_TAGS), the `hidden` attribute,
 * `aria-hidden="true"`, and inline `display:none` / `visibility:hidden`.
 *
 * ⛑ S419 (g-e2e-render-map-hidden-text-counts-as-content-while-hidden-elements-do-not)
 * — the ONE definition of "not rendered" for BOTH halves of `hasRenderedContent`.
 * The element half applies it to each candidate and its ancestors
 * (`isUnrenderedByMarkup`); the text half prunes every subtree it is true for while
 * walking text nodes (`collectTextNodes`), which is the same ancestor test done once
 * per subtree instead of once per node.
 */
function isUnrenderedByOwnMarkup(n) {
  if (UNRENDERED_CONTAINER_TAGS.has(String(n.tagName ?? "").toLowerCase())) return true;
  if (typeof n.hasAttribute === "function" && n.hasAttribute("hidden")) return true;
  if (String(attr(n, "aria-hidden") ?? "").toLowerCase() === "true") return true;
  const style = String(attr(n, "style") ?? "");
  if (/(^|;)\s*display\s*:\s*none\b/i.test(style)) return true;
  if (/(^|;)\s*visibility\s*:\s*hidden\b/i.test(style)) return true;
  return false;
}

/** Is `el`, or any ancestor below `stopAt`, unrendered by markup (isUnrenderedByOwnMarkup)? */
function isUnrenderedByMarkup(el, stopAt) {
  for (let n = el; n && n !== stopAt; n = n.parentElement) {
    if (isUnrenderedByOwnMarkup(n)) return true;
  }
  return false;
}

/**
 * The same ancestor question for an ARBITRARY node — a comment fence anchor, not just
 * an element. Walks `parentNode` (not `parentElement`) because the caller starts from a
 * comment node, and tests only the ELEMENT ancestors.
 *
 * ⛑ S423 fix round (F3) — `collectEachRegions` did not apply this, so an `<each>` inside
 * `<div hidden>` / `aria-hidden` / `display:none` / `<noscript>` was collected as a live
 * region and was PERMANENTLY empty, reddening any seeded page whose only list is hidden.
 * That broke the S419 one-definition-of-not-rendered invariant this file's own header
 * cites: both halves of `hasRenderedContent` prune unrendered subtrees, and the region
 * collector was a third reader of the DOM that did not.
 */
function isInUnrenderedSubtree(node, stopAt) {
  for (let n = node; n && n !== stopAt; n = n.parentNode) {
    if (n.nodeType === 1 && isUnrenderedByOwnMarkup(n)) return true;
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
      return typeof el.querySelector === "function" && el.querySelector(OPTION_SELECTOR) != null;
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
          el.querySelector(MEDIA_SOURCE_SELECTOR) != null)
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
 * ⛑ S426 (g-d6-region-content-ignores-the-parent-that-confers-content-…) — THE CHILD EACH
 * CONSUMING ANCESTOR EXISTS TO HOLD.
 *
 * ⚑ THE FIRST VERSION OF THIS TABLE STATED ITS INVARIANT AS "mirror the definition that
 * makes the parent content-bearing at BODY scope", AND THAT WAS WRONG, NOT MERELY
 * INCOMPLETE. It was read off a sample of five (`select`, `picture`, `video`, `audio`,
 * `svg`) in which two different questions happen to coincide. `<datalist>` separates them
 * and proves which one is the principle:
 *   - `elementCarriesContent(<datalist>)` is **false** — there is no arm for it, so there is
 *     nothing to "mirror from the descendant's side";
 *   - a body holding ONLY a `<datalist>` of options has `hasRenderedContent` **false**, and
 *     THAT IS CORRECT AND MUST STAY FALSE: a datalist is an autocomplete source, not page
 *     content. Giving it a `CONTENT_CANDIDATE_SELECTOR` entry or an `elementCarriesContent`
 *     arm would score a datalist-only page as a rendered page. (Pinned by test.)
 * Yet an `<each>` inside a `<datalist>` that produced its `<option>` rows plainly DID ITS
 * JOB, and reddening it is the same false positive as the other five.
 *
 * SO THE QUESTION THIS TABLE ANSWERS IS NOT "does this node make its ancestor content-
 * bearing at body scope?" BUT:
 *
 *     **is this node the kind of child its ancestor CONSUMES — i.e. did the each produce
 *     the rows that parent exists to hold?**
 *
 * For `select`/`picture`/`video`/`audio`/`svg` that coincides with `elementCarriesContent`,
 * which is why the weaker reading survived a five-element sample. For `datalist`, `map`,
 * `colgroup` and `<track>` there is deliberately NO body-scope counterpart, and there must
 * not be one: BODY scope asks "did the page show anything?" (a datalist shows nothing)
 * while REGION scope asks "did this each produce its rows?" (it did). Two different
 * questions, two different answers, no contradiction — and region scope is only ever
 * consulted when the body is already non-empty (`runDetectors`: `bodyEmpty ? null : …`).
 *
 * ⚑ A `Map`, NOT AN OBJECT LITERAL, AND THAT IS LOAD-BEARING. An object literal is read
 * through `Object.prototype`, so a region whose parent's tag name collides with a prototype
 * member returns a truthy non-selector and this detector THROWS instead of classifying —
 * which the file header says must never happen. MEASURED on the object-literal version:
 * `<constructor>` threw from `matches()` (`'function Object() { [native code] }' is not a
 * valid selector`) and `<__proto__>` threw from `querySelectorAll()` (`'[object Object]'`).
 * Exactly those two and no others, because the lookup lowercases the tag first, so only the
 * all-lowercase members of `Object.prototype` survive as keys. A Map has no prototype chain
 * to fall through and is immune to the whole class by construction, not by enumeration.
 *
 * `svg` is deliberately absent: its conferring test is "any element child", a node-kind and
 * not a selector, applied separately in `confersContentToConsumingAncestor`.
 */
const CONSUMED_CHILD_SELECTOR = new Map([
  // Mirrors an `elementCarriesContent` arm (shared constant, finding 3).
  ["select", OPTION_SELECTOR],
  ["picture", MEDIA_SOURCE_SELECTOR],
  // ⚑ `track[src]` has NO body-scope counterpart — `elementCarriesContent` counts only
  // `source`/`img` for a `<video>`, and must keep doing so (a subtitle track is not a
  // reason to call a src-less video "content"). But `<track>` is named in the content model
  // of `<video>`/`<audio>`, an each over a list of subtitle languages is ordinary scrml, and
  // such an each plainly produced its rows. Attribute-filtered like its `source` siblings
  // because a `<track>` with no `src` loads nothing.
  ["video", `${MEDIA_SOURCE_SELECTOR}, track[src]`],
  ["audio", `${MEDIA_SOURCE_SELECTOR}, track[src]`],
  // Region scope ONLY — see the datalist argument above. Each of these parents has a content
  // model that is WHOLLY these text-free children, and none of them renders page content of
  // its own. Unfiltered, exactly like `select`'s own `"option"`: the question is whether the
  // each produced rows, not whether each row is individually useful.
  ["datalist", OPTION_SELECTOR],
  ["map", "area"],
  ["colgroup", "col"],
]);

/** Is `el`, or a RENDERED descendant of it, a match for `selector`? */
function matchesSelfOrRenderedDescendant(el, selector) {
  if (typeof el.matches === "function" && el.matches(selector)) return true;
  if (typeof el.querySelectorAll !== "function") return false;
  const hits = el.querySelectorAll(selector);
  for (let i = 0; i < hits.length; i++) {
    if (!isUnrenderedByMarkup(hits[i], el)) return true;
  }
  return false;
}

/**
 * ⛑ S426 — DID THIS REGION NODE PRODUCE THE ROWS A CONSUMING ANCESTOR EXISTS TO HOLD?
 *
 * THE DEFECT: `regionScopedEmptiness` asks `nodesHaveRenderedContent(region.nodes)`, which
 * decides content from the region's OWN nodes — but `emitEachMountHtml` places the fence at
 * the each's SOURCE position, so for an `<each>` inside a `<select>` / `<datalist>` /
 * `<picture>` / `<video>` / `<audio>` / `<svg>` / `<map>` / `<colgroup>` the rows land INSIDE
 * that parent while the element that CONSUMES them sits OUTSIDE the region. Neither `option`
 * nor `source` is in `CONTENT_CANDIDATE_SELECTOR`, and `circle` / `area` / `col` / `track`
 * are not either — so the region measured EMPTY while the page rendered correctly and D6
 * scored `renders-empty-with-data`: a RED against the compiler on a CORRECT render.
 * Reproduced on `f8317399`, and `datalist` reproduced again on the first landed fix.
 *
 * ⚠ THE FIX IS **NOT** TO ADD `option` / `source` / `area` TO `CONTENT_CANDIDATE_SELECTOR`.
 * That list is consumed by `hasRenderedContent` at BODY scope too, so widening it would make
 * a bare `<option value="1"></option>` — or a `<datalist>`-only page — count as a rendered
 * page, re-opening the S419 one-definition-of-"not rendered" class from the other side. The
 * question is asked at REGION scope only, so body scope is untouched (pinned by test).
 *
 * ⚑ THE POPULATION WAS ENUMERATED ONCE, BY EXECUTION, RATHER THAN DISCOVERED ONE INSTANCE AT
 * A TIME (six were found that way: select, picture, video, audio, svg, datalist). The search:
 * every HTML parent whose content model is wholly ELEMENT children that carry no text of
 * their own AND are not in `CONTENT_CANDIDATE_SELECTOR` — because a text-bearing child is
 * already saved by the text half, and a candidate child by the candidate half. 22 shapes were
 * built and measured; the disposals are recorded so the next reader does not re-run them:
 *   COVERED  select>option · datalist>option · picture/video/audio>source,img · video/audio>
 *            track[src] · svg>any element · map>area · colgroup>col
 *   DISPOSED optgroup — covered TRANSITIVELY by this ancestor walk when inside a select or
 *              datalist (measured green); standalone it is invalid HTML no browser renders.
 *            table>col without a colgroup — MEASURED UNREACHABLE: the parser hoists the
 *              `<col>` OUT of the table (`<col><table><!--fence--><!--/fence-->…`), so the
 *              region really is empty and the red is correct.
 *            object>param — `<param>` is obsolete, removed from the HTML Living Standard.
 *            iframe/embed — element children are FALLBACK content, never rendered when the
 *              resource loads; they are not consumed rows.
 *            slot — shadow-DOM only, and scrml emits no shadow roots; fallback children are
 *              ordinary content the existing halves already handle.
 *            link/meta in body — not page content in any sense, and `regionScopedEmptiness`
 *              only ever walks the BODY, so `<head>` is out of reach regardless.
 *            template — MEASURED: no region is collected at all (children live in `.content`),
 *              and it is already in UNRENDERED_CONTAINER_TAGS.
 *            fieldset · form · ruby · dl · figure · details · math>mi/mn — MEASURED ALREADY
 *              GREEN: their children carry text or are content candidates.
 *   ⚠ THE ONE CONTESTABLE CALL: `math` with a TEXT-FREE child (`<mspace>`) measures as a
 *     false red and is deliberately NOT covered. MathML that carries meaning carries text
 *     (`<mn>2</mn>`, already green); an each producing only spacers renders nothing a reader
 *     could see, so the red is defensible. Revisit if a corpus app ever emits one.
 *
 * ⚠ AND IT NEVER ASKS `elementCarriesContent(ancestor)`, WHICH IS THE FAIL-OPEN FORM. The
 * placeholder `<option value="">Choose…</option>` that real corpus selects carry sits
 * OUTSIDE the region and already makes the `<select>` content-bearing BEFORE any seed — so
 * "is the ancestor content-bearing?" would score a GENUINELY EMPTY fence inside such a
 * `<select>` as green. The question is only ever whether the REGION'S OWN NODES confer.
 *
 * ⚑ THE WALK IS OVER ANCESTORS, NOT THE PARENT, and that is measured rather than assumed.
 * The dispatching hypothesis said `node.parentNode`; `select` and `picture`/`video`/`audio`
 * consume via `querySelector`, which is a DESCENDANT query, so the consuming element can be
 * any ancestor. Each of these scored RED on a correct render with a parent-only rule, i.e.
 * the parent-only fix re-creates its own class one wrapper away:
 *   `<select><optgroup>…each…</optgroup></select>`
 *   `<svg><g>…each…</g></svg>`
 *   `<video><div>…each…</div></video>`
 *
 * ⚑ `foreignObject` TERMINATES THE WALK. Inside one, HTML content rules apply and the
 * "any element is drawing content" reading of `svg` must not leak in — otherwise an empty
 * `<li>` under a foreignObject would count as content. It is a TAG test, not a namespace
 * test, deliberately: happy-dom reports `namespaceURI === "http://www.w3.org/2000/svg"` for
 * an `<li>` inside a foreignObject, so a namespace bound would silently not bind (measured).
 *
 * ⚑ The `svg` arm generalizes `el.children.length > 0` from direct children to any element
 * inside the svg. A strict mirror (direct children only) would leave `<svg><g>…each…</g>`
 * red on a correct render, which is this same defect one level down; the definition's intent
 * is "a non-empty drawing", and a `<circle>` inside a `<g>` is drawing.
 */
function confersContentToConsumingAncestor(node) {
  if (!node || node.nodeType !== ELEMENT_NODE) return false;
  for (let a = node.parentElement; a; a = a.parentElement) {
    const tag = String(a.tagName ?? "").toLowerCase();
    if (tag === "foreignobject") return false;
    // `.get` on a Map — never `table[tag]`, which reads through Object.prototype and hands
    // a non-selector to `matches()`/`querySelectorAll()`. See CONSUMED_CHILD_SELECTOR.
    const selector = CONSUMED_CHILD_SELECTOR.get(tag);
    if (selector && matchesSelfOrRenderedDescendant(node, selector)) return true;
    // `svg`: any element child is a non-empty drawing (elementCarriesContent `case "svg"`).
    // The node is already known to be an element and already known to be rendered.
    if (tag === "svg") return true;
  }
  return false;
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
 * ⛑ S419 residuals (g-e2e-render-map-hidden-text-counts-as-content-while-hidden-elements-do-not)
 * — the TEXT half read `body.textContent`, so it counted text the element half would
 * have excluded: a seeded `<p style="display:none">secret</p>` scored `renders-clean`
 * while `<img hidden src="a.png">` scored `renders-empty-with-data`, and a body whose
 * only text was `<script>` / `<style>` / `<noscript>` content scored clean. Both halves
 * now use one "not rendered" predicate (isUnrenderedByOwnMarkup): text counts only
 * from text nodes outside every unrendered subtree, and a candidate element counts
 * only when neither it nor an ancestor is unrendered.
 */
export function hasRenderedContent(body) {
  if (!body) return false;
  if (collectTextNodes(body, isUnrenderedByOwnMarkup).some((t) => t.trim() !== "")) return true;
  if (typeof body.querySelectorAll !== "function") return false;
  const els = body.querySelectorAll(CONTENT_CANDIDATE_SELECTOR);
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (isUnrenderedByMarkup(el, body)) continue;
    if (elementCarriesContent(el)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// REGION-SCOPED EMPTINESS (⛑ S423 limb 2) — the half of D6 that can actually see
// the board bug.
//
// g-e2e-render-map-populated-seed-is-inert-so-d6-has-no-live-subject, limb 2.
// Limb 1 (#978) made the populated seed reach the app's chunk-scoped cell, so the
// seed is live on two corpus apps. D6 STAYED DARK ANYWAY, because it asks its
// emptiness question of the whole `<body>` and PAGE CHROME ANSWERS IT. Measured on
// `3b66030a`, `examples/25-triage-board.scrml#populated`: the seed writes `<tasks>`
// (`reason:"written"`, `wrote:true`), all three `<ul class="task-list">` render
// ZERO rows, and the cell scores `renders-clean` with no smells — off 52 characters
// of column headings. That is the exact class the whole tier exists for, scored green.
//
// AN `<each>` LANDS IN THE DOM IN ONE OF TWO SHAPES, AND A PREDICATE THAT KNOWS
// ONLY ONE IS HALF A FIX. Read from the emitter + runtime, not inferred:
//
//   1. TOP-LEVEL each -> a parse-safe two-comment FENCE
//      `<!--scrml-each:N-->` … rows as SIBLINGS … `<!--/scrml-each:N-->`.
//      (runtime-template.js, "Approach A-unified" / g-each-mount-div-foster-parented-in-table:
//      a `<div>` wrapper was foster-parented out of `<table>` and dropped outright
//      inside `<select>`; a comment is inserted in every insertion mode.)
//   2. NESTED each -> a runtime `<div data-scrml-each-mount="each_N">`.
//      (emit-each.ts, both the Tier-1 nested branch and the Tier-0 `${for…lift}`
//      branch: "The item-local mount is created + appended ONCE (stable DOM node
//      identity across inner re-renders); the inner reconcile writes into it in place.")
//
// ⚠ THE DISPATCHING HYPOTHESIS SAID THE RUNTIME "CONSUMES THE SLOT" WHEN ITEMS
// RENDER, AND THAT IS WRONG — the mount div is the nested each's CONTAINER and is
// present either way. `examples/03-contact-book.scrml#populated` shows zero mount
// divs because its each is TOP-LEVEL (fence), not because a slot was consumed.
// The corrected reading makes the signal STRONGER, not weaker: since the container
// always exists and is written into in place, an EMPTY `[data-scrml-each-mount]` is
// an exact structural witness that THAT each rendered zero rows.
//
// THE DECISION RULE IS A CONJUNCTION OVER **LEAF** REGIONS — every identifiable
// each-region that contains no other each-region rendered nothing. Two rules were
// measured against it and both are wrong, in opposite directions:
//
//   * "every identifiable region is empty" leaves D6 DARK on its only live subject:
//     25-triage's OUTER each renders 446 chars of column chrome, so the conjunction
//     over ALL regions is false while the three inner regions are empty.
//   * "ANY surviving empty mount slot" FALSE-FIRES. Measured by mounting 25-triage
//     with the CORRECTED seed (`column:"Inbox"`/`"Doing"` instead of the old
//     non-matching `"todo"`): two columns render their task, the third is
//     LEGITIMATELY empty, and that rule scores a correct board
//     `renders-empty-with-data`. ⛑ S427 — that corrected seed is now the committed
//     fixture, so `25-triage-board#populated` renders this exact DOM on every run
//     and must stay `renders-clean`.
//
// The leaf conjunction is the only candidate correct on both. It keeps the
// load-bearing insight — a non-empty OUTER range must not veto empty inner mounts —
// but gets there structurally: the outer range is excluded because it is a
// CONTAINER of other regions, not because of its emission shape. A top-level each
// with nothing nested inside it is a leaf and still counts (03-contact-book, 06-kanban).
//
// FAIL-QUIET ON AMBIGUITY, deliberately (pa-base §8 — a detector that cries wolf
// gets ignored and then deleted): no identifiable region, or no leaf, means keep
// today's body-global answer rather than firing blind. An outer each that renders
// chrome answers "did the page show anything", not "did the DATA appear"; the leaf
// regions are where item data lands. So a two-list app with one legitimately-empty
// list stays green, at the cost of missing a one-of-two-lists-broken render.
// ---------------------------------------------------------------------------

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const COMMENT_NODE = 8;
const EACH_FENCE_PREFIX = "scrml-each:";

/** Every comment node under `root`, in document order. */
function collectCommentNodes(root) {
  const out = [];
  if (!root) return out;
  const visit = (node) => {
    const kids = node.childNodes;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.nodeType === COMMENT_NODE) out.push(k);
      visit(k);
    }
  };
  visit(root);
  return out;
}

/**
 * Did this SET of sibling nodes render anything content-bearing?
 *
 * The same question `hasRenderedContent` asks of a `<body>`, asked of an arbitrary
 * node list — because a fence region is a RANGE of siblings with no element that
 * wraps it, so there is no root to hand `hasRenderedContent`. Deliberately NOT
 * implemented by cloning the range into a detached wrapper: `cloneNode` does not
 * copy the live `.value` PROPERTY of an input, which is exactly the S419
 * "value set by binding (property only)" case, so a clone would score a filled
 * input as empty. One "not rendered" predicate across both halves, as S419 established.
 *
 * ⛑ S426 — THERE IS A THIRD HALF, AND IT IS NOT ABOUT THE REGION'S OWN SUBTREE. A region
 * node can be content by CONFERRING it on an ancestor that lies outside the region — an
 * `<option>` inside a `<select>`, a `<source>` inside a `<picture>`/`<video>`/`<audio>`, a
 * shape inside an `<svg>`, an `<option>` inside a `<datalist>`. See
 * `confersContentToConsumingAncestor`.
 */
function nodesHaveRenderedContent(nodes) {
  if (!Array.isArray(nodes)) return false;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    if (n.nodeType === TEXT_NODE) {
      if ((n.nodeValue ?? "").trim() !== "") return true;
      continue;
    }
    if (n.nodeType !== ELEMENT_NODE) continue; // comments/PIs carry nothing
    if (isUnrenderedByOwnMarkup(n)) continue; // the whole subtree is off-page
    if (collectTextNodes(n, isUnrenderedByOwnMarkup).some((t) => t.trim() !== "")) return true;
    // The node ITSELF may be a content candidate (`<img src>` as a direct row).
    if (
      typeof n.matches === "function" &&
      n.matches(CONTENT_CANDIDATE_SELECTOR) &&
      elementCarriesContent(n)
    ) {
      return true;
    }
    // ⛑ S426 — the node may instead be a row that an ancestor OUTSIDE the region consumes
    // (an `<option>` inside `<select>`/`<datalist>`, a `<source>`/`<track>` inside
    // `<video>`, a shape inside `<svg>`, an `<area>` inside `<map>`). Asked BEFORE the
    // descendant-candidate loop so it is reached even for a node with no `querySelectorAll`.
    if (confersContentToConsumingAncestor(n)) return true;
    if (typeof n.querySelectorAll !== "function") continue;
    const els = n.querySelectorAll(CONTENT_CANDIDATE_SELECTOR);
    for (let j = 0; j < els.length; j++) {
      const el = els[j];
      if (isUnrenderedByMarkup(el, n)) continue;
      if (elementCarriesContent(el)) return true;
    }
  }
  return false;
}

/**
 * Every identifiable `<each>` render region under `body`, in BOTH emission shapes.
 *
 *   { shape: "mount", host, nodes }          — a nested each's container div.
 *   { shape: "range", start, end, nodes }    — a top-level each's comment fence.
 *
 * `nodes` is the region's rendered content: the div's children, or the siblings
 * strictly between the paired fence anchors. An UNTERMINATED fence is skipped
 * rather than guessed at (fail-quiet) — its extent is not identifiable, and the
 * runtime's own `_scrml_each_end` gives up the same way.
 *
 * ⚠ The region IDs are deliberately NOT returned. They embed the chunk token
 * (`each_00hqpedw_120`), which is derived from the compile's `mkdtemp` staging dir
 * and therefore differs on EVERY run and machine. `generate-baseline.js` persists
 * `detail` for every non-green cell into the tracked baseline JSON, and reddening a
 * seeded cell is this detector's entire purpose — so an id reaching `detail` would
 * churn a committed artifact on every regeneration. Counts and shapes only (S420).
 */
export function collectEachRegions(body) {
  const regions = [];
  if (!body || typeof body.querySelectorAll !== "function") return regions;

  const mounts = body.querySelectorAll("[data-scrml-each-mount]");
  for (let i = 0; i < mounts.length; i++) {
    const host = mounts[i];
    // ⛑ S423 fix round (F3) — a region nobody can see is not evidence of anything.
    if (isInUnrenderedSubtree(host, body)) continue;
    regions.push({ shape: "mount", host, nodes: Array.from(host.childNodes ?? []) });
  }

  const comments = collectCommentNodes(body);
  for (let i = 0; i < comments.length; i++) {
    const start = comments[i];
    const data = String(start.nodeValue ?? "").trim();
    if (!data.startsWith(EACH_FENCE_PREFIX)) continue;
    if (isInUnrenderedSubtree(start, body)) continue; // ⛑ S423 fix round (F3)
    const want = `/${data}`;
    const nodes = [];
    let end = null;
    for (let n = start.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === COMMENT_NODE && String(n.nodeValue ?? "").trim() === want) {
        end = n;
        break;
      }
      nodes.push(n);
    }
    if (!end) {
      // ⛑ S423 final round (finding 2) — AN UNTERMINATED FENCE USED TO BE DROPPED WITH A
      // BARE `continue`, AND THAT PROMOTED ITS CHILDREN. The regions inside its span were
      // still collected, and with the enclosing region gone an inner mount became a FALSE
      // LEAF: `<!--scrml-each:o--><section>Task A<div data-scrml-each-mount=…></div></section>`
      // with no end anchor scored `leaves:1 emptyLeaves:1` and RED, while the outer each had
      // rendered "Task A". That is fix-round-2 finding 1 reached by another route — a dropped
      // outer region promoting an inner one — so the same ruling applies: A REGION THAT IS
      // DROPPED OR UNIDENTIFIABLE MUST NOT PROMOTE ITS CHILDREN TO LEAVES.
      //
      // It is kept as an UNRESOLVED region rather than discarded: it never counts as a leaf
      // and never appears in the resolved counts, but it still participates in enclosure, so
      // everything possibly inside it is marked unknown and the whole question resolves QUIET.
      // `nodes` is already every following sibling (the loop ran to the end without finding
      // the anchor), which is exactly the widest span the runtime's own `_scrml_each_end`
      // could have matched — it searches `nextSibling` within the same parent and gives up
      // the same way. So the suspect set is bounded the way the runtime bounds it, not guessed.
      regions.push({ shape: "range", start, end: null, nodes, unresolved: true });
      continue;
    }
    regions.push({ shape: "range", start, end, nodes });
  }
  return regions;
}

/**
 * The LEAF regions of `regions` — those enclosed by no other region.
 *
 * ⛑ S423 fix round (F5) — this was a pairwise `regionEncloses` with a LINEAR array scan
 * inside an ancestor walk, i.e. O(regions² × siblings × depth). It is now one ancestor
 * walk per region against a node→owner Map built in a single pass: O(total nodes + Σ
 * depth), with O(1) membership. A range region is a SIBLING RANGE with no wrapping
 * element, so `node.contains()` cannot express it directly — the owner map can, and it
 * handles both shapes uniformly.
 */
function leafRegions(regions) {
  // node -> EVERY region that directly holds it as one of its own nodes.
  //
  // ⛑ S423 fix round 2 (finding 1) — THIS WAS A `Map<node, region>` WITH FIRST-WINS, AND
  // THAT IS A LOSSY ENCODING OF A GENUINELY MANY-TO-MANY RELATION. One node can belong to
  // two regions at once: a fence's rows are the siblings between its anchors, and if that
  // fence sits directly inside a mount host, those same nodes are ALSO that mount's direct
  // children. First-wins gave the node to whichever region was pushed first — and
  // `collectEachRegions` pushes every mount before every range — so the inner range never
  // owned anything, survived the filter as a FALSE LEAF, and its own row chrome then
  // vetoed the empty mount beneath it. That is the exact "outer chrome vetoes empty inner
  // mounts" failure this whole rewrite exists to prevent, re-opened one level deeper, and
  // it is FAIL-QUIET: D6 goes dark and `detail.emptyRegions` commits wrong counts.
  //
  // The fix is the faithful encoding, not another case: a Set per node, and every owner
  // marked. With it the computation below is literally the definition of "A encloses B"
  // (B's anchor is at-or-inside one of A's nodes), with no ordering assumption left to be
  // wrong about. Still linear.
  const owners = new Map();
  for (const r of regions) {
    for (const n of r.nodes) {
      let set = owners.get(n);
      if (!set) owners.set(n, (set = new Set()));
      set.add(r);
    }
  }
  // Walk each region's anchor upward ONCE; every region holding an ancestor ENCLOSES this
  // one. A leaf encloses nothing (the innermost lists) — NOT "nothing encloses it", which
  // is the outermost and the exact inversion this rewrite shipped for one round before the
  // 25-triage control caught it.
  //
  // ⛑ S423 final round (finding 2) — plus the UNKNOWN tier. A region enclosed by an
  // UNRESOLVED region (a fence whose extent could not be determined) has unknown leaf
  // status, because whether it really sits inside that span is unknowable. Unknown resolves
  // QUIET, like every other ambiguity in this detector, so such a region is excluded from
  // the leaf set rather than counted as one.
  const encloses = new Set();
  const suspect = new Set();
  for (const r of regions) {
    const marker = r.shape === "mount" ? r.host : r.start;
    for (let n = marker; n; n = n.parentNode) {
      const set = owners.get(n);
      if (!set) continue;
      for (const o of set) {
        if (o === r) continue;
        encloses.add(o);
        if (o.unresolved) suspect.add(r);
      }
    }
  }
  return regions.filter((r) => !r.unresolved && !encloses.has(r) && !suspect.has(r));
}

/**
 * Did EVERY leaf each-region render nothing? Returns null when the question is not
 * identifiable (no region, or no leaf) — the caller then keeps the body-global answer.
 *
 * @returns {{ allLeavesEmpty: boolean, summary: object } | null}
 */
export function regionScopedEmptiness(body) {
  const regions = collectEachRegions(body);
  if (regions.length === 0) return null;
  const leaves = leafRegions(regions);
  if (leaves.length === 0) return null;
  const emptyLeaves = leaves.filter((r) => !nodesHaveRenderedContent(r.nodes));
  // ⛑ S423 final round — the counts describe RESOLVED regions; an unresolved span is not a
  // region anyone can reason about. Reported separately, and only when non-zero, so the
  // committed `detail.emptyRegions` shape is unchanged for every cell that has none.
  const resolved = regions.filter((r) => !r.unresolved);
  const unresolved = regions.length - resolved.length;
  return {
    allLeavesEmpty: emptyLeaves.length === leaves.length,
    // Counts + shapes ONLY — never an id (see collectEachRegions).
    summary: {
      regions: resolved.length,
      mounts: resolved.filter((r) => r.shape === "mount").length,
      ranges: resolved.filter((r) => r.shape === "range").length,
      leaves: leaves.length,
      emptyLeaves: emptyLeaves.length,
      ...(unresolved > 0 ? { unresolved } : {}),
    },
  };
}

/**
 * A comparable fingerprint of everything `body` currently RENDERS: a count per distinct
 * non-whitespace rendered text value, plus the number of content-bearing candidate
 * elements. Same "rendered" definition as `hasRenderedContent` — the S419 invariant — so
 * hidden text, `<script>`/`<style>`/`<noscript>` content and hidden images are excluded.
 *
 * ⛑ S423 fix round — this exists so the harness can ask "did the render GAIN anything
 * across the seed write?". Counts, not a Set: a list going from one "Alpha" row to two
 * is a gain, and a Set would miss it.
 *
 * ⚠ It holds raw page TEXT and must never reach `detail` — only the derived BOOLEAN does.
 */
export function renderedContentSignature(body) {
  const counts = new Map();
  for (const t of collectTextNodes(body, isUnrenderedByOwnMarkup)) {
    const v = t.trim();
    if (v === "") continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let elements = 0;
  if (body && typeof body.querySelectorAll === "function") {
    const els = body.querySelectorAll(CONTENT_CANDIDATE_SELECTOR);
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (isUnrenderedByMarkup(el, body)) continue;
      if (elementCarriesContent(el)) elements++;
    }
  }
  return { counts, elements };
}

/** Did `after` render anything `before` did not? (Strictly a GAIN — a pure loss is false.) */
export function signatureGained(before, after) {
  if (!before || !after) return false;
  if (after.elements > before.elements) return true;
  for (const [v, n] of after.counts) {
    if (n > (before.counts.get(v) ?? 0)) return true;
  }
  return false;
}

/**
 * Was a seed actually DELIVERED to a cell of the app?
 *
 * `obs.seeded` is only `seed != null` — a fixture was REGISTERED. A registered fixture
 * can write nothing (it names a DERIVED cell, or a cell the app does not have — the
 * `derived-cell` / `no-such-cell` reason codes limb 1 added) and still carry
 * `seeded:true`; scoring such a cell red for an empty render would blame the compiler
 * for a broken fixture. Until S427 two of the four corpus fixtures were exactly that
 * (06-kanban named a derived cell, 16-remote-data a non-existent one) and escaped only
 * because those apps happened to render a non-empty body. All four now write (S427);
 * the gate stays because the next fixture added can repeat the mistake.
 *
 * BACK-COMPATIBLE BY CONSTRUCTION: an observation that carries NO seed report (every
 * direct `runDetectors` call, including all of `detector-validation.test.js`) is
 * gated on `obs.seeded` exactly as before, so no existing assertion changes meaning.
 */
function seedWasDelivered(obs) {
  if (!obs.seeded) return false;
  const report = obs.seedReport;
  if (report == null) return true; // no report available — pre-S423 behaviour
  const writes = Array.isArray(report.writes) ? report.writes : [];
  return writes.some((w) => w && w.wrote === true);
}

/**
 * Did the seeded data SHOW UP somewhere — anywhere — when the seed was written?
 *
 * ⛑ S423 fix round, and this is the conjunct that closes F1 and F2. The region predicate
 * asks "are the leaf lists empty", which is NOT the same question as D6's, "was data
 * delivered and did the render fail to show it". Two shapes are indistinguishable by DOM
 * structure alone and want opposite answers:
 *   F1 — an outer each renders the seeded ROWS, and each row holds a nested list (tags,
 *        sub-tasks) that is legitimately empty. Structurally identical to 25-triage,
 *        where the outer each renders only column CHROME.
 *   F2 — the seeded datum renders by interpolation OUTSIDE any each, next to one
 *        unrelated empty each.
 * No amount of looking at the final DOM separates "the outer region rendered chrome" from
 * "the outer region rendered the data". What separates them is the TRANSITION: the
 * harness writes the seed into a live page, so it can compare what rendered before and
 * after and ask whether anything NEW appeared.
 *
 * ⚠ THE MEASURE IS "GAINED", NOT "CHANGED", AND THAT DISTINCTION IS LOAD-BEARING — the
 * obvious `domChanged` reading is WRONG IN BOTH DIRECTIONS, measured on the real corpus:
 *   - `examples/25-triage-board#populated`, as it was until S427 — `domChanged` was TRUE.
 *     The app's own initial `<tasks>` renders four tasks; the (then-wrong) seed replaced
 *     them with rows whose `column` matched no column, so the render MOVED by SHRINKING to
 *     nothing. Gating on "did not change" would have made D6 dark on that cell. (S427
 *     corrected the fixture; the shrink shape stays pinned synthetically and by
 *     `fixtures/d6-nested-each-empty-with-data.scrml`.)
 *   - the D6 fixture with its bug seed — `domChanged` is FALSE (its `<tasks>` starts empty,
 *     so an all-empty render stays all-empty), yet it is exactly the bug.
 * A pure LOSS is not a gain, so both land correctly: the pre-S427 25-triage seed gained nothing and fired;
 * `03-contact-book` gains "Ada Lovelace" and goes quiet; the fixture's matching seed gains
 * "Alpha"/"Beta" and goes quiet.
 *
 * Absent (a direct `runDetectors` call with no report) is NOT treated as "moved" — the
 * question was never asked, so it must not veto. Only an explicit `true` blocks.
 */
function seedMovedTheRender(obs) {
  const report = obs.seedReport;
  if (!report) return false; // the question was never asked — do not veto (back-compat)
  // ⛑ S423 fix round 2 (finding 3) — TRI-STATE, because "the snapshot threw" is not the
  // same answer as "nothing was gained", and resolving it to the FIRE direction would have
  // scored a cell `renders-empty-with-data` on a measurement that never happened — and
  // committed `gainedContent:false` to the baseline as though it had. `null` means
  // UNMEASURED and vetoes, matching what every other ambiguity in this detector does (no
  // region, no leaf, unterminated fence, hidden region all stay quiet). The harness also
  // raises it as a bridge error, so it is LOUD rather than silently quiet.
  // ⛑ S424 — FIRE ONLY ON THE MEASURED VALUE; EVERYTHING ELSE VETOES.
  //
  // The first S424 attempt widened `=== null` to `== null` so an ABSENT field would veto too.
  // That closed `undefined` and LEFT THE CLASS: with `return gainedContent === true` as the
  // tail, every other non-nullish value still took the FIRE direction — `0`, `""`, `NaN`, and
  // (most plainly wrong) the STRING `"false"` all scored a cell `renders-empty-with-data` on a
  // measurement that never happened, which is round 2's own ruling defeated a few values
  // further out. Caught by the adversarial pass on that attempt and confirmed by execution.
  //
  // So the predicate is inverted to state the invariant directly: a MEASURED `false` — and
  // nothing else — means the render did not move. `true`, `null`, absent, and any malformed
  // value all mean "do not fire". This is class-complete: no future construction site can
  // invent a value that fabricates a verdict, because only one value produces one.
  //
  // ⚑ DELIBERATE ASYMMETRY WITH `seedWasDelivered`, which reads similarly and means the
  // opposite. There its nullish case returns `true` = DELIVERED = fire-ENABLING (back-compat:
  // a missing report must not suppress the pre-S423 check). Here `true` = the render moved =
  // fire-SUPPRESSING. And `!report` above is a third direction again (`false`, i.e. do not
  // veto). Three nearby nullish branches, three different intents; they are not a pattern to
  // copy from one another.
  //
  // ⚑ Known and accepted: the `null` path is LOUD (the harness pushes a `[seed-bridge] …
  // UNMEASURED` notice and records a `[seed-signature]` error, so the cell still reddens —
  // since S427 round 4b as `seed-bridge-failed` via the terminal guard, not via D2) while the absent/malformed paths are
  // silently quiet. Fail-quiet is the better failure here, but it is not free — closing it
  // needs a shape check where the report is BUILT, since this detector is pure and cannot
  // raise anything itself.
  return report.gainedContent === false ? false : true;
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
 * Did the HARNESS fail to deliver the seed it was asked to deliver?
 *
 * ⛑ S426 — THE ONE NAMED PREDICATE FOR "A SEED-BRIDGE FAILURE IS ON THE RECORD", consulted
 * at every green-state return (see `runDetectors`'s terminal guard). It replaces the inlined
 * `hasSeedBridgeFailure` that #1002 put at ONE of those returns, because a condition that
 * lives at one door is a condition that the next door does not have: this entry's whole
 * history is three rounds each shutting one door and leaving a sibling open (S423 filed the
 * class · #1002 shut the state-resolution `needs-server` door · S426 found the D1 mount-throw
 * `needs-server` door, which `return`s BEFORE D2 ever runs, so no `consoleErrors` inspection
 * happens there at all).
 *
 * ⚑ TWO CARRIERS, AND THE SECOND ONE IS THE LOAD-BEARING HALF:
 *   1. THE NOTICE — a `[seed-bridge]`-prefixed entry in `consoleErrors`. This is what the
 *      harness pushes (three sites in `observeCompiled`: the `applySeed` throw, the
 *      `seedThrewNotice` per-write throw, the missing side-channel) and it is the only
 *      carrier #1002 checked.
 *   2. THE FACT — the seed report's OWN `errors[]`, and a `set-threw` write. Keying only on
 *      the notice makes the invariant depend on the harness REMEMBERING TO PUSH, which is
 *      exactly the defect S423 filed ("this comment said LOUD and the branch was silent").
 *      (History: before S427 round 4b, D2 counted the notice as a console error, so the
 *      state-resolution block returned `compiles-but-throws` first and the `renders-empty` /
 *      `renders-clean` returns were reached with a failed seed only by a direct
 *      `runDetectors` caller passing the fact without the notice.)
 *      ⚑ S427 round 4b — THE GREEN RETURNS ARE NOW THE HARNESS PATH. D2 and the
 *      state-resolution block read APP console errors only (notices excluded), so every
 *      harness-built failed seed on a mount that did not throw and produced no app error or
 *      hard smell — the `applySeed` catch, a `set-threw`, a `[seed-signature]`, no side
 *      channel, and the seeded NO-HTML branch — walks to `renders-empty` / `renders-clean`,
 *      and the terminal guard in `runDetectors` is what makes it `seed-bridge-failed`. That
 *      guard now carries F4's loudness on the mount path; it is not a backstop any more.
 *
 * ⚠ THE CARVE-OUT IS PRESERVED BY CONSTRUCTION, and it is why this reads `errors` rather
 * than "any write that did not land": `derived-cell` and `no-such-cell` are FIXTURE
 * defects, not emit regressions (S427: no corpus fixture resolves to either any more, and
 * SEED_OBSERVABILITY in e2e-render-map.test.js reds if one regresses to it). `applySeed` pushes NOTHING into
 * `errors` for either of them — only `[seed-set …]` (a write threw), `[seed-signature] …` (the
 * render snapshot failed) and the two `[seed-bridge] …` reports do — so those two reasons stay
 * quiet here without an exclusion list, exactly as in `seedThrewNotice`.
 *
 * ⚠ DELIBERATELY NOT A FAILURE SIGNAL: `gainedContent === null` (UNMEASURED). Every harness
 * path that produces it also records a `[seed-signature]`/`[seed-bridge]` error, so it is
 * already covered by the carriers above, while direct `runDetectors` callers pass a bare
 * `null` to exercise D6's veto and must not be reclassified as harness failures.
 *
 * BACK-COMPATIBLE: an observation with no `[seed-bridge]` console entry and no seed report
 * (every pre-S423-shaped call) returns false.
 *
 * @param {object} obs — a `runDetectors` observation.
 * @returns {boolean}
 */
export function seedBridgeFailed(obs) {
  // ⛑ S427 round 4c — AN UNSEEDED CELL HAS NO SEED TO FAIL. Without this, an app that itself
  // logs a line starting "[seed-bridge]" would be reclassified on an UNSEEDED cell.
  // ⚑ round 4d — ONE DELIBERATE DIVERGENCE FROM THE PRE-S427 BASE (c59367bb), measured by
  // running base's `runDetectors`: an UNSEEDED, server-dependent cell whose app logs a
  // "[seed-bridge]"-prefixed line that reads like server absence. Base scored it
  // `compiles-but-throws`, because its S424 `!consoleErrors.some(m => m.startsWith(
  // "[seed-bridge]"))` term ignored `seeded` and took the app's own line for a seed failure.
  // Here it is `needs-server`: the cell has no seed, so an app-logged string cannot be a seed
  // failure, and the line is judged as the app output it is. Every other unseeded
  // observation is classified as base classified it (and no corpus cell moves — measured).
  if (!obs.seeded) return false;
  const consoleErrors = obs.consoleErrors ?? [];
  // 1 — the notice the harness pushes.
  if (consoleErrors.some(isSeedBridgeNotice)) return true;
  // 2 — the fact the harness recorded, whether or not anything pushed a notice.
  const report = obs.seedReport;
  if (report == null) return false;
  const errors = Array.isArray(report.errors) ? report.errors : [];
  if (errors.length > 0) return true;
  const writes = Array.isArray(report.writes) ? report.writes : [];
  return writes.some((w) => w && w.reason === "set-threw");
}

/** The smell recorded on every cell carrying a seed-bridge failure — the ONE greppable mark. */
export const SEED_BRIDGE_SMELL = "S-SEED-BRIDGE-FAILED";

/** The prefix of every notice the HARNESS (not the app) pushes into `consoleErrors`. */
export const SEED_BRIDGE_PREFIX = "[seed-bridge]";

/**
 * The exact notice `observeCompiled` pushes when the ONLY thing that failed was the
 * render-content snapshot (`applySeed` recorded a `[seed-signature]` error). Defined here and
 * imported by the harness so the text that is pushed and the text that is recognised cannot
 * drift apart.
 */
export const SEED_SNAPSHOT_NOTICE =
  "[seed-bridge] the render-content snapshot failed — gainedContent is UNMEASURED, D6 suppressed";

/** Is this console entry the harness's own seed notice rather than something the APP logged? */
export function isSeedBridgeNotice(msg) {
  return String(msg).startsWith(SEED_BRIDGE_PREFIX);
}

/**
 * WHAT failed, for a cell on which `seedBridgeFailed` is true — or `null` when it is not.
 *
 * ⛑ S427 — the note used to say "the harness could not deliver the seed" for every failure,
 * which is FALSE for a `[seed-signature]`-only report: there every write landed and only the
 * DOM snapshot helper threw. Round 4c split it three ways, each TRUE of what it names:
 *   "not-attempted" — the report records NO write at all: the harness never reached the write
 *                     step (the seeded no-html branch — which pushes no notice — no side
 *                     channel, an `applySeed` throw). Why is in `detail.seed.errors`.
 *   "not-delivered" — writes were attempted and not every one landed (a `set-threw`, any
 *                     non-snapshot error or notice), OR delivery cannot be confirmed (a notice
 *                     with no report, or no write landed at all). Fail-closed.
 *   "unmeasured"    — AT LEAST ONE write landed, none threw, and the ONLY failure on record is
 *                     the render-content snapshot. ⛑ 4c: the ≥1-landed requirement is new — a
 *                     report whose writes were all `no-such-cell` / `derived-cell` delivered
 *                     nothing, and "every attempted write landed" would have been false of it.
 *
 * @param {object} obs
 * @returns {"not-attempted"|"not-delivered"|"unmeasured"|null}
 */
export function seedFailureKind(obs) {
  if (!seedBridgeFailed(obs)) return null;
  const report = obs.seedReport;
  const writes = report != null && Array.isArray(report.writes) ? report.writes : [];
  const errors = report != null && Array.isArray(report.errors) ? report.errors : [];
  // ⛑ round 4d — "not-attempted" needs a reason the write step was not reached, i.e. an error
  // other than the snapshot's. A report with NO writes and ONLY a `[seed-signature]` error DID
  // reach the loop — the fixture simply had zero keys — so it falls through and ends
  // "not-delivered" (nothing landed). Every harness path that skips the loop records its own
  // non-snapshot reason (no html, no side channel, an `applySeed` throw).
  if (
    report != null &&
    writes.length === 0 &&
    errors.some((e) => !String(e).startsWith("[seed-signature]"))
  ) {
    return "not-attempted";
  }
  const notices = (obs.consoleErrors ?? []).filter(isSeedBridgeNotice).map(String);
  if (notices.some((n) => n !== SEED_SNAPSHOT_NOTICE)) return "not-delivered";
  if (errors.some((e) => !String(e).startsWith("[seed-signature]"))) return "not-delivered";
  if (writes.some((w) => w && w.reason === "set-threw")) return "not-delivered";
  if (!writes.some((w) => w && w.wrote === true)) return "not-delivered";
  return "unmeasured";
}

/** What failed — the first half of the recorded note, keyed by `seedFailureKind`. */
const SEED_FAILURE_WHAT = {
  "not-attempted":
    "no seed write was attempted — the harness never reached the write step (why: detail.seed.errors)",
  "not-delivered":
    "the seed was not fully delivered, or its delivery cannot be confirmed (which writes failed: detail.seed)",
  unmeasured:
    "at least one seed write landed and none threw, but the render-content snapshot failed, so D6 (seeded-and-empty) was never measured",
};

/**
 * What the failure means for THIS cell's verdict — the second half of the note.
 *
 * ⛑ S427 — the note used to end "this cell carries NO verdict about the compiler" on EVERY
 * cell, including a mount throw of `loadContacts is not defined` carrying `S-UNBOUND-REF`: a
 * genuine codegen bug, recorded in the committed baseline with a sentence telling the next
 * triager to disregard it.
 *
 * ⛑ S427 round 4c — and "NO verdict about the compiler" was ALSO false on most guard
 * demotions. It is true only where the seed failure's CAUSE is established as not-the-compiler.
 * A `set-threw` is a throw out of the emitted runtime's `_scrml_reactive_set` (which already
 * catches subscriber/effect throws, so what escapes is runtime internals OR a malformed
 * fixture); a missing side channel on a mount that did not throw may be an emit regression
 * (the harness's own comment says so); no html emitted may be the compiler. Four verdicts:
 *   independent  — the cell is red on its own evidence (mount throw, app console error, DOM
 *                  smell); the seed failure does not explain it.
 *   none         — ONLY a guard demotion from `needs-server` reached by the D1 MOUNT-THROW
 *                  door: the throw is server-absence, and the undelivered seed is its
 *                  consequence (no side channel is captured once `exec()` throws). Cause
 *                  established; this cell really says nothing about the compiler.
 *                  (Refinement of the PA decision, stated: a `needs-server` reached by the
 *                  CONSOLE door has no such causal link — the seed failed on a mount that did
 *                  not throw — so it is `undecidable`.)
 *   undecidable  — every other guard demotion: the failure may be the fixture/harness OR
 *                  compiler-emitted code, and this cell claims neither.
 *   undecidableD6 — as undecidable, but D6 FIRED on the write(s) that DID land; the
 *                  board-bug-class verdict is withheld only because a sibling write failed.
 */
const UNDECIDABLE_CAUSES = {
  "not-attempted":
    "the failure may originate in the fixture/harness OR in compiler-emitted code (e.g. a dropped _scrml_reactive_set side channel, a missing entry html)",
  "not-delivered":
    "the failure may originate in the fixture/harness OR in compiler-emitted code (e.g. a throw out of the emitted _scrml_reactive_set, or a malformed fixture)",
  unmeasured:
    "the failure may originate in the harness's render-snapshot helper OR in compiler-emitted DOM it could not read",
};

const SEED_FAILURE_VERDICT = {
  independent:
    "the seed failure does NOT explain this cell: its red state stands on its own evidence (a mount throw, an app console error or a DOM smell) and IS a verdict",
  none:
    "this cell carries NO verdict about the compiler — the mount threw for server absence, and the undelivered seed is that throw's consequence",
  // ⛑ round 4d — the cause clause is KIND-SPECIFIC (see UNDECIDABLE_CAUSES): the examples that
  // are true of a failed write are false of a failed snapshot, where every write landed.
  undecidable: (kind) =>
    `UNDECIDABLE: ${UNDECIDABLE_CAUSES[kind]}; this cell makes NO claim either way — see detail.seed`,
  undecidableD6:
    "UNDECIDABLE, WITH A SUSPECT: D6 FIRED on the seed write(s) that DID land — the populated render came back empty, a possible board-bug-class compiler defect — but a sibling seed write failed, so the empty render cannot be attributed from this cell; see detail.seed and detail.emptyRegions",
};

/**
 * Record a seed-bridge failure on a cell. THE ONE WRITER of the note text, so the FOUR sites
 * that record it — three in `classifyObservation` (the D1 `compiles-but-throws` return, the
 * console-error `compiles-but-throws` return, the `smell-detected-wrong` return) plus the
 * terminal guard in `runDetectors` — cannot drift into different records of the same fact.
 * The caller states which verdict relation holds; the kind is derived.
 *
 * @param {object} obs
 * @param {string[]} smells — mutated.
 * @param {object} detail — mutated.
 * @param {"independent"|"none"|"undecidable"|"undecidableD6"} verdict
 */
function noteSeedBridgeFailure(obs, smells, detail, verdict) {
  if (!smells.includes(SEED_BRIDGE_SMELL)) smells.push(SEED_BRIDGE_SMELL);
  const kind = seedFailureKind(obs) ?? "not-delivered";
  detail.seedBridgeFailureKind = kind;
  const v = SEED_FAILURE_VERDICT[verdict];
  detail.seedBridgeFailure = `${SEED_FAILURE_WHAT[kind]} — ${typeof v === "function" ? v(kind) : v}`;
}

/**
 * Run the D0–D7 detectors against one mounted observation.
 *
 * ⛑ S426 — THE TERMINAL SEED GUARD LIVES HERE, WRAPPING THE CLASSIFIER, and that placement
 * is the point. The requirement is not "the D1 door must check the seed"; it is **no cell
 * may score a GREEN state while a seed-bridge failure is on the record** — green cells have
 * their `detail` stripped by `generate-baseline.js`, so a green verdict deletes the only
 * copy of the explanation. Enforcing it at one choke point makes it class-complete over
 * returns that do not exist yet, which is precisely what the previous two rounds could not
 * do by patching the door in front of them.
 *
 * The classifier's own RED returns (a mount throw, an APP console error, a hard DOM smell) keep
 * their state and only RECORD the seed failure — they already carry a red verdict, so there is nothing to demote.
 * Every GREEN return, `needs-server` included, is demoted HERE and nowhere else.
 *
 * ⛑ S427 — `needs-server` IS NOT SPECIAL-CASED ANY MORE. Both of its doors (the D1 mount-throw
 * one and the console-error one) used to carry a door-local `&& !seedBridgeFailed(obs)`, which
 * sent a seeded server-dependent app straight to `compiles-but-throws` — a COMPILER-blaming
 * state for a server-absence throw plus a consequential seed failure. At the D1 door that was
 * unconditional for every seeded cell: `mountAndObserve` captures the side channel only after
 * `exec()` returns, so a mount throw always leaves the seed undelivered. The door-local terms
 * dated from before this guard existed (S424 added the console one because green cells lose
 * `detail`); the guard now preserves `detail` itself, so the doors return the true tier and
 * this demotes it to `seed-bridge-failed` with `seedBridgeDemotedFrom: "needs-server"` and the
 * `needsServer` explanation intact.
 *
 * ⛑ S427 — A `[seed-signature]`-ONLY FAILURE STILL DEMOTES, deliberately. Every write landed,
 * so the seed is live — but the snapshot that feeds D6 failed, `gainedContent` is null, and D6
 * is VETOED. A green verdict here was reached without the one detector the populated cell
 * exists to run (D6's each-regions scope can fire on a content-bearing body, so this holds for
 * `renders-clean` as much as for `renders-empty`). An unverified green is not a green. The note
 * says what actually failed (`seedFailureKind` = "unmeasured"), never "could not deliver".
 *
 * @param {object} obs
 * @returns {{ state: string, smells: string[], detail: object }}
 */
export function runDetectors(obs) {
  const det = classifyObservation(obs);
  if (!GREEN_STATES.has(det.state)) return det;
  if (!seedBridgeFailed(obs)) return det;
  const smells = [...det.smells];
  const detail = { ...det.detail };
  // ⛑ S427 round 4c/4d — `seedBridgeDemotedFrom` records THE CLASSIFIER'S VERDICT WITH THE
  // SEED-FAILURE GATE IGNORED — what these same observed facts score if the failure is not
  // allowed to withhold anything. It is NOT a counterfactual "had the seed not failed": for a
  // partial delivery the render with every write landed was never observed and is unknowable.
  // For most cells it is the green return the classifier took. When D6 fired
  // (S-EMPTY-WITH-DATA) and only the `renders-empty-with-data` return declined because the seed
  // failed, the classifier fell through to `renders-empty`/`renders-clean` — recording THAT
  // would claim a green verdict the smell on the same cell contradicts. So it records
  // `renders-empty-with-data`, and the note says D6 fired. `needs-server` keeps precedence
  // exactly as in the classifier (item 2's masking is out of scope and unchanged).
  const d6Withheld = det.state !== "needs-server" && det.smells.includes("S-EMPTY-WITH-DATA");
  const wouldHaveScored = d6Withheld ? "renders-empty-with-data" : det.state;
  const causeEstablished = det.state === "needs-server" && obs.throwMessage != null;
  const verdict = causeEstablished ? "none" : d6Withheld ? "undecidableD6" : "undecidable";
  noteSeedBridgeFailure(obs, smells, detail, verdict);
  detail.seedBridgeDemotedFrom = wouldHaveScored;
  return { state: "seed-bridge-failed", smells, detail };
}

/**
 * The D0–D7 classification itself. Not exported: `runDetectors` is the entry point, because
 * the seed guard above must not be bypassable by reaching past it.
 *
 * @param {object} obs
 * @param {Array} obs.compileErrors  — result.errors from compileScrml (D0).
 * @param {string|null} obs.throwMessage — mount-throw message, or null (D1/D7).
 * @param {string[]} obs.consoleErrors — captured console.error messages (D2).
 * @param {Document|null} obs.document — the mounted happy-dom document, or null
 *                                       if mount threw / compile failed.
 * @param {boolean} obs.seeded — was a data fixture REGISTERED for this cell (D6)?
 * @param {object|null} [obs.seedReport] — the harness's seed-bridge report
 *   (`{ writes: [{ wrote }], domChanged, ... }`), when available. D6 requires a
 *   real write, not merely a registered fixture; omitted/null falls back to
 *   `obs.seeded` alone (⛑ S423 — see seedWasDelivered).
 * @param {boolean} obs.serverDependent — does the app have a server side (emits
 *   serverJs / uses a `?{}` SQL block)? Gates the needs-server classification.
 * @returns {{ state: string, smells: string[], detail: object }}
 */
function classifyObservation(obs) {
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
    // ⛑ S426 — THE FIFTH PATH. This return is a GREEN one and it fires BEFORE D2 runs, so
    // #1002's `hasSeedBridgeFailure` — which lives in the state-resolution block below and
    // reads `consoleErrors` — could never be reached from here. A seeded server-dependent app
    // whose mount throws is the ONE shape where this is harness-reachable, and it is not
    // exotic: a mount throw means `_scrml_reactive_set` was never captured, so `observeCompiled`
    // takes its no-side-channel branch on EVERY seeded cell whose mount throws. Verified by
    // execution before the fix: state `needs-server`, GREEN, seed failure recorded nowhere.
    // ⛑ S427 — and S426's fix (a `&& !seedBridgeFailed(obs)` term here) over-corrected: since
    // a mount throw ALWAYS leaves a seeded cell's seed undelivered, the term removed this
    // carve-out for EVERY seeded server-dependent app and scored it `compiles-but-throws`,
    // blaming the compiler for a server-absence throw. The door now returns its true tier and
    // `runDetectors`'s terminal guard demotes it to `seed-bridge-failed`.
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
    if (seedBridgeFailed(obs)) {
      // The mount really did throw, and not for server-absence — that is a verdict of its own,
      // and the seed failure is its CONSEQUENCE (no side channel is captured once `exec()`
      // throws). Record the failure; do not let it disown the throw.
      noteSeedBridgeFailure(obs, smells, detail, "independent");
    }
    return { state: "compiles-but-throws", smells, detail };
  }

  const doc = obs.document ?? null;
  const body = doc && doc.body ? doc.body : null;

  // ---- D2: console.error / uncaught during mount+settle (soft throw) ----
  const consoleErrors = obs.consoleErrors ?? [];
  // ⛑ S427 (round 4b) — D2 IS A DETECTOR OF THE APP, SO IT READS THE APP'S CONSOLE ERRORS.
  // `consoleErrors` also carries the harness's own `[seed-bridge]` notices. Counting them here
  // made every notice-only failed seed score `compiles-but-throws` — a COMPILER-blaming state
  // for a HARNESS failure, the exact mis-attribution `seed-bridge-failed` exists to prevent.
  // Only APP errors make the soft-throw; the notices are still RECORDED in
  // `detail.consoleErrors` (kept on every red cell), and the failed seed stays loud because
  // `runDetectors`'s terminal guard demotes whatever green return it reaches.
  // ⛑ round 4c — only on a SEEDED cell: the harness pushes notices only when it has a seed,
  // so on an unseeded cell every console line is the app's (even one that happens to start
  // "[seed-bridge]"), and the unseeded path stays identical to the pre-S427 base.
  const appConsoleErrors = obs.seeded
    ? consoleErrors.filter((m) => !isSeedBridgeNotice(m))
    : consoleErrors;
  if (consoleErrors.length > 0) {
    detail.consoleErrors = consoleErrors.slice(0, 4).map((m) => String(m).slice(0, 300));
  }
  if (appConsoleErrors.length > 0) {
    smells.push("D2-CONSOLE-ERROR");
    // A console error during mount is a soft-throw: classify as throws.
    // Continue scanning for smells too (a console error + an [object in DOM is
    // worth recording both), but the state is already the throws tier.
  }

  // Gather DOM facts for the smell detectors.
  //
  // ⛑ S419 residuals — these deliberately read ALL text (raw `textContent` for D3, every
  // text node for D4/D5), NOT the rendered-only text `hasRenderedContent` uses. The two
  // questions differ: D6 asks "did anything SHOW?", so hidden text must not answer yes;
  // D3–D5 ask "did codegen write a wrong VALUE into the DOM?", and `[object Object]` /
  // a literal `${` / a bare `undefined` inside a collapsed panel or an aria-hidden label
  // is the same defect, one toggle away from the screen. Filtering hidden text here
  // would hide real smells. (Inline `<script>`/`<style>` text in the mounted body could
  // in principle trip D3/D4 on legitimate code; see the S419 residuals progress log for
  // the corpus check — no cell does today.)
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

  // ---- D6: seeded data that rendered nowhere (S-EMPTY-WITH-DATA) ----
  // Only meaningful when a seed was actually DELIVERED (⛑ S423 — `seedWasDelivered`,
  // not the bare `obs.seeded`). An empty render with NO seed is a VALID partial
  // render (the <empty> fallback) — NOT a failure. "Empty" means nothing
  // content-bearing rendered, not merely no text (⛑ S419, see hasRenderedContent).
  //
  // TWO SCOPES, asked in order, because the body-global one is answered by page
  // chrome (⛑ S423 limb 2 — see the region-scoped emptiness block above):
  //   body        — nothing content-bearing rendered anywhere. The original question.
  //   each-regions — the body showed SOMETHING, but every identifiable leaf
  //                  `<each>` region rendered nothing. This is the board bug: the
  //                  chrome is there and the DATA is not.
  //
  // ⚑ S427 (round 4b) — D6 is still COMPUTED when the seed failed (S424 question B: the smell
  // is corroborating evidence if the throw was a broken emitted accessor). What changed is
  // whether it may DECIDE the state — see the `renders-empty-with-data` return below.
  if (seedWasDelivered(obs) && !seedMovedTheRender(obs)) {
    const bodyEmpty = !hasRenderedContent(body);
    const regionVerdict = bodyEmpty ? null : regionScopedEmptiness(body);
    if (bodyEmpty || (regionVerdict && regionVerdict.allLeavesEmpty)) {
      smells.push("S-EMPTY-WITH-DATA");
      detail.emptyWithData = true;
      detail.emptyWithDataScope = bodyEmpty ? "body" : "each-regions";
      if (regionVerdict) detail.emptyRegions = regionVerdict.summary;
    }
    // Continue — but if no harder smell fired, this is the renders-empty state.
  }

  // ---- Resolve the cell state from the accumulated smells (worst-wins) ----
  if (appConsoleErrors.length > 0) {
    // needs-server: a server-dependent app whose ONLY mount error is a server-
    // absence null/undefined-access console error — no genuine codegen error
    // (ReferenceError/TDZ) and no hard render smell. Harness-realism non-gap
    // (S203 b+c). The guards ensure a real bug is never masked: a codegen error
    // or a smell keeps the cell red (compiles-but-throws).
    // ⛑ S427 — the two APP-evidence questions below read the APP's console errors only. The
    // harness's own `[seed-bridge]` notices are not app output, and one of them is not fixed
    // text: `observeCompiled`'s `applySeed` catch pushes `[seed-bridge] ${e.message}`, which
    // can itself contain "is not defined" or "Cannot read properties of null" and would then
    // answer a question about the app. (The four fixed-text notices match neither — measured.)
    // ⛑ round 4b — this block is now ENTERED only on an app console error too (see D2), so a
    // notice-only failed seed never reaches it: it falls to the smell / green returns below,
    // and the terminal guard makes it `seed-bridge-failed`. F4's loudness now rests on that
    // guard rather than on the notice being counted as an app error.
    const hasCodegenError = appConsoleErrors.some((m) =>
      /is not defined|before initialization/.test(String(m)),
    );
    const hasHardSmell =
      smells.includes("S-OBJECT-IN-DOM") ||
      smells.includes("S-RAW-INTERP") ||
      smells.includes("S-NULLISH-TEXT");
    // ⛑ S424 item 3 → S426 → S427 — HOW A HARNESS-RAISED SEED FAILURE MEETS THIS CARVE-OUT.
    // S424 found a server-dependent seeded app whose `set-threw` notice was swallowed here:
    // `needs-server` is GREEN and `generate-baseline.js` strips `detail` from green cells, so
    // the throw went silent. It fixed that with a `!seedBridgeFailed(obs)` term (S426 moved it
    // onto the shared predicate), which scored such a cell `compiles-but-throws` — loud, but a
    // COMPILER-blaming state for a server-absence error plus a harness seed failure.
    // S427 removed the term: this carve-out now answers only its own question (is the APP's
    // only error server-absence?) and `runDetectors`'s terminal guard demotes the green result
    // to `seed-bridge-failed`, keeping `detail`. Still loud (a red state), now truthful.
    // Measured before the change: [server-absence error, no-channel notice] on a seeded
    // server-dependent app scored `compiles-but-throws`; it now scores `seed-bridge-failed`,
    // `seedBridgeDemotedFrom: "needs-server"`. A REAL server-absence app error is still
    // required — `appConsoleErrors` excludes the notices, so a notice alone cannot admit it.
    // ⚑ SCOPE, deliberately narrow: the wider masking — that ANY console error matching
    // `isServerAbsenceMessage` admits the carve-out, and that `hasHardSmell` omits
    // D6's `S-EMPTY-WITH-DATA` — is a separate, already-filed arc (item 2 of
    // [[g-d6-seed-gating-has-three-latent-paths-...]]) and is NOT closed here.
    if (
      obs.serverDependent &&
      !hasCodegenError &&
      !hasHardSmell &&
      appConsoleErrors.some(isServerAbsenceMessage)
    ) {
      smells.push("NEEDS-SERVER");
      detail.needsServer =
        "server-dependent app mounted with no server — console error from a null server-only data source";
      return { state: "needs-server", smells, detail };
    }
    if (seedBridgeFailed(obs)) {
      // #1002's door. The state is unchanged (a console error is already
      // `compiles-but-throws`); the failure is recorded in the SAME shape as everywhere else.
      // ⛑ S427 — and the note must be TRUE for this cell. This block is entered only on an
      // APP console error (round 4b), so the red state always has evidence of its own here:
      // the verdict is "independent" by construction. The notice-only case no longer arrives.
      noteSeedBridgeFailure(obs, smells, detail, "independent");
    }
    return { state: "compiles-but-throws", smells, detail };
  }
  if (
    smells.includes("S-OBJECT-IN-DOM") ||
    smells.includes("S-RAW-INTERP") ||
    smells.includes("S-NULLISH-TEXT")
  ) {
    // ⛑ S427 (round 4b) — a notice-only failed seed can now reach this RED return (before 4b
    // the notice sent it to `compiles-but-throws` first). The smell is a DOM value codegen
    // wrote — `[object Object]`, a raw `${`, a bare `undefined` — which is its own evidence,
    // so the state stands; the failure is recorded here because the terminal guard only
    // touches GREEN returns, and without this the cell would lose its greppable mark.
    if (seedBridgeFailed(obs)) noteSeedBridgeFailure(obs, smells, detail, "independent");
    return { state: "smell-detected-wrong", smells, detail };
  }
  // ⛑ S427 (round 4b) — NOT WHILE THE SEED IS ON THE RECORD AS FAILED. `seedWasDelivered` asks
  // "did ANY write land", so a PARTIAL `set-threw` (the key driving the list threw, a sibling
  // landed) passes it and, with `gainedContent: false`, D6 fires. Before 4b the notice sent
  // that cell to `compiles-but-throws` first (S424 question B: "a veto adds nothing to the
  // STATE"). Once D2 stopped counting notices, it reached THIS return — blaming the COMPILER
  // for a write the HARNESS failed to make, S424 item 3's round-2 bug through another door.
  // Measured by execution. An empty render cannot be pinned on the compiler while the seed
  // failed, so the cell falls through to the green return, the terminal guard makes it
  // `seed-bridge-failed`, and the S-EMPTY-WITH-DATA smell SURVIVES on it as corroboration —
  // question B's reason for keeping the smell still holds; only its right to set the state
  // is withdrawn.
  if (smells.includes("S-EMPTY-WITH-DATA") && !seedBridgeFailed(obs)) {
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
  // ⛑ S426 — the seed was not (verifiably) delivered, so the cell's populated render was never
  // judged. ⛑ S427 round 4c: that makes the cell UNDECIDABLE about the compiler, not cleared of
  // it — the failure may be the fixture/harness or compiler-emitted code, and `detail.
  // seedBridgeFailure` says which of the two is established, if either. Deliberately its own
  // state rather than a reuse: `compiles-but-throws` would
  // claim a throw that did not happen, `smell-detected-wrong` and `renders-empty-with-data`
  // both blame the COMPILER for a write the HARNESS failed to make (the exact
  // mis-attribution round 2 of `seedThrewNotice` shipped), and any GREEN state deletes the
  // explanation, because `generate-baseline.js` strips `detail` from green cells.
  "seed-bridge-failed",
];

/**
 * States that are NOT a gap (green) — the delta-gate's definition of "a closed cell".
 * `needs-server` is non-gap: a server-dependent app mounted with NO server is NOT broken
 * (harness-realism, S203 b+c), so the gate treats throw->needs-server as an improvement and
 * needs-server->throw (a real codegen bug surfacing) as a green->red regression.
 *
 * ⛑ S416 — `renders-empty-with-data` IS DELIBERATELY ABSENT. An empty render with NO seed is
 * a valid `<empty>` fallback and stays green; an empty render WITH data seeded is the
 * board-bug class D6 exists to catch, and it used to land in `renders-empty` and score green.
 *
 * ⛑ S426 — CANONICAL HERE, AND IT WAS THREE COPIES. `generate-baseline.js:53` and
 * `e2e-render-map.test.js:80` each carried their own literal Set, and this module — which
 * PRODUCES the states and now has to enforce "no green cell may carry a seed-bridge failure"
 * — would have made a fourth. Both consumers import this one now: a green state added in one
 * place and forgotten in another is the same "must stay in step" documentary invariant the
 * #1012 round replaced with hoisted constants.
 */
export const GREEN_STATES = new Set([
  "renders-clean",
  "renders-empty",
  "needs-server",
]);

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
