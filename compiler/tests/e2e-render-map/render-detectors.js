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
//     with the CORRECTED seed the fixture-fix arc will land (`column:"Inbox"`/
//     `"Doing"` instead of the current non-matching `"todo"`): two columns render
//     their task, the third is LEGITIMATELY empty, and that rule scores a correct
//     board `renders-empty-with-data`. It is safe today only by accident of a
//     fixture everyone agrees is broken.
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
 * `obs.seeded` is only `seed != null` — a fixture was REGISTERED. Two of the four
 * corpus fixtures write nothing at all (`examples/06-kanban-board` names a DERIVED
 * cell; `examples/16-remote-data` names a cell the app does not have — the reason
 * codes limb 1 added), and both still carry `seeded:true`. Scoring such a cell red
 * for an empty render would blame the compiler for a broken fixture. They cannot
 * false-fire TODAY only because those two apps happen to render a non-empty body —
 * a property of those apps, not of this detector, and the fixtures are scheduled to
 * be corrected.
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
 *   - `examples/25-triage-board#populated` — `domChanged` is TRUE. The app's own initial
 *     `<tasks>` renders four tasks; the seed replaces them with rows whose `column` matches
 *     no column, so the render MOVES by SHRINKING to nothing. Gating on "did not change"
 *     would make D6 dark on the one cell it exists for.
 *   - the D6 fixture with its bug seed — `domChanged` is FALSE (its `<tasks>` starts empty,
 *     so an all-empty render stays all-empty), yet it is exactly the bug.
 * A pure LOSS is not a gain, so both land correctly: 25-triage gains nothing and fires;
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
  // ⛑ S424 — LOOSE `== null`, so an ABSENT field vetoes exactly as an explicit `null` does.
  // Both mean UNMEASURED; the strict form let `undefined` fall through to the FIRE direction,
  // which is the very thing round 2 ruled against one value short of the class. The sibling
  // `seedWasDelivered` (:616) already writes the loose form — this makes the two agree.
  if (report.gainedContent == null) return true;
  return report.gainedContent === true;
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
 * @param {boolean} obs.seeded — was a data fixture REGISTERED for this cell (D6)?
 * @param {object|null} [obs.seedReport] — the harness's seed-bridge report
 *   (`{ writes: [{ wrote }], domChanged, ... }`), when available. D6 requires a
 *   real write, not merely a registered fixture; omitted/null falls back to
 *   `obs.seeded` alone (⛑ S423 — see seedWasDelivered).
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
