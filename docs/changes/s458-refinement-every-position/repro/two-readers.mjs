// s458 Phase 0 — the TWO predicate readers, side by side, and what the runtime judge emits for each.
// TS reader: type-system.ts resolveTypeExpr → PredicatedType.predicate (decl zones consume this).
// CG reader: codegen/emit-predicates.ts parsePredicateAnnotation (param / return / server-param checks consume this).
// Usage: bun docs/changes/s458-refinement-every-position/repro/two-readers.mjs
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const wt = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { resolveTypeExpr } = await import(resolve(wt, "compiler/src/type-system.js"));
const { parsePredicateAnnotation, predicateToJsExpr } = await import(resolve(wt, "compiler/src/codegen/emit-predicates.ts"));

const reg = new Map();
reg.set("Role", { kind: "enum", name: "Role", variants: [{ name: "Admin", payload: null }, { name: "Editor", payload: null }, { name: "Viewer", payload: null }] });
const forms = [
  "string(url)",
  "number(>0 && <10000)",
  "string(.length > 7)",
  "string(email) [lbl]",
  "integer(>0)",
  "string(url || email)",
  "number(!(>5))",
  "number(0 < value < 10)",
  "string(pattern(/^[^@]+@[^@]+$/))",
  "number(min(0) && max(100))",
  "number.min(0).max(100)",
  "string.req.length(>=2)",
  "string req length(<=80)",
  "Role oneOf([.Admin, .Editor])",
  "Role notIn([.Viewer])",
  "string(ssn)",
  "boolean(true)",
];
for (const f of forms) {
  let t;
  try { t = resolveTypeExpr(f, reg); } catch (e) { t = { kind: "THREW " + e.message }; }
  const m = parsePredicateAnnotation(f);
  const tsJudge = t && t.kind === "predicated" ? predicateToJsExpr(t.predicate, "v") : "-";
  const cgJudge = m ? predicateToJsExpr(m.predicate, "v") : "(no check)";
  console.log(`${JSON.stringify(f)}\n   TS: ${t.kind}${t.kind === "predicated" ? " " + JSON.stringify(t.predicate).slice(0, 120) : ""}\n   TS-judge: ${tsJudge.slice(0, 110)}\n   CG-judge: ${cgJudge.slice(0, 110)}`);
}
