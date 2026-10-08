// native-tablefor-struct-field-drop.test.js — native statement-parser fix.
//
// change-id: native-tablefor-struct-field-drop-2026-06-04
//
// THE BUG: a `<tableFor for=T rows=@cell>` over a NEWLINE-separated struct
// silently MISCOMPILED through the native parser — it emitted only the FIRST
// struct column. It compiled CLEAN (exit 0) — the S139/S163 silent-miscompile
// trap.
//
// ROOT (NOT tableFor-specific): native's `typeBodyText` (parse-stmt.js)
// reconstructed the `type T:struct = { ... }` body raw by joining every inner
// token with a single SPACE, collapsing the NEWLINE field-separators of the
// canonical V5 shape:
//     type User:struct = {
//         id:    integer
//         email: string req      <- no trailing commas; newline IS the separator
//     }
// The type-system body parsers (`parseStructBody` / `parseEnumBody`) split the
// body on `,` OR `\n` (NOT spaces), so only `id` registered and every
// parseStructBody consumer (tableFor / formFor / schemaFor) dropped the rest.
//
// THE FIX (parse-stmt.js `typeBodyText` + `joinWithNewlines`): mirror the live
// ast-builder `joinWithNewlines` — a token on a LATER source line than its
// predecessor is separated by `\n`, not a space.
//
// S449 RE-POINT: this file used to compile under the retired full-pipeline
// `--parser=scrml-native` flag and compare the emitted HTML with the default
// pipeline's. `typeBodyText` runs in production inside `nativeParseFile`
// (component / `^{}` / `<match>` re-parse), so the fix is asserted on the
// native tree: the type-decl `raw` keeps one field per line and equals the
// default parser's `raw` byte for byte (a fixed-input oracle). The tableFor
// end-to-end column count is kept as a default-pipeline compile.

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";
import { nativeAst, liveAst, findNodes, errorsOf } from "../helpers/native-ast.js";

function compileDefault(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-tfdrop-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${name}.html`);
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const countTh = (html) => (html.match(/<th[\s>]/g) || []).length;

const typeRaw = (result, name) =>
  findNodes(result.ast, (n) => n.kind === "type-decl" && n.name === name)[0]?.raw ?? null;

// A 5-field NEWLINE-separated struct rendered through <tableFor> — the exact
// shape that triggered the drop (no trailing commas; newline IS the separator).
const TABLEFOR_NEWLINE = [
  "${",
  "    import { tableFor } from 'scrml:data'",
  "    type User:struct = {",
  "        id:    integer",
  "        email: string req",
  "        name:  string req",
  "        role:  string req",
  "        active: bool",
  "    }",
  "}",
  "",
  "<program>",
  "    <users> = [",
  '        { id: 1, email: "a@b.c", name: "Al",  role: "Admin",  active: true },',
  '        { id: 2, email: "c@d.e", name: "Bo",  role: "Editor", active: false }',
  "    ]",
  "    <h1>Users</h1>",
  "    <tableFor for=User rows=@users/>",
  "</program>",
].join("\n");

const COMMA = [
  "${",
  "    import { tableFor } from 'scrml:data'",
  "    type User:struct = { id: integer, email: string req, name: string req, role: string req }",
  "}",
  "<program>",
  '    <users> = [{ id: 1, email: "a@b.c", name: "Al", role: "Admin" }]',
  "    <tableFor for=User rows=@users/>",
  "</program>",
].join("\n");

describe("native struct body keeps its newline field separators (typeBodyText)", () => {
  test("native type-decl raw has one field per line — all five fields survive", () => {
    const nat = nativeAst(TABLEFOR_NEWLINE);
    expect(errorsOf(nat)).toEqual([]);
    const raw = typeRaw(nat, "User");
    expect(raw).not.toBeNull();
    const fields = raw.replace(/^\{|\}$/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
    expect(fields.map((f) => f.split(":")[0].trim())).toEqual(["id", "email", "name", "role", "active"]);
  });

  test("native type-decl raw is byte-identical to the default parser's", () => {
    expect(typeRaw(nativeAst(TABLEFOR_NEWLINE), "User")).toBe(typeRaw(liveAst(TABLEFOR_NEWLINE), "User"));
  });

  test("regression: COMMA separators still produce the same raw as the default parser (no over-correction)", () => {
    const raw = typeRaw(nativeAst(COMMA), "User");
    expect(raw).not.toBeNull();
    expect(raw).toBe(typeRaw(liveAst(COMMA), "User"));
  });
});

describe("<tableFor> over a newline-separated struct (default pipeline)", () => {
  test("emits ALL five struct columns and compiles clean", () => {
    const def = compileDefault(TABLEFOR_NEWLINE, "tf-def");
    expect(def.errors.length).toBe(0);
    expect(countTh(def.html)).toBe(5);
  });

  test("comma-separated struct: four columns", () => {
    expect(countTh(compileDefault(COMMA, "tf-comma-def").html)).toBe(4);
  });
});
