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
 *   struct   — an object whose listed fields are each their judge (only the
 *              fields that carry a refinement are listed).
 *   anyOf    — a union with a refined member: the value satisfies one member.
 *   prim     — an unrefined primitive union member (number/integer/string/boolean).
 *   any      — an unrefined, non-primitive union member: not judged (admits).
 */
export type JudgeType =
  | { k: "pred"; baseType: string; predicate: unknown; label: string | null }
  | { k: "array"; of: JudgeType }
  | { k: "nullable"; of: JudgeType }
  | { k: "struct"; name: string; fields: Array<[string, JudgeType]> }
  | { k: "anyOf"; of: JudgeType[] }
  | { k: "prim"; baseType: string }
  | { k: "any" };

/** Where a judged value was written — for the failure report. */
export interface RefineWhere {
  kind: "param" | "decl" | "assign" | "return" | "field" | "derived";
  name: string;
  fn?: string;
}

type AnyType = { kind?: string; [k: string]: unknown } | null | undefined;

const PRIMS = new Set(["number", "integer", "int", "string", "boolean", "bool"]);

/**
 * The judge for declared type `t`, or null when `t` carries no refinement
 * anywhere (nothing to check). Recursive types are cut at a struct already on
 * the path (its refined fields are judged at the first level).
 */
export function judgeTypeOf(t: AnyType, seen: Set<unknown> = new Set()): JudgeType | null {
  if (!t || typeof t !== "object") return null;
  switch (t.kind) {
    case "predicated": {
      const pt = t as { baseType: string; predicate: unknown; label?: string | null };
      return { k: "pred", baseType: pt.baseType, predicate: pt.predicate, label: pt.label ?? null };
    }
    case "array": {
      const of = judgeTypeOf((t as { element?: AnyType }).element, seen);
      return of ? { k: "array", of } : null;
    }
    case "union": {
      const members = ((t as { members?: AnyType[] }).members ?? []) as AnyType[];
      const judged = members.map((m) => judgeTypeOf(m, seen));
      if (!judged.some((j) => j !== null)) return null;
      const nonNot = members.filter((m) => m && m.kind !== "not");
      const hasNot = nonNot.length !== members.length;
      // `T | not` (and `T?`): the common optional shape.
      if (hasNot && nonNot.length === 1) {
        const of = judgeTypeOf(nonNot[0], seen);
        return of ? { k: "nullable", of } : null;
      }
      const of: JudgeType[] = [];
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m) continue;
        if (judged[i]) { of.push(judged[i] as JudgeType); continue; }
        if (m.kind === "primitive" && typeof (m as { name?: unknown }).name === "string" && PRIMS.has((m as { name: string }).name)) {
          const n = (m as { name: string }).name;
          of.push({ k: "prim", baseType: n === "int" ? "integer" : n === "bool" ? "boolean" : n });
        } else if (m.kind === "not") {
          continue; // absence is the `nullable` wrapper below
        } else {
          of.push({ k: "any" });
        }
      }
      const core: JudgeType = { k: "anyOf", of };
      return hasNot ? { k: "nullable", of: core } : core;
    }
    case "struct": {
      if (seen.has(t)) return null;
      seen.add(t);
      const fields: Array<[string, JudgeType]> = [];
      const fm = (t as { fields?: Map<string, AnyType> }).fields;
      if (fm instanceof Map) {
        for (const [name, ft] of fm) {
          const j = judgeTypeOf(ft, seen);
          if (j) fields.push([name, j]);
        }
      }
      seen.delete(t);
      return fields.length ? { k: "struct", name: String((t as { name?: unknown }).name ?? "struct"), fields } : null;
    }
    default:
      return null;
  }
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

/** A short human description of a judge, for the failure report. */
export function describeJudge(j: JudgeType, fmtPred: (p: unknown) => string): string {
  switch (j.k) {
    case "pred": return `${j.baseType}(${fmtPred(j.predicate)})${j.label ? ` [${j.label}]` : ""}`;
    case "array": return `${describeJudge(j.of, fmtPred)}[]`;
    case "nullable": return `${describeJudge(j.of, fmtPred)} | not`;
    case "struct": return `${j.name} { ${j.fields.map(([n, f]) => `${n}: ${describeJudge(f, fmtPred)}`).join(", ")} }`;
    case "anyOf": return j.of.map((m) => describeJudge(m, fmtPred)).join(" | ");
    case "prim": return j.baseType;
    case "any": return "…";
  }
}
