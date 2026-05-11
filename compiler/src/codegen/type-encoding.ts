/**
 * Type Encoding — Phase 1 of the encoded variable names feature (ADR-001).
 *
 * Produces deterministic, collision-free encoded variable names for compiled
 * JavaScript output. Each encoded name carries a type-derived component so
 * that downstream stages and the runtime meta engine can decode type identity
 * from the variable name alone (with a companion table for hash-based lookup).
 *
 * Encoding format:  _<kind><hash><seq>        (production)
 *                   _<kind><hash><seq>$<name>  (debug)
 *
 * - kind:  single char identifying the ResolvedType discriminant
 * - hash:  8-char base36 FNV-1a of the canonical type string
 * - seq:   single base36 char (0-9 a-z) for binding-level disambiguation
 */

import { CGError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Local type interfaces — mirrors of the non-exported types from type-system.ts
// ---------------------------------------------------------------------------

export interface PrimitiveType {
  kind: "primitive";
  name: string;
}

export interface StructType {
  kind: "struct";
  name: string;
  fields: Map<string, ResolvedType>;
}

export interface VariantDef {
  name: string;
  payload: Map<string, ResolvedType> | null;
}

export interface EnumType {
  kind: "enum";
  name: string;
  variants: VariantDef[];
}

export interface ArrayType {
  kind: "array";
  element: ResolvedType;
}

export interface UnionType {
  kind: "union";
  members: ResolvedType[];
}

export interface AsIsType {
  kind: "asIs";
  constraint: ResolvedType | null;
}

export interface UnknownType {
  kind: "unknown";
}

export interface NotType {
  kind: "not";
}

export interface StateType {
  kind: "state";
  name: string;
  attributes?: Map<string, unknown>;
  isHtml?: boolean;
  rendersToDom?: boolean;
  constructorBody?: unknown[] | null;
}

export interface ErrorType {
  kind: "error";
  name: string;
  fields: Map<string, ResolvedType>;
}

export interface HtmlElementType {
  kind: "html-element";
  tag: string;
  attrs?: Record<string, unknown>;
}

export interface CssClassType {
  kind: "cssClass";
}

export interface FunctionType {
  kind: "function";
  name: string;
  params: unknown[];
  returnType: ResolvedType;
}

export interface MetaSpliceType {
  kind: "meta-splice";
  resultType: ResolvedType;
  parentContext?: string;
}

export interface RefBindingType {
  kind: "ref-binding";
  resolvedType: ResolvedType;
  domInterface?: string;
}

export type ResolvedType =
  | PrimitiveType
  | StructType
  | EnumType
  | ArrayType
  | UnionType
  | AsIsType
  | UnknownType
  | StateType
  | ErrorType
  | HtmlElementType
  | CssClassType
  | FunctionType
  | MetaSpliceType
  | RefBindingType
  | NotType;

// ---------------------------------------------------------------------------
// Kind marker map — single char per ResolvedType discriminant
// ---------------------------------------------------------------------------

const KIND_MARKERS: Record<string, string> = {
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
};

/** Reverse map: marker char -> full kind name */
const MARKER_TO_KIND: Record<string, string> = {
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
};

// ---------------------------------------------------------------------------
// normalizeType — canonical string form for hashing
// ---------------------------------------------------------------------------

/**
 * Convert a ResolvedType to its canonical string form.
 *
 * Recursive types use `&Name` reference to prevent infinite recursion.
 * The `seen` set tracks struct/enum names currently being expanded.
 */
export function normalizeType(type: ResolvedType, seen?: Set<string>): string {
  const s = seen ?? new Set<string>();

  switch (type.kind) {
    case "primitive":
      return `p:${type.name}`;

    case "struct": {
      if (s.has(type.name)) return `&${type.name}`;
      s.add(type.name);
      const fields = [...type.fields.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${normalizeType(v, s)}`)
        .join(",");
      s.delete(type.name);
      return `s:${type.name}{${fields}}`;
    }

    case "enum": {
      if (s.has(type.name)) return `&${type.name}`;
      s.add(type.name);
      // variants in declaration order
      const variants = type.variants.map((v) => v.name).join(",");
      s.delete(type.name);
      return `e:${type.name}{${variants}}`;
    }

    case "array":
      return `a:[${normalizeType(type.element, s)}]`;

    case "union": {
      // members sorted by their canonical form
      const members = type.members
        .map((m) => normalizeType(m, s))
        .sort()
        .join("|");
      return `u:(${members})`;
    }

    case "state":
      return `t:${type.name}`;

    case "error": {
      const fields = [...type.fields.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${normalizeType(v, s)}`)
        .join(",");
      return `r:${type.name}{${fields}}`;
    }

    case "html-element":
      return `h:${type.tag}`;

    case "function": {
      const params = type.params
        .map((p: unknown) => {
          if (
            p &&
            typeof p === "object" &&
            "type" in (p as Record<string, unknown>)
          ) {
            return normalizeType(
              (p as Record<string, unknown>).type as ResolvedType,
              s
            );
          }
          return String(p);
        })
        .join(",");
      return `f:${type.name}(${params}):${normalizeType(type.returnType, s)}`;
    }

    case "not":
      return "n:";

    case "asIs":
      return `x:${type.constraint ? normalizeType(type.constraint, s) : ""}`;

    case "cssClass":
      return "k:";

    case "meta-splice":
      return `m:${normalizeType(type.resultType, s)}`;

    case "ref-binding":
      return `b:${normalizeType(type.resolvedType, s)}`;

    case "unknown":
      return "p:unknown";

    default:
      return "p:unknown";
  }
}

// ---------------------------------------------------------------------------
// FNV-1a hash — 32-bit, output as 8-char base36
// ---------------------------------------------------------------------------

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * FNV-1a 32-bit hash, output as zero-padded 8-char base36 string (~41 bits).
 */
export function fnv1aHash(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(36).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// encodeTypeName / encodeTypeNameDebug
// ---------------------------------------------------------------------------

/**
 * Produce the full encoded variable name.
 * Format: `_<kind><hash><seq>`
 */
export function encodeTypeName(type: ResolvedType, seq: number): string {
  const kind = KIND_MARKERS[type.kind] ?? "p";
  const hash = fnv1aHash(normalizeType(type));
  const seqChar = seq.toString(36);
  return `_${kind}${hash}${seqChar}`;
}

/**
 * Debug mode variant.
 * Format: `_<kind><hash><seq>$<originalName>`
 */
export function encodeTypeNameDebug(
  type: ResolvedType,
  seq: number,
  originalName: string
): string {
  const base = encodeTypeName(type, seq);
  return `${base}$${originalName}`;
}

// ---------------------------------------------------------------------------
// decodeKind — extract kind from an encoded name
// ---------------------------------------------------------------------------

/** Encoded name pattern: _<kindChar><8-char-hash><seqChar>[optional $debug] */
const ENCODED_PATTERN = /^_([a-z])([0-9a-z]{8})([0-9a-z])(\$.*)?$/;

/**
 * Extract the kind from an encoded variable name.
 * Returns the full kind name ("struct", "enum", etc.) or null if not valid.
 */
export function decodeKind(encodedName: string): string | null {
  const m = ENCODED_PATTERN.exec(encodedName);
  if (!m) return null;
  return MARKER_TO_KIND[m[1]] ?? null;
}

// ---------------------------------------------------------------------------
// CollisionChecker
// ---------------------------------------------------------------------------

/**
 * Detects type-identity collisions: two structurally different types mapping
 * to the same encoded prefix (_<kind><hash>). Throws E-CG-010 on collision.
 */
export class CollisionChecker {
  /** Map from encoded prefix (_<kind><hash>) to the canonical type string. */
  private registry = new Map<string, string>();

  /**
   * Check a type against its encoded prefix. If a different type was already
   * registered for the same prefix, throw E-CG-010.
   */
  check(type: ResolvedType, encodedPrefix: string): void {
    const canonical = normalizeType(type);
    const existing = this.registry.get(encodedPrefix);

    if (existing !== undefined && existing !== canonical) {
      throw new CGError(
        "E-CG-010",
        `Type encoding collision: prefix "${encodedPrefix}" maps to both ` +
          `"${existing}" and "${canonical}". This is a compiler defect — ` +
          `please report it.`,
        {}
      );
    }

    this.registry.set(encodedPrefix, canonical);
  }

  /** Clear all registered encodings. */
  reset(): void {
    this.registry.clear();
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
  /** Whether encoding is active. When false, encode() is a passthrough. */
  readonly enabled: boolean;

  /** Whether to append $originalName debug suffix. */
  readonly debug: boolean;

  /**
   * S79 audit fix (hardcoded-thresholds A.2): test-only injectable cap on
   * the per-prefix `seq` counter. When `register()` would assign a `seq`
   * value > `seqCap`, fires `E-CG-014` (Disambiguator overflow). Default
   * 1331 (the spec-canonical algorithmic ceiling — corresponds to the
   * 3-char base36 codomain `_<kind><hash><seq>`). Tests inject a small
   * value (e.g. `seqCap: 3`) to trigger the diagnostic with a 4-binding
   * fixture instead of synthesizing 1,332 bindings.
   *
   * NOT an adopter-facing knob — the cap reflects an internal encoding
   * format choice. Promoting to adopter API requires a SPEC §47 amendment.
   */
  readonly seqCap: number;

  /** Map from original name → encoded name. */
  private nameMap = new Map<string, string>();

  /** Map from original name → ResolvedType (for decode table generation). */
  private typeMap = new Map<string, ResolvedType>();

  /** Seq counter per encoded prefix (_<kind><hash>) for disambiguation. */
  private seqCounters = new Map<string, number>();

  /** Collision checker instance. */
  private collisionChecker = new CollisionChecker();

  constructor(opts: {
    enabled?: boolean;
    debug?: boolean;
    /** S79 audit fix A.2 — see `seqCap` field JSDoc. */
    __testOnly_typeEncodingSeqCap?: number;
  } = {}) {
    this.enabled = opts.enabled ?? false;
    this.debug = opts.debug ?? false;
    this.seqCap = (typeof opts.__testOnly_typeEncodingSeqCap === "number"
      && opts.__testOnly_typeEncodingSeqCap >= 0)
      ? opts.__testOnly_typeEncodingSeqCap
      : 1331;
  }

  /**
   * Register a variable name with its resolved type. Assigns an encoded
   * name and stores the mapping. Returns the encoded name.
   *
   * If the name is already registered, returns the existing encoded name.
   * If encoding is disabled, returns the original name.
   */
  register(originalName: string, type: ResolvedType): string {
    if (!this.enabled) return originalName;
    if (this.nameMap.has(originalName)) return this.nameMap.get(originalName)!;

    const kind = KIND_MARKERS[type.kind] ?? "p";
    const hash = fnv1aHash(normalizeType(type));
    const prefix = `_${kind}${hash}`;

    // Collision check
    this.collisionChecker.check(type, prefix);

    // Assign seq
    const seq = this.seqCounters.get(prefix) ?? 0;
    this.seqCounters.set(prefix, seq + 1);

    // Check overflow (default >1332 same-type bindings; cap injectable per
    // S79 audit fix A.2 via `__testOnly_typeEncodingSeqCap`).
    if (seq > this.seqCap) {
      throw new CGError(
        "E-CG-014",
        `Disambiguator overflow: scope contains more than ${this.seqCap + 1} bindings ` +
          `of type "${normalizeType(type)}" (prefix "${prefix}").`,
        {}
      );
    }

    const encoded = this.debug
      ? encodeTypeNameDebug(type, seq, originalName)
      : encodeTypeName(type, seq);

    this.nameMap.set(originalName, encoded);
    this.typeMap.set(originalName, type);
    return encoded;
  }

  /**
   * Look up the encoded name for an original variable name.
   * Returns the encoded name if registered, otherwise the original name
   * (passthrough for unregistered names or when encoding is disabled).
   */
  encode(originalName: string): string {
    if (!this.enabled) return originalName;
    return this.nameMap.get(originalName) ?? originalName;
  }

  /**
   * Check whether a name has been registered.
   */
  has(originalName: string): boolean {
    return this.nameMap.has(originalName);
  }

  /**
   * Retrieve the ResolvedType registered for an original variable name.
   * Returns undefined if the name has not been registered.
   */
  getType(originalName: string): ResolvedType | undefined {
    return this.typeMap.get(originalName);
  }

  /**
   * Return a read-only view of all name mappings (original → encoded).
   */
  get mappings(): ReadonlyMap<string, string> {
    return this.nameMap;
  }

  /** Clear all state for reuse. */
  reset(): void {
    this.nameMap.clear();
    this.typeMap.clear();
    this.seqCounters.clear();
    this.collisionChecker.reset();
  }
}

// ---------------------------------------------------------------------------
// TypeDescriptor — runtime type metadata for reflect() (§47.2)
// ---------------------------------------------------------------------------

export interface TypeDescriptor {
  kind: string;
  name?: string;
  fields?: Array<{ name: string; type: TypeDescriptor }>;
  variants?: Array<{ name: string }>;
  element?: TypeDescriptor;
  members?: Array<TypeDescriptor>;
  params?: Array<TypeDescriptor>;
  returnType?: TypeDescriptor;
}

// ---------------------------------------------------------------------------
// toTypeDescriptor — build a TypeDescriptor from a ResolvedType
// ---------------------------------------------------------------------------

/**
 * Recursively convert a ResolvedType into a TypeDescriptor for runtime
 * reflection. The `seen` set prevents infinite recursion on self-referential
 * struct/enum types.
 */
export function toTypeDescriptor(type: ResolvedType, seen?: Set<string>): TypeDescriptor {
  const s = seen ?? new Set<string>();

  switch (type.kind) {
    case "primitive":
      return { kind: type.name };

    case "struct": {
      if (s.has(type.name)) return { kind: "struct", name: type.name };
      s.add(type.name);
      const fields = [...type.fields.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fieldName, fieldType]) => ({
          name: fieldName,
          type: toTypeDescriptor(fieldType, s),
        }));
      s.delete(type.name);
      return { kind: "struct", name: type.name, fields };
    }

    case "enum": {
      if (s.has(type.name)) return { kind: "enum", name: type.name };
      s.add(type.name);
      const variants = type.variants.map((v) => ({ name: v.name }));
      s.delete(type.name);
      return { kind: "enum", name: type.name, variants };
    }

    case "array":
      return { kind: "array", element: toTypeDescriptor(type.element, s) };

    case "union": {
      const members = type.members.map((m) => toTypeDescriptor(m, s));
      return { kind: "union", members };
    }

    case "function": {
      const params = type.params.map((p: unknown) => {
        if (p && typeof p === "object" && "type" in (p as Record<string, unknown>)) {
          return toTypeDescriptor((p as Record<string, unknown>).type as ResolvedType, s);
        }
        return { kind: "unknown" } as TypeDescriptor;
      });
      return {
        kind: "function",
        name: type.name,
        params,
        returnType: toTypeDescriptor(type.returnType, s),
      };
    }

    case "state":
      return { kind: "state", name: type.name };

    case "error": {
      const fields = [...type.fields.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fieldName, fieldType]) => ({
          name: fieldName,
          type: toTypeDescriptor(fieldType, s),
        }));
      return { kind: "error", name: type.name, fields };
    }

    case "html-element":
      return { kind: "html-element", name: type.tag };

    case "meta-splice":
      return { kind: "meta-splice" };

    case "ref-binding":
      return { kind: "ref-binding" };

    case "asIs":
      return { kind: "asIs" };

    case "cssClass":
      return { kind: "cssClass" };

    case "not":
      return { kind: "not" };

    case "unknown":
    default:
      return { kind: "unknown" };
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
export function emitDecodeTable(ctx: EncodingContext): string {
  if (!ctx.enabled || ctx.mappings.size === 0) {
    return "const _scrml_decode_table = {};";
  }

  // Deduplicate by prefix — multiple bindings with the same prefix share one entry
  const prefixToDescriptor = new Map<string, TypeDescriptor>();

  for (const [originalName, encodedName] of ctx.mappings) {
    const prefix = encodedName.slice(0, 10);
    if (prefixToDescriptor.has(prefix)) continue;

    const type = ctx.getType(originalName);
    if (!type) continue;

    prefixToDescriptor.set(prefix, toTypeDescriptor(type));
  }

  const entries: string[] = [];
  for (const [prefix, descriptor] of prefixToDescriptor) {
    entries.push(`${JSON.stringify(prefix)}: ${JSON.stringify(descriptor)}`);
  }

  return `const _scrml_decode_table = { ${entries.join(", ")} };`;
}

// ---------------------------------------------------------------------------
// emitRuntimeReflect — generate the _scrml_reflect function (§47.4.2)
// ---------------------------------------------------------------------------

/**
 * Generate the runtime `_scrml_reflect` function as a JavaScript string.
 * This function looks up a TypeDescriptor from the decode table by extracting
 * the 10-char prefix from an encoded variable name.
 */
export function emitRuntimeReflect(): string {
  return [
    "function _scrml_reflect(encodedName) {",
    '  if (typeof encodedName !== "string" || !encodedName.startsWith("_")) return { kind: "foreign" };',
    "  const prefix = encodedName.slice(0, 10);",
    "  const entry = _scrml_decode_table[prefix];",
    '  return entry || { kind: "foreign" };',
    "}",
  ].join("\n");
}
