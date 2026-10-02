// native-vardecl-type-annotation-thread.test.js — native-parser-swap parity-closer.
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
// VERIFIED HERE: native fires E-CONTRACT-001 (not E-VARIANT-AMBIGUOUS) for an
// out-of-subset variant in a typed const; clean for in-subset; scalar/enum
// typed const+let decls emit byte-identical to the default (LIVE) — no
// regression.

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-vta-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codes = (r) => r.errors.map((e) => String(e.code ?? ""));

const ROLE = "type Role:enum = { Admin, Editor, Viewer }";
const POST_SUBSET =
  "type Post:struct = { title: string req, role: Role oneOf([.Admin, .Editor]) }";

describe("native const/let typeAnnotation threading (FIX C)", () => {
  test("out-of-subset variant in typed const -> E-CONTRACT-001 (not E-VARIANT-AMBIGUOUS)", () => {
    const src = [
      ROLE,
      POST_SUBSET,
      "${",
      '  const bad: Post = { title: "x", role: .Viewer }',
      "}",
      "<program><p>${bad.title}</></>",
    ].join("\n") + "\n";

    const native = compileWith(src, "scrml-native", "bad");
    const nativeCodes = codes(native);
    expect(nativeCodes).toContain("E-CONTRACT-001");
    expect(nativeCodes).not.toContain("E-VARIANT-AMBIGUOUS");

    // Parity: LIVE fires the same diagnostic class.
    const live = compileWith(src, null, "badlive");
    expect(codes(live)).toContain("E-CONTRACT-001");
  });

  test("in-subset variant in typed const -> clean (parity with LIVE)", () => {
    const src = [
      ROLE,
      POST_SUBSET,
      "${",
      '  const ok: Post = { title: "x", role: .Admin }',
      "}",
      "<program><p>${ok.title}</></>",
    ].join("\n") + "\n";

    const native = compileWith(src, "scrml-native", "ok");
    expect(codes(native)).not.toContain("E-CONTRACT-001");
    expect(codes(native)).not.toContain("E-VARIANT-AMBIGUOUS");

    const live = compileWith(src, null, "oklive");
    expect(live.errors).toHaveLength(0);
    expect(native.errors).toHaveLength(0);
  });

  test("scalar + enum typed const/let decls emit byte-identical to default", () => {
    const src = [
      ROLE,
      "${",
      "  const n: number = 5",
      '  let s: string = "hi"',
      "  const r: Role = .Admin",
      "}",
      "<program><p>${n} ${s}</></>",
    ].join("\n") + "\n";

    const live = compileWith(src, null, "tyl");
    const native = compileWith(src, "scrml-native", "tyn");
    expect(live.errors).toHaveLength(0);
    expect(native.errors).toHaveLength(0);

    // The three decl lines compose identically (the typed annotation does not
    // change emitted JS — the bare variant `.Admin` resolves to "Admin").
    for (const frag of ["const n = 5;", 'let s = "hi";', 'const r = "Admin";']) {
      expect(live.clientJs).toContain(frag);
      expect(native.clientJs).toContain(frag);
    }
  });
});
