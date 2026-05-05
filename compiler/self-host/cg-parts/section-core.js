// ===========================================================================
// External dependencies — imported from other self-hosted modules
// ===========================================================================

// BPP functions (from compat/parser-workarounds.js)
const { splitBareExprStatements, splitMergedStatements, isLeakedComment, stripLeakedComments } =
    await import("../../src/codegen/compat/parser-workarounds.js")

// Expression parser functions (from expression-parser.ts)
const { extractReactiveDepsFromAST, rewriteReactiveRefsAST, rewriteServerReactiveRefsAST, extractIdentifiersFromAST } =
    await import("../../src/expression-parser.ts")

// HTML elements list
const { HTML_ELEMENTS } = await import("../../src/html-elements.js")

// ===========================================================================
// SECTION: errors (from errors.ts)
// ===========================================================================
//
// CGSpan, CGError
//
// CGSpan is a plain object shape — no class needed (just used as a descriptor).
// CGError is a class with code, message, span, severity.

export class CGError {
    constructor(code, message, span, severity) {
        this.code = code
        this.message = message
        this.span = span
        this.severity = severity != null ? severity : "error"
    }
}

// ===========================================================================
// SECTION: utils (from utils.ts)
// ===========================================================================
//
// routePath, escapeHtmlAttr, escapeRegex, replaceCssVarRefs, VOID_ELEMENTS

export function routePath(generatedRouteName) {
    return "/_scrml/" + generatedRouteName
}

export function escapeHtmlAttr(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

// NOTE: escapeRegex pattern contains literal { and } — using String.fromCharCode
// to avoid confusing the block splitter's brace-depth counting.
// String.fromCharCode(123) = '{', String.fromCharCode(125) = '}'
const _escapeRegex_OB = String.fromCharCode(123)
const _escapeRegex_CB = String.fromCharCode(125)

export function escapeRegex(s) {
    const pattern = new RegExp(
        "[.*+?^$" + _escapeRegex_OB + _escapeRegex_CB + "()|[\\]\\\\]",
        "g"
    )
    return s.replace(pattern, "\\$&")
}

export function replaceCssVarRefs(value) {
    return value.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, "var(--scrml-$1)")
}

export const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
])

// ===========================================================================
// SECTION: var-counter (from var-counter.ts)
// ===========================================================================
//
// genVar, resetVarCounter

let _varCounter = 0

export function genVar(baseName) {
    _varCounter++
    const safe = (baseName || "v").replace(/[^A-Za-z0-9_$]/g, "_")
    return "_scrml_" + safe + "_" + _varCounter
}

export function resetVarCounter() {
    _varCounter = 0
}

// ===========================================================================
// SECTION: ir (from ir.ts)
// ===========================================================================
//
// Factory functions: createHtmlIR, createCssIR, createServerIR, createClientIR,
// createFileIR, createTestIR
//
// All TypeScript interfaces (HtmlIR, CssIR, ServerIR, ClientIR, FileIR,
// AssertStmt, TestCase, TestGroup, TestIR) are removed — plain objects are used.

export function createHtmlIR() {
    return { parts: [] }
}

export function createCssIR() {
    return { userCss: "", tailwindCss: "" }
}

export function createServerIR() {
    return { lines: [] }
}

export function createClientIR() {
    return { lines: [] }
}

export function createFileIR(filePath) {
    return {
        filePath,
        html: createHtmlIR(),
        css: createCssIR(),
        server: createServerIR(),
        client: createClientIR(),
    }
}

export function createTestIR() {
    return { groups: [] }
}

// ===========================================================================
// SECTION: binding-registry (from binding-registry.ts)
// ===========================================================================
//
// BindingRegistry class
//
// TypeScript interfaces EventBinding and LogicBinding are removed — plain
// objects conforming to the expected shape are used at call sites.

export class BindingRegistry {
    constructor() {
        this._eventBindings = []
        this._logicBindings = []
    }

    addEventBinding(entry) {
        this._eventBindings.push(entry)
    }

    addLogicBinding(entry) {
        this._logicBindings.push(entry)
    }

    get eventBindings() {
        return this._eventBindings
    }

    get logicBindings() {
        return this._logicBindings
    }

    static from(eventBindings, logicBindings) {
        if (eventBindings == null) eventBindings = []
        if (logicBindings == null) logicBindings = []
        const reg = new BindingRegistry()
        for (const eb of eventBindings) reg.addEventBinding(eb)
        for (const lb of logicBindings) reg.addLogicBinding(lb)
        return reg
    }
}

// ===========================================================================
// SECTION: source-map (from source-map.ts)
// ===========================================================================
//
// encodeVlq, encodeVlqGroup, SourceMapBuilder, appendSourceMappingUrl

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export function encodeVlq(value) {
    // Map signed to unsigned (sign bit in LSB)
    let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1
    let result = ""
    do {
        let digit = vlq & 0x1F  // take 5 bits
        vlq >>>= 5
        if (vlq > 0) digit |= 0x20  // set continuation bit if more to come
        result += BASE64_CHARS[digit]
    } while (vlq > 0)
    return result
}

export function encodeVlqGroup(values) {
    return values.map(encodeVlq).join("")
}

export class SourceMapBuilder {
    constructor(sourceFile) {
        this._sourceFile = sourceFile
        this._mappings = []
    }

    addMapping(outputLine, sourceLine, sourceCol) {
        if (sourceCol == null) sourceCol = 0
        this._mappings.push({ outputLine, sourceLine, sourceCol })
    }

    generate(outputFile) {
        const mappings = this._buildMappingsField()
        const map = {
            version: 3,
            file: outputFile,
            sourceRoot: "",
            sources: [this._sourceFile],
            sourcesContent: null,
            mappings,
        }
        return JSON.stringify(map, null, 2)
    }

    _buildMappingsField() {
        if (this._mappings.length == 0) return ""

        // Sort mappings by output line
        const sorted = [...this._mappings].sort((a, b) => a.outputLine - b.outputLine)

        // Find the highest output line number
        const maxOutputLine = sorted[sorted.length - 1].outputLine

        // Build a map: outputLine → list of { sourceLine, sourceCol }
        const lineMap = new Map()
        for (const m of sorted) {
            if (!lineMap.has(m.outputLine)) lineMap.set(m.outputLine, [])
            lineMap.get(m.outputLine).push({ sourceLine: m.sourceLine, sourceCol: m.sourceCol })
        }

        // Delta state (relative to previous segment globally)
        let prevSourceLine = 0
        let prevSourceCol = 0
        // sourceFileIndex is always 0 (one source file), delta from previous = 0 after first segment

        const groups = []
        let prevSourceFileIndex = 0

        for (let lineIdx = 0; lineIdx <= maxOutputLine; lineIdx++) {
            const segments = lineMap.get(lineIdx)
            if (!segments || segments.length == 0) {
                // Empty group for this output line
                groups.push("")
                continue
            }

            const segmentParts = []
            let prevOutputCol = 0  // outputCol delta resets per line

            for (const seg of segments) {
                const outputColDelta = 0 - prevOutputCol  // always 0 for first segment per line
                const sourceFileIndexDelta = 0 - prevSourceFileIndex
                const sourceLineDelta = seg.sourceLine - prevSourceLine
                const sourceColDelta = seg.sourceCol - prevSourceCol

                segmentParts.push(encodeVlqGroup([
                    outputColDelta,
                    sourceFileIndexDelta,
                    sourceLineDelta,
                    sourceColDelta,
                ]))

                prevOutputCol = 0  // column is 0, stays 0
                prevSourceFileIndex = 0
                prevSourceLine = seg.sourceLine
                prevSourceCol = seg.sourceCol
            }

            groups.push(segmentParts.join(","))
        }

        return groups.join(";")
    }
}

export function appendSourceMappingUrl(jsCode, mapFile) {
    const comment = "//# sourceMappingURL=" + mapFile
    // Idempotent — don't double-append
    if (jsCode.includes(comment)) return jsCode
    // Ensure there's a newline before the comment
    const separator = jsCode.endsWith("\n") ? "" : "\n"
    return jsCode + separator + comment + "\n"
}

// ===========================================================================
// SECTION: context (from context.ts)
// ===========================================================================
//
// makeCompileContext factory function
//
// The CompileContext interface is removed — plain objects are used.
// EncodingContext is an opaque type from type-encoding.ts — not re-exported here.
// All fields and defaults are preserved exactly.

export function makeCompileContext(partial) {
    return {
        filePath: partial.filePath != null ? partial.filePath : (partial.fileAST && partial.fileAST.filePath != null ? partial.fileAST.filePath : ""),
        fileAST: partial.fileAST,
        routeMap: partial.routeMap != null ? partial.routeMap : { functions: new Map() },
        depGraph: partial.depGraph != null ? partial.depGraph : { nodes: new Map(), edges: [] },
        protectedFields: partial.protectedFields != null ? partial.protectedFields : new Set(),
        authMiddleware: partial.authMiddleware != null ? partial.authMiddleware : null,
        middlewareConfig: partial.middlewareConfig != null ? partial.middlewareConfig : null,
        csrfEnabled: partial.csrfEnabled != null ? partial.csrfEnabled : false,
        encodingCtx: partial.encodingCtx != null ? partial.encodingCtx : null,
        mode: partial.mode != null ? partial.mode : "browser",
        testMode: partial.testMode != null ? partial.testMode : false,
        dbVar: partial.dbVar != null ? partial.dbVar : "_scrml_db",
        workerNames: partial.workerNames != null ? partial.workerNames : [],
        errors: partial.errors != null ? partial.errors : [],
        registry: partial.registry != null ? partial.registry : new BindingRegistry(),
        derivedNames: partial.derivedNames != null ? partial.derivedNames : new Set(),
        analysis: partial.analysis != null ? partial.analysis : null,
        // Always-included runtime chunks. Additional chunks are added by
        // detectRuntimeChunks() in emit-client.js based on feature usage.
        usedRuntimeChunks: partial.usedRuntimeChunks != null ? partial.usedRuntimeChunks : new Set(["core", "scope", "errors", "transitions"]),
    }
}

// ===========================================================================
// SECTION: collect (from collect.ts)
// ===========================================================================
//
// getNodes, collectMarkupNodes, collectCssBlocks, collectFunctions,
// collectTopLevelLogicStatements, collectProtectedFields,
// collectCssVariableBridges, isServerOnlyNode
//
// All TypeScript interfaces (Node, CSSRule, CSSReactiveRef, CSSVariableBridge,
// FileAST, ProtectAnalysis, DBViews, TableView) are removed.

// ---------------------------------------------------------------------------
// Node access helper
// ---------------------------------------------------------------------------

export function getNodes(fileAST) {
    return fileAST.nodes != null ? fileAST.nodes : (fileAST.ast ? fileAST.ast.nodes : [])
}

// ---------------------------------------------------------------------------
// Markup node collection
// ---------------------------------------------------------------------------

export function collectMarkupNodes(nodes) {
    const result = []
    function visit(nodeList) {
        for (const node of nodeList) {
            if (!node || typeof node != "object") continue
            if (node.kind == "markup") result.push(node)
            if (Array.isArray(node.children)) visit(node.children)
        }
    }
    visit(nodes)
    return result
}

// ---------------------------------------------------------------------------
// CSS block collection
// ---------------------------------------------------------------------------

export function collectCssBlocks(nodes) {
    const inlineBlocks = []
    const styleBlocks = []

    function visit(nodeList, componentScope) {
        for (const node of nodeList) {
            if (!node || typeof node != "object") continue

            // When a node was expanded from a component definition, its subtree
            // belongs to that component. Use the innermost (nearest) _expandedFrom
            // so nested component expansions each get their own scope.
            const scope = node._expandedFrom != null ? node._expandedFrom : componentScope

            if (node.kind == "css-inline") {
                inlineBlocks.push(Object.assign({}, node, { _componentScope: scope }))
                continue
            }
            if (node.kind == "style") {
                styleBlocks.push(Object.assign({}, node, { _componentScope: scope }))
                continue
            }
            if (Array.isArray(node.children)) visit(node.children, scope)
            if (node.kind == "logic" && Array.isArray(node.body)) {
                for (const child of node.body) {
                    if (!child) continue
                    if (child.kind == "css-inline") {
                        inlineBlocks.push(Object.assign({}, child, { _componentScope: scope }))
                    } else if (child.kind == "style") {
                        styleBlocks.push(Object.assign({}, child, { _componentScope: scope }))
                    }
                }
            }
        }
    }

    visit(nodes, null)
    return { inlineBlocks, styleBlocks }
}

// ---------------------------------------------------------------------------
// Function node collection
// ---------------------------------------------------------------------------

export function collectFunctions(fileAST) {
    const nodes = getNodes(fileAST)
    const result = []
    function visit(nodeList) {
        for (const node of nodeList) {
            if (!node || typeof node != "object") continue
            if (node.kind == "logic" && Array.isArray(node.body)) {
                for (const child of node.body) {
                    if (child && (child.kind == "function-decl")) {
                        result.push(child)
                    }
                }
            }
            if (node.kind == "function-decl") {
                result.push(node)
            }
            if (Array.isArray(node.children)) visit(node.children)
        }
    }
    visit(nodes)
    return result
}

// ---------------------------------------------------------------------------
// Top-level logic statement collection
// ---------------------------------------------------------------------------

export function collectTopLevelLogicStatements(fileAST) {
    const nodes = getNodes(fileAST)
    const result = []
    function visit(nodeList) {
        for (const node of nodeList) {
            if (!node || typeof node != "object") continue

            // Top-level `^{}` meta block — yield the whole meta node so emitLogicNode
            // can emit it as an IIFE (case "meta": handler in emit-logic.js).
            if (node.kind == "meta") {
                result.push(node)
                continue
            }

            if (node.kind == "logic" && Array.isArray(node.body)) {
                for (const child of node.body) {
                    if (!child) continue
                    if (child.kind == "function-decl") continue
                    result.push(child)
                }
            }
            if (Array.isArray(node.children)) visit(node.children)
        }
    }
    visit(nodes)
    return result
}

// ---------------------------------------------------------------------------
// Protected fields collection
// ---------------------------------------------------------------------------

export function collectProtectedFields(protectAnalysis) {
    const fields = new Set()
    if (!protectAnalysis || !protectAnalysis.views) return fields
    for (const [, dbViews] of protectAnalysis.views) {
        if (dbViews.tables) {
            for (const [, tableView] of dbViews.tables) {
                if (tableView.protectedFields) {
                    for (const f of tableView.protectedFields) {
                        fields.add(f)
                    }
                }
            }
        }
    }
    return fields
}

// ---------------------------------------------------------------------------
// CSS variable bridge collection
// ---------------------------------------------------------------------------

export function collectCssVariableBridges(nodes, isScoped) {
    if (isScoped == null) isScoped = false
    const { inlineBlocks } = collectCssBlocks(nodes)
    const bridges = []
    const seen = new Set()

    for (const block of inlineBlocks) {
        const scoped = isScoped || (block._constructorScoped == true) || (block._componentScope != null)
        if (!block.rules || !Array.isArray(block.rules)) continue

        for (const rule of block.rules) {
            if (!rule.reactiveRefs || rule.reactiveRefs.length == 0) continue

            if (rule.isExpression) {
                // Expression: one custom property for the whole expression
                const exprPropName = "--scrml-expr-" + rule.reactiveRefs.map(r => r.name).join("-")
                const key = "expr:" + exprPropName
                if (!seen.has(key)) {
                    seen.add(key)
                    bridges.push({
                        varName: rule.reactiveRefs.map(r => r.name).join(","),
                        customProp: exprPropName,
                        isExpression: true,
                        expr: rule.reactiveRefs[0].expr != null ? rule.reactiveRefs[0].expr : null,
                        scoped,
                        refs: rule.reactiveRefs,
                    })
                }
            } else {
                // Simple @var reference(s)
                for (const ref of rule.reactiveRefs) {
                    const customProp = "--scrml-" + ref.name
                    const key = "var:" + ref.name
                    if (!seen.has(key)) {
                        seen.add(key)
                        bridges.push({
                            varName: ref.name,
                            customProp,
                            isExpression: false,
                            expr: null,
                            scoped,
                            refs: [ref],
                        })
                    }
                }
            }
        }
    }

    return bridges
}

// ---------------------------------------------------------------------------
// Server-only node detection
// ---------------------------------------------------------------------------

// NOTE: Regex patterns containing literal { or } use String.fromCharCode
// to avoid confusing the block splitter's brace-depth counting.
// String.fromCharCode(123) = '{', String.fromCharCode(125) = '}'
const _collect_OB = String.fromCharCode(123)
const _collect_CB = String.fromCharCode(125)

const SERVER_CONTEXT_META_PATTERNS = [
    /\bprocess\.env\b/,
    /\bBun\.env\b/,
    /\bbun\.eval\s*\(/,
    /\bBun\.file\s*\(/,
    /\bBun\.write\s*\(/,
    /\bBun\.spawn\s*\(/,
    /\bBun\.serve\s*\(/,
    /\bnew\s+Database\s*\(/,
    /\bfs\./,
    /(?<!public )\benv\s*\(/,
]

// SQL sigil pattern: ?{` — using OB to avoid confusing the block splitter
const SQL_SIGIL_PATTERN = new RegExp("\\?" + _collect_OB + "`")

// Pattern to detect secret env() calls (server-only unless public)
const ENV_PATTERN = /(?<!public )\benv\s*\(/

function collectMetaExprStrings(body) {
    const exprs = []
    function walk(nodes) {
        if (!Array.isArray(nodes)) return
        for (const node of nodes) {
            if (!node || typeof node != "object") continue
            if (node.kind == "bare-expr" && node.expr) exprs.push(node.expr)
            if ((node.kind == "let-decl" || node.kind == "const-decl") && node.init) {
                exprs.push(typeof node.init == "string" ? node.init : String(node.init))
            }
            if (Array.isArray(node.body)) walk(node.body)
            if (Array.isArray(node.children)) walk(node.children)
            if (Array.isArray(node["consequent"])) walk(node["consequent"])
            if (Array.isArray(node["alternate"])) walk(node["alternate"])
        }
    }
    walk(body)
    return exprs
}

export function isServerOnlyNode(node) {
    if (!node || typeof node != "object") return false

    if (node.kind == "sql") return true
    if (node.kind == "transaction-block") return true

    if (node.kind == "meta") {
        const body = node.body
        if (!Array.isArray(body) || body.length == 0) return false
        const exprs = collectMetaExprStrings(body)
        return exprs.some(expr =>
            SERVER_CONTEXT_META_PATTERNS.some(pattern => pattern.test(expr))
        )
    }

    // Catch inline ?{} SQL sigil in let-decl / const-decl / reactive-decl init strings.
    if (node.kind == "let-decl" || node.kind == "const-decl" || node.kind == "state-decl") {
        const init = typeof node.init == "string" ? node.init : ""
        if (SQL_SIGIL_PATTERN.test(init)) return true
        if (ENV_PATTERN.test(init)) return true
    }

    // Catch inline ?{} SQL sigil in bare-expr nodes.
    if (node.kind == "bare-expr") {
        const expr = typeof node.expr == "string" ? node.expr : ""
        if (SQL_SIGIL_PATTERN.test(expr)) return true
        if (ENV_PATTERN.test(expr)) return true
    }

    return false
}

// ===========================================================================
// SECTION: analyze (from analyze.ts)
// ===========================================================================
//
// analyzeFile, analyzeAll
//
// All TypeScript interfaces (ASTNode, ProtectAnalysis, FileAST, FileAnalysis)
// are removed. collectChannelNodes is inlined here to avoid a cross-file import
// (in the self-hosted JS, all sections are concatenated into one module).
//
// collectChannelNodes from emit-channel.ts is inlined below.

function collectChannelNodes(nodes) {
    const result = []

    function visit(nodeList) {
        for (const node of nodeList) {
            if (!node || typeof node != "object") continue

            if (node.kind == "markup") {
                if ((node.tag != null ? node.tag : "") == "channel") {
                    result.push(node)
                }
                if (Array.isArray(node.children)) {
                    visit(node.children)
                }
                continue
            }

            if (node.kind == "logic" && Array.isArray(node.body)) {
                continue
            }

            if (Array.isArray(node.children)) {
                visit(node.children)
            }
        }
    }

    visit(nodes)
    return result
}

export function analyzeFile(fileAST) {
    const filePath = fileAST.filePath
    const nodes = getNodes(fileAST)

    // Collect test groups from ~{} nodes
    const testGroups = []
    for (const node of nodes) {
        if (node.kind == "test" && node.testGroup) {
            testGroups.push(node.testGroup)
        }
    }

    return {
        filePath,
        nodes,
        fnNodes: collectFunctions(fileAST),
        markupNodes: collectMarkupNodes(nodes),
        topLevelLogic: collectTopLevelLogicStatements(fileAST),
        cssBridges: collectCssVariableBridges(nodes),
        cssBlocks: collectCssBlocks(nodes),
        channelNodes: collectChannelNodes(nodes),
        overloadRegistry: fileAST.overloadRegistry,
        ir: createFileIR(filePath),
        testGroups,
    }
}

export function analyzeAll(input) {
    const { files, protectAnalysis } = input

    const protectedFields = collectProtectedFields(protectAnalysis)
    const fileAnalyses = new Map()

    if (!files) return { fileAnalyses, protectedFields }

    for (const fileAST of files) {
        const analysis = analyzeFile(fileAST)
        fileAnalyses.set(fileAST.filePath, analysis)
    }

    return { fileAnalyses, protectedFields }
}

// ===========================================================================
// SECTION: runtime-chunks (from runtime-chunks.ts)
// ===========================================================================
//
// RUNTIME_CHUNK_ORDER, RUNTIME_CHUNKS, assembleRuntime
//
// The TypeScript import `import { SCRML_RUNTIME } from "../runtime-template.js"` is
// preserved as a dynamic require() call since this JS runs in a Node/Bun context.
// The TS-only `as const` and type aliases (RuntimeChunkName, NonCoreChunkName) are
// removed entirely — plain strings are used throughout.

const { SCRML_RUNTIME, RUNTIME_FILENAME } = await import("../../src/runtime-template.js")

export const RUNTIME_CHUNK_ORDER = [
    "core",
    "derived",
    "lift",
    "scope",
    "timers",
    "animation",
    "reconciliation",
    "utilities",
    "meta",
    "transitions",
    "errors",
    "input",
    "equality",
    "deep_reactive",
]

// Chunk boundary markers.
// Each value is a short substring that appears EXACTLY ONCE in SCRML_RUNTIME
// and marks the start of the corresponding chunk. 'core' has no marker —
// it is everything before the first boundary.
const CHUNK_MARKERS = {
    derived:        "\u00a76.6 Derived reactive runtime",
    scope:          "\u00a76.7.3 Scope-aware cleanup registry",
    timers:         "\u00a76.7.5 / \u00a76.7.6 Timer and Poll runtime",
    animation:      "\u00a76.7.7 animationFrame runtime",
    meta:           "\u00a722.5 meta.emit() runtime",
    transitions:    "Transition CSS injection",
    errors:         "\u00a719 Built-in error types",
    input:          "\u00a735.1 Global input state registry",
    equality:       "\u00a745 Structural equality",
    deep_reactive:  "Fine-grained reactivity primitives (Reactivity Phase 1)",
    lift:           "function _scrml_lift",
    reconciliation: "function _scrml_reconcile_list",
    utilities:      "function _scrml_deep_set",
}

function buildRuntimeChunks() {
    // Locate each chunk boundary in SCRML_RUNTIME
    const positions = []

    for (const [name, marker] of Object.entries(CHUNK_MARKERS)) {
        const idx = SCRML_RUNTIME.indexOf(marker)
        if (idx == -1) {
            // Warn but don't crash — a missing marker means the chunk falls back to
            // the previous chunk boundary, and the runtime still works (just not tree-shaken).
            if (typeof console != "undefined") {
                console.warn("[scrml runtime-chunks] Marker not found for chunk \"" + name + "\": \"" + marker + "\". Tree-shaking will be disabled for this chunk.")
            }
            continue
        }
        positions.push({ name, idx })
    }

    // Sort by ascending position
    positions.sort((a, b) => a.idx - b.idx)

    const chunks = {}

    // 'core' is everything before the first boundary
    chunks.core = positions.length > 0
        ? SCRML_RUNTIME.slice(0, positions[0].idx)
        : SCRML_RUNTIME

    // Each subsequent chunk runs from its marker start to the next marker's start
    for (let i = 0; i < positions.length; i++) {
        const chunkStart = positions[i].idx
        const chunkEnd = i + 1 < positions.length ? positions[i + 1].idx : SCRML_RUNTIME.length
        chunks[positions[i].name] = SCRML_RUNTIME.slice(chunkStart, chunkEnd)
    }

    // Fill in any chunks that had missing markers with empty string
    for (const name of RUNTIME_CHUNK_ORDER) {
        if (chunks[name] == null) {
            chunks[name] = ""
        }
    }

    return chunks
}

export const RUNTIME_CHUNKS = buildRuntimeChunks()

export function assembleRuntime(chunkNames) {
    return RUNTIME_CHUNK_ORDER
        .filter(name => chunkNames.has(name))
        .map(name => RUNTIME_CHUNKS[name] != null ? RUNTIME_CHUNKS[name] : "")
        .join("")
}
