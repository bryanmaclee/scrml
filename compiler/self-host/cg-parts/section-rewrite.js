// ===========================================================================
// SECTION: reactive-deps (from reactive-deps.ts)
//
// AST-based reactive dependency extraction for the CG stage.
// External dependencies (provided at assembly time):
//   - getNodes         (from codegen/collect.ts section)
//   - extractReactiveDepsFromAST (from expression-parser.ts — external)
// ===========================================================================

/**
 * Extract all reactive variable names (@var) referenced in an expression string.
 *
 * Respects string literal boundaries — @var inside quoted strings is NOT extracted.
 * Handles single-quoted, double-quoted, and template literal strings.
 * Handles escaped characters inside strings.
 */
export function extractReactiveDeps(expr, knownReactiveVars = null) {
    if (!expr || typeof expr != "string") return new Set()

    // Phase 1 restructure: try acorn-based extraction first.
    // Falls back to manual scanner for expressions acorn can't parse.
    try {
        const astResult = extractReactiveDepsFromAST(expr, knownReactiveVars)
        if (astResult.size > 0) return astResult
    } catch {
        // Acorn parse failed — fall through to manual scanner
    }

    const found = new Set()
    let inString = null // null, '"', "'", or '`'
    let i = 0

    while (i < expr.length) {
        const ch = expr[i]

        if (inString === null) {
            if (ch === '"' || ch === "'" || ch === '`') {
                inString = ch
                i++
                continue
            }
            // Check for @varName pattern
            if (ch === '@') {
                // Peek ahead: must be followed by an identifier start char
                const rest = expr.slice(i + 1)
                const m = rest.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/)
                if (m) {
                    const varName = m[1]
                    if (knownReactiveVars === null || knownReactiveVars.has(varName)) {
                        found.add(varName)
                    }
                    i += 1 + varName.length
                    continue
                }
            }
            i++
        } else {
            // Inside a string literal
            if (ch === '\\') {
                // Skip the escaped character
                i += 2
                continue
            }
            if (ch === inString) {
                inString = null
            }
            i++
        }
    }

    return found
}

/**
 * Collect all reactive variable names declared in a fileAST.
 *
 * Walks logic blocks for reactive-decl nodes and returns their names.
 * This gives a fast lookup set for use with extractReactiveDeps filtering.
 */
export function collectReactiveVarNames(fileAST) {
    const names = new Set()
    const nodes = getNodes(fileAST)

    function visit(nodeList) {
        if (!Array.isArray(nodeList)) return
        for (const node of nodeList) {
            if (!node || typeof node != "object") continue
            const n = node
            if (n.kind == "state-decl" && n.name) {
                names.add(n.name)
            }
            if (n.kind == "logic" && Array.isArray(n.body)) {
                visit(n.body)
            }
            if (Array.isArray(n.children)) {
                visit(n.children)
            }
            // Recurse into control flow bodies (match arms, if/else, for/while, try)
            if (n.kind == "match-stmt" && Array.isArray(n.body)) {
                visit(n.body)
            }
            if (n.kind == "if-stmt") {
                if (Array.isArray(n.consequent)) visit(n.consequent)
                if (Array.isArray(n.alternate)) visit(n.alternate)
            }
            if ((n.kind == "for-stmt" || n.kind == "while-stmt") && Array.isArray(n.body)) {
                visit(n.body)
            }
            if (n.kind == "try-stmt") {
                if (Array.isArray(n.body)) visit(n.body)
                if (n.catchNode && Array.isArray(n.catchNode.body)) visit(n.catchNode.body)
                if (Array.isArray(n.finallyBody)) visit(n.finallyBody)
            }
        }
    }

    visit(nodes)
    return names
}

/**
 * Collect all derived reactive variable names declared in a fileAST.
 *
 * Walks logic blocks for reactive-derived-decl nodes and returns their names.
 * This set is used by rewriteReactiveRefs to route reads of derived names through
 * _scrml_derived_get() instead of _scrml_reactive_get().
 *
 * Per §6.6: `const @name = expr` declarations produce `reactive-derived-decl` nodes.
 * Their values live in the derived cache, not the reactive state map. Reads must use
 * _scrml_derived_get to benefit from lazy pull + dirty flag semantics.
 */
export function collectDerivedVarNames(fileAST) {
    const names = new Set()
    const nodes = getNodes(fileAST)

    function visit(nodeList) {
        if (!Array.isArray(nodeList)) return
        for (const node of nodeList) {
            if (!node || typeof node != "object") continue
            const n = node
            if (n.kind == "reactive-derived-decl" && n.name) {
                names.add(n.name)
            }
            if (n.kind == "logic" && Array.isArray(n.body)) {
                visit(n.body)
            }
            if (Array.isArray(n.children)) {
                visit(n.children)
            }
            // Recurse into control flow bodies (match arms, if/else, for/while, try)
            if (n.kind == "match-stmt" && Array.isArray(n.body)) {
                visit(n.body)
            }
            if (n.kind == "if-stmt") {
                if (Array.isArray(n.consequent)) visit(n.consequent)
                if (Array.isArray(n.alternate)) visit(n.alternate)
            }
            if ((n.kind == "for-stmt" || n.kind == "while-stmt") && Array.isArray(n.body)) {
                visit(n.body)
            }
            if (n.kind == "try-stmt") {
                if (Array.isArray(n.body)) visit(n.body)
                if (n.catchNode && Array.isArray(n.catchNode.body)) visit(n.catchNode.body)
                if (Array.isArray(n.finallyBody)) visit(n.finallyBody)
            }
        }
    }

    visit(nodes)
    return names
}

// ===========================================================================
// SECTION: type-encoding (from type-encoding.ts)
//
// Produces deterministic, collision-free encoded variable names for compiled
// JavaScript output. Each encoded name carries a type-derived component so
// that downstream stages and the runtime meta engine can decode type identity
// from the variable name alone (with a companion table for hash-based lookup).
//
// Encoding format:  _<kind><hash><seq>        (production)
//                   _<kind><hash><seq>$<name>  (debug)
//
// External dependencies:
//   - CGError (from codegen/errors section)
// ===========================================================================

// Note: Regex containing literal { } use String.fromCharCode to avoid
// confusing the block splitter.
// String.fromCharCode(123) = '{', String.fromCharCode(125) = '}'

// ---------------------------------------------------------------------------
// Type factory functions — replaces TS interfaces (no runtime needed, kept as
// documentation pattern; actual values are plain objects from callers)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Kind marker map — single char per ResolvedType discriminant
// ---------------------------------------------------------------------------

export const KIND_MARKERS = {
    struct: "s",
    enum: "e",
    primitive: "p",
    array: "a",
    union: "u",
    state: "t",
    error: "r",
    "html-element": "h",
    function: "f",
    "meta-splice": "m",
    "ref-binding": "b",
    asIs: "x",
    not: "n",
    cssClass: "k",
    unknown: "p", // treated as primitive-like for encoding purposes
}

/** Reverse map: marker char -> full kind name */
export const MARKER_TO_KIND = {
    s: "struct",
    e: "enum",
    p: "primitive",
    a: "array",
    u: "union",
    t: "state",
    r: "error",
    h: "html-element",
    f: "function",
    m: "meta-splice",
    b: "ref-binding",
    x: "asIs",
    n: "not",
    k: "cssClass",
}

// ---------------------------------------------------------------------------
// normalizeType — canonical string form for hashing
// ---------------------------------------------------------------------------

/**
 * Convert a ResolvedType to its canonical string form.
 *
 * Recursive types use `&Name` reference to prevent infinite recursion.
 * The `seen` set tracks struct/enum names currently being expanded.
 */
export function normalizeType(type, seen) {
    const s = seen ?? new Set()

    switch (type.kind) {
        case "primitive":
            return `p:${type.name}`

        case "struct": {
            if (s.has(type.name)) return `&${type.name}`
            s.add(type.name)
            const fields = [...type.fields.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${k}:${normalizeType(v, s)}`)
                .join(",")
            s.delete(type.name)
            return `s:${type.name}` + String.fromCharCode(123) + fields + String.fromCharCode(125)
        }

        case "enum": {
            if (s.has(type.name)) return `&${type.name}`
            s.add(type.name)
            // variants in declaration order
            const variants = type.variants.map((v) => v.name).join(",")
            s.delete(type.name)
            return `e:${type.name}` + String.fromCharCode(123) + variants + String.fromCharCode(125)
        }

        case "array":
            return `a:[${normalizeType(type.element, s)}]`

        case "union": {
            // members sorted by their canonical form
            const members = type.members
                .map((m) => normalizeType(m, s))
                .sort()
                .join("|")
            return `u:(${members})`
        }

        case "state":
            return `t:${type.name}`

        case "error": {
            const fields = [...type.fields.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${k}:${normalizeType(v, s)}`)
                .join(",")
            return `r:${type.name}` + String.fromCharCode(123) + fields + String.fromCharCode(125)
        }

        case "html-element":
            return `h:${type.tag}`

        case "function": {
            const params = type.params
                .map((p) => {
                    if (p && typeof p === "object" && "type" in p) {
                        return normalizeType(p.type, s)
                    }
                    return String(p)
                })
                .join(",")
            return `f:${type.name}(${params}):${normalizeType(type.returnType, s)}`
        }

        case "not":
            return "n:"

        case "asIs":
            return `x:${type.constraint ? normalizeType(type.constraint, s) : ""}`

        case "cssClass":
            return "k:"

        case "meta-splice":
            return `m:${normalizeType(type.resultType, s)}`

        case "ref-binding":
            return `b:${normalizeType(type.resolvedType, s)}`

        case "unknown":
            return "p:unknown"

        default:
            return "p:unknown"
    }
}

// ---------------------------------------------------------------------------
// FNV-1a hash — 32-bit, output as 8-char base36
// ---------------------------------------------------------------------------

const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619

/**
 * FNV-1a 32-bit hash, output as zero-padded 8-char base36 string (~41 bits).
 */
export function fnv1aHash(input) {
    let hash = FNV_OFFSET
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, FNV_PRIME) >>> 0 // keep unsigned 32-bit
    }
    return hash.toString(36).padStart(8, "0")
}

// ---------------------------------------------------------------------------
// encodeTypeName / encodeTypeNameDebug
// ---------------------------------------------------------------------------

/**
 * Produce the full encoded variable name.
 * Format: `_<kind><hash><seq>`
 */
export function encodeTypeName(type, seq) {
    const kind = KIND_MARKERS[type.kind] ?? "p"
    const hash = fnv1aHash(normalizeType(type))
    const seqChar = seq.toString(36)
    return `_${kind}${hash}${seqChar}`
}

/**
 * Debug mode variant.
 * Format: `_<kind><hash><seq>$<originalName>`
 */
export function encodeTypeNameDebug(type, seq, originalName) {
    const base = encodeTypeName(type, seq)
    return `${base}$${originalName}`
}

// ---------------------------------------------------------------------------
// decodeKind — extract kind from an encoded name
// ---------------------------------------------------------------------------

// Encoded name pattern: _<kindChar><8-char-hash><seqChar>[optional $debug]
// NOTE: uses String.fromCharCode to avoid brace confusion in block splitter
const _ENCODED_PATTERN_SRC = "^_([a-z])([0-9a-z]" + String.fromCharCode(123) + "8" + String.fromCharCode(125) + ")([0-9a-z])(\\$.*)?$"
const ENCODED_PATTERN = new RegExp(_ENCODED_PATTERN_SRC)

/**
 * Extract the kind from an encoded variable name.
 * Returns the full kind name ("struct", "enum", etc.) or null if not valid.
 */
export function decodeKind(encodedName) {
    const m = ENCODED_PATTERN.exec(encodedName)
    if (!m) return null
    return MARKER_TO_KIND[m[1]] ?? null
}

// ---------------------------------------------------------------------------
// CollisionChecker
// ---------------------------------------------------------------------------

/**
 * Detects type-identity collisions: two structurally different types mapping
 * to the same encoded prefix (_<kind><hash>). Throws E-CG-010 on collision.
 */
export class CollisionChecker {
    constructor() {
        /** Map from encoded prefix (_<kind><hash>) to the canonical type string. */
        this.registry = new Map()
    }

    /**
     * Check a type against its encoded prefix. If a different type was already
     * registered for the same prefix, throw E-CG-010.
     */
    check(type, encodedPrefix) {
        const canonical = normalizeType(type)
        const existing = this.registry.get(encodedPrefix)

        if (existing !== undefined && existing != canonical) {
            throw new CGError(
                "E-CG-010",
                `Type encoding collision: prefix "${encodedPrefix}" maps to both ` +
                    `"${existing}" and "${canonical}". This is a compiler defect — ` +
                    `please report it.`,
                {}
            )
        }

        this.registry.set(encodedPrefix, canonical)
    }

    /** Clear all registered encodings. */
    reset() {
        this.registry.clear()
    }
}

// ---------------------------------------------------------------------------
// EncodingContext — per-file name mapping registry for the emit pipeline
// ---------------------------------------------------------------------------

/**
 * Manages the mapping from original variable names to encoded names during
 * a single compilation unit (file). Thread an instance through the emit
 * pipeline so every emitter can resolve names consistently.
 *
 * Usage:
 *   const ctx = new EncodingContext({ debug: false });
 *   ctx.register("user", userType);       // → "_s7km3f2x00"
 *   ctx.encode("user");                   // → "_s7km3f2x00"
 *   ctx.encode("unknownVar");             // → "unknownVar" (passthrough)
 *
 * When `debug` is true, encoded names include the `$originalName` suffix.
 * When `enabled` is false (default for backward compat), all encode() calls
 * return the original name unchanged.
 */
export class EncodingContext {
    constructor(opts = {}) {
        /** Whether encoding is active. When false, encode() is a passthrough. */
        this.enabled = opts.enabled ?? false
        /** Whether to append $originalName debug suffix. */
        this.debug = opts.debug ?? false
        /** Map from original name → encoded name. */
        this.nameMap = new Map()
        /** Map from original name → ResolvedType (for decode table generation). */
        this.typeMap = new Map()
        /** Seq counter per encoded prefix (_<kind><hash>) for disambiguation. */
        this.seqCounters = new Map()
        /** Collision checker instance. */
        this.collisionChecker = new CollisionChecker()
    }

    /**
     * Register a variable name with its resolved type. Assigns an encoded
     * name and stores the mapping. Returns the encoded name.
     *
     * If the name is already registered, returns the existing encoded name.
     * If encoding is disabled, returns the original name.
     */
    register(originalName, type) {
        if (!this.enabled) return originalName
        if (this.nameMap.has(originalName)) return this.nameMap.get(originalName)

        const kind = KIND_MARKERS[type.kind] ?? "p"
        const hash = fnv1aHash(normalizeType(type))
        const prefix = `_${kind}${hash}`

        // Collision check
        this.collisionChecker.check(type, prefix)

        // Assign seq
        const seq = this.seqCounters.get(prefix) ?? 0
        this.seqCounters.set(prefix, seq + 1)

        // Check overflow (>1332 same-type bindings)
        if (seq > 1331) {
            throw new CGError(
                "E-CG-014",
                `Disambiguator overflow: scope contains more than 1,332 bindings ` +
                    `of type "${normalizeType(type)}" (prefix "${prefix}").`,
                {}
            )
        }

        const encoded = this.debug
            ? encodeTypeNameDebug(type, seq, originalName)
            : encodeTypeName(type, seq)

        this.nameMap.set(originalName, encoded)
        this.typeMap.set(originalName, type)
        return encoded
    }

    /**
     * Look up the encoded name for an original variable name.
     * Returns the encoded name if registered, otherwise the original name
     * (passthrough for unregistered names or when encoding is disabled).
     */
    encode(originalName) {
        if (!this.enabled) return originalName
        return this.nameMap.get(originalName) ?? originalName
    }

    /**
     * Check whether a name has been registered.
     */
    has(originalName) {
        return this.nameMap.has(originalName)
    }

    /**
     * Retrieve the ResolvedType registered for an original variable name.
     * Returns undefined if the name has not been registered.
     */
    getType(originalName) {
        return this.typeMap.get(originalName)
    }

    /**
     * Return a read-only view of all name mappings (original → encoded).
     */
    get mappings() {
        return this.nameMap
    }

    /** Clear all state for reuse. */
    reset() {
        this.nameMap.clear()
        this.typeMap.clear()
        this.seqCounters.clear()
        this.collisionChecker.reset()
    }
}

// ---------------------------------------------------------------------------
// toTypeDescriptor — build a TypeDescriptor from a ResolvedType
// ---------------------------------------------------------------------------

/**
 * Recursively convert a ResolvedType into a TypeDescriptor for runtime
 * reflection. The `seen` set prevents infinite recursion on self-referential
 * struct/enum types.
 */
export function toTypeDescriptor(type, seen) {
    const s = seen ?? new Set()

    switch (type.kind) {
        case "primitive":
            return { kind: type.name }

        case "struct": {
            if (s.has(type.name)) return { kind: "struct", name: type.name }
            s.add(type.name)
            const fields = [...type.fields.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([fieldName, fieldType]) => ({
                    name: fieldName,
                    type: toTypeDescriptor(fieldType, s),
                }))
            s.delete(type.name)
            return { kind: "struct", name: type.name, fields }
        }

        case "enum": {
            if (s.has(type.name)) return { kind: "enum", name: type.name }
            s.add(type.name)
            const variants = type.variants.map((v) => ({ name: v.name }))
            s.delete(type.name)
            return { kind: "enum", name: type.name, variants }
        }

        case "array":
            return { kind: "array", element: toTypeDescriptor(type.element, s) }

        case "union": {
            const members = type.members.map((m) => toTypeDescriptor(m, s))
            return { kind: "union", members }
        }

        case "function": {
            const params = type.params.map((p) => {
                if (p && typeof p === "object" && "type" in p) {
                    return toTypeDescriptor(p.type, s)
                }
                return { kind: "unknown" }
            })
            return {
                kind: "function",
                name: type.name,
                params,
                returnType: toTypeDescriptor(type.returnType, s),
            }
        }

        case "state":
            return { kind: "state", name: type.name }

        case "error": {
            const fields = [...type.fields.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([fieldName, fieldType]) => ({
                    name: fieldName,
                    type: toTypeDescriptor(fieldType, s),
                }))
            return { kind: "error", name: type.name, fields }
        }

        case "html-element":
            return { kind: "html-element", name: type.tag }

        case "meta-splice":
            return { kind: "meta-splice" }

        case "ref-binding":
            return { kind: "ref-binding" }

        case "asIs":
            return { kind: "asIs" }

        case "cssClass":
            return { kind: "cssClass" }

        case "not":
            return { kind: "not" }

        case "unknown":
        default:
            return { kind: "unknown" }
    }
}

// ---------------------------------------------------------------------------
// emitDecodeTable — generate the _scrml_decode_table declaration (§47.2)
// ---------------------------------------------------------------------------

/**
 * Generate a JavaScript `const _scrml_decode_table = { ... };` declaration
 * from an EncodingContext. Maps encoded name prefixes (10-char `_<kind><hash>`)
 * to pre-built TypeDescriptor objects.
 *
 * Returns an empty table declaration when the context is disabled or has no
 * registered mappings.
 */
export function emitDecodeTable(ctx) {
    if (!ctx.enabled || ctx.mappings.size === 0) {
        return "const _scrml_decode_table = " + String.fromCharCode(123) + String.fromCharCode(125) + ";"
    }

    // Deduplicate by prefix — multiple bindings with the same prefix share one entry
    const prefixToDescriptor = new Map()

    for (const [originalName, encodedName] of ctx.mappings) {
        const prefix = encodedName.slice(0, 10)
        if (prefixToDescriptor.has(prefix)) continue

        const type = ctx.getType(originalName)
        if (!type) continue

        prefixToDescriptor.set(prefix, toTypeDescriptor(type))
    }

    const entries = []
    for (const [prefix, descriptor] of prefixToDescriptor) {
        entries.push(`${JSON.stringify(prefix)}: ${JSON.stringify(descriptor)}`)
    }

    return `const _scrml_decode_table = ` + String.fromCharCode(123) + ` ${entries.join(", ")} ` + String.fromCharCode(125) + `;`
}

// ---------------------------------------------------------------------------
// emitRuntimeReflect — generate the _scrml_reflect function (§47.4.2)
// ---------------------------------------------------------------------------

/**
 * Generate the runtime `_scrml_reflect` function as a JavaScript string.
 * This function looks up a TypeDescriptor from the decode table by extracting
 * the 10-char prefix from an encoded variable name.
 */
export function emitRuntimeReflect() {
    return [
        "function _scrml_reflect(encodedName) " + String.fromCharCode(123),
        '  if (typeof encodedName !== "string" || !encodedName.startsWith("_")) return ' + String.fromCharCode(123) + ' kind: "foreign" ' + String.fromCharCode(125) + ';',
        "  const prefix = encodedName.slice(0, 10);",
        "  const entry = _scrml_decode_table[prefix];",
        '  return entry || ' + String.fromCharCode(123) + ' kind: "foreign" ' + String.fromCharCode(125) + ';',
        String.fromCharCode(125),
    ].join("\n")
}

// ===========================================================================
// SECTION: rewrite (from rewrite.ts)
//
// Expression rewrite passes for the CG stage.
//
// External dependencies (provided at assembly time):
//   - genVar                      (from var-counter.ts section)
//   - splitBareExprStatements     (from compat/parser-workarounds.js section)
//   - rewriteReactiveRefsAST      (from expression-parser.ts — external)
//   - rewriteServerReactiveRefsAST (from expression-parser.ts — external)
// ===========================================================================

// NOTE: All regex patterns containing literal { or } use String.fromCharCode(123) / (125)
// to avoid confusing the block splitter's brace-depth counting.
// OB = '{', CB = '}'
const _RW_OB = String.fromCharCode(123)
const _RW_CB = String.fromCharCode(125)

// ---------------------------------------------------------------------------
// rewriteReactiveRefs
// ---------------------------------------------------------------------------

/**
 * Rewrite `@varName` reactive references to runtime getter calls.
 */
export function rewriteReactiveRefs(expr, derivedNames = null) {
    if (!expr || typeof expr != "string") return expr

    const astRewrite = rewriteReactiveRefsAST(expr, derivedNames)
    if (astRewrite.ok) return astRewrite.result

    const hasDerived = derivedNames && derivedNames.size > 0

    const result = []
    let inString = null
    let i = 0
    let segStart = 0

    while (i < expr.length) {
        const ch = expr[i]

        if (inString === null) {
            if (ch === '"' || ch === "'" || ch === '`') {
                const segment = expr.slice(segStart, i)
                result.push(_rewriteSegment(segment, hasDerived ? derivedNames : null))
                inString = ch
                segStart = i
            }
        } else {
            if (ch === '\\') {
                i++
            } else if (ch === inString) {
                result.push(expr.slice(segStart, i + 1))
                inString = null
                segStart = i + 1
            }
        }
        i++
    }

    const remaining = expr.slice(segStart)
    if (inString === null) {
        result.push(_rewriteSegment(remaining, hasDerived ? derivedNames : null))
    } else {
        result.push(remaining)
    }

    return result.join("")
}

function _rewriteSegment(segment, derivedNames) {
    if (!derivedNames) {
        return segment.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, '_scrml_reactive_get("$1")')
    }
    return segment.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, (_, name) => {
        if (derivedNames.has(name)) {
            return `_scrml_derived_get("${name}")`
        }
        return `_scrml_reactive_get("${name}")`
    })
}

// ---------------------------------------------------------------------------
// extractSqlParams
// ---------------------------------------------------------------------------

/**
 * Extract `${expr}` interpolations from a SQL template literal string.
 */
export function extractSqlParams(sqlContent) {
    const params = []
    let sql = ""
    let i = 0

    while (i < sqlContent.length) {
        if (sqlContent[i] === '$' && sqlContent[i + 1] === '{') {
            let depth = 1
            let j = i + 2
            while (j < sqlContent.length && depth > 0) {
                if (sqlContent[j] === '{') depth++
                else if (sqlContent[j] === '}') depth--
                if (depth > 0) j++
            }
            const paramExpr = sqlContent.slice(i + 2, j)
            params.push(paramExpr)
            sql += `?${params.length}`
            i = j + 1
        } else {
            sql += sqlContent[i]
            i++
        }
    }

    return { sql, params }
}

// ---------------------------------------------------------------------------
// rewriteSqlRefs
// ---------------------------------------------------------------------------

/**
 * Rewrite `?{`...`}.method()` and bare `?{`...`}` inline SQL blocks to
 * parameterized runtime database calls.
 *
 * Special handling for `.prepare()`:
 *   `?{`INSERT INTO users (name) VALUES (${name})`}.prepare()`
 *   → `_scrml_db.prepare("INSERT INTO users (name) VALUES (?1)")`
 *
 * The `.prepare()` method returns a reusable PreparedStatement. Bound params
 * are NOT passed at prepare time — they are passed when the statement is
 * later executed via `.run()`, `.all()`, or `.get()` on the returned object.
 * This matches the bun:sqlite API (§8.5).
 *
 * All other methods (`.all()`, `.first()`, `.get()`, `.run()`) pass bound
 * params immediately at call time.
 */
export function rewriteSqlRefs(expr, dbVar = "_scrml_db") {
    if (!expr || typeof expr != "string") return expr

    // Pattern: ?{`...`}.method() — using string concatenation to avoid brace confusion
    const sqlMethodPat = new RegExp("\\?" + _RW_OB + "`([^`]*)`" + _RW_CB + "\\.(\\w+)\\(\\)", "g")
    let result = expr.replace(sqlMethodPat, (_, sqlContent, method) => {
        const { sql, params } = extractSqlParams(sqlContent)
        // .prepare() returns a reusable PreparedStatement — params are bound at
        // execution time, not at prepare time. Emit db.prepare(sql) without params.
        if (method === "prepare") {
            return `${dbVar}.prepare(${JSON.stringify(sql)})`
        }
        const argList = params.length > 0 ? params.join(", ") : ""
        return `${dbVar}.query(${JSON.stringify(sql)}).${method}(${argList})`
    })

    // Pattern: ?{`...`} bare — using string concatenation to avoid brace confusion
    const sqlBarePat = new RegExp("\\?" + _RW_OB + "`([^`]*)`" + _RW_CB, "g")
    result = result.replace(sqlBarePat, (_, sqlContent) => {
        const { sql, params } = extractSqlParams(sqlContent)
        const argList = params.length > 0 ? params.join(", ") : ""
        return `_scrml_sql_exec(${JSON.stringify(sql)}${argList ? `, ${argList}` : ""})`
    })

    return result
}

// ---------------------------------------------------------------------------
// rewriteNavigateCalls
// ---------------------------------------------------------------------------

/**
 * Rewrite `navigate(path)` calls to the runtime navigation function.
 */
export function rewriteNavigateCalls(expr) {
    if (!expr || typeof expr != "string") return expr
    return expr.replace(/\bnavigate\s*\(/g, '_scrml_navigate(')
}

// ---------------------------------------------------------------------------
// rewriteWorkerRefs
// ---------------------------------------------------------------------------

/**
 * §4.12.4: Rewrite `<#name>.send(expr)` worker references to runtime worker calls.
 * Must run BEFORE rewriteInputStateRefs which would consume the `<#name>` pattern.
 */
export function rewriteWorkerRefs(expr) {
    if (!expr || typeof expr != "string") return expr
    if (!expr.includes("<#")) return expr
    // <#name>.send(expr) → _scrml_worker_name.send(expr)
    return expr.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>\s*\.\s*send\s*\(/g, '_scrml_worker_$1.send(')
}

// ---------------------------------------------------------------------------
// rewriteInputStateRefs
// ---------------------------------------------------------------------------

/**
 * Rewrite `<#identifier>` input state references to runtime registry lookups (§35).
 */
export function rewriteInputStateRefs(expr) {
    if (!expr || typeof expr != "string") return expr
    return expr.replace(/<#([A-Za-z_$][A-Za-z0-9_$]*)>/g, '_scrml_input_state_registry.get("$1")')
}

// ---------------------------------------------------------------------------
// rewriteBunEval
// ---------------------------------------------------------------------------

/**
 * Evaluate `bun.eval("...")` calls at compile time and replace with literal results.
 */
export function rewriteBunEval(expr, errors) {
    if (!expr || typeof expr != "string") return expr
    if (!expr.includes("bun") || !/\bbun\s*\.\s*eval\b/.test(expr)) return expr

    // Pattern: bun.eval("...") with single/double/template quoted arg
    const bunEvalPat = /\bbun\s*\.\s*eval\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*\)/g
    return expr.replace(bunEvalPat, (match, strArg) => {
        const code = strArg.slice(1, -1)
        try {
            const result = new Function(`return (${code})`)()
            if (result === undefined) return "undefined"
            if (result === null) return "null"
            if (typeof result === "string") return JSON.stringify(result)
            if (typeof result === "number" || typeof result === "boolean") return String(result)
            return JSON.stringify(result)
        } catch (err) {
            if (errors) {
                errors.push({
                    code: "E-EVAL-001",
                    message: `E-EVAL-001: bun.eval() failed at compile time: ${err.message}. Expression: ${code}`,
                    severity: "error",
                })
            }
            return match
        }
    })
}

// ---------------------------------------------------------------------------
// rewriteIsOperator
// ---------------------------------------------------------------------------

/**
 * Rewrite the scrml `is` operator for single-variant enum checks.
 */
export function rewriteIsOperator(expr) {
    if (!expr || typeof expr != "string") return expr
    expr = expr.replace(/\bis\s+[A-Z][A-Za-z0-9_]*\.([A-Z][A-Za-z0-9_]*)\b/g, '=== "$1"')
    expr = expr.replace(/\bis\s+\.([A-Z][A-Za-z0-9_]*)\b/g, '=== "$1"')
    return expr
}

// ---------------------------------------------------------------------------
// rewritePresenceGuard
// ---------------------------------------------------------------------------

/**
 * Rewrite `(x) => { body }` presence guard to `if (x !== null && x !== undefined) { body }` (§42).
 *
 * Only rewrites when the ENTIRE expression is a single-identifier presence guard:
 *   ( identifier ) => { ... }
 *
 * This does NOT rewrite multi-param arrows `(x, y) => ...` or expression-body
 * arrows `x => x + 1` or inline callbacks like `.map((x) => x.value)`.
 *
 * Safe because this runs on the bare-expr string — a standalone `(x) => { body }`
 * at statement level is unambiguously a presence guard, not a value-producing arrow.
 */
export function rewritePresenceGuard(expr) {
    if (!expr || typeof expr != "string") return expr
    // Quick exit: must contain "=>" and "{"
    if (!expr.includes("=>") || !expr.includes("{")) return expr

    const trimmed = expr.trim()
    // Match: ( identifier ) => { body }
    // The body may span multiple lines/tokens — use a brace-counting approach.
    // NOTE: regex uses String.fromCharCode to avoid brace confusion
    const presenceReSrc = "^\\(\\s*([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\)\\s*=>\\s*" + _RW_OB + "([\\s\\S]*)" + _RW_CB + "\\s*$"
    const presenceRe = new RegExp(presenceReSrc)
    const m = trimmed.match(presenceRe)
    if (!m) return expr

    const varName = m[1]
    const body = m[2] // raw body content (already has spaces from tokenizer)

    return `if (${varName} !== null && ${varName} !== undefined) ` + _RW_OB + body + _RW_CB
}

// ---------------------------------------------------------------------------
// rewriteNotKeyword
// ---------------------------------------------------------------------------

/**
 * Rewrite `not` keyword and `is not` operator to JavaScript equivalents (§42).
 * Also detects E-SYNTAX-010 (`null`/`undefined` in value position) and
 * E-TYPE-042 (`== not`/`!= not`) when an errors array is provided.
 */
export function rewriteNotKeyword(expr, errors) {
    if (!expr || typeof expr != "string") return expr

    const hasNot = expr.includes("not")
    const hasNull = expr.includes("null")
    const hasUndefined = expr.includes("undefined")

    if (!hasNot && !hasNull && !hasUndefined) return expr

    // Split on string literals to avoid rewriting inside quoted content.
    const result = []
    let inString = null
    let i = 0
    let segStart = 0

    while (i < expr.length) {
        const ch = expr[i]
        if (inString === null) {
            if (ch === '"' || ch === "'" || ch === '`') {
                result.push(_rewriteNotSegment(expr.slice(segStart, i), errors))
                inString = ch
                segStart = i
            }
        } else {
            if (ch === '\\') {
                i++ // skip escaped character
            } else if (ch === inString) {
                inString = null
                i++
                result.push(expr.slice(segStart, i)) // preserve string literal as-is
                segStart = i
                continue
            }
        }
        i++
    }
    result.push(_rewriteNotSegment(expr.slice(segStart), errors))
    return result.join("")
}

function _rewriteNotSegment(segment, errors) {
    // E-TYPE-042: detect `== not` / `!= not` / `=== not` / `!== not` patterns (§42)
    if (errors) {
        const eqNotRe = /(?:===?|!==?)\s*not(?![A-Za-z0-9_$])/g
        let eqNotMatch
        while ((eqNotMatch = eqNotRe.exec(segment)) !== null) {
            const op = eqNotMatch[0].trim().replace(/\s*not$/, "")
            const hint = op.startsWith("!") ? "!(x is not)" : "x is not"
            errors.push({
                code: "E-TYPE-042",
                message: `E-TYPE-042: \`${op} not\` is not a valid absence check. Use \`${hint}\` instead — scrml uses \`is not\` for absence checks (§42).`,
            })
        }
    }
    // E-SYNTAX-010: detect `null` or `undefined` as standalone identifiers (§42)
    if (errors) {
        const nullRe = /(?<![A-Za-z0-9_$.])(null|undefined)(?![A-Za-z0-9_$])/g
        let nullMatch
        while ((nullMatch = nullRe.exec(segment)) !== null) {
            errors.push({
                code: "E-SYNTAX-010",
                message: `E-SYNTAX-010: \`${nullMatch[1]}\` is not a valid scrml value. Use \`not\` instead — scrml uses \`not\` as the unified absence value (§42).`,
            })
        }
    }
    // Match `@varName is not not` or `identifier is not not` (presence check, §42).
    // MUST run before the `is not` replacement — otherwise the first `is not` consumes
    // the token and the trailing `not` becomes a stray `null`.
    segment = segment.replace(/(@?[A-Za-z_$][A-Za-z0-9_$.]*) is not not(?![A-Za-z0-9_$])/g,
        '($1 !== null && $1 !== undefined)')
    // Match `@varName is not` or `identifier is not` or `dotted.path is not` (absence check).
    // The @-prefix is included in the capture so it is preserved in the output
    // (the @-to-reactive_get() rewrite runs after this pass).
    segment = segment.replace(/(@?[A-Za-z_$][A-Za-z0-9_$.]*) is not(?![A-Za-z0-9_$])/g,
        '($1 === null || $1 === undefined)')
    segment = segment.replace(/(?<![A-Za-z0-9_$@])not(?![A-Za-z0-9_$])/g, 'null')
    return segment
}

// ---------------------------------------------------------------------------
// parseInlineMatchArm / splitInlineArms / rewriteMatchExpr
// ---------------------------------------------------------------------------

function parseInlineMatchArm(text) {
    const newVariantMatch = text.match(/^\.\s*([A-Z][A-Za-z0-9_]*)(?:\s*\(\s*(\w+)\s*\))?\s*=>\s*([\s\S]+)$/)
    if (newVariantMatch) {
        return { kind: "variant", test: newVariantMatch[1], result: newVariantMatch[3].trim() }
    }

    const newDqMatch = text.match(/^"((?:[^"\\]|\\.)*)"\s*=>\s*([\s\S]+)$/)
    if (newDqMatch) {
        return { kind: "string", test: `"${newDqMatch[1]}"`, result: newDqMatch[2].trim() }
    }

    const newSqMatch = text.match(/^'((?:[^'\\]|\\.)*)'\s*=>\s*([\s\S]+)$/)
    if (newSqMatch) {
        return { kind: "string", test: `'${newSqMatch[1]}'`, result: newSqMatch[2].trim() }
    }

    // §42: `not => expr` — absence arm in inline match
    const notArmMatch = text.match(/^not\s*=>\s*([\s\S]+)$/)
    if (notArmMatch) {
        return { kind: "not", test: null, result: notArmMatch[1].trim() }
    }

    const newWildcardMatch = text.match(/^else\s*(?:=>\s*)?([\s\S]+)$/)
    if (newWildcardMatch) {
        return { kind: "wildcard", test: null, result: newWildcardMatch[1].trim() }
    }

    const legacyVariantMatch = text.match(/^::\s*(\w+)(?:\s*\(\s*(\w+)\s*\))?\s*->\s*([\s\S]+)$/)
    if (legacyVariantMatch) {
        return { kind: "variant", test: legacyVariantMatch[1], result: legacyVariantMatch[3].trim() }
    }

    const legacyDqMatch = text.match(/^"((?:[^"\\]|\\.)*)"\s*->\s*([\s\S]+)$/)
    if (legacyDqMatch) {
        return { kind: "string", test: `"${legacyDqMatch[1]}"`, result: legacyDqMatch[2].trim() }
    }

    const legacySqMatch = text.match(/^'((?:[^'\\]|\\.)*)'\s*->\s*([\s\S]+)$/)
    if (legacySqMatch) {
        return { kind: "string", test: `'${legacySqMatch[1]}'`, result: legacySqMatch[2].trim() }
    }

    const legacyWildcardMatch = text.match(/^_\s*->\s*([\s\S]+)$/)
    if (legacyWildcardMatch) {
        return { kind: "wildcard", test: null, result: legacyWildcardMatch[1].trim() }
    }

    // §42 presence arm: (identifier) => expr — counterpart to `not => expr`
    const presenceArmMatch = text.match(/^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>\s*([\s\S]+)$/)
    if (presenceArmMatch) {
        return { kind: "wildcard", test: null, result: presenceArmMatch[2].trim() }
    }

    return null
}

/**
 * Split a multi-arm string on arm boundaries.
 *
 * Private version for use in splitInlineArms when inline match arms are on one
 * line without newline separators (BUG-R13-001). Same logic as splitMultiArmString
 * in emit-control-flow.ts — duplicated here to avoid cross-module coupling.
 *
 * An arm boundary is detected when we find an arm-start token at a non-string
 * position that is not a property access:
 *   - .UpperCase  (new variant arm — only when NOT preceded by identifier char)
 *   - "..." =>    (string literal arm, followed by => or ->)
 *   - '...' =>    (string literal arm, followed by => or ->)
 *   - else        (wildcard arm — when preceded by whitespace or start)
 *   - ::letter    (legacy variant arm)
 *   - _ ->        (legacy wildcard arm)
 *
 * Returns [s] when only zero or one arm boundary is found.
 */
function _splitMultiArmString(s) {
    const armStartPositions = []
    let inString = null
    let i = 0

    while (i < s.length) {
        const ch = s[i]

        if (inString !== null) {
            if (ch === "\\") { i += 2; continue }
            if (ch === inString) { inString = null }
            i++
            continue
        }

        if (/\s/.test(ch)) { i++; continue }

        // New variant arm: .UpperCase or . UpperCase (BS adds spaces around .)
        // Only when NOT preceded by an identifier char.
        if (ch === "." && i + 1 < s.length) {
            let nextNonSpace = i + 1
            while (nextNonSpace < s.length && s[nextNonSpace] === " ") nextNonSpace++
            if (nextNonSpace < s.length && /[A-Z]/.test(s[nextNonSpace])) {
                const prevCh = i > 0 ? s[i - 1] : null
                if (prevCh === null || !/[A-Za-z0-9_$]/.test(prevCh)) {
                    armStartPositions.push(i)
                }
            }
            i++
            continue
        }

        // String literal arm: "..." => / '...' => or -> only (not bare strings in results)
        if (ch === '"' || ch === "'") {
            const q = ch
            let j = i + 1
            while (j < s.length && s[j] != q) {
                if (s[j] === "\\") j++
                j++
            }
            if (j < s.length) {
                let k = j + 1
                while (k < s.length && /\s/.test(s[k])) k++
                if (s.slice(k, k + 2) === "=>" || s.slice(k, k + 2) === "->") {
                    armStartPositions.push(i)
                    inString = q
                    i++
                    continue
                }
            }
            inString = q
            i++
            continue
        }

        // §42 absence arm: not => — only when preceded by whitespace or start
        if (s.slice(i, i + 3) === "not" && (i + 3 >= s.length || /[\s=]/.test(s[i + 3]))) {
            const prevCh = i > 0 ? s[i - 1] : null
            if (prevCh === null || /\s/.test(prevCh)) {
                let k = i + 3
                while (k < s.length && /\s/.test(s[k])) k++
                if (s.slice(k, k + 2) === "=>") {
                    armStartPositions.push(i)
                    i += 3
                    continue
                }
            }
        }

        // Wildcard arm: else — only when preceded by whitespace or start-of-string
        if (s.slice(i, i + 4) === "else" && (i + 4 >= s.length || /[\s=>]/.test(s[i + 4]))) {
            const prevCh = i > 0 ? s[i - 1] : null
            if (prevCh === null || /\s/.test(prevCh)) {
                armStartPositions.push(i)
                i += 4
                continue
            }
        }

        // Legacy variant arm: ::Letter
        if (ch === ":" && i + 1 < s.length && s[i + 1] === ":" && i + 2 < s.length && /[A-Za-z_]/.test(s[i + 2])) {
            armStartPositions.push(i)
            i += 2
            continue
        }

        // Legacy wildcard: _ ->
        if (ch === "_") {
            let k = i + 1
            while (k < s.length && /\s/.test(s[k])) k++
            if (s.slice(k, k + 2) === "->") {
                armStartPositions.push(i)
            }
        }

        // §42 presence arm: (identifier) => — only when preceded by whitespace or start
        if (ch === "(") {
            const prevCh = i > 0 ? s[i - 1] : null
            if (prevCh === null || /\s/.test(prevCh)) {
                const presenceRe = /^\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\)\s*=>/
                if (presenceRe.test(s.slice(i))) {
                    armStartPositions.push(i)
                }
            }
        }

        i++
    }

    if (armStartPositions.length <= 1) return [s]

    const result = []
    for (let idx = 0; idx < armStartPositions.length; idx++) {
        const start = armStartPositions[idx]
        const end = idx + 1 < armStartPositions.length ? armStartPositions[idx + 1] : s.length
        const arm = s.slice(start, end).trim()
        if (arm) result.push(arm)
    }
    return result.length > 0 ? result : [s]
}

function splitInlineArms(armsStr) {
    const byNewline = armsStr
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

    // If newline splitting yielded multiple arms, use that result.
    if (byNewline.length > 1) return byNewline

    // Single line or no newlines: try arm-boundary splitting (BUG-R13-001).
    const src = byNewline.length === 1 ? byNewline[0] : armsStr.trim()
    const byBoundary = _splitMultiArmString(src)
    return byBoundary.length > 1 ? byBoundary : byNewline
}

/**
 * Rewrite inline `match expr { ... }` expressions to a JS IIFE.
 */
export function rewriteMatchExpr(expr) {
    if (!expr || typeof expr != "string") return expr
    const matchIdx = expr.indexOf("match ")
    if (matchIdx === -1) return expr

    // NOTE: regex uses String.fromCharCode to avoid brace confusion in block splitter
    const matchRegexSrc = "\\bmatch\\s+([\\s\\S]*?)\\s*" + _RW_OB + "([\\s\\S]*)" + _RW_CB + "\\s*$"
    const matchRegex = new RegExp(matchRegexSrc)
    const m = expr.match(matchRegex)
    if (!m) return expr

    const prefix = expr.slice(0, matchIdx)
    const matchTarget = m[1].trim()
    const armsStr = m[2].trim()

    const armLines = splitInlineArms(armsStr)
    const arms = []

    for (const line of armLines) {
        const arm = parseInlineMatchArm(line)
        if (arm) arms.push(arm)
    }

    if (arms.length === 0) {
        // NOTE: regex uses String.fromCharCode for dot-uppercase arm pattern
        const newCompactRegexSrc = "\\.\\s*([A-Z][A-Za-z0-9_]*)\\s*(?:\\(\\s*\\w+\\s*\\))?\\s*=>\\s*(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|[^.]+?)(?=\\s*\\.\\s*[A-Z]|\\s*$)"
        const newCompactRegex = new RegExp(newCompactRegexSrc, "g")
        let compactMatch
        while ((compactMatch = newCompactRegex.exec(armsStr)) !== null) {
            arms.push({ kind: "variant", test: compactMatch[1], result: compactMatch[2].trim() })
        }
    }

    if (arms.length === 0) {
        const legacyRegexSrc = "::\\s*(\\w+)\\s*(?:\\(\\s*(\\w+)\\s*\\))?\\s*-\\s*>\\s*(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|[^:]+?)(?=\\s*::\\s*\\w|\\s*$)"
        const legacyRegex = new RegExp(legacyRegexSrc, "g")
        let legacyMatch
        while ((legacyMatch = legacyRegex.exec(armsStr)) !== null) {
            arms.push({ kind: "variant", test: legacyMatch[1], result: legacyMatch[3].trim() })
        }
    }

    if (arms.length === 0) return expr

    const tmpVar = genVar("match")
    const lines = []
    lines.push(`(function() ` + _RW_OB)
    lines.push(`  const ${tmpVar} = ${matchTarget};`)

    let conditionIndex = 0
    for (const arm of arms) {
        if (arm.kind === "wildcard") {
            lines.push(`  else return ${arm.result};`)
        } else {
            const kw = conditionIndex === 0 ? "if" : "else if"
            let condition
            if (arm.kind === "not") {
                // §42: `not` match arm checks for absence (null or undefined)
                condition = `${tmpVar} === null || ${tmpVar} === undefined`
            } else if (arm.kind === "variant") {
                condition = `${tmpVar} === "${arm.test}"`
            } else {
                condition = `${tmpVar} === ${arm.test}`
            }
            lines.push(`  ${kw} (${condition}) return ${arm.result};`)
            conditionIndex++
        }
    }

    lines.push(_RW_CB + ")()")

    return prefix + lines.join("\n")
}

// ---------------------------------------------------------------------------
// rewriteFnKeyword
// ---------------------------------------------------------------------------

/**
 * Rewrite scrml `fn` shorthand to `function` keyword.
 */
export function rewriteFnKeyword(expr) {
    if (!expr || typeof expr != "string") return expr
    return expr.replace(/\bfn\b/g, "function")
}

// ---------------------------------------------------------------------------
// findMatchingBrace / fixBlockBody / rewriteInlineFunctionBodies
// ---------------------------------------------------------------------------

function findMatchingBrace(str, openPos) {
    let depth = 1
    let j = openPos + 1
    let inStr = null
    while (j < str.length && depth > 0) {
        const ch = str[j]
        if (inStr === null) {
            if (ch === '"' || ch === "'" || ch === '`') inStr = ch
            else if (ch === '{') depth++
            else if (ch === '}') depth--
        } else {
            if (ch === '\\') { j++ }
            else if (ch === inStr) inStr = null
        }
        if (depth > 0) j++
    }
    return depth === 0 ? j : -1
}

function fixBlockBody(body) {
    if (!body) return body

    const hasSemicolons = /;/.test(body)
    const hasNewlines = /\n/.test(body)

    let processed = ""
    let i = 0
    while (i < body.length) {
        const ch = body[i]
        if (ch === '"' || ch === "'" || ch === '`') {
            let j = i + 1
            while (j < body.length) {
                if (body[j] === '\\') { j += 2; continue }
                if (body[j] === ch) { j++; break }
                j++
            }
            processed += body.slice(i, j)
            i = j
            continue
        }
        if (ch === '{') {
            const closeIdx = findMatchingBrace(body, i)
            if (closeIdx > i) {
                const innerBody = body.slice(i + 1, closeIdx).trim()
                const fixedInner = fixBlockBody(innerBody)
                processed += "{ " + fixedInner + " }"
                i = closeIdx + 1
                continue
            }
        }
        processed += ch
        i++
    }

    if (!hasSemicolons && !hasNewlines) {
        const stmts = splitBareExprStatements(processed)
        if (stmts.length > 1) {
            return stmts.map((s) => s.trim()).filter(Boolean).join("; ")
        }
    }

    return processed
}

/**
 * Rewrite inline function bodies to insert semicolons between merged statements.
 */
export function rewriteInlineFunctionBodies(expr) {
    if (!expr || typeof expr != "string") return expr
    const result = []
    let i = 0

    while (i < expr.length) {
        const funcMatch = expr.slice(i).match(/^(function\s*\([^)]*\)\s*)\{/)
        if (funcMatch) {
            result.push(expr.slice(i, i + funcMatch[1].length))
            i += funcMatch[1].length
            if (expr[i] === '{') {
                const closeIdx = findMatchingBrace(expr, i)
                if (closeIdx > i) {
                    const body = expr.slice(i + 1, closeIdx).trim()
                    const fixedBody = fixBlockBody(body)
                    result.push("{ ")
                    result.push(fixedBody)
                    result.push(" }")
                    i = closeIdx + 1
                    continue
                }
            }
        }
        result.push(expr[i])
        i++
    }

    return result.join("")
}

// ---------------------------------------------------------------------------
// rewriteEnumToEnum
// ---------------------------------------------------------------------------

/**
 * Rewrite `EnumType.toEnum(expr)` to a runtime lookup table call.
 */
export function rewriteEnumToEnum(expr) {
    if (!expr || typeof expr != "string") return expr
    return expr.replace(
        /\b([A-Z][A-Za-z0-9_]*)\s*\.\s*toEnum\s*\(\s*([^)]+)\s*\)/g,
        (_, typeName, arg) => `(${typeName}_toEnum[${arg.trim()}] ?? null)`,
    )
}

// ---------------------------------------------------------------------------
// rewriteEnumVariantAccess
// ---------------------------------------------------------------------------

/**
 * Rewrite value-position enum variant references to string literals.
 */
export function rewriteEnumVariantAccess(expr) {
    if (!expr || typeof expr != "string") return expr
    // Block-splitter adds spaces around `.` — collapse `X . UpperIdent` → `X.UpperIdent`
    // so the negative lookbehind below can correctly distinguish member access (e.g.
    // `Color . Red` → `Color.Red`, kept as-is) from standalone `.VariantName`.
    // Only collapse when the property starts uppercase to avoid touching `todo . completed`.
    expr = expr.replace(/([A-Za-z0-9_$])\s+\.\s+([A-Z][A-Za-z0-9_$]*)/g, "$1.$2")

    // §14.4.2 — EnumType.variants → EnumType_variants (PascalCase identifiers only)
    expr = expr.replace(/\b([A-Z][A-Za-z0-9_]*)\s*\.\s*variants\b/g, "$1_variants")

    // §14.5 — Payload variant construction: EnumType.Variant(expr) → { variant: "Variant", value: (expr) }
    // Only matches PascalCase.PascalCase( pattern to avoid false positives on Math.floor() etc.
    expr = expr.replace(
        /\b([A-Z][A-Za-z0-9_]*)\s*\.\s*([A-Z][A-Za-z0-9_]*)\s*\(([^)]*)\)/g,
        (_, _typeName, variantName, arg) =>
            `{ variant: "${variantName}", value: (${arg.trim()}) }`,
    )

    // Standalone .VariantName (compact form, not preceded by identifier) → "VariantName"
    expr = expr.replace(/(?<![A-Za-z0-9_$.])\.\s*([A-Z][A-Za-z0-9_]*)\b/g, '"$1"')
    expr = expr.replace(/\b[A-Z][A-Za-z0-9_]*\s*::\s*([A-Z][A-Za-z0-9_]*)/g, '"$1"')
    expr = expr.replace(/\s*::\s*([A-Z][A-Za-z0-9_]*)/g, '"$1"')
    return expr
}

// ---------------------------------------------------------------------------
// rewriteEqualityOps
// ---------------------------------------------------------------------------

/**
 * Rewrite scrml equality operators to JavaScript strict equality (§45).
 */
export function rewriteEqualityOps(expr) {
    if (!expr || typeof expr != "string") return expr
    if (!expr.includes("==") && !expr.includes("!=")) return expr

    const result = []
    let inString = null
    let i = 0
    let segStart = 0

    while (i < expr.length) {
        const ch = expr[i]
        if (inString === null) {
            if (ch === '"' || ch === "'" || ch === '`') {
                result.push(_rewriteEqualitySegment(expr.slice(segStart, i)))
                inString = ch
                segStart = i
            }
        } else {
            if (ch === '\\') {
                i++
            } else if (ch === inString) {
                inString = null
                i++
                result.push(expr.slice(segStart, i))
                segStart = i
                continue
            }
        }
        i++
    }
    result.push(_rewriteEqualitySegment(expr.slice(segStart)))
    return result.join("")
}

function _rewriteEqualitySegment(segment) {
    return segment
        .replace(/([^!=])={2}(?!=)/g, "$1===")
        .replace(/!={1}(?!=)/g, "!==")
}

// ---------------------------------------------------------------------------
// rewriteRenderKeyword — E-TYPE-071 (§14.9, §16.8)
// ---------------------------------------------------------------------------

/**
 * Detect `render` keyword in expressions that survived past CE.
 * If `render name()` or `render name(expr)` appears in a rewrite-phase expression,
 * it was NOT inside a component body (CE would have consumed it). Emit E-TYPE-071.
 * The expression is passed through unchanged — the error is diagnostic only.
 */
export function rewriteRenderKeyword(expr, errors) {
    if (!expr || typeof expr != "string") return expr
    if (!expr.includes("render")) return expr

    if (errors) {
        const renderRe = /(?<![A-Za-z0-9_$])render\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
        let match
        while ((match = renderRe.exec(expr)) !== null) {
            errors.push({
                code: "E-TYPE-071",
                message: `E-TYPE-071: \`render ${match[1]}(...)\` is only valid inside a component body. ` +
                    `The \`render\` keyword invokes snippet-typed props and must appear inside a component ` +
                    `that declares the snippet prop. Move this into a component body or remove it (§16.8).`,
            })
        }
    }
    return expr
}

// ---------------------------------------------------------------------------
// rewriteExpr (main entry point)
// ---------------------------------------------------------------------------

/**
 * Apply all expression rewrites in sequence (no derived-name awareness).
 */
export function rewriteExpr(expr, errors) {
    // rewriteNotKeyword and rewritePresenceGuard must run BEFORE rewriteReactiveRefs.
    // Reason: patterns like `@x is not` need to match `@x` as a plain identifier.
    // After rewriteReactiveRefs, `@x` becomes `_scrml_reactive_get("x")` which the
    // `([A-Za-z_$]...) is not` regex cannot match.
    return rewriteEqualityOps(rewriteInlineFunctionBodies(rewriteFnKeyword(rewriteEnumVariantAccess(rewriteMatchExpr(rewriteIsOperator(rewriteNavigateCalls(rewriteReactiveRefs(rewriteEnumToEnum(rewriteSqlRefs(rewriteInputStateRefs(rewriteWorkerRefs(rewriteBunEval(rewriteRenderKeyword(rewriteNotKeyword(rewritePresenceGuard(expr), errors), errors), errors)))))))))))))
}

// ---------------------------------------------------------------------------
// rewriteExprWithDerived
// ---------------------------------------------------------------------------

/**
 * Apply all expression rewrites with derived-name awareness (§6.6).
 */
export function rewriteExprWithDerived(expr, derivedNames) {
    if (!derivedNames || derivedNames.size === 0) return rewriteExpr(expr)
    return rewriteEqualityOps(rewriteInlineFunctionBodies(
        rewriteFnKeyword(
            rewriteEnumVariantAccess(
                rewriteMatchExpr(
                    rewriteIsOperator(
                        rewriteNavigateCalls(
                            rewriteReactiveRefs(
                                rewriteEnumToEnum(
                                    rewriteSqlRefs(
                                        rewriteInputStateRefs(
                                            rewriteNotKeyword(rewritePresenceGuard(expr)),
                                        ),
                                    ),
                                ),
                                derivedNames,
                            )
                        )
                    )
                )
            )
        )
    ))
}

// ---------------------------------------------------------------------------
// rewriteServerReactiveRefs / rewriteServerExpr / serverRewriteEmitted
// ---------------------------------------------------------------------------

/**
 * Rewrite `@varName` reactive references to server-side request body lookups.
 */
export function rewriteServerReactiveRefs(expr) {
    if (!expr || typeof expr != "string") return expr

    const astRewrite = rewriteServerReactiveRefsAST(expr)
    if (astRewrite.ok) return astRewrite.result

    const result = []
    let inString = null
    let i = 0
    let segStart = 0

    while (i < expr.length) {
        const ch = expr[i]

        if (inString === null) {
            if (ch === '"' || ch === "'" || ch === '`') {
                const segment = expr.slice(segStart, i)
                result.push(segment.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, '_scrml_body["$1"]'))
                inString = ch
                segStart = i
            }
        } else {
            if (ch === '\\') {
                i++
            } else if (ch === inString) {
                result.push(expr.slice(segStart, i + 1))
                inString = null
                segStart = i + 1
            }
        }
        i++
    }

    const remaining = expr.slice(segStart)
    if (inString === null) {
        result.push(remaining.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, '_scrml_body["$1"]'))
    } else {
        result.push(remaining)
    }

    return result.join("")
}

/**
 * Apply all expression rewrites for server handler context.
 */
export function rewriteServerExpr(expr, dbVar = "_scrml_db") {
    // rewriteNotKeyword and rewritePresenceGuard must run BEFORE rewriteServerReactiveRefs
    // (same ordering rationale as rewriteExpr — @x patterns need to be intact).
    return rewriteInlineFunctionBodies(rewriteFnKeyword(rewriteEnumVariantAccess(rewriteMatchExpr(rewriteIsOperator(rewriteNavigateCalls(rewriteSqlRefs(rewriteServerReactiveRefs(rewriteEnumToEnum(rewriteInputStateRefs(rewriteWorkerRefs(rewriteNotKeyword(rewritePresenceGuard(expr)))))), dbVar)))))))
}

/**
 * Post-process emitted JS code for server handler context.
 */
export function serverRewriteEmitted(code) {
    if (!code) return code
    return code
        .replace(/_scrml_reactive_get\("([^"]+)"\)/g, '_scrml_body["$1"]')
        .replace(/_scrml_derived_get\("([^"]+)"\)/g, '_scrml_body["$1"]')
}

// ---------------------------------------------------------------------------
// hasTemplateInterpolation / rewriteTemplateAttrValue
// ---------------------------------------------------------------------------

/**
 * Check whether a string attribute value contains template literal interpolations.
 */
export function hasTemplateInterpolation(value) {
    if (!value || typeof value != "string") return false
    // NOTE: uses String.fromCharCode to avoid brace confusion
    return new RegExp("\\$" + _RW_OB).test(value)
}

/**
 * Rewrite a string attribute value containing `${...}` interpolations into
 * a JS template literal expression.
 */
export function rewriteTemplateAttrValue(value) {
    const reactiveVars = new Set()

    let result = "`"
    let i = 0

    while (i < value.length) {
        if (value[i] === '$' && value[i + 1] === '{') {
            let depth = 1
            let j = i + 2
            while (j < value.length && depth > 0) {
                if (value[j] === '{') depth++
                else if (value[j] === '}') depth--
                if (depth > 0) j++
            }
            const interiorExpr = value.slice(i + 2, j)

            const rewrittenExpr = interiorExpr.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, (_, name) => {
                reactiveVars.add(name)
                return `_scrml_reactive_get("${name}")`
            })

            result += `\$` + _RW_OB + rewrittenExpr + _RW_CB
            i = j + 1
        } else if (value[i] === '`') {
            result += '\\`'
            i++
        } else if (value[i] === '\\' && i + 1 < value.length) {
            result += value[i] + value[i + 1]
            i += 2
        } else {
            result += value[i]
            i++
        }
    }

    result += "`"

    return { jsExpr: result, reactiveVars }
}
