/**
 * @module library-shape
 *
 * Single source of truth for the §21.5 / §23.6 library-file SHAPE predicates,
 * shared across the pipeline so the detection paths never silently diverge:
 *   - api.js W5a build-wide library auto-detect (mode-flip),
 *   - ast-builder.js `isPureModuleFile` (W-PROGRAM-001 suppression),
 *   - tool-program.ts `isLibraryShapedFile` (§64 tool-dep library emit).
 *
 * A future change to what a `<foreign lang>` library declaration looks like must
 * change ONE function, not three copies.
 */

/**
 * True when `node` is a top-level `<foreign lang="…">` LIBRARY foreign-language
 * declaration (§23.6) — the `lang=` sibling of `<db src>` (§44.7.1). Such a node
 * is a library-context DECLARATION, not "this file is a page" markup, so the
 * pure-fn-module / library shape predicates must NOT let it disqualify an
 * otherwise-§21.5 file.
 *
 * Admits ONLY the canonical library-decl form: a markup node, tag `foreign`,
 * carrying `lang=`, that is SELF-CLOSING / childless. A `<foreign lang="html">
 * …body…</foreign>` (a bodied foreign node — page-shaped content) does NOT
 * qualify; admitting it would let a page-shaped file flip the whole build to
 * library mode (a blank page). A `<db src>` decl lowers to a `kind:"state"` node
 * (never `"markup"`), so it already passes a `kind !== "markup"` test — only
 * `<foreign lang>` needs this admit.
 *
 * @param {any} node — a top-level FileAST node
 * @returns {boolean}
 */
export function isForeignLangLibDecl(node) {
  return (
    !!node &&
    node.kind === "markup" &&
    node.tag === "foreign" &&
    // §23.6 library-decl form is self-closing / childless. `children` is set
    // during buildBlock (before every consumer stage); a bodied foreign has
    // ≥1 child and is rejected. `selfClosing` is the precise §23.6 flag and is
    // asserted too where present.
    node.selfClosing === true &&
    (node.children == null || node.children.length === 0) &&
    Array.isArray(node.attrs) &&
    node.attrs.some((a) => a && a.name === "lang")
  );
}
