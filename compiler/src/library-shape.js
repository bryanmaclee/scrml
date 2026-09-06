/**
 * @module library-shape
 *
 * Single source of truth for FILE-SHAPE classification — "what kind of document
 * is this `.scrml` file?" — plus the §21.5 / §23.6 library-decl predicate it is
 * built on. Shared across the pipeline so the detection paths never silently
 * diverge:
 *   - ast-builder.js (the TAB) — ASKS this classifier for the W-PROGRAM-001
 *     decision. ⛑ It does NOT record the field: `fileShape` is a local `const`
 *     there and the `const ast = {…}` literal has no such key. The STAMP happens
 *     once, downstream, in `compute-pgo-flags.ts:computeFileShape` at the Stage
 *     3.004 PRECG seam — which is what lets the M5 native pipeline carry the
 *     field with no mirrored predicate — and again in `component-expander.ts`,
 *     which re-stamps it when CE rebuilds the FileAST with new `nodes`.
 *     ⚑ SO `buildAST(...).ast.fileShape` IS `undefined`, BY DESIGN. A caller
 *     that builds an AST without going through api.js's PRECG loop — an LSP
 *     path, a `commands/` path — must call `classifyFileShape` itself or read
 *     the field with a fallback. Reading it bare there degrades SILENTLY, which
 *     is exactly the hazard `api.js`'s W5a carried until it was given a
 *     fallback. (This bullet previously claimed the TAB "records it on the
 *     FileAST", contradicting both `compute-pgo-flags.ts`'s docstring and the
 *     unit test that asserts `ast.fileShape` is undefined after `buildAST`.)
 *   - api.js W5a build-wide library auto-detect (mode-flip),
 *   - tool-program.ts `isLibraryShapedFile` (§64 tool-dep library emit),
 *   - codegen/index.ts shell composition (non-entry-page detection).
 *
 * A future change to what a `<foreign lang>` library declaration looks like — or
 * to what counts as a pure-module / pure-channel / non-entry-page file — must
 * change ONE function here, not four hand copies.
 *
 * ⚑ WHAT THIS MODULE DOES *NOT* ANSWER: "which file of this compilation is the
 * application ENTRY". Per SPEC §40.8 that is a BUILD fact, not a file fact —
 * *"The entry file is the file resolved by the build root"*. A single FileAST
 * cannot know whether it is the build root, so no variant here is called
 * "entry". `"program"` means only *this file declares a top-level `<program>`*,
 * which is strong evidence for entry-ness (§40.8 requires the entry to declare
 * it) but is not the same claim: the compiler does not yet enforce uniqueness
 * (`E-PROGRAM-002` is reserved-not-implemented), so more than one file in a
 * compile unit can carry the shape. Consumers picking "the entry" from a file
 * SET are making a build-level decision and own it explicitly.
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

/**
 * The closed set of file shapes. Every `.scrml` file classifies to EXACTLY ONE
 * of these, and `"bare-markup"` is the residual — so the set is exhaustive by
 * construction and a shape nobody anticipated falls into the warning branch
 * rather than into silence.
 *
 * ⚑ RE-EXPORTED, NOT REDECLARED. `FILE_SHAPES` and the `FileShape` union are
 * defined ONCE, in `types/ast.ts`, and the union is derived from the array
 * there. This module re-exports the same frozen object so callers can reach it
 * without importing the type barrel. Do not paste a second literal list here:
 * that is the drift this change exists to remove, one layer up.
 *
 *   "program"        — declares a top-level `<program>` (§40.8 entry-file shape).
 *   "pure-module"    — §21.5 pure-type / pure-fn module: no top-level markup at
 *                      all beyond §23.6 `<foreign lang>` library decls.
 *   "pure-channel"   — §38.12.6 PURE-CHANNEL-FILE: no `<program>`, and every
 *                      top-level markup node is a `<channel>` declaration.
 *   "non-entry-page" — no `<program>`, declares a top-level `<page>` (§40.8: the
 *                      route file of a multi-page app; its `<program>` lives in
 *                      the entry file).
 *   "bare-markup"    — none of the above: top-level markup with no `<program>`
 *                      wrapper and no recognized module shape. This is the shape
 *                      W-PROGRAM-001 exists to flag.
 *
 * ⛑ The list above is PROSE — what each variant MEANS. It is not a second
 * declaration of the set, and it is deliberately not one: the `@typedef` below
 * IMPORTS the union rather than restating it. An earlier revision spelled the
 * union out here as a literal, nine lines under the banner forbidding exactly
 * that, and the consequence was not cosmetic — adding a sixth member to
 * `FILE_SHAPES` would have left this union stale, so `classifyFileShape`'s
 * `@returns` and `isRecognizedNonEntryShape`'s `@param` would type-check JS
 * callers against the OLD closed set while the runtime array carried six. The
 * §1 identity test compares the runtime arrays only and would have stayed green
 * through it.
 *
 * @typedef {import("./types/ast.ts").FileShape} FileShape
 */

// The exhaustive variant list, for tests + tooling. Re-exported from the single
// definition in `types/ast.ts`; see the banner above.
//
// ⛑ Deliberately NOT carrying a `/** @type {readonly string[]} */` annotation:
// JSDoc cannot annotate an `export … from` specifier, so one here reads as a
// type contract and enforces nothing. The real type travels with the export.
export { FILE_SHAPES } from "./types/ast.ts";

/**
 * Classify a file by the shape of its TOP-LEVEL nodes.
 *
 * ⚑ ORDER IS BEHAVIOURAL, NOT COSMETIC. The branches are mutually exclusive
 * except for one real overlap — a file with BOTH a top-level `<page>` and a
 * top-level `<channel>` (the "channel+page" shape, which the flagship has). It
 * is classified `"non-entry-page"`, matching the pre-existing
 * `isNonEntryPageFile` precedence exactly, so this classification is
 * behaviour-preserving on that shape rather than quietly re-deciding it.
 *
 * @param {any[]} nodes — the FileAST's TOP-LEVEL nodes (post-`liftBareDeclarations`,
 *   so bare declarations are already wrapped in synthetic logic blocks).
 * @param {boolean} hasProgramRoot — true iff a top-level node is `<program>`.
 * @returns {FileShape}
 */
export function classifyFileShape(nodes, hasProgramRoot) {
  if (hasProgramRoot) return "program";

  const topLevel = Array.isArray(nodes) ? nodes : [];
  // An EMPTY file is not a module — it declares nothing to import. Both legacy
  // predicates carried a `nodes.length > 0` guard for exactly this, and an empty
  // file keeps warning.
  if (topLevel.length === 0) return "bare-markup";

  // Markup nodes are what decide the shape; a `<foreign lang>` library decl is a
  // DECLARATION wearing markup's clothes (§23.6) and never disqualifies a module.
  const markup = topLevel.filter(
    (n) => n && n.kind === "markup" && !isForeignLangLibDecl(n),
  );

  // ⚑ SELF-CONSISTENCY GUARD. `hasProgramRoot` is a PARAMETER, and until this
  // existed the function trusted it absolutely — never once looking at `nodes`
  // for a top-level `<program>`. Callers that pass a node list and a
  // `hasProgramRoot` read from a DIFFERENT object could therefore get
  // `"non-entry-page"` for a `<program>`-bearing file, which is not merely
  // imprecise: it is a shape this classifier is supposed to make
  // unrepresentable.
  //
  // On every CORRECTLY-paired call this branch is dead by construction — the
  // TAB derives `hasProgramRoot` as exactly `nodes.some(n => n.kind ===
  // "markup" && n.tag === "program")`, so a program node implies the early
  // return above already fired. It costs nothing on the happy path and
  // immunizes EVERY fallback call site at once, rather than hardening one
  // caller and leaving the others to carry a documented hazard.
  if (markup.some((n) => n.tag === "program")) return "program";

  // §40.8 — a route file of a multi-page app. Checked BEFORE the channel branch
  // so the channel+page overlap resolves the way it always has.
  //
  // Evaluated before the nullish gate below because the legacy
  // `isNonEntryPageFile` was `some`-shaped — `nodes.some(n => n && …)` — and so
  // was NULLISH-TOLERANT. Order relative to `pure-module` is immaterial (the two
  // are mutually exclusive: one demands a `<page>`, the other demands no markup
  // at all), so moving it up costs nothing and buys exact polarity fidelity.
  if (markup.some((n) => n.tag === "page")) return "non-entry-page";

  // ⚑ A NULLISH TOP-LEVEL NODE DISQUALIFIES THE `every`-SHAPED SHAPES. The
  // legacy `isPureModuleFile` was `nodes.every(n => n && …)`, so a nullish entry
  // made it FALSE and W-PROGRAM-001 fired. Filtering nullish entries out — which
  // is what the first version of this classifier did — silently inverted that:
  // such a file became `pure-module` and was SUPPRESSED.
  //
  // Restored deliberately, and not because the shape is reachable (it almost
  // certainly is not). A nullish top-level node means a malformed node list, and
  // this classifier's organising principle is that `"bare-markup"` is the
  // RESIDUAL so an unrecognised shape WARNS rather than going quiet. Becoming
  // more permissive on precisely the input we understand least is that principle
  // backwards. `pure-channel` inherits the same gate: it is the other
  // `every`-shaped branch, so it answers to the same rule.
  if (topLevel.some((n) => !n)) return "bare-markup";

  // §21.5 — no page-shaped markup whatsoever.
  if (markup.length === 0) return "pure-module";

  // §38.12.6 — PURE-CHANNEL-FILE. SPEC: *"A `.scrml` file that contains only
  // `export <channel>` declarations and no top-level markup other than logic
  // blocks is a pure-channel-file. The compiler SHALL recognize this pattern
  // automatically."* The `export` prefix is NOT required here: a bare file-top
  // `<channel>` in a file with no `<program>` is granted the same canonical
  // placement by the §38.1 / Insight 30 dispensation, and classifying the two
  // differently would make an `export` keyword change the file's shape.
  if (markup.every((n) => n.tag === "channel")) return "pure-channel";

  return "bare-markup";
}

/**
 * True when the file's shape is a recognized NON-ENTRY module shape — i.e. a
 * file that legitimately has no `<program>` of its own. This is precisely the
 * W-PROGRAM-001 suppression set, exposed as a named predicate so the warning's
 * fire condition reads as one positive question instead of a triple negative.
 *
 * @param {FileShape} shape
 * @returns {boolean}
 */
export function isRecognizedNonEntryShape(shape) {
  return (
    shape === "pure-module" ||
    shape === "pure-channel" ||
    shape === "non-entry-page"
  );
}

/**
 * True when the file is a §21.5 pure-fn LIBRARY file: `"pure-module"` shape AND
 * exports-bearing. The export requirement is what separates an importable
 * library from a bare declaration fragment that has nothing to import — a shape
 * distinction the classification deliberately does NOT encode, because
 * "exports-bearing" is a property of `ast.exports`, not of the node shapes.
 *
 * @param {FileShape} shape
 * @param {unknown[]} exportsList — the FileAST's `exports`
 * @returns {boolean}
 */
export function isLibraryShape(shape, exportsList) {
  return shape === "pure-module" && Array.isArray(exportsList) && exportsList.length > 0;
}
