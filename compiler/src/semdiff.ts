/**
 * @module semdiff
 *
 * #6b — the semantic-diff / behavioral-classification primitive, **P0 (the honest floor)**.
 *
 * Given two compiled versions of a scrml program (base + head), classify their
 * difference by AXIS + soundness TIER — NEVER a boolean "safe". This is the
 * compiler-only cut two independent consumers (giti MERGE, flogence REVIEW) hit
 * from opposite tasks: sound cosmetic-vs-behavioral classification the consumer
 * cannot compute from two `#6` sidecars.
 *
 * DESIGN DEEP-DIVE (authoritative):
 *   scrml-support/docs/deep-dives/6b-semantic-diff-primitive-design-2026-07-17.md
 *
 * CONSTRAINT §0 (FIXED — the load-bearing axiom):
 *   1. Report AXIS + TIER, never a boolean "safe".
 *   2. Opaque/unmodeled regions (foreign `_={ }=`, unresolved import, dynamic
 *      dispatch) are behavioral-BY-CONSTRUCTION — NEVER silently cosmetic. The
 *      tier system MUST NOT have a path that lets an opaque region reach Tier-0/1.
 *   3. Gating policy stays CONSUMER-SIDE — this module classifies + reports only.
 *
 * P0 SCOPE (this module):
 *   - Signal 1 — Tier-0 emit-identity: whole-output normalized-emit byte-compare
 *     (per Fork C, P0's floor is a per-entity/whole-output MIX; per-entity emit
 *     attribution is the P1 footprint refinement).
 *   - Signal 2 — opaque region → forced Tier-2 `opaque` (constraint §0(2)).
 *   - Signal 3 — use-site diagnostic-set diff → Tier-2 use-site (delivers giti's
 *     `E-TYPE-063` rename↔use separator).
 *   Entity match = fingerprint-first (Fork B). Alpha-normalize = shallow (Fork D):
 *   SOURCE-level for the fingerprint; EMIT-level (acorn name-token rename over the
 *   matched-entity rename map, skipping property/string tokens) for the Tier-0 proof.
 *
 * The 6-axis full primitive (footprint / reachability / engine / CPS / confidentiality)
 * is P1-P4 — NOT built here. The entity model is structured so a whole-program pass
 * (Fork C) can attach later without a per-entity-only hard-code.
 */

// @ts-ignore — acorn ships its own types but the compiler imports it untyped
// (matching codegen/validate-emit.ts). We only touch `.tokenizer`.
import * as acorn from "acorn";

// Printable, collision-improbable sentinels — NEVER a control byte (keeps this
// module plain-text + the emit-corpus / fingerprint strings greppable). A scrml
// / JS identifier can hold none of these, so the SELF mask never fuses with a
// real token; the corpus delimiters are used for whole-string EQUALITY only, so
// even a delimiter appearing inside content cannot manufacture a false match.
const SELF_SENTINEL = " «SEMDIFF-SELF» ";
const CORPUS_KIND_SEP = "\n<<<SEMDIFF-KIND>>>\n";
const CORPUS_ARTIFACT_SEP = "\n<<<SEMDIFF-ARTIFACT>>>\n";
const DIAG_KEY_SEP = " <<>> ";

// ---------------------------------------------------------------------------
// Public shapes (the classification schema — DD §8)
// ---------------------------------------------------------------------------

/** A byte/line span. */
export interface SemSpan {
  start: number;
  end: number;
  line?: number;
  endLine?: number;
}

/** One diagnostic (compiler error / warning / info / lint), normalized. */
export interface SemDiagnostic {
  code: string;
  message: string;
  severity?: string;
  span?: SemSpan;
  /** 1-based line, when the diagnostic carries one instead of a byte span. */
  line?: number;
}

/**
 * A resolved entity for one version — the CLI command builds this from the
 * canonical `blockAnalyses()` projection + the raw source text.
 */
export interface SemEntity {
  /** `<relpath>::<name>` — the #6 lease anchor. */
  id: string;
  /** function | component | engine | type | channel */
  kind: string;
  name: string;
  span: SemSpan;
  /** Tight body span `[start, end)` into the raw source. */
  bodySpan: SemSpan;
  /** Raw source slice of the body (for the fingerprint + opaque scan). */
  bodyText: string;
  /** Comment-stripped + ws-collapsed + own-name-masked body hash (Fork B/D). */
  fingerprint: string;
  /** True → the entity contains an unmodeled region (constraint §0(2)). */
  opaque: boolean;
  /** Human-readable opaque reasons (`foreign-block`, `unresolved-import`, …). */
  opaqueReasons: string[];
  /**
   * True → the entity is EXPORTED (an observable public symbol — `export fn`,
   * `export function`, `export type`, …). Fork D (DD): exported/observable names
   * must stay FIXED — an export rename IS behavioral (it breaks any cross-file
   * `import { name }`), so an exported entity's name is NEVER folded into the
   * alpha-rename map (D1). Defaults false when not captured.
   */
  exported?: boolean;
}

/** One emitted artifact (raw), before canonicalization. */
export interface SemEmitArtifact {
  /** serverJs | clientJs | libraryJs | html | css | sql */
  kind: string;
  content: string;
}

/** One unmodeled-axis declaration attribute (D3 — the confidentiality honest
 *  floor). `attr` is the attribute name (`protect`); `value` its raw string. The
 *  confidentiality AXIS itself is P4-DEFERRED — P0 only SIGNALS that an unmodeled
 *  attribute moved (never silently absorbs it into a cosmetic verdict, §0(2)). */
export interface SemUnmodeledAttr {
  attr: string;
  value: string;
}

/** Everything the classifier needs for one compiled version. */
export interface SemVersion {
  /** The base/head label (relpath or ref). */
  label: string;
  entities: SemEntity[];
  diagnostics: SemDiagnostic[];
  /** The raw emitted artifacts (deterministic, path-independent — see collectEmitArtifacts). */
  emitArtifacts: SemEmitArtifact[];
  /** True → the compile produced at least one FATAL error. */
  failedToCompile: boolean;
  /**
   * The source file's basename STEM (no dir, no `.scrml`) — e.g. `alpha` for
   * `.../alpha.scrml`. The stem bakes into emitted CONTENT (`new URL("./alpha.html")`,
   * `path:"/alpha"`, `<title>alpha</title>`, `alpha.client.js`), so two BYTE-
   * IDENTICAL programs with different filenames would otherwise read behavioral
   * (D2). Canonicalized to a placeholder on BOTH sides before the Tier-0 compare.
   */
  sourceBasename?: string;
  /**
   * Unmodeled-axis declaration attributes lifted from the RAW source (D3). Diffed
   * base↔head so a change to an axis P0 does not model (`<db protect=>`) surfaces
   * a breadcrumb signal instead of a silent Tier-0 (§0(2)). Absent → none found.
   */
  unmodeledAxisAttrs?: SemUnmodeledAttr[];
}

/** One moved axis on a matched entity (DD §8 `axes[]` element). */
export interface SemAxis {
  /** opaque | use-site | source | context (P0 axis set). */
  axis: string;
  /** confidentiality-only (P4) — unused in P0, kept for schema stability. */
  facet?: string;
  detail?: Record<string, unknown>;
  span?: SemSpan;
}

/** One classified entity (DD §8 `entities[]` element). */
export interface SemClassifiedEntity {
  entity: string;
  kind: string;
  /** name | fingerprint — the Fork B entity-match provenance. */
  matchedBy: "name" | "fingerprint";
  /** "0" | "1" | "2" — P0 emits only "0" and "2" (no modeled-axis Tier-1). */
  tier: "0" | "1" | "2";
  axes: SemAxis[];
  opaque: boolean;
  span: SemSpan;
}

/** The full classification (DD §8 schema + a P0 top-level diagnostics diff). */
export interface SemClassification {
  version: 1;
  base: string;
  head: string;
  /**
   * The SYNTHESIZED top-level verdict (D4) — the single field a consumer should
   * key on. `cosmetic` iff EVERY matched entity is Tier-0 AND nothing landed in
   * `unmatched` (a route/entity add or remove) AND no new use-site diagnostic AND
   * no unmodeled-axis signal fired; otherwise `behavioral`. A naive "all entities
   * Tier-0" misreads a route-add (which lands only in `unmatched.added`) as
   * cosmetic — this field ANDs the whole picture so the consumer cannot.
   */
  verdict: "cosmetic" | "behavioral";
  entities: SemClassifiedEntity[];
  unmatched: { added: string[]; removed: string[] };
  /**
   * The use-site diagnostic-set diff (Signal 3). `added` = new-on-head (the
   * use-breaks); `removed` = gone-from-head. A P0 addition to the DD §8 schema so
   * a use-break that maps to NO entity (e.g. a cell-level `E-TYPE-063`) is still
   * surfaced (constraint §0(1) — never drop the signal).
   */
  diagnostics: { added: SemDiagnostic[]; removed: SemDiagnostic[] };
  /**
   * Unmodeled-axis breadcrumb signals (D3) — info-level notes that a change
   * touched an axis P0 does not fully model (`<db protect=>` confidentiality,
   * P4-deferred). NOT a verdict on that axis; a signal so a consumer can SEE that
   * something semdiff does not model moved (§0(2) — never SILENTLY cosmetic).
   */
  signals: SemDiagnostic[];
  /**
   * Exit-code contract (D4 — the standard diff convention):
   *   0 = cosmetic / no-op (safe to auto-approve on the modeled axes)
   *   1 = behavioral (a change on some axis — the consumer must review/gate)
   *   2 = error (a version failed to compile — fail-closed)
   */
  exitCode: 0 | 1 | 2;
}

// ---------------------------------------------------------------------------
// Foreign-region (opaque) detection — Signal 2
// ---------------------------------------------------------------------------

/**
 * Blank every comment + string-literal character in `s` to a space (offsets
 * preserved 1:1), so the foreign-opener scan is not fooled by a `_={` inside a
 * comment or a string. Newlines preserved. Mirrors block-analysis.ts:maskComments,
 * extended to also blank string interiors (a `_={` inside `"…"` is not an opener).
 */
export function maskCommentsAndStrings(s: string): string {
  const out = s.split("");
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out[i] = " ";
      i++;
      while (i < n) {
        if (s[i] === "\\") { out[i] = " "; if (i + 1 < n && s[i + 1] !== "\n") out[i + 1] = " "; i += 2; continue; }
        if (s[i] === quote) { out[i] = " "; i++; break; }
        if (s[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && s[i + 1] === "/") {
      while (i < n && s[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (ch === "/" && s[i + 1] === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2;
      while (i < n) {
        if (s[i] === "*" && s[i + 1] === "/") { out[i] = " "; out[i + 1] = " "; i += 2; break; }
        if (s[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Match a foreign-code opener `_` + zero-or-more `=` + `{` at position `p` in a
 * PRE-MASKED buffer. Returns true on a match. Replicates block-splitter.js
 * `matchForeignOpener` exactly (SPEC §23.2): the `_` must NOT be the tail of a
 * longer identifier (the preceding char must be a non-identifier char or SOI),
 * which keeps `_ = {` (spaced assignment) and `_underscoreVar` from matching.
 */
function matchesForeignOpenerAt(masked: string, p: number): boolean {
  if (masked[p] !== "_") return false;
  const prev = p > 0 ? masked[p - 1] : "";
  if (prev && /[A-Za-z0-9_$]/.test(prev)) return false;
  let q = p + 1;
  while (masked[q] === "=") q++;
  return masked[q] === "{";
}

/**
 * Detect opaque/unmodeled regions inside an entity body (Signal 2). P0 detects
 * the foreign `_={ }=` block (the flogence B1 hole); unresolved-import + dynamic-
 * dispatch reasons are appended by the caller (they are file/compile-level
 * signals, not body-local). Returns the distinct reasons (empty = not opaque).
 *
 * SOUND-CONSERVATIVE: a false positive over-reports Tier-2 opaque (the safe
 * direction); the masked scan of a distinctive opener never false-negatives on a
 * real foreign block.
 */
export function detectForeignRegions(bodyText: string): string[] {
  const masked = maskCommentsAndStrings(bodyText);
  for (let i = 0; i < masked.length; i++) {
    if (matchesForeignOpenerAt(masked, i)) return ["foreign-block"];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Entity fingerprint — Fork B/D shallow (SOURCE level)
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32-bit hash (deterministic, dependency-free) — the fingerprint digest.
 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Strip line + block comments but leave string literals intact. */
function stripCommentsKeepStrings(s: string): string {
  let out = "";
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        out += s[i];
        if (s[i] === "\\") { if (i + 1 < n) out += s[i + 1]; i += 2; continue; }
        if (s[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && s[i + 1] === "/") {
      while (i < n && s[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The entity fingerprint (Fork B fingerprint-first match; Fork D shallow). Hash
 * of the body with: comments stripped, whitespace runs collapsed to one space,
 * and every word-boundary occurrence of the entity's OWN name masked to a fixed
 * sentinel — so a pure entity-NAME rename (`fn foo` → `fn bar`, identical body)
 * is fingerprint-STABLE and matches instead of reading as REMOVED+ADDED.
 *
 * Inner-scope (param / local) renames are NOT normalized here — Fork D shallow —
 * so they change the fingerprint and fall to a name-match (name unchanged) or, if
 * the entity was ALSO renamed, to REMOVED+ADDED (the conservative degradation).
 */
export function fingerprintEntity(bodyText: string, name: string): string {
  const noComments = stripCommentsKeepStrings(bodyText);
  let norm = noComments.replace(/\s+/g, " ").trim();
  if (name) {
    const re = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(name)}(?![A-Za-z0-9_$])`, "g");
    norm = norm.replace(re, (_m, pre) => `${pre}${SELF_SENTINEL}`);
  }
  return fnv1a(norm);
}

// ---------------------------------------------------------------------------
// Entity match — Fork B (fingerprint-first, then name+kind residue)
// ---------------------------------------------------------------------------

export interface SemMatch {
  base: SemEntity;
  head: SemEntity;
  matchedBy: "name" | "fingerprint";
}

export interface SemMatchResult {
  matched: SemMatch[];
  addedHead: SemEntity[];
  removedBase: SemEntity[];
}

/**
 * Match entities across the two versions. Fork B: fingerprint-EQUAL pairs first
 * (rename-stable — resolves a renamed-but-body-identical entity), then name+kind
 * on the residue (catches a same-name body-changed entity), leftover → REMOVED /
 * ADDED. A false non-match degrades to REMOVED+ADDED — NEVER a false COSMETIC.
 */
export function matchEntities(base: SemEntity[], head: SemEntity[]): SemMatchResult {
  const matched: SemMatch[] = [];
  const baseUsed = new Set<number>();
  const headUsed = new Set<number>();

  // Pass A — fingerprint + kind equality (rename-stable). Deterministic: iterate
  // base in source order, take the first unused head with equal (kind,fingerprint).
  for (let bi = 0; bi < base.length; bi++) {
    if (baseUsed.has(bi)) continue;
    const b = base[bi];
    for (let hi = 0; hi < head.length; hi++) {
      if (headUsed.has(hi)) continue;
      const h = head[hi];
      if (h.kind === b.kind && h.fingerprint === b.fingerprint) {
        baseUsed.add(bi);
        headUsed.add(hi);
        // A fingerprint match with EQUAL names is the trivial (unchanged) case —
        // label it "name"; a DIFFERENT name means the fingerprint resolved a
        // rename — label it "fingerprint" (giti's exact need to see a rename was
        // resolved, not add+remove).
        matched.push({ base: b, head: h, matchedBy: b.name === h.name ? "name" : "fingerprint" });
        break;
      }
    }
  }

  // Pass B — name + kind on the residue (body changed, name stable).
  for (let bi = 0; bi < base.length; bi++) {
    if (baseUsed.has(bi)) continue;
    const b = base[bi];
    for (let hi = 0; hi < head.length; hi++) {
      if (headUsed.has(hi)) continue;
      const h = head[hi];
      if (h.kind === b.kind && h.name === b.name) {
        baseUsed.add(bi);
        headUsed.add(hi);
        matched.push({ base: b, head: h, matchedBy: "name" });
        break;
      }
    }
  }

  const removedBase = base.filter((_, i) => !baseUsed.has(i));
  const addedHead = head.filter((_, i) => !headUsed.has(i));
  return { matched, addedHead, removedBase };
}

// ---------------------------------------------------------------------------
// Emit canonicalization — the Tier-0 emit-identity proof (Signal 1)
// ---------------------------------------------------------------------------
//
// scrml codegen re-emits a function body with the SOURCE whitespace preserved, so
// a pure reformat / comment-only edit produces a DIFFERENT byte stream even though
// the program is identical. A raw byte-compare therefore mis-reads reformat /
// comment as behavioral. The sound fix is AST-STRUCTURAL canonicalization: parse
// each emitted JS artifact with acorn and serialize a whitespace/comment-free,
// ASI-correct (post-parse) canonical string, applying the matched-entity rename
// map to Identifiers (skipping property keys / import-export externals / labels,
// which are the observable surface). Two emits that differ only in formatting,
// comments, or a top-level entity alpha-rename → identical canonical strings →
// Tier-0. This mirrors the DD §3 prior art (Difftastic ignores whitespace;
// alpha-equivalence reduces to syntactic equality after canonical renaming).

const JS_KINDS = new Set(["serverJs", "clientJs", "libraryJs"]);

const SER_SKIP_KEYS = new Set([
  "type", "start", "end", "loc", "range", "leadingComments", "trailingComments", "comments",
]);

/** Positions where an Identifier is a FIXED name (property key / import-export
 *  external / label), NOT a renameable binding or reference. */
function isFixedNameChild(parentType: string, key: string, parent: Record<string, unknown>): boolean {
  if (parentType === "MemberExpression" && key === "property" && !parent.computed) return true;
  if (
    (parentType === "Property" || parentType === "PropertyDefinition" || parentType === "MethodDefinition") &&
    key === "key" && !parent.computed
  ) return true;
  if (
    parentType === "ImportSpecifier" || parentType === "ImportDefaultSpecifier" ||
    parentType === "ImportNamespaceSpecifier" || parentType === "ExportSpecifier"
  ) return true;
  if (
    (parentType === "LabeledStatement" || parentType === "BreakStatement" || parentType === "ContinueStatement") &&
    key === "label"
  ) return true;
  return false;
}

/**
 * Collect a pattern's bound Identifier names into `names` (handles the
 * destructuring forms an `export const { a, b } = …` can carry).
 */
function collectPatternNames(pat: unknown, names: Set<string>): void {
  if (!pat || typeof pat !== "object") return;
  const p = pat as Record<string, unknown>;
  switch (p.type) {
    case "Identifier":
      names.add(p.name as string);
      break;
    case "ObjectPattern":
      for (const prop of (p.properties as Record<string, unknown>[]) || []) {
        // Property → `.value`; RestElement → `.argument`.
        collectPatternNames(prop.value ?? prop.argument, names);
      }
      break;
    case "ArrayPattern":
      for (const el of (p.elements as unknown[]) || []) collectPatternNames(el, names);
      break;
    case "AssignmentPattern":
      collectPatternNames(p.left, names);
      break;
    case "RestElement":
      collectPatternNames(p.argument, names);
      break;
  }
}

/**
 * Collect the names EXPORTED by a top-level declaration form scrml actually
 * emits — `export function NAME`, `export class NAME`, `export const NAME`,
 * `export default function NAME`. These are the observable public surface: Fork D
 * (DD) fixes them so an export rename can NEVER canonicalize away (D1). scrml
 * NEVER emits an `export { }` specifier list (the pre-existing `ExportSpecifier`
 * guard in `isFixedNameChild` was DEAD CODE for real scrml output); this covers
 * the declaration forms it DOES emit.
 */
function collectExportedNames(ast: unknown): Set<string> {
  const names = new Set<string>();
  const body = (ast as Record<string, unknown> | null)?.body;
  if (!Array.isArray(body)) return names;
  for (const node of body) {
    if (!node || typeof node !== "object") continue;
    const t = (node as Record<string, unknown>).type;
    if (t === "ExportNamedDeclaration" || t === "ExportDefaultDeclaration") {
      const decl = (node as Record<string, unknown>).declaration as Record<string, unknown> | undefined;
      if (!decl) continue; // `export { a as b }` — the specifier guard already fixes it.
      const dt = decl.type;
      if ((dt === "FunctionDeclaration" || dt === "ClassDeclaration") && decl.id) {
        names.add((decl.id as Record<string, unknown>).name as string);
      } else if (dt === "VariableDeclaration" && Array.isArray(decl.declarations)) {
        for (const d of decl.declarations as Record<string, unknown>[]) collectPatternNames(d.id, names);
      }
    }
  }
  return names;
}

/** Serialize an ESTree node to a canonical, position-free string. `fixed` = the
 *  incoming Identifier is a fixed name (only consumed at the Identifier leaf).
 *  `exportedNames` = observable public symbols that are NEVER renamed at ANY site
 *  (Fork D — an export rename is behavioral, D1). */
function serializeNode(
  node: unknown,
  renameMap: Map<string, string>,
  fixed: boolean,
  exportedNames: Set<string>,
): string {
  if (node === null || node === undefined) return "0";
  if (Array.isArray(node)) return "[" + node.map((n) => serializeNode(n, renameMap, false, exportedNames)).join(",") + "]";
  if (typeof node !== "object") return JSON.stringify(node);
  const obj = node as Record<string, unknown>;
  const type = obj.type as string | undefined;
  if (!type) {
    // A plain sub-record (e.g. Literal.regex `{pattern,flags}`) — serialize keys.
    const keys = Object.keys(obj).filter((k) => !SER_SKIP_KEYS.has(k)).sort();
    return "{" + keys.map((k) => k + ":" + serializeNode(obj[k], renameMap, false, exportedNames)).join(",") + "}";
  }
  if (type === "Identifier") {
    const nm = obj.name as string;
    // An exported/observable name stays FIXED at every occurrence (decl AND
    // reference) — so an export rename never folds to equality (D1 / Fork D).
    const renameable = !fixed && !exportedNames.has(nm) && renameMap.has(nm);
    return "Id:" + (renameable ? renameMap.get(nm) : nm);
  }
  if (type === "PrivateIdentifier") return "Priv:" + obj.name;
  if (type === "Literal") {
    if (obj.regex) return "Rx:" + serializeNode(obj.regex, renameMap, false, exportedNames);
    if (typeof obj.bigint === "string") return "Big:" + obj.bigint;
    return "Lit:" + JSON.stringify(obj.value);
  }
  if (type === "TemplateElement") {
    const val = obj.value as { cooked?: unknown; raw?: unknown } | undefined;
    return "Tpl:" + JSON.stringify(val ? val.cooked : undefined);
  }
  const keys = Object.keys(obj).filter((k) => !SER_SKIP_KEYS.has(k)).sort();
  let s = "(" + type;
  for (const k of keys) {
    const childFixed = isFixedNameChild(type, k, obj);
    s += " " + k + "=" + serializeNode(obj[k], renameMap, childFixed, exportedNames);
  }
  return s + ")";
}

/**
 * Canonicalize an emitted JS artifact (Signal 1). Returns a whitespace/comment-
 * free, ASI-correct canonical string with the matched-entity rename map applied.
 * On a parse failure (should not happen — emitted JS is validate-emit gated) the
 * raw text is returned with a marker prefix (conservative: it then only matches an
 * identically-raw counterpart, so a would-be Tier-0 degrades to Tier-2 safely).
 */
export function canonicalizeJs(js: string, renameMap: Map<string, string>): string {
  if (!js) return js;
  try {
    const ast = acorn.parse(js, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowSuperOutsideMethod: true,
    });
    // Fork D — never rename an observable exported name (D1); collect them from
    // the real emitted declaration forms so an export rename cannot fold away.
    const exportedNames = collectExportedNames(ast);
    return serializeNode(ast, renameMap, false, exportedNames);
  } catch {
    return "RAW:" + js;
  }
}

// ---------------------------------------------------------------------------
// Source-basename neutralization — D2
// ---------------------------------------------------------------------------
//
// scrml bakes the SOURCE file's basename stem into emitted CONTENT: the SSR html
// loader (`new URL("./<base>.html", import.meta.url)`), the route path
// (`path:"/<base>"`), the html shell (`<title><base></title>`,
// `<script src="<base>.client.js">`), and the sibling artifact names
// (`<base>.client.js` / `<base>.css` / …). Two BYTE-IDENTICAL programs at
// different filenames therefore differ ONLY by this stem and would read
// behavioral (D2). We canonicalize the stem to a placeholder on BOTH sides, but
// ONLY in these unambiguously filename-DERIVED shapes — a user string literal
// (`reveal("alpha")`, `<p>alpha</p>`) is left untouched, so a genuine behavioral
// string change still reads behavioral.

const SEMDIFF_BASENAME_PLACEHOLDER = "__SEMDIFF_BASENAME__";

// The build-file extensions the source stem carries in a filename reference. The
// trailing lookahead forbids a longer extension (`.jsx`, `.json`) from being
// partial-matched on `.js`.
const SEMDIFF_BUILD_EXT = "\\.(?:client\\.js|server\\.js|css|html|js|map)(?![A-Za-z0-9])";

/**
 * Replace the source basename `stem` with a stable placeholder in the
 * filename-derived shapes scrml emits. Surgical by construction: EVERY pattern is
 * anchored on a filename-derived CONTEXT — an HTML `src=`/`href=` attribute, a
 * relative `"./…"` module/URL specifier (the SSR `new URL("./stem.html")` loader
 * + `import`/`from`), a `sourceMappingURL=` directive, a `<title>` element, or a
 * `path:"…"` route key. A BARE content literal (`return "alpha.js"`,
 * `reveal("alpha")`) carries NONE of these contexts, so a genuine content change
 * that coincides with a filename still reads behavioral (N1 — the earlier
 * unanchored `<stem>.<ext>` match over-neutralized bare literals). Returns
 * `content` unchanged when `stem` is empty.
 */
export function canonicalizeSourceBasename(content: string, stem: string): string {
  if (!content || !stem) return content;
  const B = escapeRegExp(stem);
  const EXT = SEMDIFF_BUILD_EXT;
  const PH = SEMDIFF_BASENAME_PLACEHOLDER;
  let out = content;
  // (1a) HTML attribute reference — `src="<stem>.<ext>"` / `href='<stem>.<ext>'`
  //      (the `<script src="stem.client.js">` shell, `<link href="stem.css">`).
  out = out.replace(new RegExp(`(\\b(?:src|href)\\s*=\\s*["'])${B}(${EXT})`, "g"), `$1${PH}$2`);
  // (1b) relative module / URL specifier — `"./<stem>.<ext>"` (the SSR loader
  //      `new URL("./stem.html", import.meta.url)`, an `import … from "./stem…"`).
  out = out.replace(new RegExp(`(["'\`]\\./)${B}(${EXT})`, "g"), `$1${PH}$2`);
  // (1c) sourcemap directive — `sourceMappingURL=<stem>.<ext>`.
  out = out.replace(new RegExp(`(sourceMappingURL=)${B}(${EXT})`, "g"), `$1${PH}$2`);
  // (2) `<title><stem></title>` — the auto-derived document title.
  out = out.replace(new RegExp(`(<title>)${B}(</title>)`, "g"), `$1${PH}$2`);
  // (3) `path: "/<stem>"` — the route table's auto-derived path (anchored on the
  //     `path:` key so a user path literal elsewhere is not touched).
  out = out.replace(new RegExp(`(path\\s*:\\s*")/${B}(?=["/])`, "g"), `$1/${PH}`);
  return out;
}

/**
 * Collect the raw emitted artifacts for a version, deterministic + PATH-
 * INDEPENDENT. Base and head are the SAME logical program at two versions (often
 * different worktree paths / fixture names), so the output FILE PATH is version-
 * noise that must NOT enter the Tier-0 compare; only (kind, content) survives.
 * The list is sorted so a multi-file compile's path-order does not perturb it.
 */
export function collectEmitArtifacts(outputs: Map<string, Record<string, unknown>>): SemEmitArtifact[] {
  const KIND_ORDER = ["serverJs", "clientJs", "libraryJs", "html", "css", "sql"];
  const artifacts: SemEmitArtifact[] = [];
  for (const out of outputs.values()) {
    for (const kind of KIND_ORDER) {
      const v = (out || {})[kind];
      if (typeof v === "string" && v.length > 0) artifacts.push({ kind, content: v });
    }
  }
  artifacts.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.content < b.content ? -1 : a.content > b.content ? 1 : 0));
  return artifacts;
}

/**
 * Build the canonical, comparable emit corpus for a version: canonicalize each JS
 * artifact (whitespace/comment/ASI-insensitive + rename-applied); include html /
 * css / sql raw (a scrml logic reformat leaves those byte-identical; markup-
 * whitespace insensitivity is a P1 refinement). Sorted + separator-joined.
 */
function buildComparableCorpus(
  artifacts: SemEmitArtifact[],
  renameMap: Map<string, string>,
  sourceBasename?: string,
): string {
  const stem = sourceBasename || "";
  const parts = artifacts.map((a) => {
    // D2 — neutralize the source-basename stem baked into emitted content BEFORE
    // canonicalization (in JS it lives inside string literals canonicalizeJs
    // preserves verbatim, so it must be rewritten first).
    const deBased = canonicalizeSourceBasename(a.content, stem);
    const body = JS_KINDS.has(a.kind) ? canonicalizeJs(deBased, renameMap) : deBased;
    return a.kind + CORPUS_KIND_SEP + body;
  });
  parts.sort();
  return parts.join(CORPUS_ARTIFACT_SEP);
}

// ---------------------------------------------------------------------------
// Use-site diagnostic-set diff — Signal 3
// ---------------------------------------------------------------------------

/** Set-membership key for a diagnostic: (code + message) — tolerant of the small
 *  byte-offset shifts a same-diagnostic sees when unrelated bytes move between
 *  base and head, so only genuinely-new diagnostics read as "added". */
function diagKey(d: SemDiagnostic): string {
  return `${d.code}${DIAG_KEY_SEP}${d.message}`;
}

export function diffDiagnostics(
  base: SemDiagnostic[],
  head: SemDiagnostic[],
): { added: SemDiagnostic[]; removed: SemDiagnostic[] } {
  const baseKeys = new Set(base.map(diagKey));
  const headKeys = new Set(head.map(diagKey));
  const added = head.filter((d) => !baseKeys.has(diagKey(d)));
  const removed = base.filter((d) => !headKeys.has(diagKey(d)));
  return { added, removed };
}

/** Does a diagnostic fall within an entity's source span? */
function diagInSpan(d: SemDiagnostic, span: SemSpan): boolean {
  if (d.span && typeof d.span.start === "number") {
    return d.span.start >= span.start && d.span.start < span.end;
  }
  if (typeof d.line === "number" && typeof span.line === "number") {
    const endLine = typeof span.endLine === "number" ? span.endLine : span.line;
    return d.line >= span.line && d.line <= endLine;
  }
  return false;
}

/**
 * Does a diagnostic message reference an entity by name? E-TYPE-063 fires at a
 * cell/use-site (outside any function/type entity span) but names the enum in
 * backticks — "…variant of enum `Ref`". A backtick-quoted `<name>` token in the
 * message attributes the use-break to that entity, delivering giti's rename↔use
 * separator to the enum entity even though the diagnostic span is elsewhere.
 */
function diagNamesEntity(d: SemDiagnostic, name: string): boolean {
  if (!name) return false;
  return d.message.includes("`" + name + "`");
}

// ---------------------------------------------------------------------------
// Unmodeled-axis breadcrumb — D3 (the confidentiality honest floor)
// ---------------------------------------------------------------------------
//
// P0 does NOT model the confidentiality axis (`<db protect=>` — Fork A / P4).
// When a `protect=` list narrows with no local handler selecting the column, the
// emit is BYTE-IDENTICAL and no `I-PROTECT-STRIP-001` fires, so the change would
// be a SILENT Tier-0 — the one thing §0(2) forbids ("unmodeled = never silently
// cosmetic"). We do NOT classify the change (that IS the P4 confidentiality
// axis); we only SIGNAL that an unmodeled-axis attribute moved, so a consumer can
// SEE that something semdiff does not model changed.

/** Canonicalize an unmodeled-axis attribute value for the set-compare — collapse
 *  whitespace + sort the comma-list so `"email, password_hash"` and
 *  `"password_hash,email"` compare equal (order/spacing is not the axis). */
function normUnmodeledAttrValue(value: string): string {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
    .join(",");
}

/**
 * Diff the unmodeled-axis attributes base↔head and produce a breadcrumb signal
 * per attribute whose value CHANGED. Info-level (`I-SEMDIFF-UNMODELED-AXIS`) — a
 * signal, not a verdict on the (P4-deferred) axis.
 */
export function diffUnmodeledAxisAttrs(
  base: SemUnmodeledAttr[] | undefined,
  head: SemUnmodeledAttr[] | undefined,
): SemDiagnostic[] {
  const signals: SemDiagnostic[] = [];
  // Aggregate ALL occurrences of an attribute into one normalized set — a change
  // to any `<db protect=>` in the file moves the aggregate (a net-zero shuffle of
  // the SAME columns across blocks is, correctly, not a confidentiality change).
  const byAttr = (list: SemUnmodeledAttr[] | undefined) => {
    const groups = new Map<string, string[]>();
    for (const a of list || []) {
      const g = groups.get(a.attr);
      if (g) g.push(a.value);
      else groups.set(a.attr, [a.value]);
    }
    const m = new Map<string, string>();
    for (const [attr, vals] of groups) m.set(attr, normUnmodeledAttrValue(vals.join(",")));
    return m;
  };
  const b = byAttr(base);
  const h = byAttr(head);
  const attrs = Array.from(new Set([...b.keys(), ...h.keys()])).sort();
  for (const attr of attrs) {
    const bv = b.get(attr);
    const hv = h.get(attr);
    if (bv !== hv) {
      signals.push({
        code: "I-SEMDIFF-UNMODELED-AXIS",
        message:
          `an unmodeled-axis attribute (\`${attr}=\`) changed (${bv ?? "<absent>"} -> ${hv ?? "<absent>"}) — ` +
          `P0 does not model this axis (confidentiality is P4-deferred); surfaced so the change is not a silent Tier-0`,
        severity: "info",
      });
    }
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Classification core
// ---------------------------------------------------------------------------

/**
 * Classify head vs base into the per-entity AXIS + TIER schema (DD §8).
 *
 * Tier assignment per matched entity (constraint §0 — never a false COSMETIC):
 *   1. opaque (either side)                → Tier-2, opaque:true, axis "opaque"   [forced, §0(2)]
 *   2. new use-site diagnostic (in-span or names-entity) → Tier-2, axis "use-site"
 *   3. whole-output normalized emit IDENTICAL → Tier-0   [emit-identity PROVEN — a
 *        source-fingerprint delta absorbed by the rename normalization is cosmetic]
 *   4. body fingerprint changed            → Tier-2, axis "source"  [entity's own source moved]
 *   5. else (emit differs, source stable)  → Tier-2, axis "context" [sibling changed the compile;
 *                                              P0's whole-output gate can't isolate — Fork C / P1]
 *
 * P0 emits only Tier-0 / Tier-2 — a modeled-axis Tier-1 needs the P1-P4 axis
 * diffs this floor deliberately omits. The emit-identity gate (step 3) takes
 * precedence over the source-delta (step 4) so a pure alpha-rename (which moves an
 * entity's body text but not its observable output) reaches Tier-0 for BOTH the
 * renamed entity and its callers.
 */
export function classifySemdiff(base: SemVersion, head: SemVersion): SemClassification {
  const { matched, addedHead, removedBase } = matchEntities(base.entities, head.entities);
  const diagDiff = diffDiagnostics(base.diagnostics, head.diagnostics);

  // Signal 1 — whole-output emit identity, modulo top-level entity-name renames.
  // Build the rename maps from the fingerprint-matched (renamed) pairs — but
  // NEVER fold an EXPORTED (observable) name (D1 / Fork D): an export rename
  // genuinely changes the public symbol (`export function getUser` ->
  // `export function fetchUser`), which breaks any cross-file `import { getUser }`.
  // Excluding it keeps the emit DIFFERENT so the change reaches Tier-2.
  const baseRename = new Map<string, string>();
  const headRename = new Map<string, string>();
  let renameCounter = 0;
  for (const m of matched) {
    if (m.base.name !== m.head.name && !m.base.exported && !m.head.exported) {
      const canonical = `__SEMDIFF_MATCH_${renameCounter++}__`;
      baseRename.set(m.base.name, canonical);
      headRename.set(m.head.name, canonical);
    }
  }
  const baseEmitNorm = buildComparableCorpus(base.emitArtifacts, baseRename, base.sourceBasename);
  const headEmitNorm = buildComparableCorpus(head.emitArtifacts, headRename, head.sourceBasename);
  const emitIdentical = baseEmitNorm.length > 0 && baseEmitNorm === headEmitNorm;

  // D3 — unmodeled-axis breadcrumb signals (a `protect=` move P0 does not model).
  const unmodeledSignals = diffUnmodeledAxisAttrs(base.unmodeledAxisAttrs, head.unmodeledAxisAttrs);

  const entities: SemClassifiedEntity[] = [];

  for (const m of matched) {
    const { base: b, head: h, matchedBy } = m;
    const axes: SemAxis[] = [];
    let tier: "0" | "1" | "2" = "2";
    let opaque = false;

    const opaqueReasons = Array.from(new Set([...b.opaqueReasons, ...h.opaqueReasons]));

    if (opaqueReasons.length > 0) {
      // §0(2) — forced Tier-2, regardless of the modeled axes. NEVER Tier-0/1.
      opaque = true;
      tier = "2";
      axes.push({ axis: "opaque", detail: { reasons: opaqueReasons }, span: h.span });
    } else {
      // D1 — an EXPORTED entity whose observable name changed (matched by
      // fingerprint = same body, different name). This is behavioral by
      // construction (Fork D): the public symbol moved, breaking importers. Flag
      // it precisely (NOT the imprecise "context" the whole-output gate would
      // otherwise assign) — independent of the emit-identity gate.
      if (matchedBy === "fingerprint" && (b.exported || h.exported) && b.name !== h.name) {
        tier = "2";
        axes.push({
          axis: "source",
          detail: {
            reason: "exported-name-changed",
            from: b.name,
            to: h.name,
            note: "exported symbol renamed — the public name changed; breaks any cross-file `import { name }` (DD Fork D)",
          },
          span: h.span,
        });
      }

      // Signal 3 — a use-break attributed to this entity (span-containment OR the
      // diagnostic message names the entity in backticks).
      const useBreaks = diagDiff.added.filter(
        (d) => diagInSpan(d, h.span) || diagNamesEntity(d, h.name),
      );
      if (useBreaks.length > 0) {
        tier = "2";
        axes.push({
          axis: "use-site",
          detail: { codes: useBreaks.map((d) => d.code), messages: useBreaks.map((d) => d.message) },
          span: h.span,
        });
      }

      if (emitIdentical) {
        // Whole normalized output byte-identical → PROVEN cosmetic. Grant Tier-0
        // unless a use-break was surfaced (a new diagnostic is a real signal even
        // when the emit looks unchanged — the safe direction).
        if (axes.length === 0) tier = "0";
      } else {
        // Emit differs — attribute the per-entity movement.
        if (b.fingerprint !== h.fingerprint) {
          tier = "2";
          axes.push({
            axis: "source",
            detail: { note: "entity body changed (P0 detects the change; the modeled-axis attribution is the P1 footprint refinement)" },
            span: h.span,
          });
        }
        if (axes.length === 0) {
          tier = "2";
          axes.push({
            axis: "context",
            detail: { note: "entity source unchanged, but the compile output changed in a sibling entity; P0's whole-output emit gate cannot certify Tier-0 (Fork C — P1 per-entity attribution)" },
            span: h.span,
          });
        }
      }
    }

    entities.push({ entity: h.name, kind: h.kind, matchedBy, tier, axes, opaque, span: h.span });
  }

  // Deterministic order: source position in head, then name.
  entities.sort((a, b) => (a.span.start - b.span.start) || (a.entity < b.entity ? -1 : 1));

  const unmatched = {
    added: addedHead.map((e) => e.name).sort(),
    removed: removedBase.map((e) => e.name).sort(),
  };

  // D4 — the SYNTHESIZED top-level verdict. A change is `cosmetic` only when the
  // WHOLE picture is a no-op: every matched entity Tier-0, nothing added/removed
  // (a route/entity add lands ONLY in `unmatched.added`), no new use-site
  // diagnostic, and no unmodeled-axis signal (§0(2) — never SILENTLY cosmetic).
  // A naive "all entities Tier-0" misreads a route-add as cosmetic — this ANDs it.
  const anyBehavioralEntity = entities.some((e) => e.tier !== "0");
  const anyUnmatched = unmatched.added.length > 0 || unmatched.removed.length > 0;
  const anyNewDiagnostic = diagDiff.added.length > 0;
  const anyUnmodeledSignal = unmodeledSignals.length > 0;

  // N2 (S239 re-review) — the whole-output emit-identity is the FLOOR of the
  // verdict, not just a per-entity input. A change to a program with ZERO matched
  // entities (a pure-markup edit `<p>hello</p>`->`<p>goodbye</p>`, a degenerate
  // component-only file) leaves entities/unmatched/diagnostics all empty, yet the
  // compiled output genuinely differs. Without this term the verdict would read a
  // FALSE cosmetic (the dangerous direction). When the whole normalized output
  // differs but NOTHING attributes it (no behavioral entity / add / diagnostic),
  // surface a breadcrumb so the consumer sees WHY it is behavioral.
  const wholeOutputChanged = baseEmitNorm !== headEmitNorm;
  const signals: SemDiagnostic[] = [...unmodeledSignals];
  if (wholeOutputChanged && !anyBehavioralEntity && !anyUnmatched && !anyNewDiagnostic) {
    signals.push({
      code: "I-SEMDIFF-EMIT-CHANGED",
      message:
        "the compiled output changed but no matched entity carries it — a markup / whole-output " +
        "change P0's entity model does not attribute per-entity; classified behavioral (conservative)",
      severity: "info",
    });
  }

  const behavioral =
    anyBehavioralEntity || anyUnmatched || anyNewDiagnostic || anyUnmodeledSignal || wholeOutputChanged;
  const verdict: "cosmetic" | "behavioral" = behavioral ? "behavioral" : "cosmetic";

  // D4 — the exit-code contract (standard diff convention):
  //   2 = a version failed to compile (fail-closed) · 1 = behavioral · 0 = cosmetic.
  const exitCode: 0 | 1 | 2 =
    base.failedToCompile || head.failedToCompile ? 2 : behavioral ? 1 : 0;

  return {
    version: 1,
    base: base.label,
    head: head.label,
    verdict,
    entities,
    unmatched,
    diagnostics: diagDiff,
    signals,
    exitCode,
  };
}
