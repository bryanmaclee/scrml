/**
 * S458 refinement 2a-fix — the review findings of slice 2a (F1-F4).
 *
 *   F1  one accessor for a refinement: codegen never reads a raw predicate off a
 *       stamp; the bind:value gate judges the BOUND position (a field by path).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { readFileSync, readdirSync } from "fs";
import { refinementOf, refinementAtPath, htmlPredicateOf, judgeBaseType } from "../../src/codegen/emit-predicates.ts";

const CODEGEN = resolve(import.meta.dir, "../../src/codegen");

describe("F1 — one accessor for a refinement", () => {
  test("no codegen consumer reads a raw predicate off a stamp or calls the predicate-level primitives", () => {
    const offenders = [];
    for (const f of readdirSync(CODEGEN)) {
      if (!f.endsWith(".ts") || f === "emit-predicates.ts") continue;
      const src = readFileSync(resolve(CODEGEN, f), "utf8");
      const lines = src.split("\n");
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        if (/(predicateCheck|refinement|refineReturn|refineAssign|_pc|_pParsed|PredInfo|predInfo)\??\.predicate\b/.test(l)
          || /\b(predicateToJsExpr|judgeExpr|emitRuntimeCheck|emitServerParamCheck)\s*\(/.test(l)) {
          offenders.push(`${f}:${i + 1}: ${l.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test("a whole-type stamp yields no predicate; the field path yields the field's own judge", () => {
    const struct = { k: "struct", name: "P", fields: [["n", { k: "pred", baseType: "number", predicate: { kind: "comparison", op: ">", value: 0 }, label: null }]] };
    const r = refinementOf({ judge: struct, predicate: undefined });
    expect(Object.keys(r).sort()).toEqual(["judge", "label"]);
    expect(htmlPredicateOf(r)).toBeNull();
    expect(refinementAtPath(r, ["name"])).toBeNull(); // unrefined field: no judge, no gate
    const n = refinementAtPath(r, ["n"]);
    expect(n.judge.k).toBe("pred");
    expect(judgeBaseType(n.judge)).toBe("number");
    expect(htmlPredicateOf(n).baseType).toBe("number");
  });

  test("a plain refinement inside containers becomes the container judge", () => {
    const r = refinementOf({ predicate: { kind: "comparison", op: ">", value: 0 }, baseType: "number", label: "pos", wrap: ["array", "nullable"] });
    expect(r.judge.k).toBe("array");
    expect(r.judge.of.k).toBe("nullable");
    expect(r.judge.of.of.k).toBe("pred");
    expect(r.label).toBe("pos");
    expect(htmlPredicateOf(r)).toBeNull();
  });
});
