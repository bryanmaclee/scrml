// collect-hoisted.js — JS-host shadow of collect-hoisted.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors collect-hoisted.scrml's header.
//
// F3 / Cluster B — the native-parser analogue of the live pipeline's
// `collectHoisted` (compiler/src/ast-builder.js ~L11903) + the
// `hasProgramRoot` computation (~L11963). A pure fold over the native
// parser's block-stream producing the file-level surface the downstream
// compiler stages consume.
//
// THE LIVE CONTRACT (the behavioral spec — ast-builder.js):
//   collectHoisted(nodes) -> { imports, exports, typeDecls, components,
//                              machineDecls, channelDecls }
//   The live walk visits each AST node:
//     - `logic`       — spreads its pre-filtered imports/exports/typeDecls/
//                       components arrays in;
//     - `engine-decl` — pushes to machineDecls; recurses `bodyChildren` to
//                       discover NESTED engines;
//     - `markup`/`state` — recurses `children`;
//     - `markup` tag "channel" — pushes to channelDecls;
//     - `meta`        — walks `body` for import/export/type/component-def
//                       (and recurses `function-decl` bodies).
//   hasProgramRoot is computed by the caller: true iff a top-level `markup`
//   node has tag "program".
//
// THE NATIVE NODE-CATALOG ADAPTATION. The native parser's per-file output is
// a flat `Block[]` (parse-markup.js's `parseMarkup`). Each Block is
// `{ kind, span, commentForm, ...payload }`:
//   - "Markup"      — { name, children:Block[], closerForm, tagClass,
//                       tagKind, attrs:AttrNode[], span }
//   - "LogicEscape" — { bodyText, body:Stmt[], span }   (body = parseProgram)
//   - "Meta"        — { bodyText, body:Stmt[], span }   (F8 — parsed body)
//   Stmt nodes (ast-stmt.js) carry kind "Import" / "Export" / "TypeDecl" /
//   "VarDecl" / "FunctionDecl" / "Block".
//
// A3 (v0.7 M5-swap) — declaration/hoist SYNTHESIS. The native parser models
// engines as plain `Markup` blocks, components as `const Upper = <markup>`
// VarDecls, and (since B5) `type` decls as `TypeDecl` Stmts. A3 SYNTHESIZES
// the live FileAST declaration node shapes from those native shapes:
//   - machineDecls — a `Markup` block named "engine" / "machine" -> a
//     14-field `EngineDeclNode` (engineName/governedType/rulesRaw/
//     bodyChildren/sourceVar/varName/varNameOverride/initialVariant/pinned/
//     isExported/openerHadSpaceAfterLt/legacyMachineKeyword/id/span).
//     Nested engines in composite state-children are discovered by recursing
//     `children`.
//   - components — a `VarDecl{declKind:"const"}` with an UPPERCASE-initial
//     target name and a `MarkupValue` init -> a `ComponentDefNode`.
//   - typeDecls — a native `StmtKind.TypeDecl` Stmt -> a `TypeDeclNode`. An
//     `export type` is an `Export` Stmt whose `declaration` is a `TypeDecl`:
//     the live pipeline pushes BOTH a type-decl AND an export-decl
//     (ast-builder.js:7297), so A3 mirrors that — the exported type lands in
//     `typeDecls` (synthesized, `fromExport:true`) AND `exports`.
//
// Synthesized declaration nodes extend the live `BaseNode` (`id` + `span`).
// `id` is allocated from an optional `idGen` counter (`{ next }`) threaded in
// by the caller — the same discipline `translate-stmt.js` follows so the
// whole native->live FileAST shares one id space. When `idGen` is omitted a
// fresh local counter is used (test-harness convenience).

import { StmtKind } from "./ast-stmt.js";

// =============================================================================
// collectHoisted — calculation (pure). One fold over the block-stream,
// producing all seven outputs (Cluster B — one walk, all outputs).
//
// `blocks` is the `Block[]` from parse-markup.js's `parseMarkup`. Defensive:
// a missing / non-array `blocks` folds to the empty surface.
//
// `idGen` is an optional id allocator `{ next }`. Synthesized declaration
// nodes (EngineDeclNode / ComponentDefNode / TypeDeclNode) need a numeric
// `id` (live BaseNode). The counter is THREADED IN so the calculation stays
// pure (the counter is an argument, not module state) — mirrors
// translate-stmt.js's `idGen`.
//
// `source` is the optional full source buffer. A synthesized engine's
// `rulesRaw` (the raw body text between the engine opener `>` and the closer
// `</>`) is sliced out of `source` via the body's child spans. The native
// `Markup`/`Text` blocks carry SPANS but NOT a source-text payload (only the
// LogicEscape/Meta/Sql/Css blocks carry `bodyText`), so `rulesRaw` can only
// be sourced when the caller passes `source`. When `source` is omitted,
// `rulesRaw` resolves to "" — surfaced as a documented partial (the C1
// `nativeParseFile` caller has the source and threads it through).
//
// Returns { imports, exports, typeDecls, components, machineDecls,
//           channelDecls, hasProgramRoot }.
// =============================================================================
export function collectHoisted(blocks, idGen, source) {
    const imports = [];
    const exports = [];
    const typeDecls = [];
    const components = [];
    const machineDecls = [];
    const channelDecls = [];

    if (blocks === undefined || blocks === null || Array.isArray(blocks) === false) {
        return {
            imports, exports, typeDecls, components,
            machineDecls, channelDecls, hasProgramRoot: false,
        };
    }

    // The id allocator. A synthesized declaration node carries a live
    // BaseNode `id`; `stampId` is `++counter.next` (ast-builder discipline).
    const counter = (idGen !== undefined && idGen !== null) ? idGen : { next: 0 };
    function stampId() {
        counter.next = counter.next + 1;
        return counter.next;
    }

    // hasProgramRoot — TOP-LEVEL only (the live check is `nodes.some(...)`
    // over the top-level node list, NOT a recursive search). Computed in the
    // same pass per Cluster B; the top-level scan happens here so it is not
    // contaminated by a nested `<program>` deeper in the tree.
    let programRoot = false;

    // walkBlocks — recurse the block-stream. Markup blocks recurse their
    // `children` (the nested element tree); LogicEscape + Meta blocks have
    // their parsed `body` Stmt[] scanned for the declaration kinds.
    function walkBlocks(blockList) {
        for (const block of blockList) {
            if (block === undefined || block === null) continue;

            if (block.kind === "Markup") {
                // live: `markup` tag "channel" -> channelDecls.
                if (block.name === "channel") {
                    channelDecls.push(block);
                }
                // A3 — live: `engine-decl` -> machineDecls. The native parser
                // models an engine as a `Markup` block named "engine" (or the
                // legacy "machine"). SYNTHESIZE the EngineDeclNode and push it.
                if (block.name === "engine" || block.name === "machine") {
                    machineDecls.push(synthEngineDecl(block, stampId, source));
                }
                // live: `markup`/`state` -> recurse `children`. The recursion
                // ALSO discovers NESTED engines inside composite state-children
                // (the live walker recurses `bodyChildren` — see ast-builder.js
                // L11936-11940; the native engine's `children` IS that body).
                if (Array.isArray(block.children)) {
                    walkBlocks(block.children);
                }
            } else if (block.kind === "LogicEscape") {
                // live: a `logic` node hands pre-filtered imports/exports/
                // typeDecls/components. The native LogicEscape carries the RAW
                // parsed Stmt[] body; the walker filters it. `topLevel` true —
                // the LogicEscape body is the direct statement list.
                if (Array.isArray(block.body)) {
                    walkStmts(block.body, block.bodyText, block.span, true);
                }
            } else if (block.kind === "Meta") {
                // F8 (S115) — Meta blocks now carry a parsed `body` Stmt[].
                // live `walkBodyNodes` walks `meta.body` for import/export/
                // type/component-def. The native Meta body is the same Stmt[]
                // shape as a LogicEscape body — scan it the same way.
                // `topLevel` true — the Meta body is the direct statement list.
                if (Array.isArray(block.body)) {
                    walkStmts(block.body, block.bodyText, block.span, true);
                }
            }
            // "Sql" / "Css" / "ErrorEffect" / "Test" / "ForeignCode" / "Text"
            // / "DisplayTextLiteral" / "Comment" blocks carry no hoistable
            // declarations.
        }
    }

    // walkStmts — scan a Stmt[] for the hoistable declaration kinds. Recurses
    // FunctionDecl + Block bodies for the structural-reach kinds, but NOT for
    // `Import` collection (see the `topLevel` gate below).
    //
    //   blockText / blockSpan — the enclosing LogicEscape/Meta `bodyText` +
    //   `span`, threaded through so a synthesized `component-def.raw` can be
    //   sliced out of the source (the native VarDecl carries spans but not a
    //   raw string).
    //   topLevel — true only for the DIRECT statement list of a LogicEscape /
    //   Meta body; false for any nested FunctionDecl / Block recursion.
    //
    // IMPORT HOISTING — TOP-LEVEL ONLY (the live-pipeline contract). The live
    // `logic` node hoists imports via a FLAT top-level filter over its body
    // (`body.filter(n => n.kind === "import-decl")`, ast-builder.js:11344) —
    // it does NOT recurse FunctionDecl bodies. An `import` inside a function
    // body is illegal placement (E-IMPORT-003); the live parser never emits an
    // `import-decl` node there, so the live `walkBodyNodes` recursion never
    // finds one to hoist. The native parser DOES emit a `StmtKind.Import` Stmt
    // inside a FunctionDecl body, so `walkStmts` must NOT hoist an `Import`
    // discovered by the FunctionDecl / Block recursion — only a `topLevel`
    // import lands in `FileAST.imports`.
    function walkStmts(stmtList, blockText, blockSpan, topLevel) {
        for (const stmt of stmtList) {
            if (stmt === undefined || stmt === null) continue;

            if (stmt.kind === StmtKind.Import) {
                // Top-level only — a nested import (inside a FunctionDecl /
                // Block) is illegal placement and is not hoisted.
                if (topLevel !== true) continue;
                // Skip a DEGENERATE import — one with no module `source`. The
                // native parser models a dynamic `import(...)` expression
                // (e.g. `const { x } = await import("path")`) as a parse-error
                // recovery `StmtKind.Import` with empty `specifiers` AND an
                // empty `source`: `import` is consumed as a statement lead,
                // then `expectFromKeyword` / `expectModuleString` both fail
                // (parse-stmt.js:2050-2051). A dynamic-import EXPRESSION is not
                // a static module import — the live pipeline (Acorn) parses it
                // as an `ImportExpression` and never hoists it. A real static
                // import — named, default, namespace, OR bare side-effect
                // (`import "m"`) — always carries a non-empty `source`.
                if (typeof stmt.source !== "string" || stmt.source.length === 0) {
                    continue;
                }
                // M6.4a — synthesize the live `import-decl` shape so cross-
                // file consumers (module-resolver.js L155 + name-resolver.ts
                // L416 + api.js L1458 + component-expander.ts L3160) can
                // read `imp.names` directly. The native `Import` Stmt
                // carries `specifiers[]` only; many host consumers (notably
                // name-resolver and api.js's TS-pass) iterate `imp.names`
                // which is empty on the native shape — silently dropping
                // every cross-file user-component / type binding from NR
                // (the surface bug: `<X1Badge/>` use-site stays unresolved
                // post-CE, firing VP-2 E-COMPONENT-035 in the cross-file
                // Form-1 case once the EXPORT side resolves via
                // synthExportDecl above).
                //
                // The live `ImportDeclNode` (ast.ts:1184) carries BOTH
                // `names` (legacy parallel array) and `specifiers` (modern
                // structured form) — populate both so every consumer path
                // works regardless of which shape it reads.
                imports.push(synthImportDecl(stmt, stampId));
            } else if (stmt.kind === StmtKind.Export) {
                // M6.4a — synthesize the live `export-decl` shape so cross-
                // file consumers (module-resolver.js L195-235 + api.js L1018-
                // L1038) can read `exportedName` + `exportKind` directly. The
                // pre-M6.4a native push pushed the raw `Export` Stmt
                // (`{ kind: "Export", declaration, specifiers, source, ... }`)
                // — module-resolver's `if (exp.exportedName)` gate silently
                // dropped every native-pipeline cross-file export because
                // `exportedName` is not a field on the native shape.
                //
                // Translation mirrors `makeExportDecl` (translate-stmt.js
                // L1101) — the live ExportDeclNode (ast.ts:1216) shape with
                // the behaviour fields MOD reads (`exportedName`, `exportKind`,
                // `reExportSource`, `raw`). `raw` is sourced from the
                // enclosing LogicEscape/Meta `bodyText` so cross-file CE
                // (component-expander.ts L2957-2978 "path b") can strip the
                // `export const NAME =` prefix and recover the component
                // markup body — this is the LIVE oracle's path-b shape that
                // mirrors how the desugared Form 1 / Form 2 reaches CE.
                exports.push(synthExportDecl(stmt, stampId, blockText, blockSpan));
                // A3 — `export type Name : kind = {...}` is an Export Stmt
                // whose `declaration` is a TypeDecl. The live pipeline pushes
                // BOTH a type-decl AND the export-decl (ast-builder.js:7297 —
                // "when exporting a type, ALSO synthesize a type-decl AST
                // node"). Mirror that: the exported type lands in `typeDecls`
                // too, marked `fromExport`.
                if (stmt.declaration !== undefined && stmt.declaration !== null
                    && stmt.declaration.kind === StmtKind.TypeDecl) {
                    typeDecls.push(synthTypeDecl(stmt.declaration, stampId, true));
                }
            } else if (stmt.kind === StmtKind.TypeDecl) {
                // A3 — B5's native `type` production yields a TypeDecl Stmt;
                // SYNTHESIZE the live TypeDeclNode.
                typeDecls.push(synthTypeDecl(stmt, stampId, false));
            } else if (stmt.kind === StmtKind.VarDecl) {
                // A3 — a `const Upper = <markup>` declaration is a component
                // definition. The live ast-builder recognizes a `const`
                // declaration whose name starts uppercase, with a markup
                // initializer (component-def.raw is the template). Scan each
                // declarator.
                collectComponentDefs(stmt, blockText, blockSpan, stampId);
            } else if (stmt.kind === StmtKind.FunctionDecl) {
                // live walkBodyNodes recurses `function-decl` bodies for the
                // structural-reach kinds — but NOT for imports (`topLevel`
                // false: a nested import is illegal placement, not hoisted).
                if (Array.isArray(stmt.body)) {
                    walkStmts(stmt.body, blockText, blockSpan, false);
                }
            } else if (stmt.kind === StmtKind.Block) {
                if (Array.isArray(stmt.body)) {
                    walkStmts(stmt.body, blockText, blockSpan, false);
                }
            }
        }
    }

    // collectComponentDefs — scan a VarDecl's declarators for component
    // definitions. A component is a `const`-kind declaration whose target is
    // a plain identifier with an UPPERCASE initial char, initialized to a
    // `MarkupValue` expression. A lowercase-initial `const` is an ordinary
    // variable — NOT a component (live ast-builder gate).
    function collectComponentDefs(varDecl, blockText, blockSpan, stamp) {
        // Only `const` declarations are component definitions.
        if (varDecl.declKind !== "const") return;
        if (Array.isArray(varDecl.declarations) === false) return;

        for (const declarator of varDecl.declarations) {
            if (declarator === undefined || declarator === null) continue;
            const target = declarator.target;
            const init = declarator.init;
            // Target must be a plain identifier binding.
            if (target === undefined || target === null) continue;
            if (target.bindingKind !== "Ident") continue;
            const name = target.name;
            if (typeof name !== "string" || name.length === 0) continue;
            // UPPERCASE-initial gate — a lowercase const is not a component.
            if (isUpperInitial(name) === false) continue;
            // The initializer must be a markup-as-value expression.
            if (init === undefined || init === null) continue;
            if (init.kind !== "MarkupValue") continue;

            components.push(synthComponentDef(name, init, blockText, blockSpan, stamp));
        }
    }

    // The top-level scan — drives hasProgramRoot off the top-level blocks
    // ONLY, then recurses every block for the deeper collections.
    for (const block of blocks) {
        if (block === undefined || block === null) continue;
        if (block.kind === "Markup" && block.name === "program") {
            programRoot = true;
        }
    }
    walkBlocks(blocks);

    return {
        imports, exports, typeDecls, components,
        machineDecls, channelDecls, hasProgramRoot: programRoot,
    };
}

// =============================================================================
// synthEngineDecl — calculation (pure). SYNTHESIZE a live `EngineDeclNode`
// (ast.ts:878 — the 14-field shape) from a native `Markup` block named
// "engine" / "machine". The native parser models an engine as a plain Markup
// block; this builds the consumer-expected declaration node.
//
// Field derivation (the live ast-builder contract — ast-builder.js
// L10920-11146):
//   governedType        — the `for=` attribute value.
//   varName / varNameOverride — §51.0.C resolution order:
//                           1. `var=NAME` override -> NAME (also varNameOverride)
//                           2. `name=NAME` legacy form -> NAME
//                           3. auto-derive from `for=Type` (lowercase-first-char)
//   engineName          — mirrors varName (legacy-consumer back-compat).
//   sourceVar           — §51.9 — the `derived=@x` source reactive var name
//                           (no `@` prefix), or null.
//   initialVariant      — §51.0.E — the `initial=.X` variant (the `.`-stripped
//                           variant name), or null.
//   pinned              — §51.0.B — true iff the `pinned` bareword is present.
//   rulesRaw            — the engine body — the raw source slice spanning the
//                           body's child blocks (the live `rulesRaw`
//                           substring). Sourced only when `source` is passed;
//                           "" otherwise (the native Markup/Text blocks carry
//                           spans but no source-text payload).
//   bodyChildren        — the native `children` block array (walkable body —
//                           collectHoisted's nested-engine recursion + future
//                           body-render codegen consume it).
//   legacyMachineKeyword — true iff the block was authored with `<machine>`.
//   openerHadSpaceAfterLt — true iff the opener was `< engine` (space after
//                           `<`). The native tagKind discriminates: a
//                           space-after-`<` opener gets TagKind.StateOpener.
//   isExported          — false here; the live pipeline sets it later
//                           (export Form 1 detection in liftBareDeclarations).
//
// NATIVE-PARSER GAP (documented, not papered over): the `initial=.X` form
// where `.X` is UNQUOTED does not tokenize as one attribute value — the
// native attribute tokenizer's unquoted-value-start gate excludes `.`. The
// `initial` attribute resolves to an `absent` value and the variant name
// appears as a SEPARATE bare attribute immediately after it. `readInitial`
// recovers BOTH forms: the quoted `initial=".X"` (a clean string-literal
// value) AND the unquoted `initial=.X` (the absent-valued `initial` followed
// by the bare variant attr). A native attr-tokenizer fix for unquoted dotted
// values is the proper close — surfaced as a deferred item.
// =============================================================================
// isEngineBlock — calculation (predicate). True iff `block` is a native
// `Markup` block the native parser models an engine declaration as: a
// `<engine ...>` element (or the legacy `<machine ...>` keyword). This is
// the read-side discriminator A3's `collectHoisted` keys the
// engine-vs-markup routing off — exported so `parse-file.js`'s
// `mapOneBlock` can route an engine block to `synthEngineDecl` (and emit a
// live-parity `engine-decl` ASTNode into `FileAST.nodes`) instead of a
// plain `markup` node, the same way `isStateBlock` routes a state block.
export function isEngineBlock(block) {
    if (block === undefined || block === null) return false;
    if (block.kind !== "Markup") return false;
    return block.name === "engine" || block.name === "machine";
}

export function synthEngineDecl(block, stamp, source) {
    const attrs = Array.isArray(block.attrs) ? block.attrs : [];

    const governedType = readAttrName(attrs, "for");
    const varOverride = readAttrName(attrs, "var");
    const legacyName = readAttrName(attrs, "name");
    const sourceVar = readSourceVar(attrs);
    const initialVariant = readInitial(attrs);
    const pinned = hasBareAttr(attrs, "pinned");

    // §51.0.C — resolve varName.
    let varName = "";
    let varNameOverride = null;
    if (varOverride !== null) {
        varName = varOverride;
        varNameOverride = varOverride;
    } else if (legacyName !== null) {
        // Legacy `name=` IS the variable name.
        varName = legacyName;
    } else if (governedType !== null && governedType.length > 0) {
        // §51.0.C literal rule — lowercase the first character only.
        varName = governedType.charAt(0).toLowerCase() + governedType.slice(1);
    }

    const engineName = varName;

    // rulesRaw — the raw source slice spanning the engine body's child blocks
    // (the live `rulesRaw` body substring). The native Markup/Text blocks
    // carry spans but no source-text payload, so this is sliced out of
    // `source` via the first-child-start..last-child-end span. "" when
    // `source` is omitted (a documented partial — see the header).
    const rulesRaw = collectRulesRaw(block.children, source);

    // bodyChildren — the native `children` block array, the walkable engine
    // body. collectHoisted's nested-engine recursion already walked it; it is
    // preserved on the node for downstream body-render codegen.
    const bodyChildren = Array.isArray(block.children) ? block.children : [];

    return {
        id: stamp(),
        kind: "engine-decl",
        engineName,
        governedType: governedType !== null ? governedType : "",
        rulesRaw,
        bodyChildren,
        sourceVar,
        varName,
        varNameOverride,
        initialVariant,
        pinned,
        isExported: false,
        // A `< engine` opener (space after `<`) is classified TagKind
        // StateOpener by the native opener scanner; `<engine` is ScrmlStructural.
        openerHadSpaceAfterLt: block.tagKind === "StateOpener",
        legacyMachineKeyword: block.name === "machine",
        span: block.span,
        // M6.6.b.2 — native-walker bridge. Stamp the source native engine
        // Markup block + the full file source so symbol-table's PASS 11
        // can walk the engine state-children via the native block stream
        // (compiler/src/native-walker/engine-statechild-walker.ts) instead
        // of re-tokenizing rulesRaw through engine-statechild-parser.ts.
        //
        // Underscore-prefixed (consumer-private). The fields are populated
        // ONLY on the native pipeline; the live pipeline's engineDecl never
        // carries them. Symbol-table uses presence as the discriminator:
        // when present, walk natively; when absent, fall back to the legacy
        // text re-tokenizer. Additive — no FileAST contract change.
        _nativeEngineBlock: block,
        _source: typeof source === "string" ? source : "",
    };
}

// synthImportDecl — calculation (pure). SYNTHESIZE a live `ImportDeclNode`
// (ast.ts:1184 — `{ kind:"import-decl", raw, names, specifiers, source,
// isDefault }` + BaseNode) from a native `StmtKind.Import` Stmt. Mirrors
// `makeImportDecl` (translate-stmt.js L1015). The native Stmt carries
// `specifiers[]` (`{specifierKind, imported, local, ...}`) + `source` + an
// optional `isDefault`. The live shape carries BOTH:
//   - `names`        — legacy parallel string[] of imported names (the
//                      ast-builder.js parses `import {a, b}` and pushes
//                      ["a","b"]; consumers like name-resolver.ts L416 +
//                      api.js L1458 iterate this array — empty on the
//                      native shape silently drops cross-file bindings).
//   - `specifiers[]` — modern `{imported, local, pinned}[]` (component-
//                      expander.ts + symbol-table.ts L1030 read this form).
// Default imports populate `names[0]` only; named imports populate both.
// Namespace imports (`import * as N from`) ride as a single ImportNamespace
// specifier whose `local` is the namespace alias.
function synthImportDecl(stmt, stamp) {
    const specs = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];
    const isDefault = stmt.isDefault === true;
    const names = [];
    const liveSpecifiers = [];
    for (const spec of specs) {
        if (spec === undefined || spec === null) continue;
        // The live ast-builder's `names` array pushes the LOCAL name (the
        // binding the consumer sees in scope). For a non-renamed import
        // (`import { Foo }`), local === imported === "Foo"; for a renamed
        // import (`import { Foo as Bar }`), local === "Bar". Mirror the
        // ast-builder pattern: push `local` to `names` when present.
        const localName = typeof spec.local === "string" ? spec.local
            : (typeof spec.imported === "string" ? spec.imported : null);
        const importedName = typeof spec.imported === "string" ? spec.imported
            : (typeof spec.local === "string" ? spec.local : null);
        if (localName !== null) {
            names.push(localName);
        }
        if (importedName !== null) {
            liveSpecifiers.push({
                imported: importedName,
                local: localName !== null ? localName : importedName,
                pinned: spec.pinned === true,
            });
        }
    }
    return {
        id: stamp(),
        kind: "import-decl",
        raw: "",
        names,
        specifiers: liveSpecifiers,
        source: typeof stmt.source === "string" ? stmt.source : null,
        isDefault,
        span: stmt.span,
    };
}

// synthExportDecl — calculation (pure). SYNTHESIZE a live `ExportDeclNode`
// (ast.ts:1216 — `{ kind:"export-decl", raw, exportedName, exportKind,
// reExportSource, ...isPure/isServer/isAsync }` + BaseNode) from a native
// `StmtKind.Export` Stmt. Mirrors `makeExportDecl` (translate-stmt.js L1101)
// — the same shape, derived from the same three native shapes:
//   - `export <declaration>` — exportedName/exportKind from declaration
//   - `export { ... } from '...'` — re-export (specifiers + source)
//   - `export { ... }` — bare specifiers (no source)
// Cross-file consumers (module-resolver.js L195-235 + api.js L1018-L1038)
// read `exportedName` + `exportKind`; without translation they silently drop
// every native-pipeline export.
//
// `blockText` + `blockSpan` (optional) — the enclosing LogicEscape/Meta
// `bodyText` + `span`, threaded through by `walkStmts`. When present, the
// `raw` field is sliced from `blockText` so cross-file CE (component-
// expander.ts L2957-2978 "path b") can strip the `export const NAME =`
// prefix to recover the component-def markup body — the LIVE oracle's path-b
// shape. When absent (a non-Block-bound caller), `raw` is "".
//
// M6.4a — added so the P2-Form1 desugar's `export const Name = <markup>`
// reaches MOD's exportRegistry with isComponent semantics AND CE's path-b
// raw-stripping can recover the markup body. Without this, the cross-file
// Form-1 fix's synthesized export-decl never registered, and `<X1Badge/>`
// use-sites raised E-COMPONENT-035 in CE.
function synthExportDecl(stmt, stamp, blockText, blockSpan) {
    let exportedName = null;
    let exportKind = null;
    const reExportSource = (stmt.source === undefined || stmt.source === null)
        ? null : stmt.source;

    if (stmt.declaration !== undefined && stmt.declaration !== null) {
        const d = stmt.declaration;
        if (d.kind === StmtKind.FunctionDecl) {
            exportKind = (d.fnKind === "fn") ? "fn" : "function";
            exportedName = (d.name === undefined || d.name === null) ? null : d.name;
        } else if (d.kind === StmtKind.ClassDecl) {
            exportKind = "const";
            exportedName = (d.name === undefined || d.name === null) ? null : d.name;
        } else if (d.kind === StmtKind.VarDecl) {
            exportKind = (d.declKind === "const") ? "const" : "let";
            const decls = Array.isArray(d.declarations) ? d.declarations : [];
            if (decls.length > 0) {
                const tgt = decls[0].target;
                if (tgt !== undefined && tgt !== null) {
                    // Plain identifier binding — the common case (the live
                    // export-decl exportedName is a single name per
                    // ast-builder.js L7285 declMatch[2]). Pattern bindings
                    // (destructuring) are uncommon in scrml exports; we mirror
                    // makeExportDecl's first-target behaviour for parity.
                    if (tgt.bindingKind === "Ident"
                        && typeof tgt.name === "string") {
                        exportedName = tgt.name;
                    }
                }
            }
        } else if (d.kind === StmtKind.TypeDecl) {
            exportKind = "type";
            exportedName = (d.name === undefined || d.name === null) ? null : d.name;
        } else if (d.kind === StmtKind.LinDecl) {
            exportKind = "let";
            exportedName = (d.name === undefined || d.name === null) ? null : d.name;
        }
    } else if (reExportSource !== null) {
        exportKind = "re-export";
        const specs = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];
        if (specs.length > 0) {
            exportedName = exportSpecifierNameLocal(specs[0]);
        }
    } else {
        const specs = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];
        if (specs.length > 0) {
            exportedName = exportSpecifierNameLocal(specs[0]);
        }
    }

    // Slice the export's raw source from the enclosing bodyText. The native
    // Stmt's span is in HOST coordinates; bodyText is the LogicEscape /
    // Meta bodyText (host-coordinate slice that starts at blockSpan.start).
    // CE's path-b strip-prefix logic (component-expander.ts L2962-2978)
    // expects the raw to include the literal `export const NAME = <markup>`
    // form so it can prepend `export const ${name} =` and indexOf-strip.
    let raw = "";
    if (typeof blockText === "string"
        && stmt.span !== undefined && stmt.span !== null
        && typeof stmt.span.start === "number"
        && typeof stmt.span.end === "number"
        && blockSpan !== undefined && blockSpan !== null
        && typeof blockSpan.start === "number") {
        const lo = stmt.span.start - blockSpan.start;
        const hi = stmt.span.end - blockSpan.start;
        if (lo >= 0 && hi <= blockText.length && lo <= hi) {
            raw = blockText.slice(lo, hi);
        }
    }

    return {
        id: stamp(),
        kind: "export-decl",
        raw,
        exportedName,
        exportKind,
        reExportSource,
        span: stmt.span,
    };
}

// exportSpecifierNameLocal — mirrors translate-stmt.js's exportSpecifierName
// (L1165). Returns the outward-facing name of one export-clause specifier:
// `{ local as exported }` -> `exported`; a `*`-re-export namespace alias rides
// as an ImportNamespace specifier whose `local` is the outward name.
function exportSpecifierNameLocal(spec) {
    if (spec === undefined || spec === null) return null;
    if (spec.exported !== undefined && spec.exported !== null) return spec.exported;
    if (spec.local !== undefined && spec.local !== null) return spec.local;
    return null;
}

// synthTypeDecl — calculation (pure). SYNTHESIZE a live `TypeDeclNode`
// (ast.ts:1235 — `{ kind:"type-decl", name, typeKind, raw }` + BaseNode) from
// a native `StmtKind.TypeDecl` Stmt (ast-stmt.js:368 —
// `{ kind, name, typeKind, raw, span }`). The native shape already carries
// the three payload fields; this adds the live `kind` tag + the BaseNode
// `id`. `fromExport` marks a type-decl synthesized off an `export type`
// (live ast-builder stamps the same flag — ast-builder.js:7308).
function synthTypeDecl(stmt, stamp, fromExport) {
    return {
        id: stamp(),
        kind: "type-decl",
        name: typeof stmt.name === "string" ? stmt.name : "",
        typeKind: typeof stmt.typeKind === "string" ? stmt.typeKind : "",
        raw: typeof stmt.raw === "string" ? stmt.raw : "",
        fromExport: fromExport === true,
        span: stmt.span,
    };
}

// synthComponentDef — calculation (pure). SYNTHESIZE a live `ComponentDefNode`
// (ast.ts:856 — `{ kind:"component-def", name, raw }` + BaseNode) from a
// recognized `const Upper = <markup>` declarator.
//
//   name      — the declarator target identifier (PascalCase).
//   init      — the `MarkupValue` initializer expression.
//   blockText — the enclosing LogicEscape/Meta `bodyText`.
//   blockSpan — the enclosing block's `span` (the `bodyText` is the slice
//               from `blockSpan.start`, so an absolute child span maps to a
//               `bodyText` offset by subtracting `blockSpan.start`).
//
// `raw` is the source substring of the component template (the markup
// initializer). The native `MarkupValue` carries the typed `markup`
// block-stream + a `span`; the raw template text is recovered by slicing the
// enclosing block's `bodyText`. (R2 noted the live `component-def.raw`
// follows `component-expander.ts`'s space-joined-token `normalizeTokenizedRaw`
// contract; the native `bodyText` slice is the verbatim source form. A
// raw-normalization reconciliation is a downstream component-expander
// concern — surfaced as a deferred item.)
function synthComponentDef(name, init, blockText, blockSpan, stamp) {
    let raw = "";
    const initSpan = init.span;
    if (initSpan !== undefined && initSpan !== null
        && typeof blockText === "string"
        && blockSpan !== undefined && blockSpan !== null) {
        const lo = initSpan.start - blockSpan.start;
        const hi = initSpan.end - blockSpan.start;
        if (lo >= 0 && hi <= blockText.length && lo <= hi) {
            raw = blockText.slice(lo, hi);
        }
    }
    return {
        id: stamp(),
        kind: "component-def",
        name,
        raw,
        span: initSpan !== undefined && initSpan !== null ? initSpan : null,
    };
}

// =============================================================================
// Attribute-reading helpers — calculations (pure). The native engine's
// `attrs` is an `AttrNode[]` (`{ name, value, span }`); `value` is the live
// 6-variant AttrValue union (string-literal / variable-ref / call-ref / expr
// / props-block / absent).
// =============================================================================

// readAttrName — the value of the named attribute as an identifier-ish string,
// or null when the attribute is absent / has no usable value. `variable-ref`
// and `string-literal` values both yield their text.
function readAttrName(attrs, attrName) {
    for (const attr of attrs) {
        if (attr === undefined || attr === null) continue;
        if (attr.name !== attrName) continue;
        const value = attr.value;
        if (value === undefined || value === null) return null;
        if (value.kind === "variable-ref") return value.name;
        if (value.kind === "string-literal") return value.value;
        return null;
    }
    return null;
}

// hasBareAttr — true iff the named attribute is present with an `absent`
// value (a bareword modifier, e.g. `pinned`).
function hasBareAttr(attrs, attrName) {
    for (const attr of attrs) {
        if (attr === undefined || attr === null) continue;
        if (attr.name !== attrName) continue;
        const value = attr.value;
        if (value !== undefined && value !== null && value.kind === "absent") {
            return true;
        }
    }
    return false;
}

// readSourceVar — §51.9 — the `derived=@x` source reactive var name with the
// leading `@` stripped, or null. The native `derived=@bar` attribute yields a
// `variable-ref` value whose `name` is `@bar`.
function readSourceVar(attrs) {
    const derived = readAttrName(attrs, "derived");
    if (derived === null) return null;
    if (derived.length > 0 && derived.charAt(0) === "@") {
        return derived.slice(1);
    }
    return derived;
}

// readInitial — §51.0.E — the `initial=.X` variant name (the `.`-stripped
// variant), or null. Two source forms are recovered:
//   1. Quoted — `initial=".X"` — a clean `string-literal` attribute value.
//   2. Unquoted — `initial=.X` — the native attribute tokenizer does NOT
//      admit `.` as an unquoted-value start, so `initial` resolves to an
//      `absent` value and the variant name `X` appears as the immediately
//      following bare attribute. Recover it from that adjacency.
function readInitial(attrs) {
    for (let i = 0; i < attrs.length; i++) {
        const attr = attrs[i];
        if (attr === undefined || attr === null) continue;
        if (attr.name !== "initial") continue;
        const value = attr.value;
        if (value === undefined || value === null) return null;
        // Form 1 — a quoted string-literal value (`initial=".X"`).
        if (value.kind === "string-literal") {
            return stripLeadingDot(value.value);
        }
        // A variable-ref value (`initial=X` without the `.`).
        if (value.kind === "variable-ref") {
            return stripLeadingDot(value.name);
        }
        // Form 2 — `initial` is absent-valued; the variant is the next bare
        // attribute (the unquoted `initial=.X` tokenizer split).
        if (value.kind === "absent" && i + 1 < attrs.length) {
            const next = attrs[i + 1];
            if (next !== undefined && next !== null
                && next.value !== undefined && next.value !== null
                && next.value.kind === "absent"
                && typeof next.name === "string" && next.name.length > 0) {
                return stripLeadingDot(next.name);
            }
        }
        return null;
    }
    return null;
}

// stripLeadingDot — remove a single leading `.` from a variant name (`.X` -> `X`).
function stripLeadingDot(text) {
    if (typeof text !== "string") return "";
    if (text.length > 0 && text.charAt(0) === ".") return text.slice(1);
    return text;
}

// isUpperInitial — predicate. True iff `name`'s first character is an ASCII
// uppercase letter (the component-def recognition gate).
function isUpperInitial(name) {
    if (typeof name !== "string" || name.length === 0) return false;
    const code = name.charCodeAt(0);
    return code >= 65 && code <= 90;
}

// collectRulesRaw — the raw source text of an engine body. The native engine
// body's `children` carries `Text` blocks (the rule lines) plus nested
// element blocks; those blocks carry SPANS but no source-text payload, so the
// body text is recovered by slicing `source` from the first child's span
// start to the last child's span end. The result is trimmed (the live
// `rulesRaw` trailing-trim discipline). "" when `source` is unavailable or
// the body has no child blocks.
function collectRulesRaw(children, source) {
    if (Array.isArray(children) === false || children.length === 0) return "";
    if (typeof source !== "string") return "";
    let lo = -1;
    let hi = -1;
    for (const child of children) {
        if (child === undefined || child === null) continue;
        const span = child.span;
        if (span === undefined || span === null) continue;
        if (lo < 0 || span.start < lo) lo = span.start;
        if (hi < 0 || span.end > hi) hi = span.end;
    }
    if (lo < 0 || hi < 0 || lo > hi || hi > source.length) return "";
    return source.slice(lo, hi).trim();
}

// =============================================================================
// hasProgramRoot — calculation (pure predicate). True iff a TOP-LEVEL block
// is a Markup block named "program". The live pipeline's W-PROGRAM-001 check
// (ast-builder.js ~L11963). Exported standalone for callers that want only the
// boolean; collectHoisted folds the same computation in per Cluster B.
// =============================================================================
export function hasProgramRoot(blocks) {
    if (blocks === undefined || blocks === null || Array.isArray(blocks) === false) {
        return false;
    }
    for (const block of blocks) {
        if (block === undefined || block === null) continue;
        if (block.kind === "Markup" && block.name === "program") {
            return true;
        }
    }
    return false;
}
