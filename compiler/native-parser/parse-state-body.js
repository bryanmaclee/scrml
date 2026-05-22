// parse-state-body.js — JS-host shadow of parse-state-body.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors parse-state-body.scrml's header.
//
// F7.a / v0.6 BRIDGE-FULL — the native-parser analogue of the live
// pipeline's state-block payload shaping (compiler/src/ast-builder.js
// `parseTypedAttributes` ~L1992 + the `buildBlock` `case "state"` arm
// ~L11250). A pure calculation over a native Markup block that the
// markup layer has classified as a STATE opener (`TagKind.StateOpener` —
// the §4.3 `< Ident ...>` space-after-`<` signal).
//
// THE LIVE CONTRACT (the behavioral spec — ast-builder.js):
//   The live BS routes a `< Ident ...>` block to `case "state"`. There:
//     parseTypedAttributes(attrTokens) -> { attrs, typedAttrs, hasTypedDecls }
//   splits the opener's attribute tokens into
//     - attrs[]      — plain AttrNode entries (`name="v"` / `name=v` / bare),
//     - typedAttrs[] — TypedAttrDecl entries from `name(type)` decls:
//                      { name, typeExpr, optional, defaultValue, span }.
//   `hasTypedDecls` is true iff at least one `name(type)` decl appeared.
//   When hasTypedDecls is true the node kind is `state-constructor-def`
//   (§35.2 — a state TYPE declaration); otherwise it is `state` (a state
//   INSTANTIATION). `stateType` is the opener name in both cases.
//
// THE NATIVE NODE-CATALOG ADAPTATION (Phase 0 — M5-divergence-ledger):
//   The native parser does NOT have a dedicated state BlockKind — a
//   `< Ident ...>` element is a `Markup` block whose opener carries
//   `TagKind.StateOpener` (tag-frame.js `tagKindFor`: a space after the
//   `<` returns StateOpener — the same `openerHadSpaceAfterLt` signal the
//   live BS keys `case "state"` off). F1's `tokenizeAttributeRegion`
//   already emits `ATTR_TYPED_DECL` tokens (JSON `{name, typeExpr}`) for
//   `name(type)` decls in a state opener, AND plain `ATTR_NAME`/`ATTR_EQ`/
//   value tokens for ordinary attributes. F7.a is the SHAPING pass: it
//   reads `block.tokenizedAttrs` (the raw ATTR_* stream F1 produced) and
//   `block.attrs` (the F1 AttrNode[] — already excludes the typed decls,
//   since `tokenizeAttributeRegion` pushes a typed decl ONLY to `tokens`,
//   not to `attrs`) and stamps the state payload onto the Markup block:
//     block.stateNodeKind — "state" | "state-constructor-def"
//     block.stateType     — the opener name
//     block.typedAttrs    — TypedAttrDecl[] (empty for a plain `state`)
//   `block.attrs` is left as the F1 AttrNode[] (the live `state` /
//   `state-constructor-def` node's `attrs` field is exactly that — the
//   non-typed attrs). No native<->live translation layer: the stamped
//   fields ARE the live FileAST `StateNode` / `StateConstructorDefNode`
//   payload shape.
//
// The `name(type)` typeExpr split — `?` optional marker + `= default` —
// mirrors `parseTypedAttributes` byte-for-byte (live: an `=` in the
// typeExpr peels the default; a trailing `?` peels the optional marker; a
// default value implies optional).

// =============================================================================
// shapeStateBlock — calculation (pure-ish: mutates the passed Markup block
// in place, the same way emitMarkupElement stamps `.attrs`). Given a Markup
// block whose opener TagKind is StateOpener, derive + stamp the state
// payload. A non-state Markup block (or a missing block) is left untouched.
//
// The stamped fields:
//   block.stateNodeKind — "state-constructor-def" when any `name(type)`
//                          typed decl appeared, else "state".
//   block.stateType     — block.name (the opener name).
//   block.typedAttrs    — TypedAttrDecl[] (empty for a plain `state`).
// =============================================================================
export function shapeStateBlock(block) {
    if (block === undefined || block === null) return block;
    if (block.kind !== "Markup") return block;

    const tokens = Array.isArray(block.tokenizedAttrs) ? block.tokenizedAttrs : [];
    const typedAttrs = parseTypedAttrTokens(tokens);

    block.stateType = typeof block.name === "string" ? block.name : "";
    block.typedAttrs = typedAttrs;
    // §35.2 — a state opener carrying typed `name(type)` decls is a state
    // TYPE declaration (state-constructor-def); otherwise it is a state
    // INSTANTIATION (state).
    block.stateNodeKind = typedAttrs.length > 0 ? "state-constructor-def" : "state";
    return block;
}

// =============================================================================
// STATE_FORM_KEYWORDS — the built-in scrml lifecycle keywords whose `<name>`
// element the live builder routes to a `state` ASTNode REGARDLESS of the
// space-after-`<` opener form. This is the native analogue of the live
// builder's `_STATE_FORM_LIFECYCLE` name-set (ast-builder.js ~L10478):
// `buildBlock` rewrites a `markup`-classified block named one of these to
// `type: "state"` (uniform-opener normalization). The live set is
// `{db, schema, engine, machine}` — `engine`/`machine` are EXCLUDED here
// because the native parser routes them to `engine-decl` via `isEngineBlock`
// (collect-hoisted.js); only `db` / `schema` synthesize a `state` node.
//
// WHY THIS EXISTS: the §4.3 `TagKind.StateOpener` signal fires only on the
// space-after-`<` form (`< db ...>`). The corpus overwhelmingly writes the
// no-space form (`<db ...>`) — which `tagKindFor` classifies `Html`. The
// live builder's name-set normalization catches BOTH forms; the native
// recognition must too, or a `<db>` nested inside a `<program>` body stays
// a `markup` node while the live pipeline produces `state` (the M5
// `DIFF-deep-seq` nested-`<state>` divergence class).
// =============================================================================
export const STATE_FORM_KEYWORDS = Object.freeze(["db", "schema"]);

// =============================================================================
// ENGINE_FORM_KEYWORDS — the built-in scrml lifecycle keywords whose `<name>`
// element the native parser routes to an `engine-decl` ASTNode (via
// `collect-hoisted.js` `isEngineBlock` + `synthEngineDecl`), NOT to a `state`
// node. The live builder's `_STATE_FORM_LIFECYCLE` set DOES include
// `engine`/`machine` — but only because the live `buildBlock` routes a
// `state`-classified `engine`/`machine` block through `case "state"` and then
// into engine-specific handling. The native parser has a DEDICATED
// `isEngineBlock` branch in `parse-file.js` `mapOneBlock`, so `isStateBlock`
// MUST NOT claim an `engine`/`machine` opener — otherwise the `isStateBlock`
// check (which `mapOneBlock` evaluates BEFORE `isEngineBlock`) swallows the
// engine and `synthStateNode` produces a spurious `state` node where the live
// pipeline produces `engine-decl` (the M5 `DIFF-deep-seq` D-misc `engine`-vs-
// `state` over-match — `< engine name=...>` space-form openers carry
// `TagKind.StateOpener` and were caught by the StateOpener recognition path).
// =============================================================================
export const ENGINE_FORM_KEYWORDS = Object.freeze(["engine", "machine"]);

// =============================================================================
// isStateBlock — calculation (pure predicate). True iff `block` is a Markup
// block that synthesizes a live `state` / `state-constructor-def` ASTNode.
// Two recognition paths, both depth-agnostic (a nested `<db>` inside a
// `<program>` body is recognized identically to a top-level one):
//   1. TagKind.StateOpener — the §4.3 `< Ident ...>` space-after-`<` signal.
//      The markup layer stamps `block.tagKind` from the opener's TagKind.
//   2. A built-in state-form lifecycle keyword (`db` / `schema`) — the
//      no-space `<db ...>` form. The live builder's `_STATE_FORM_LIFECYCLE`
//      name-set normalization (ast-builder.js `buildBlock`) routes these to
//      a `state` node regardless of opener form; `STATE_FORM_KEYWORDS`
//      mirrors that.
// ENGINE EXCLUSION (M5 P4-1): an `engine`/`machine`-named block is NEVER a
// state block on EITHER path — it routes to `engine-decl` via `isEngineBlock`.
// The space-form `< engine ...>` opener carries `TagKind.StateOpener`, so the
// StateOpener path (1) would otherwise over-match it; the exclusion is checked
// FIRST, before either recognition path, so both the space-form and the
// no-space `<engine>` form defer to the dedicated engine branch.
// This is the read-side discriminator the M5 swap keys state-vs-markup
// routing off.
// =============================================================================
export function isStateBlock(block) {
    if (block === undefined || block === null) return false;
    if (block.kind !== "Markup") return false;
    // Engine/machine openers are an engine-decl, not a state node — exclude
    // them on BOTH recognition paths (the space-form `< engine>` carries
    // TagKind.StateOpener and would otherwise be claimed by path 1 below).
    if (ENGINE_FORM_KEYWORDS.includes(block.name)) return false;
    if (block.tagKind === "StateOpener") return true;
    return STATE_FORM_KEYWORDS.includes(block.name);
}

// =============================================================================
// parseTypedAttrTokens — calculation (pure). Scan an ATTR_* token stream
// for `ATTR_TYPED_DECL` tokens and produce the TypedAttrDecl[] the live
// `parseTypedAttributes` produces. Each ATTR_TYPED_DECL token's `.text` is
// the JSON `{ name, typeExpr }` F1's `tokenizeAttributeRegion` emitted; this
// peels the `= default` and trailing `?` exactly as the live builder does.
//
// A TypedAttrDecl: { name, typeExpr, optional, defaultValue, span }.
//   - defaultValue — the text after `=` in the typeExpr, or null.
//   - optional     — true if the typeExpr ends with `?` OR a default is set.
//
// EMPTY-PAREN DISCRIMINATION (M5 P5-8 — `gauntlet-r10-bun-admin` T-state).
//   A `name(type)` typed-attr declaration ALWAYS carries a non-empty type
//   expression — the `type` between the parens is the whole point of the
//   typed-decl form. An empty-paren `name()` is unambiguously a CALL
//   expression, NOT a typed-attr decl. The native F1 tokenizer
//   (`tag-frame.js` `tokenizeAttributeRegion`) emits an `ATTR_TYPED_DECL`
//   for ANY `name(...)` shape inside a state opener — including the
//   empty-paren `name()` call form. When the markup layer over-scans an
//   opener's attribute region (a `< p.foo).length` mis-segmentation grabbing
//   a `${}` body full of `.run()` / `.all()` / `.get()` calls), those stray
//   `name()` call tokens would otherwise flip a plain `state` instantiation
//   to a phantom `state-constructor-def`. A typed decl with an empty type
//   expression is not a typed decl — it is dropped here so `stateNodeKind`
//   discrimination (`shapeStateBlock`) stays correct under attr over-scan.
//   This matches the live FileAST: an over-scanned state opener stays a
//   plain `state` node (live `typedAttrs` undefined / empty).
// =============================================================================
export function parseTypedAttrTokens(tokens) {
    const typedAttrs = [];
    if (tokens === undefined || tokens === null || Array.isArray(tokens) === false) {
        return typedAttrs;
    }
    for (const tok of tokens) {
        if (tok === undefined || tok === null) continue;
        if (tok.kind !== "ATTR_TYPED_DECL") continue;

        let parsed;
        try {
            parsed = JSON.parse(typeof tok.text === "string" ? tok.text : "{}");
        } catch (_e) {
            parsed = { name: "?", typeExpr: "" };
        }
        const name = typeof parsed.name === "string" ? parsed.name : "?";
        const rawTypeExpr = typeof parsed.typeExpr === "string" ? parsed.typeExpr : "";

        const decl = splitTypedAttr(name, rawTypeExpr, tok.span ?? null);
        // An empty-paren `name()` is a call expression, not a `name(type)`
        // typed-attr declaration — skip it so it cannot flip `stateNodeKind`.
        if (decl.typeExpr === "" && decl.defaultValue === null) continue;
        typedAttrs.push(decl);
    }
    return typedAttrs;
}

// =============================================================================
// splitTypedAttr — calculation (pure). Split a raw `name(type)` typeExpr
// into the TypedAttrDecl shape. Mirrors the live `parseTypedAttributes`
// inner block:
//   1. trim the typeExpr;
//   2. an `=` peels the default value (text after the FIRST `=`);
//   3. a trailing `?` peels the optional marker;
//   4. a default value implies `optional`.
// =============================================================================
export function splitTypedAttr(name, rawTypeExpr, span) {
    let typeExpr = (typeof rawTypeExpr === "string" ? rawTypeExpr : "").trim();
    let defaultValue = null;

    const eqIdx = typeExpr.indexOf("=");
    if (eqIdx !== -1) {
        defaultValue = typeExpr.slice(eqIdx + 1).trim();
        typeExpr = typeExpr.slice(0, eqIdx).trim();
    }

    let optional = false;
    if (typeExpr.endsWith("?")) {
        optional = true;
        typeExpr = typeExpr.slice(0, -1).trim();
    }
    // A default value implies optional (live parity).
    if (defaultValue !== null) {
        optional = true;
    }

    return { name, typeExpr, optional, defaultValue, span };
}
