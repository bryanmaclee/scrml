/**
 * W-EACH-TABLE-FOSTER — info-level lint that surfaces `<each>` sites whose
 * static mount placeholder is emitted into a table context where the HTML
 * parser will FOSTER-PARENT it out of the table.
 *
 * ## The defect this warns about
 *
 * `emitEachMountHtml` (emit-each.ts) emits a static
 * `<div data-scrml-each-mount="each_<id>"></div>` placeholder at the each's
 * source position in the served HTML shell. Per the HTML tree-construction
 * spec, a `<tbody>` (or `<thead>`/`<tfoot>`/`<tr>`/bare `<table>`) may contain
 * only `<tr>` (resp. `<td>`/`<th>`, table-sections) plus script-supporting
 * elements — NOT a `<div>`. When the parser meets that `<div>` while in the
 * "in table"/"in table body"/"in row" insertion mode it FOSTER-PARENTS it:
 * the `<div>` (and every `<tr>` the runtime later appends into it) is
 * physically relocated to just BEFORE the `<table>`. Result: `<tbody>` renders
 * empty, `<empty>` fallback absent, list silently shows zero rows — no error,
 * no warning at parse time. (Real-Chrome CDP witness: `tbody tr` == 0 while
 * stray `tr` are hoisted out — assetManagement roster, S272 adopter report.)
 *
 * The `<div>`-based each (list rendered as `<div>` rows inside a `<div>`
 * parent) renders correctly because a `<div>` inside a `<div>` is legal and is
 * never foster-parented. That is the current adopter workaround.
 *
 * ## Why only the STATIC top-level mount
 *
 * Foster-parenting is a PARSE-TIME behavior of the HTML tree builder — it
 * applies only to markup that literally appears in the served `.html` shell.
 * A NESTED each (one inside another each's per-item template) builds its mount
 * via `document.createElement("div")` + `appendChild` at RUNTIME; the DOM API
 * is not subject to foster-parenting, so a runtime-created `<div>` mount
 * appended into a `<tbody>` element is NOT relocated. Therefore this lint
 * fires ONLY for a top-level (static-shell) each whose nearest enclosing
 * markup element is a table-section tag, and deliberately does NOT descend
 * into each `templateChildren` (those mounts are runtime-created and immune).
 *
 * ## Scope / disposition
 *
 * Info-level, non-blocking (partitions into result.warnings via the `W-`
 * prefix, never result.errors). This is a guidance lint that turns the
 * currently-SILENT failure into a loud one, pointing the adopter at the
 * `<div>`-layout workaround, until the real fix lands (a foster-safe mount
 * model — anchor-comment + sibling insertion, or a table-context-aware mount).
 * Tracked: docs/known-gaps.md `g-each-mount-div-foster-parented-in-table`.
 *
 * Output shape: `{ filePath, line, column, code, severity, message }`
 * — fed into the `allLintDiagnostics` channel by api.js, mirroring
 * lint-w-each-key.js's convention.
 *
 * @module lint-w-each-table-foster
 */

/**
 * Table-context element tags whose children the HTML parser restricts, so a
 * `<div>` each-mount placed directly inside them is foster-parented out.
 *   - `table`  → foster-parents non-table-content (a bare `<each>`→`<tr>`
 *     placed as a direct `<table>` child hits this too).
 *   - `thead`/`tbody`/`tfoot` → only `<tr>` (+ script-supporting) permitted.
 *   - `tr` → only `<td>`/`<th>` (+ script-supporting) permitted.
 * `colgroup` is excluded (only `<col>`; an `<each>`→`<col>` is not a real
 * adopter shape). `select`/`optgroup` are ALSO excluded, but note the exclusion
 * is a SCOPE choice, not a safety one: in the "in select" insertion mode a
 * `<div>` start tag is a parse error and the token is DROPPED (not
 * foster-parented, but not surviving either), so a `<div>`-mount `<each>` under
 * `<select>` ALSO silently renders zero rows — a sibling gap via a different
 * parser mechanism. This lint is deliberately scoped to table foster-parenting
 * (the reported adopter case); the select/option variant is noted in the
 * known-gap as related-but-separate.
 */
const FOSTER_PARENT_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

/**
 * TRANSPARENT control-flow markup tags: bare block wrappers that establish NO
 * real HTML element container — they foster along with their content, so a
 * child `<each>` inherits the SAME enclosing element as the wrapper. The bare
 * `<if>…</if>` block is the case: `<tbody><if @c><each>…</each></if></tbody>`
 * emits `<tbody><if><div data-scrml-each-mount></div></if></tbody>`, where BOTH
 * the `<if>` marker and the each mount foster out of the table. So `<if>` must
 * pass the enclosing tag through rather than reset it to "if".
 *
 * NOT included: `else-if`/`else` — scrml expresses those as the ATTRIBUTE form
 * (`<div else-if=…>` / `<div else>`), a real `<div>` element that legitimately
 * resets the enclosing tag (its own div-in-table foster is a separate locus,
 * not this each-lint's scope). A MULTI-branch if-CHAIN emits its own
 * `<div data-scrml-if-chain>` wrapper (node kind `if-chain`, not walked here) —
 * that wrapper's foster is likewise a separate locus. MATCH arms build their
 * per-arm content at runtime (bodies under `armBodyChildren`, deliberately not
 * in the recursion keys) → immune, correctly never warned.
 */
const TRANSPARENT_CONTROL_TAGS = new Set(["if"]);

/**
 * Read an element node's tag name, lowercased, or null when the node is not
 * a rendered element. Mirrors emit-html.ts's `node.tag ?? node.tagName`.
 * @param {object} node
 * @returns {string|null}
 */
function elementTag(node) {
  const raw = node && (node.tag ?? node.tagName);
  return typeof raw === "string" && raw.length > 0 ? raw.toLowerCase() : null;
}

/**
 * Build the W-EACH-TABLE-FOSTER diagnostic message.
 * @param {object} eachBlock
 * @param {string} enclosingTag — the foster-parenting parent tag (lowercased)
 * @returns {string}
 */
function buildMessage(eachBlock, enclosingTag) {
  const src = (eachBlock.inExprRaw || eachBlock.ofExprRaw || "").trim();
  const at = src ? ` (\`<each in=${src}>\`)` : "";
  return (
    `W-EACH-TABLE-FOSTER: an \`<each>\`${at} rendered inside \`<${enclosingTag}>\` ` +
    `emits a \`<div>\` mount placeholder that the browser's HTML parser foster-parents OUT of the ` +
    `table — the rendered rows land before \`<table>\`, so \`<${enclosingTag}>\` shows zero rows ` +
    `(and no \`<empty>\` fallback), silently. scrml does not yet emit a table-safe mount for ` +
    `\`<each>\` under \`<table>/<thead>/<tbody>/<tfoot>/<tr>\`. Workaround: render the list with a ` +
    `\`<div>\`-based layout (e.g. a CSS grid) instead of a semantic \`<table>\` — a \`<div>\` mount ` +
    `inside a \`<div>\` is never foster-parented. Tracked: known-gap ` +
    `\`g-each-mount-div-foster-parented-in-table\`.`
  );
}

/**
 * Walk a file's markup tree tracking the nearest enclosing rendered-element
 * tag, and emit W-EACH-TABLE-FOSTER for every top-level (static-shell)
 * each-block whose enclosing element is a foster-parenting table tag.
 *
 * Coverage (honest scope):
 *   - Fires for an each directly under a table section, and for an each inside
 *     a bare `<if>` block under a table section (the `<if>` is transparent —
 *     see TRANSPARENT_CONTROL_TAGS — so the each still fosters). These are the
 *     common adopter shapes (aM's roster is the direct case).
 *   - Does NOT descend into an each-block's own `templateChildren`/`emptyChild`
 *     (per-item mounts are runtime createElement+appendChild → immune to
 *     parse-time foster-parenting; descending would false-positive on nested
 *     eaches).
 *   - Does NOT trace a MULTI-branch if-chain (kind `if-chain`, not in the
 *     recursion keys — it emits its own `<div data-scrml-if-chain>` wrapper, a
 *     separate foster locus) or MATCH arms (`armBodyChildren`, not in the keys
 *     — runtime-mounted, immune). Both are deliberate, sound omissions for an
 *     advisory lint (under-warning here is strictly ≤ the pre-lint silent
 *     status quo; it never over-warns).
 *
 * @param {object} file — a typed FileAST
 * @param {(diag: object) => void} emit
 */
function walkFile(file, emit) {
  const filePath = file.filePath || "";
  const seen = new WeakSet();

  /**
   * @param {*} node
   * @param {string|null} enclosingTag — nearest enclosing element tag (lowercased)
   */
  function walk(node, enclosingTag) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, enclosingTag);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);

    if (node.kind === "each-block") {
      if (enclosingTag && FOSTER_PARENT_TAGS.has(enclosingTag)) {
        const span = node.span || {};
        emit({
          filePath,
          line: span.line ?? 0,
          column: span.col ?? 0,
          code: "W-EACH-TABLE-FOSTER",
          severity: "info",
          message: buildMessage(node, enclosingTag),
        });
      }
      // Do NOT recurse into templateChildren/emptyChild — those mounts are
      // runtime-created (createElement+appendChild), immune to parse-time
      // foster-parenting. Recursing would false-positive on nested eaches
      // (an `<each>`→`<tr>` inside a table built once tables work).
      return;
    }

    // Compute the enclosing tag the children see: this node's own tag when it
    // is a rendered element, else the inherited enclosing tag (logic nodes emit
    // no element of their own and pass it through). A TRANSPARENT control marker
    // (bare `<if>`) also passes the inherited tag through — it establishes no
    // real HTML container and fosters together with its content, so a child
    // each still lands in the surrounding table section.
    const ownTag = elementTag(node);
    const childEnclosing = ownTag && !TRANSPARENT_CONTROL_TAGS.has(ownTag) ? ownTag : enclosingTag;
    for (const k of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
      if (Array.isArray(node[k])) walk(node[k], childEnclosing);
    }
  }

  walk(file.ast?.nodes ?? file.nodes ?? file, null);
}

/**
 * Walk the typed-AST files and collect W-EACH-TABLE-FOSTER diagnostics.
 *
 * @param {object[]} files — typed FileAST array from `runTS`
 * @returns {Array<{ filePath: string, line: number, column: number, code: string, severity: string, message: string }>}
 */
export function runWEachTableFoster(files) {
  const diagnostics = [];
  if (!files || !Array.isArray(files)) return diagnostics;
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    walkFile(file, (d) => diagnostics.push(d));
  }
  return diagnostics;
}
