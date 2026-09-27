// lint.test.js — proves the no-default-arm lint BITES (dpa-051 §3.4 / §10).
//
// The lint is only a mechanism if it goes RED on a planted wildcard over an IR
// enum and GREEN once it is removed. This test plants one in a scratch copy of
// the real bootstrap tree (core.scrml's `Type` enum — a Core IR enum), asserts
// red at the exact line, removes it, asserts green; plus unit cases for every
// pattern shape the lint classifies.

import { describe, test, expect } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lintText, lintTree } from "../../../scripts/lint-no-default-arm.js";

const TREE = join(import.meta.dir, "..");

const PLANT = `
    export fn isScalar(t: Type) -> boolean {
        return match t {
            .Int  :> true
            .Str  :> true
            _     :> false
        }
    }
`;

describe("lint-no-default-arm — bite on the real tree", () => {
  test("the bootstrap tree (compiler/self-host-v2) is clean", () => {
    const r = lintTree(TREE);
    expect(r.files.length).toBeGreaterThanOrEqual(3);
    expect(r.violations).toEqual([]);
  });

  test("RED on a planted `_ :>` over the Core `Type` enum; GREEN once removed", () => {
    const scratch = mkdtempSync(join(tmpdir(), "no-default-arm-"));
    cpSync(TREE, scratch, { recursive: true });
    const corePath = join(scratch, "core.scrml");
    const clean = readFileSync(corePath, "utf8");
    // Plant just before the module's closing brace.
    const at = clean.lastIndexOf("}");
    const planted = clean.slice(0, at) + PLANT + clean.slice(at);
    writeFileSync(corePath, planted);

    const red = lintTree(scratch);
    expect(red.violations.length).toBe(1);
    const v = red.violations[0];
    expect(v.file).toBe(corePath);
    const plantedLine = planted.split("\n").findIndex((l) => l.includes("_     :> false")) + 1;
    expect(v.line).toBe(plantedLine);
    expect(v.message).toContain("default arm `_`");

    writeFileSync(corePath, clean);
    const green = lintTree(scratch);
    expect(green.violations).toEqual([]);
  });
});

describe("lint-no-default-arm — pattern classification", () => {
  const count = (src) => lintText(src).violations.length;

  test("`else :>` in an enum match is a default arm", () => {
    expect(count(`match k { .A :> 1\n else :> 2 }`)).toBe(1);
  });
  test("a bare catch-all binder is a default arm", () => {
    expect(count(`match k { .A :> 1\n other :> 2 }`)).toBe(1);
  });
  test("an all-wildcard tuple arm is a default arm; a partial one is not", () => {
    expect(count(`match (a, b) { (.A, .X) :> 1\n (_, _) :> 2 }`)).toBe(1);
    expect(count(`match (a, b) { (.A, .X) :> 1\n (_, .Y) :> 2\n (.B, _) :> 3 }`)).toBe(0);
  });
  test("`.X` patterns lexed as Dot+Ident after a value body still mark an enum match", () => {
    expect(count(`match q { .Single :> 39\n .Double :> 34\n _ :> 0 }`)).toBe(1);
  });
  test("qualified and payload variant patterns mark an enum match", () => {
    expect(count(`match e { Expr.Lit :> 1\n _ :> 2 }`)).toBe(1);
    expect(count(`match e { .Lit(lit: l) :> 1\n _ :> 2 }`)).toBe(1);
  });
  test("a literal lookup table (open domain) may keep its wildcard", () => {
    expect(count(`match s { "if" :> 1\n "else" :> 2\n _ :> 0 }`)).toBe(0);
  });
  test("a total enum match with no default arm is clean (alternation as the FIRST arm)", () => {
    expect(count(`match m { .B | .C :> 2\n .A :> 1 }`)).toBe(0);
  });
  test("F8 REVIEW CASE: `_` inside a later alternation is flagged (impl#1 drops that arm silently)", () => {
    const v = lintText(`match k { .B :> 0\n _ | .A :> 1 }`).violations;
    expect(v.length).toBe(1);
    expect(v[0].line).toBe(2);
    expect(v[0].message).toContain("alternation arm `_ | .A` is not the first arm");
  });
  test("F8: `_` inside a FIRST-arm alternation of an enum match is a default arm", () => {
    const v = lintText(`match k { _ | .A :> 1\n .B :> 0 }`).violations;
    expect(v.length).toBe(1);
    expect(v[0].message).toContain("wildcard inside the alternation `_ | .A`");
  });
  test("F8/F12: any alternation arm that is not first is flagged — enum or literal match", () => {
    expect(count(`match m { .A :> 1\n .B | .C :> 2 }`)).toBe(1);
    expect(count(`match m { .A :> 1\n .B |\n .C :> 2 }`)).toBe(1);
    expect(count(`match s { "a" :> 1\n "b" | "c" :> 2 }`)).toBe(1);
    expect(count(`match m { .A | .B :> 1\n .C :> 2 }`)).toBe(0);
  });
  test("F8 bite on the real tree: plant a non-first alternation in core.scrml → RED; remove → GREEN", () => {
    const scratch = mkdtempSync(join(tmpdir(), "no-default-arm-alt-"));
    cpSync(TREE, scratch, { recursive: true });
    const corePath = join(scratch, "core.scrml");
    const clean = readFileSync(corePath, "utf8");
    const at = clean.lastIndexOf("}");
    const plant = "\n    export fn isText(t: Type) -> boolean {\n        return match t {\n            .Str :> true\n            .Int | .Num | .Bool :> false\n        }\n    }\n";
    writeFileSync(corePath, clean.slice(0, at) + plant + clean.slice(at));
    const red = lintTree(scratch);
    expect(red.violations.length).toBe(1);
    expect(red.violations[0].message).toContain("is not the first arm");
    writeFileSync(corePath, clean);
    expect(lintTree(scratch).violations).toEqual([]);
  });
  test("an opt-out needs a reason", () => {
    expect(count(`match k { .A :> 1\n // no-default-arm: product over internal state\n _ :> 2 }`)).toBe(0);
    expect(count(`match k { .A :> 1\n _ :> 2 // no-default-arm:\n }`)).toBe(1);
  });
  test("`match` inside strings/comments and the markup <match> element are ignored", () => {
    expect(count(`const s = "match k { .A :> 1 _ :> 2 }"\n// match k { .A :> 1 _ :> 2 }`)).toBe(0);
    expect(count(`<match for=Phase on=@phase> <A/> </match>\n${"$"}{ const x = { a: 1 } }`)).toBe(0);
  });
  test("nested matches are judged independently", () => {
    expect(count(`match a { .A :> match s { "x" :> 1\n _ :> 2 }\n .B :> 3 }`)).toBe(0);
    expect(count(`match s { "x" :> match a { .A :> 1\n _ :> 2 }\n _ :> 3 }`)).toBe(1);
  });
});
