// ast-stmt.js — JS-host shadow of ast-stmt.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors ast-stmt.scrml's header — see that file.

// =============================================================================
// StmtKind — string-tag registry for the native Stmt AST. Order mirrors the
// canonical `type Stmt:enum` declaration in ast-stmt.scrml. Per S98 DD §D3
// the Stmt enum is one struct per node-kind under a single enum discriminator.
//
// M3.1 EMITS: Block, ExprStmt, Empty, VarDecl. M3.2 EMITS the control-flow
// kinds (If / While / DoWhile / For / ForIn / ForOf / Return / Break /
// Continue / Labeled). The remaining kinds are declared HERE (the catalog is
// whole — a reviewer can name every statement kind the M3 chain produces)
// but their constructors land at M3.3:
//   - FunctionDecl / ClassDecl / Import / Export / Try / Throw — M3.3.
// =============================================================================
export const StmtKind = Object.freeze({
    // --- M3.1 — statement substrate ---
    Block:    "Block",     // `{ stmt* }`            block statement
    ExprStmt: "ExprStmt",  // `expr ;`               expression statement
    Empty:    "Empty",     // `;`                    the empty statement
    VarDecl:  "VarDecl",   // `let`/`const`/`var` declaration

    // --- M3.2 — control-flow statements ---
    If:       "If",        // `if (test) cons else alt`
    While:    "While",     // `while (test) body`
    DoWhile:  "DoWhile",   // `do body while (test)`
    For:      "For",       // `for (init; test; update) body`
    ForIn:    "ForIn",     // `for (left in right) body`
    ForOf:    "ForOf",     // `for (left of right) body`
    Return:   "Return",    // `return arg?`
    Break:    "Break",     // `break label?`
    Continue: "Continue",  // `continue label?`
    Labeled:  "Labeled",   // `label: body`

    // --- M3.3 — declarations + module syntax + legacy error flow ---
    FunctionDecl: "FunctionDecl",  // `function name(params) { body }`
    ClassDecl:    "ClassDecl",     // `class Name extends Base { ... }`
    Import:       "Import",        // `import ... from "..."`
    Export:       "Export",        // `export ...`
    Try:          "Try",           // `try { } catch { } finally { }`
    Throw:        "Throw",         // `throw arg`

    // --- M5-swap Wave 1 — core scrml declaration kinds ---
    // B4: `lin name = expr` linear (single-consumption) binding (SPEC §35.2).
    // B5: `type Name : kind = {...}` / `type Name : kind` declaration
    //     — struct / enum / alias (SPEC §14). Both the `: kind = {...}` body
    //     form and the `: kind` alias form ride this one kind.
    LinDecl:      "LinDecl",       // `lin name = expr`
    TypeDecl:     "TypeDecl",      // `type Name : kind = { ... }`

    // --- M5-swap Wave 2 — `~` tilde (pipeline-reactive) declaration kind ---
    // B3: `~name = pipeline` declares a pipeline-reactive cell (SPEC §32).
    //     `~` lexes as a `BitNot` token; the §32 standalone-`~` accumulator
    //     ATOM (ast-expr's `Tilde` ExprKind) is unaffected — TildeDecl is the
    //     statement-position DECLARATION form, disambiguated from prefix
    //     bitwise-`~` by the source-adjacent `~ Ident =` shape.
    TildeDecl:    "TildeDecl",     // `~name = pipeline`
});

// VarDeclKind — the `let` / `const` / `var` declaration keyword (M3.1).
export const VarDeclKind = Object.freeze({
    Let:   "let",
    Const: "const",
    Var:   "var",
});

// ClassMemberKind — the discriminator for one class-body member (M3.3).
//   Method   — a method definition (`name(params) { body }`, incl. a
//              constructor, a static method, a get/set accessor, a
//              generator/async method, a computed-name method).
//   Property — a class field `name = init` / `name` (incl. static fields).
// (M3.3 parses ESTree's MethodDefinition + PropertyDefinition class members;
// the `kind` sub-field on a Method — "constructor"/"method"/"get"/"set" —
// is carried separately, see MethodKind.)
export const ClassMemberKind = Object.freeze({
    Method:   "Method",
    Property: "Property",
});

// MethodKind — the role of a class Method member (ESTree MethodDefinition
// `kind`). A get/set accessor, the constructor, or a plain method.
export const MethodKind = Object.freeze({
    Constructor: "constructor",
    Method:      "method",
    Get:         "get",
    Set:         "set",
});

// ImportSpecifierKind — one specifier of an `import` statement (M3.3).
//   Named     — `import { a, b as c } from "m"` — one bound name (+ optional
//               local alias).
//   Default   — `import d from "m"` — the module's default binding.
//   Namespace — `import * as ns from "m"` — the whole namespace object.
export const ImportSpecifierKind = Object.freeze({
    Named:     "Named",
    Default:   "Default",
    Namespace: "Namespace",
});

// BindingKind — the discriminator for a variable-declaration binding TARGET
// (the left side of one declarator). M3.1 parses real binding patterns for
// declaration targets per S98 DD §D5 ("destructuring patterns ...
// `collectBindingIdentifiers` walks these"):
//   Ident      — a plain identifier binding `let x`
//   ObjectPat  — an object-destructuring pattern `let {a, b} = ...`
//   ArrayPat   — an array-destructuring pattern `let [a, b] = ...`
// (Patterns nest: an ObjectPat property value or an ArrayPat element can be
// another pattern, an AssignmentPattern default, or a RestElement.)
export const BindingKind = Object.freeze({
    Ident:     "Ident",
    ObjectPat: "ObjectPat",
    ArrayPat:  "ArrayPat",
});

// BindingPropertyKind — one property of an object-destructuring pattern.
//   KeyValue  — `{ key: target }`  (target is a binding element)
//   Shorthand — `{ name }`         (name is both key and binding identifier)
//   Rest      — `{ ...rest }`      (collects the remaining own properties)
export const BindingPropertyKind = Object.freeze({
    KeyValue:  "KeyValue",
    Shorthand: "Shorthand",
    Rest:      "Rest",
});

// BindingElementKind — one element of an array-destructuring pattern.
//   Item — a binding element (an identifier / nested pattern / defaulted)
//   Hole — an elision slot `[ , x ]` (skips one array position)
//   Rest — `[ ...rest ]` (collects the remaining elements)
export const BindingElementKind = Object.freeze({
    Item: "Item",
    Hole: "Hole",
    Rest: "Rest",
});

// =============================================================================
// Statement node constructors — M3.1.
//
// Every Stmt node is a plain JS object: a `kind` string tag (a StmtKind value)
// + per-variant payload fields + a `span: Span`. Same string-tag concession as
// ast-expr.js / token.js (the canonical scrml-source form is a tagged-variant
// enum — see ast-stmt.scrml; the M5 swap-in lights it up).
// =============================================================================

// makeBlock — a block statement `{ stmt* }`. `body` is a Stmt array. The span
// covers the opening `{` to the closing `}`.
export function makeBlock(body, span) {
    return { kind: StmtKind.Block, body, span };
}

// makeExprStmt — an expression statement `expr ;`. `expression` is an Expr
// node (from ast-expr). The trailing `;` is consumed by the parser but is not
// retained on the node (matching ESTree's ExpressionStatement).
export function makeExprStmt(expression, span) {
    return { kind: StmtKind.ExprStmt, expression, span };
}

// makeEmpty — the empty statement `;`. Carries only a span (matching ESTree's
// EmptyStatement). A lone `;` is a legal no-op statement.
export function makeEmpty(span) {
    return { kind: StmtKind.Empty, span };
}

// makeVarDecl — a variable declaration `let`/`const`/`var` decl0, decl1, ...`.
// `declKind` is a VarDeclKind value. `declarations` is an array of declarator
// objects (see makeVarDeclarator). The trailing `;` is consumed by the parser.
export function makeVarDecl(declKind, declarations, span) {
    return { kind: StmtKind.VarDecl, declKind, declarations, span };
}

// makeVarDeclarator — one declarator of a variable declaration: a binding
// `target` and an optional `init` Expr. `init` is `not` for an
// initializer-free declarator (`let x;`). `target` is a binding node from
// makeBindingIdent / makeObjectPattern / makeArrayPattern.
export function makeVarDeclarator(target, init, span) {
    return { target, init, span };
}

// =============================================================================
// Control-flow statement node constructors — M3.2 (DD §D3 / §D5).
//
// Each is a plain JS object: a `kind` string tag (a StmtKind value) +
// per-variant payload fields + a `span: Span`. Statement-position children
// (`consequent` / `body` / loop bodies) are Stmt nodes; condition / argument
// children are Expr nodes from ast-expr.
// =============================================================================

// makeIf — an `if (test) consequent else alternate` statement. `test` is an
// Expr, `consequent` a Stmt. `alternate` is a Stmt or `null` (no `else`); an
// `else if` chain is an If nested as the alternate — Acorn's IfStatement shape.
export function makeIf(test, consequent, alternate, span) {
    return { kind: StmtKind.If, test, consequent, alternate, span };
}

// makeWhile — a `while (test) body` loop. `test` is an Expr; `body` a Stmt.
export function makeWhile(test, body, span) {
    return { kind: StmtKind.While, test, body, span };
}

// makeDoWhile — a `do body while (test)` loop. The body runs once before the
// first test. `body` is a Stmt; `test` an Expr.
export function makeDoWhile(body, test, span) {
    return { kind: StmtKind.DoWhile, body, test, span };
}

// makeFor — a C-style three-clause `for (init; test; update) body` loop. Each
// of `init` / `test` / `update` is `null` when its clause is empty. `init` is
// a VarDecl Stmt or an Expr; `test` / `update` are Exprs; `body` is a Stmt.
export function makeFor(init, test, update, body, span) {
    return { kind: StmtKind.For, init, test, update, body, span };
}

// makeForIn — a `for (left in right) body` loop. `left` is a VarDecl Stmt
// (`for (let k in o)`) or an assignment-target Expr (`for (k in o)`); `right`
// is the iterated-object Expr; `body` is a Stmt.
export function makeForIn(left, right, body, span) {
    return { kind: StmtKind.ForIn, left, right, body, span };
}

// makeForOf — a `for (left of right) body` loop. `left` / `right` / `body` as
// for ForIn. `isAwait` is true for `for await (left of right)` — an M3.2
// extension of the DD §D3 ForOf shape, mirroring Acorn's ForOfStatement
// `await: boolean`. The body's `async` context itself is M3.3's territory;
// M3.2 only recognizes the `await` keyword in the `for` head.
export function makeForOf(left, right, body, isAwait, span) {
    return { kind: StmtKind.ForOf, left, right, body, isAwait, span };
}

// makeReturn — a `return argument` statement. `argument` is an Expr, or
// `null` for a bare `return` (a `return` followed by `;` / a newline / `}`).
export function makeReturn(argument, span) {
    return { kind: StmtKind.Return, argument, span };
}

// makeBreak — a `break` statement, optionally `break label`. `label` is the
// label identifier text, or `null` for an unlabeled break.
export function makeBreak(label, span) {
    return { kind: StmtKind.Break, label, span };
}

// makeContinue — a `continue` statement, optionally `continue label`. `label`
// is the label identifier text, or `null` for an unlabeled continue.
export function makeContinue(label, span) {
    return { kind: StmtKind.Continue, label, span };
}

// makeLabeled — a `label: body` labeled statement. `label` is the label
// identifier text; `body` is the statement the label names (`break label` /
// `continue label` target it).
export function makeLabeled(label, body, span) {
    return { kind: StmtKind.Labeled, label, body, span };
}

// =============================================================================
// Declaration / module / legacy-error statement node constructors — M3.3
// (DD §D3 / §D5 — the MUST-PARSE declaration + module + try/throw rows).
//
// Function/class declarations carry their body parsed IN-LINE — `body` is a
// Stmt array, NOT a token-range stub. This is THE body-pre-parser subsumption:
// M3 parses function bodies in-line, so `body-pre-parser.ts` deletes by
// construction (DD §D7 M3 gating). `try`/`catch`/`finally`+`throw` are parsed
// for legacy + JS-import inputs; a later stage (the typer) rejects them in
// scrml source per primer §6 — scrml uses `fail`/`!{}` per SPEC §19.
// =============================================================================

// makeFunctionDecl — a `[server|pure] function|fn name(params) [!] { body }`
// declaration. `name` is the function name (a declaration is always named).
// `params` is the parameter array (the M2.3 param shapes — Ident /
// RestElement / AssignmentPattern / destructuring stand-in). `body` is the
// function body's Stmt array — parsed in-line (the BPP subsumption).
// `isAsync` is true for `async function`; `isGenerator` is true for
// `function*`.
//
// M5-swap Wave 1 (B6) — `modifiers` is an OPTIONAL trailing object carrying
// the scrml function-declaration modifiers the native JS-subset parser did
// not previously recognize:
//   { fnKind, isServer, isPure, isPinned, canFail, errorType }
// `fnKind` is "function" (the `function` keyword) or "fn" (the scrml
// shorthand). `isServer` / `isPure` / `isPinned` are the prefix-modifier
// flags. `canFail` is true for the trailing `!` failable marker; `errorType`
// is the named error type from a `! -> ErrorType` clause. When `modifiers`
// is omitted the node defaults to a plain `function` (the legacy 6-arg call
// shape — every pre-B6 call site stays valid).
export function makeFunctionDecl(name, params, body, isAsync, isGenerator, span, modifiers) {
    const m = modifiers ?? {};
    return {
        kind: StmtKind.FunctionDecl,
        name, params, body, isAsync, isGenerator, span,
        fnKind:    m.fnKind ?? "function",
        isServer:  m.isServer === true,
        isPure:    m.isPure === true,
        isPinned:  m.isPinned === true,
        canFail:   m.canFail === true,
        errorType: m.errorType ?? null,
    };
}

// makeClassDecl — a `class Name extends Base { ... }` declaration. `name` is
// the class name (a declaration is always named). `superClass` is the
// extends-clause Expr, or `not` for a base class. `body` is a ClassMember
// array (see makeMethodDef / makePropertyDef).
export function makeClassDecl(name, superClass, body, span) {
    return { kind: StmtKind.ClassDecl, name, superClass, body, span };
}

// makeImport — an `import ... from "source"` statement. `specifiers` is an
// array of import-specifier objects (see makeImportNamed / makeImportDefault
// / makeImportNamespace). `source` is the module-specifier string value. A
// bare side-effect import `import "m"` has an empty `specifiers` array.
export function makeImport(specifiers, source, span) {
    return { kind: StmtKind.Import, specifiers, source, span };
}

// makeExport — an `export ...` statement. Three shapes ride one node:
//   - `export <declaration>`     — `declaration` is the exported Stmt,
//                                  `specifiers` is empty, `source` is `not`.
//   - `export { a, b as c }`     — `declaration` is `not`, `specifiers` is the
//      [from "m"]                  export-specifier list, `source` is the
//                                  re-export module string or `not`.
//   - `export default <expr>`    — `isDefault` is true, `declaration` carries
//                                  the default value/decl.
// `isDefault` is true for `export default`.
export function makeExport(declaration, specifiers, source, isDefault, span) {
    return { kind: StmtKind.Export, declaration, specifiers, source, isDefault, span };
}

// makeTry — a `try { block } catch (param) { } finally { }` statement.
// `block` is the try-block Stmt (a Block). `handler` is a catch-clause object
// (see makeCatchClause) or `not` for a `try`/`finally` with no catch.
// `finalizer` is the finally-block Stmt (a Block) or `not`.
export function makeTry(block, handler, finalizer, span) {
    return { kind: StmtKind.Try, block, handler, finalizer, span };
}

// makeThrow — a `throw argument` statement. `argument` is the thrown-value
// Expr. The no-LineTerminator restricted production applies — `throw` must be
// followed on the SAME source line by its argument.
export function makeThrow(argument, span) {
    return { kind: StmtKind.Throw, argument, span };
}

// =============================================================================
// Core scrml declaration node constructors — M5-swap Wave 1 (B4 / B5).
// =============================================================================

// makeLinDecl — a `lin name = expr` linear-binding declaration (SPEC §35.2).
// `lin` takes the same syntactic position as `let` / `const`. A `lin` binding
// is immutable + single-consumption; the linearity guarantee is enforced by a
// later static-analysis stage, not the parser. `name` is the bound identifier
// text; `init` is the initializer Expr (a `lin` declaration always has an
// initializer — `lin x` with no `= expr` is a malformed shape the production
// records a diagnostic for, then carries `init` as `null`).
export function makeLinDecl(name, init, span) {
    return { kind: StmtKind.LinDecl, name, init, span };
}

// makeTypeDecl — a `type` declaration (SPEC §14). Two source forms ride one
// node:
//   - body form  `type Name : kind = { ... }`  — `typeKind` is the struct /
//     enum / tuple discriminator; `raw` is the brace-delimited body text
//     `"{ ... }"`.
//   - alias form `type Name : kind` / `type Name = expr` — `raw` is the
//     inline type expression (a union / a primitive name), `typeKind` is the
//     `: kind` discriminator when present, else "".
// `name` is the declared type name. `typeKind` is the `: kind` modifier text
// or "". `raw` is the type body / alias expression text or "". This mirrors
// the live `TypeDeclNode` shape (ast.ts:1235 — `{name, typeKind, raw}`).
export function makeTypeDecl(name, typeKind, raw, span) {
    return { kind: StmtKind.TypeDecl, name, typeKind, raw, span };
}

// =============================================================================
// `~` tilde-declaration node constructor — M5-swap Wave 2 (B3).
// =============================================================================

// makeTildeDecl — a `~name = pipeline` tilde (pipeline-reactive) declaration
// (SPEC §32). `~` declares a must-use pipeline-reactive cell; `name` is the
// bound identifier text and `init` is the initializer Expr (the pipeline
// expression). A `~` declaration always has an initializer — `~name` with no
// `= expr` is a malformed shape the production records a diagnostic for, then
// carries `init` as `null`. This mirrors `makeLinDecl`'s shape (the live
// `TildeDeclNode` and `LinDeclNode` are structural twins — ast.ts:480/492).
// The standalone-`~` accumulator atom (§32, ast-expr's `Tilde` ExprKind) is a
// SEPARATE construct — a `~`-led declaration is recognized only at statement
// position by the `~ Ident =` shape (see parseTildeDecl).
export function makeTildeDecl(name, init, span) {
    return { kind: StmtKind.TildeDecl, name, init, span };
}

// =============================================================================
// Class-member node constructors — M3.3 (ESTree MethodDefinition +
// PropertyDefinition). A class body is a ClassMember array.
// =============================================================================

// makeMethodDef — one method member of a class body. `key` is the method-name
// node (an Ident / StringLit / NumberLit key Expr, or — when `computed` — any
// Expr). `value` is the method's Function Expr node (params + in-line body).
// `methodKind` is a MethodKind value ("constructor"/"method"/"get"/"set").
// `isStatic` is true for a `static` method. `computed` is true for a
// `[expr]`-named method.
export function makeMethodDef(key, value, methodKind, isStatic, computed, span) {
    return {
        memberKind: ClassMemberKind.Method,
        key, value, methodKind, isStatic, computed, span,
    };
}

// makePropertyDef — one class-field member. `key` is the field-name node (as
// for makeMethodDef). `value` is the field-initializer Expr, or `not` for an
// uninitialized field (`name;`). `isStatic` is true for a `static` field.
// `computed` is true for a `[expr]`-named field.
export function makePropertyDef(key, value, isStatic, computed, span) {
    return {
        memberKind: ClassMemberKind.Property,
        key, value, isStatic, computed, span,
    };
}

// =============================================================================
// Import-specifier node constructors — M3.3. One specifier of an `import`.
// =============================================================================

// makeImportNamed — a named import specifier `imported as local` (or just
// `imported` when there is no alias). `imported` is the name exported by the
// module; `local` is the name bound in this module (equal to `imported` for
// an un-aliased specifier).
export function makeImportNamed(imported, local, span) {
    return { specifierKind: ImportSpecifierKind.Named, imported, local, span };
}

// makeImportDefault — the default-import specifier `import local from "m"`.
// `local` is the name the module's default export is bound to.
export function makeImportDefault(local, span) {
    return { specifierKind: ImportSpecifierKind.Default, local, span };
}

// makeImportNamespace — the namespace-import specifier `import * as local`.
// `local` is the name the whole module-namespace object is bound to.
export function makeImportNamespace(local, span) {
    return { specifierKind: ImportSpecifierKind.Namespace, local, span };
}

// makeExportSpecifier — one specifier of an `export { ... }` clause:
// `local as exported` (or just `local` when there is no alias). `local` is
// the name in this module; `exported` is the name the consumer sees.
export function makeExportSpecifier(local, exported, span) {
    return { local, exported, span };
}

// makeCatchClause — the `catch (param) { body }` clause of a `try`. `param`
// is the caught-binding target (a binding node — Ident or destructuring
// pattern), or `not` for the optional-catch-binding form `catch { }`. `body`
// is the catch-block Stmt (a Block).
export function makeCatchClause(param, body, span) {
    return { param, body, span };
}

// =============================================================================
// Binding-pattern node constructors — M3.1.
//
// The declaration-target grammar per S98 DD §D5. A binding TARGET is an
// identifier or a destructuring pattern; patterns nest. These are SEPARATE
// from ast-expr's Object/Array literal nodes — a binding pattern is the
// left-of-`=` shape, not a value (ESTree splits ObjectPattern/ArrayPattern
// from ObjectExpression/ArrayExpression for the same reason). M2.3's
// `parseParamTarget` still uses literal stand-ins for FUNCTION PARAMS; M4
// unifies the two surfaces (documented in the roadmap K-class report).
// =============================================================================

// makeBindingIdent — a plain identifier binding `x`. `name` is the identifier
// text. The leaf of every binding pattern.
export function makeBindingIdent(name, span) {
    return { bindingKind: BindingKind.Ident, name, span };
}

// makeObjectPattern — an object-destructuring pattern `{ a, b: c, ...rest }`.
// `properties` is an array of binding-property objects (see the
// makeBindingProperty* constructors).
export function makeObjectPattern(properties, span) {
    return { bindingKind: BindingKind.ObjectPat, properties, span };
}

// makeArrayPattern — an array-destructuring pattern `[ a, , b, ...rest ]`.
// `elements` is an array of binding-element objects (see the
// makeBindingElement* constructors).
export function makeArrayPattern(elements, span) {
    return { bindingKind: BindingKind.ArrayPat, elements, span };
}

// makeAssignmentPattern — a defaulted binding `target = default`. Used inside
// object/array patterns ( `{ a = 1 }`, `[ x = 0 ]` ) and at the declarator
// level is NOT needed (the declarator carries its own `init`). `left` is the
// binding target, `right` is the default-value Expr.
export function makeAssignmentPattern(left, right, span) {
    return { bindingKind: "AssignmentPattern", left, right, span };
}

// makeRestElement — a rest binding `...target`. The trailing element of an
// array pattern or the trailing property of an object pattern. `argument` is
// the binding target collecting the remainder.
export function makeRestElement(argument, span) {
    return { bindingKind: "RestElement", argument, span };
}

// --- object-pattern property constructors ---

// makeBindingPropertyKeyValue — `{ key: target }`. `key` is the property-key
// Expr (an Ident, a StringLit, a NumberLit, or — when `computed` — any Expr).
// `value` is the binding target the property destructures into.
export function makeBindingPropertyKeyValue(key, value, computed) {
    return { propertyKind: BindingPropertyKind.KeyValue, key, value, computed };
}

// makeBindingPropertyShorthand — `{ name }` (optionally `{ name = default }`,
// in which case `value` is an AssignmentPattern wrapping the identifier).
// `name` is the binding identifier; `value` is the binding target (a plain
// BindingIdent for `{ name }`, an AssignmentPattern for `{ name = d }`).
export function makeBindingPropertyShorthand(name, value) {
    return { propertyKind: BindingPropertyKind.Shorthand, name, value };
}

// makeBindingPropertyRest — `{ ...rest }`. `argument` is the rest binding
// target. An object-pattern rest collects the own enumerable properties not
// already bound.
export function makeBindingPropertyRest(argument) {
    return { propertyKind: BindingPropertyKind.Rest, argument };
}

// --- array-pattern element constructors ---

// makeBindingElementItem — one positional element of an array pattern. `value`
// is the binding target (a BindingIdent, a nested pattern, or an
// AssignmentPattern when the slot has a default).
export function makeBindingElementItem(value) {
    return { elementKind: BindingElementKind.Item, value };
}

// makeBindingElementHole — an elision slot `[ , x ]`. Carries no payload; it
// skips one array position.
export function makeBindingElementHole() {
    return { elementKind: BindingElementKind.Hole };
}

// makeBindingElementRest — `[ ...rest ]`. `argument` is the rest binding
// target collecting the remaining elements.
export function makeBindingElementRest(argument) {
    return { elementKind: BindingElementKind.Rest, argument };
}

// --- isStmt — predicate ---
export function isStmt(node) {
    if (node === undefined || node === null) {
        return false;
    }
    return StmtKind[node.kind] !== undefined;
}
