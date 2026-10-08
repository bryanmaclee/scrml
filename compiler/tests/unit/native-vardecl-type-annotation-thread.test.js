// native-vardecl-type-annotation-thread.test.js — native translate-bridge fix.
//
// change-id: native-translate-bridge-gaps-2026-06-06 (FIX C)
//
// THE BUG (native-only): `parseVarDeclarator` (parse-stmt.js) CAPTURES a const /
// let declarator's `: T` annotation on `declarator.typeAnnotation`, but
// `makeVarDeclNode` (translate-stmt.js) never copied it onto the synthesized
// const-decl / let-decl node (contrast `makeStateDeclNode`, which DOES). So
// `const bad: Post = { role: .Viewer }` reached the type-system with
// `typeAnnotation: undefined` — no struct / subset context for the bare-variant
// resolver — and native fired E-VARIANT-AMBIGUOUS where LIVE fired the correct
// E-CONTRACT-001 (subset violation, §53.15.2).
//
// THE FIX (one line in makeVarDeclNode): copy `declarator.typeAnnotation` onto
// the node when non-empty, mirroring makeStateDeclNode.
//
// S449 RE-POINT: this file used to compile under the retired full-pipeline
// `--parser=scrml-native` flag. The bridge runs in production inside
// `nativeParseFile` (component / `^{}` / `<match>` re-parse), so the fix is now
// asserted on the native tree: the const/let nodes carry the annotation, equal
// to the default parser's. The type-system consequence (E-CONTRACT-001, not
// E-VARIANT-AMBIGUOUS) is kept as a default-pipeline compile.

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";
import { nativeAst, liveAst, findNodes, errorsOf } from "../helpers/native-ast.js";

function compileDefault(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-vta-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return { errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codes = (r) => r.errors.map((e) => String(e.code ?? ""));

const ROLE = "type Role:enum = { Admin, Editor, Viewer }";
const POST_SUBSET =
  "type Post:struct = { title: string req, role: Role oneOf([.Admin, .Editor]) }";

const varDecls = (result) =>
  findNodes(result.ast, (n) => n.kind === "const-decl" || n.kind === "let-decl")
    .map((n) => [n.kind, n.name, n.typeAnnotation ?? null]);

describe("native const/let typeAnnotation threading (FIX C)", () => {
  test("scalar / enum / struct annotations reach the native const-decl / let-decl nodes", () => {
    const src = [
      ROLE,
      POST_SUBSET,
      "${",
      "  const n: number = 5",
      '  let s: string = "hi"',
      "  const r: Role = .Admin",
      '  const bad: Post = { title: "x", role: .Viewer }',
      "  const u = 3",
      "}",
      "<program><p>${n} ${s}</></>",
    ].join("\n") + "\n";
    const nat = nativeAst(src);
    expect(errorsOf(nat)).toEqual([]);
    expect(varDecls(nat)).toEqual([
      ["const-decl", "n", "number"],
      ["let-decl", "s", "string"],
      ["const-decl", "r", "Role"],
      ["const-decl", "bad", "Post"],
      ["const-decl", "u", null],
    ]);
    // Fixed-input oracle: the default parser threads the same annotations.
    expect(varDecls(nat)).toEqual(varDecls(liveAst(src)));
  });

  test("out-of-subset variant in typed const -> E-CONTRACT-001, not E-VARIANT-AMBIGUOUS (default pipeline)", () => {
    const src = [
      ROLE,
      POST_SUBSET,
      "${",
      '  const bad: Post = { title: "x", role: .Viewer }',
      "}",
      "<program><p>${bad.title}</></>",
    ].join("\n") + "\n";
    const live = compileDefault(src, "badlive");
    expect(codes(live)).toContain("E-CONTRACT-001");
    expect(codes(live)).not.toContain("E-VARIANT-AMBIGUOUS");
  });

  test("in-subset variant in typed const -> clean (default pipeline)", () => {
    const src = [
      ROLE,
      POST_SUBSET,
      "${",
      '  const ok: Post = { title: "x", role: .Admin }',
      "}",
      "<program><p>${ok.title}</></>",
    ].join("\n") + "\n";
    expect(compileDefault(src, "oklive").errors).toHaveLength(0);
  });
});
