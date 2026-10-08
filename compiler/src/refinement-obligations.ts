/**
 * §53 refinement obligations — S458 slice 2.
 *
 * ONE place decides "this value flows into a refined type, so it is judged".
 * The type-system stage calls in here at every site where a value is written
 * into a declared type (a declaration, a reassignment, a parameter binding, a
 * return, a struct/array/union container); this module turns the declared
 * TYPE into a `JudgeType` — the plain-data description of what the runtime
 * judge (codegen/emit-predicates.ts `judgeTypeExpr`) checks — and desugars the
 * obligation INTO THE AST, so every emitter that emits the program emits the
 * check without knowing about it:
 *
 *   - a value expression is wrapped in a call to the per-compilation placeholder
 *     `__scrml_refine_<token>__(value)` carrying `refine: { judge, where }`.
 *     codegen's `emitCall` lowers it to an inline judge; an emitter that does
 *     not lower it leaves a `__scrml_…__` placeholder in its artifact, which the
 *     §2.2.1 emit gate (codegen/validate-emit.ts) refuses — so a missed lowering
 *     is a compile error, never a silently unchecked write (F2). An author cannot
 *     spell the placeholder: the token is fresh per compilation
 *     (placeholder-nonce.ts) and `__scrml_` is reserved (§47.1.1).
 *   - a function parameter gets a guard STATEMENT prepended to its body (an
 *     expression statement of the same placeholder call over the parameter), so
 *     client, server, nested, worker, tool and library functions all carry it.
 *
 * The reserved-prefix check (validators/reserved-prefix.ts) runs on the
 * AUTHOR's tree post-TAB, before the type-system stage creates these nodes, so
 * it never sees them; the type-system scope walker skips `_`-prefixed names.
 */

import { placeholderName, isCompilerPlaceholderName } from "./placeholder-nonce.ts";

/**
 * What the runtime judge checks. Plain data (survives the codegen deep-clones).
 *   pred     — a §53 refinement: base type + predicate (+ label).
 *   array    — every element is `of`.
 *   nullable — `not` (null/undefined), or `of`.
 *   struct   — a REFERENCE to a struct judge (`structJudgeDef(id)`): an object
 *              whose refined fields are each their judge.
 *   enum     — a REFERENCE to an enum judge (`enumJudgeDef(id)`): one of the
 *              enum's variants, a payload variant's refined fields judged.
 *   anyOf    — a union with a refined member: the value satisfies one member.
 *   prim     — an unrefined primitive union member (number/integer/string/boolean,
 *              and the string-shaped date/timestamp).
 *   shape    — an unrefined union member judged by its runtime shape: a §59
 *              value-native map (or set), a function.
 *   any      — an `asIs` union member: a developer-signed untyped value, which
 *              every value inhabits (§7.5.2) — `true` is its exact judge.
 *   unjudgeable — a union member no runtime test can decide (an unresolved
 *              type, markup, an engine, a map whose keys / values are refined,
 *              …). The type stage refuses the annotation (E-CONTRACT-002); the
 *              judge, if ever reached, fails closed. S459 LOW-MED-3: these used
 *              to be `any` — `number(>0) | date` admitted -5.
 *
 * S458 2a-fix F3 — a struct / enum is a reference, never an inline copy: a
 * struct reused k times per level used to be copied k^depth times into every
 * judge, every stamp and every emitted check. The definitions live in one
 * content-addressed registry (the same type always gets the same id, in any
 * compilation), so a judge is linear in the size of the annotation it came from.
 */
export type JudgeType =
  | { k: "pred"; baseType: string; predicate: unknown; label: string | null }
  | { k: "array"; of: JudgeType }
  | { k: "nullable"; of: JudgeType }
  | { k: "struct"; name: string; id: string }
  | { k: "enum"; name: string; id: string }
  | { k: "anyOf"; of: JudgeType[] }
  | { k: "prim"; baseType: string }
  | { k: "shape"; shape: "map" | "function" }
  | { k: "any" }
  | { k: "unjudgeable"; what: string };

/** A struct judge: the refined fields (only those carrying a refinement are listed). */
export interface StructJudgeDef { name: string; fields: Array<[string, JudgeType]> }
/** An enum judge: every variant; a payload variant lists its refined payload fields (`null` = unit). */
export interface EnumJudgeDef { name: string; variants: Array<[string, Array<[string, JudgeType]> | null]> }

const _structDefs = new Map<string, StructJudgeDef>();
const _enumDefs = new Map<string, EnumJudgeDef>();

/** The struct judge `id` names (a `{ k: "struct" }` reference). */
export function structJudgeDef(id: string): StructJudgeDef {
  const d = _structDefs.get(id);
  if (!d) throw new Error(`internal: no struct judge ${id}`);
  return d;
}

/** The enum judge `id` names (a `{ k: "enum" }` reference). */
export function enumJudgeDef(id: string): EnumJudgeDef {
  const d = _enumDefs.get(id);
  if (!d) throw new Error(`internal: no enum judge ${id}`);
  return d;
}

/** FNV-1a 32-bit over `s`, base36 — a short, deterministic content id. */
export function contentId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Where a judged value was written — for the failure report. */
export interface RefineWhere {
  kind: "param" | "decl" | "assign" | "return" | "field" | "derived";
  name: string;
  fn?: string;
}

type AnyType = { kind?: string; [k: string]: unknown } | null | undefined;

// date / timestamp: "registered string-shaped primitives" (SPEC §7, the canonical-empty list).
const PRIMS = new Set(["number", "integer", "int", "string", "boolean", "bool", "date", "timestamp"]);

// Memo per resolved type object: a type reached along many paths is judged once.
// Only results computed with no recursion cut below them are memoized.
const _judgeMemo = new WeakMap<object, JudgeType | null>();
const _shapeMemo = new WeakMap<object, JudgeType>();

/**
 * The judge for declared type `t`, or null when `t` carries no refinement
 * anywhere (nothing to check). A recursive type is cut where it re-enters a
 * struct already on the path (that inner occurrence is not judged).
 */
export function judgeTypeOf(t: AnyType, seen: Set<unknown> = new Set()): JudgeType | null {
  if (!t || typeof t !== "object") return null;
  if (_judgeMemo.has(t)) return _judgeMemo.get(t)!;
  const cuts = { n: 0 };
  const j = judgeTypeOfInner(t, seen, cuts);
  if (cuts.n === 0) _judgeMemo.set(t, j);
  return j;
}

function judgeTypeOfInner(t: NonNullable<AnyType>, seen: Set<unknown>, cuts: { n: number }): JudgeType | null {
  const sub = (x: AnyType): JudgeType | null => {
    if (!x || typeof x !== "object") return null;
    if (_judgeMemo.has(x)) return _judgeMemo.get(x)!;
    const c = { n: 0 };
    const r = judgeTypeOfInner(x, seen, c);
    if (c.n === 0) _judgeMemo.set(x, r);
    cuts.n += c.n;
    return r;
  };
  switch (t.kind) {
    case "predicated": {
      const pt = t as { baseType: string; predicate: unknown; label?: string | null };
      return { k: "pred", baseType: pt.baseType, predicate: pt.predicate, label: pt.label ?? null };
    }
    case "array": {
      const of = sub((t as { element?: AnyType }).element);
      return of ? { k: "array", of } : null;
    }
    case "union": {
      const members = ((t as { members?: AnyType[] }).members ?? []) as AnyType[];
      const judged = members.map((m) => sub(m));
      if (!judged.some((j) => j !== null)) return null;
      const nonNot = members.filter((m) => m && m.kind !== "not");
      const hasNot = nonNot.length !== members.length;
      // `T | not` (and `T?`): the common optional shape.
      if (hasNot && nonNot.length === 1) {
        const of = judged[members.indexOf(nonNot[0])];
        return of ? { k: "nullable", of } : null;
      }
      // S458 2a-fix F2 — an unrefined member is judged by its SHAPE (a struct is
      // an object, an enum value is one of its variants, an array is an array of
      // its element's shape), never admitted wholesale: `number(>0) | Role` used
      // to admit -5 because the `Role` arm was `true`.
      const of: JudgeType[] = [];
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m || m.kind === "not") continue; // absence is the `nullable` wrapper below
        of.push(judged[i] ?? shapeJudgeOf(m, seen, cuts));
      }
      const core: JudgeType = { k: "anyOf", of };
      return hasNot ? { k: "nullable", of: core } : core;
    }
    case "struct": {
      if (seen.has(t)) { cuts.n++; return null; }
      seen.add(t);
      const fields: Array<[string, JudgeType]> = [];
      const fm = (t as { fields?: Map<string, AnyType> }).fields;
      if (fm instanceof Map) {
        for (const [name, ft] of fm) {
          const j = sub(ft);
          if (j) fields.push([name, j]);
        }
      }
      seen.delete(t);
      return fields.length ? registerStruct(String((t as { name?: unknown }).name ?? "struct"), fields) : null;
    }
    case "enum": {
      // An enum is refined only through a payload field that carries a refinement.
      if (seen.has(t)) { cuts.n++; return null; }
      seen.add(t);
      const def = enumVariantsJudged(t, sub);
      seen.delete(t);
      return def.some(([, f]) => f && f.length) ? registerEnum(String((t as { name?: unknown }).name ?? "enum"), def) : null;
    }
    default:
      return null;
  }
}

function enumVariantsJudged(t: NonNullable<AnyType>, sub: (x: AnyType) => JudgeType | null): Array<[string, Array<[string, JudgeType]> | null]> {
  const out: Array<[string, Array<[string, JudgeType]> | null]> = [];
  for (const v of ((t as { variants?: Array<{ name?: unknown; payload?: Map<string, AnyType> | null }> }).variants ?? [])) {
    if (!v || typeof v.name !== "string") continue;
    if (!(v.payload instanceof Map)) { out.push([v.name, null]); continue; }
    const fields: Array<[string, JudgeType]> = [];
    for (const [name, ft] of v.payload) {
      const j = sub(ft);
      if (j) fields.push([name, j]);
    }
    out.push([v.name, fields]);
  }
  return out;
}

function registerStruct(name: string, fields: Array<[string, JudgeType]>): JudgeType {
  const id = contentId(`struct ${name} ${JSON.stringify(fields)}`);
  if (!_structDefs.has(id)) _structDefs.set(id, { name, fields });
  return { k: "struct", name, id };
}

function registerEnum(name: string, variants: Array<[string, Array<[string, JudgeType]> | null]>): JudgeType {
  const id = contentId(`enum ${name} ${JSON.stringify(variants)}`);
  if (!_enumDefs.has(id)) _enumDefs.set(id, { name, variants });
  return { k: "enum", name, id };
}

/**
 * The judge of an UNREFINED union member: its runtime shape. Refinements inside
 * it are judged too (a refined member never reaches here).
 */
function shapeJudgeOf(m: NonNullable<AnyType>, seen: Set<unknown>, cuts: { n: number }): JudgeType {
  if (_shapeMemo.has(m)) return _shapeMemo.get(m)!;
  let r: JudgeType;
  switch (m.kind) {
    case "primitive": {
      const n = (m as { name?: unknown }).name;
      r = typeof n === "string" && PRIMS.has(n)
        ? { k: "prim", baseType: n === "int" ? "integer" : n === "bool" ? "boolean" : n }
        : { k: "unjudgeable", what: `the primitive type '${String(n)}'` };
      break;
    }
    case "asIs":
      r = { k: "any" };
      break;
    case "map": {
      // a refined key / value type inside the map would need every entry judged: not expressible here
      const mt = m as { key?: AnyType; value?: AnyType; set?: boolean };
      const refinedInside = judgeTypeOf(mt.key, seen) !== null || judgeTypeOf(mt.value, seen) !== null;
      r = refinedInside
        ? { k: "unjudgeable", what: `a ${mt.set ? "set" : "map"} whose ${mt.set ? "members" : "keys or values"} are refined` }
        : { k: "shape", shape: "map" };
      break;
    }
    case "function":
      r = { k: "shape", shape: "function" };
      break;
    case "struct":
      r = registerStruct(String((m as { name?: unknown }).name ?? "struct"), []);
      break;
    case "enum":
      r = registerEnum(String((m as { name?: unknown }).name ?? "enum"),
        enumVariantsJudged(m, (x) => (x && typeof x === "object" ? judgeTypeOf(x, seen) : null)));
      break;
    case "array": {
      const el = (m as { element?: AnyType }).element;
      r = { k: "array", of: el && typeof el === "object" ? (judgeTypeOf(el, seen) ?? shapeJudgeOf(el, seen, cuts)) : { k: "unjudgeable", what: "an array of an unresolved element type" } };
      break;
    }
    default:
      r = { k: "unjudgeable", what: m.kind === "unknown" ? "an unresolved type" : `a member of kind '${String(m.kind)}'` };
  }
  _shapeMemo.set(m, r);
  return r;
}

/** The compilation's refine placeholder callee name. */
export function refinePlaceholder(): string {
  return placeholderName("refine");
}

/** Is `node` a refine placeholder call (this compilation's)? */
export function isRefineCall(node: unknown): boolean {
  const n = node as { kind?: string; callee?: { kind?: string; name?: unknown }; refine?: unknown } | null;
  return !!n && n.kind === "call" && !!n.refine && n.callee?.kind === "ident"
    && typeof n.callee.name === "string" && n.callee.name === refinePlaceholder()
    && isCompilerPlaceholderName(n.callee.name);
}

/** Wrap value expression `expr` so it is judged against `judge` where it is written. */
export function wrapRefine(expr: unknown, judge: JudgeType, where: RefineWhere): unknown {
  if (!expr || typeof expr !== "object") return expr;
  if (isRefineCall(expr)) return expr; // never wrap twice
  const span = (expr as { span?: unknown }).span;
  return {
    kind: "call",
    callee: { kind: "ident", name: refinePlaceholder(), ...(span ? { span } : {}) },
    args: [expr],
    refine: { judge, where },
    ...(span ? { span } : {}),
  };
}

/**
 * S458 2a-fix F2 — `x++` / `--x` on a refined LOCAL target: a placeholder call
 * over the target whose lowering computes `x ± 1`, judges it, assigns it, and
 * yields the prefix / postfix value. `target` is a side-effect-free reference.
 */
export function wrapRefineUpdate(target: unknown, judge: JudgeType, where: RefineWhere, op: "+" | "-", prefix: boolean): unknown {
  const span = (target as { span?: unknown } | null)?.span;
  return {
    kind: "call",
    callee: { kind: "ident", name: refinePlaceholder(), ...(span ? { span } : {}) },
    args: [target],
    refine: { judge, where, update: { op, prefix } },
    ...(span ? { span } : {}),
  };
}

/**
 * S458 2a-fix F2 — `Object.assign(x, …src)` into a refined LOCAL struct: the
 * sources are merged first and the result `{ ...x, ...merged }` is judged
 * BEFORE anything is copied into `x`; the call then copies the merged object.
 * `base` is a second (side-effect-free) reference to the target.
 */
export function wrapRefineMerge(base: unknown, sources: unknown[], judge: JudgeType, where: RefineWhere): unknown {
  const span = (base as { span?: unknown } | null)?.span;
  return {
    kind: "call",
    callee: { kind: "ident", name: refinePlaceholder(), ...(span ? { span } : {}) },
    args: [base, ...sources],
    refine: { judge, where, merge: true },
    ...(span ? { span } : {}),
  };
}

/**
 * A guard statement for parameter `name` of function `fn`: an expression
 * statement `__scrml_refine__(name)`. Prepended to the function body.
 */
export function paramGuardStatement(name: string, judge: JudgeType, fn: string, span: unknown): Record<string, unknown> {
  const ident = { kind: "ident", name, ...(span ? { span } : {}) };
  return {
    kind: "bare-expr",
    expr: "",
    exprNode: wrapRefine(ident, judge, { kind: "param", name, fn }),
    refineParamGuard: { name, judge, fn },
    ...(span ? { span } : {}),
  };
}

/**
 * The first member of `j` no runtime test can decide (a union arm, through
 * arrays and `not`), or null. Struct / enum references are not entered: their
 * fields are checked at their own declaration.
 */
export function unjudgeableIn(j: JudgeType | null): string | null {
  if (!j) return null;
  switch (j.k) {
    case "unjudgeable": return j.what;
    case "array": case "nullable": return unjudgeableIn(j.of);
    case "anyOf": for (const m of j.of) { const w = unjudgeableIn(m); if (w) return w; } return null;
    default: return null;
  }
}

/** A short human description of a judge, for the failure report. */
export function describeJudge(j: JudgeType, fmtPred: (p: unknown) => string, nested = false, expand = false): string {
  switch (j.k) {
    case "pred": return `${j.baseType}(${fmtPred(j.predicate)})${j.label ? ` [${j.label}]` : ""}`;
    case "array": return `${describeJudge(j.of, fmtPred, nested)}[]`;
    case "nullable": return `${describeJudge(j.of, fmtPred, nested)} | not`;
    // S458 2a-fix F3 — a struct is described by reference (its name). Expanding it
    // inlined the whole type into every failure report, nested types included; its
    // fields are spelled once, on its hoisted judge (`expand` — that one level only).
    case "struct": {
      if (nested || !expand) return j.name;
      const d = structJudgeDef(j.id);
      return `${j.name} { ${d.fields.map(([n, f]) => `${n}: ${describeJudge(f, fmtPred, true)}`).join(", ")} }`;
    }
    case "enum": {
      if (nested || !expand) return j.name;
      const d = enumJudgeDef(j.id);
      return `${j.name} { ${d.variants.map(([v, f]) => f === null ? v : `${v}(${f.map(([n, fj]) => `${n}: ${describeJudge(fj, fmtPred, true)}`).join(", ")})`).join(", ")} }`;
    }
    case "anyOf": return j.of.map((m) => describeJudge(m, fmtPred, nested)).join(" | ");
    case "prim": return j.baseType;
    case "shape": return j.shape;
    case "any": return "asIs";
    case "unjudgeable": return "…";
  }
}
