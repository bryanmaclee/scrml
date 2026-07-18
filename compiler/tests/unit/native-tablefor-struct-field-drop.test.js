// native-tablefor-struct-field-drop.test.js — native-parser-swap parity-closer.
//
// change-id: native-tablefor-struct-field-drop-2026-06-04
//
// THE BUG (root-caused this dispatch): under `--parser=scrml-native`, a
// `<tableFor for=T rows=@cell>` over a NEWLINE-separated struct silently
// MISCOMPILED — it emitted only the FIRST struct column (e.g. tableFor-basic:
// default 4 <th> Id/Email/Name/Role -> native 1 <th> Id). It compiled CLEAN
// (exit 0); the HTML byte-DIFFERED — the S139/S163 silent-miscompile trap.
//
// ROOT (NOT tableFor-specific, NOT enum-body-shaped — the triage hypothesis was
// imprecise): native's `typeBodyText` (parse-stmt.js) reconstructed the
// `type T:struct = { ... }` body raw by joining every inner token with a single
// SPACE (`parts.join(" ")`), collapsing the NEWLINE field-separators of the
// canonical V5 shape:
//     type User:struct = {
//         id:    integer
//         email: string req      <- no trailing commas; newline IS the separator
//     }
// The type-system body parsers (`parseStructBody` / `parseEnumBody`) split the
// body on `,` OR `\n` (NOT spaces). So native's space-joined body became ONE
// field clause `id : integer email : string req ...` -> `indexOf(":")` -> only
// `id` registered. Every parseStructBody consumer (tableFor / formFor /
// schemaFor) therefore dropped all fields but the first.
//
// THE FIX (parse-stmt.js `typeBodyText` + new `joinWithNewlines`): mirror the
// live ast-builder `joinWithNewlines` — a token on a LATER source line than its
// predecessor is separated by `\n`, not a space. Native type-decl raw now
// byte-matches the default ast-builder raw.
//
// VERIFIED HERE (byte-presence + count parity, not fatal-error-absence — the
// S139 trap): native `<th>` count == default; native html byte-identical to
// default; all fields present in client.js. End-to-end byte-identical R26 emit
// parity for tableFor-basic / 27-type-derived-table / a minimal multi-field
// repro lives in the R26 probe (see progress.md).

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// compileWith — full-compile `source` under `parser` (null = default live
// BS+TAB; "scrml-native" = native pipeline). Returns errors + the client.js +
// html text. Mirrors native-engine-substrate-instance-share.test.js's helper.
function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-tfdrop-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const countTh = (html) => (html.match(/<th[\s>]/g) || []).length;

// The emitted html embeds the per-compile basename in <title>, the client.js
// <script src>, and (since the §65.3.4 universal reset) the stylesheet <link>.
// Those differ ONLY because each compileWith() call uses a unique temp basename
// (parser-independent) — NOT a real native-vs-default drift. Strip all three so
// the byte-identical comparison sees only the structural markup.
const normHtml = (html) =>
  html
    .replace(/<title>[^<]*<\/title>/g, "<title>X</title>")
    .replace(/<script src="[^"]*\.client\.js"><\/script>/g, '<script src="X.client.js"></script>')
    .replace(/<link rel="stylesheet" href="[^"]*\.css">/g, '<link rel="stylesheet" href="X.css">');

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

describe("native <tableFor> struct-field-drop (newline-separated struct body)", () => {
  test("native emits ALL struct columns — <th> count == default (was first-field-only)", () => {
    const nat = compileWith(TABLEFOR_NEWLINE, "scrml-native", "tf-nat");
    const def = compileWith(TABLEFOR_NEWLINE, null, "tf-def");
    // The struct has 5 fields -> 5 <th> columns under BOTH parsers.
    expect(countTh(def.html)).toBe(5);
    expect(countTh(nat.html)).toBe(5);
    expect(countTh(nat.html)).toBe(countTh(def.html));
  });

  test("native html is BYTE-IDENTICAL to default (the silent-miscompile surface)", () => {
    const nat = compileWith(TABLEFOR_NEWLINE, "scrml-native", "tf-nat-html");
    const def = compileWith(TABLEFOR_NEWLINE, null, "tf-def-html");
    expect(normHtml(nat.html)).toBe(normHtml(def.html));
  });

  test("native client.js renders a per-row cell for EVERY field (email/name/role/active not dropped)", () => {
    const nat = compileWith(TABLEFOR_NEWLINE, "scrml-native", "tf-cells");
    // Each non-id default column lowers to a `row.<field>` textContent write.
    for (const f of ["id", "email", "name", "role", "active"]) {
      expect(nat.clientJs).toContain(`row.${f}`);
    }
  });

  test("native compiles clean — no fatal errors (drop was a CLEAN-compile miscompile)", () => {
    const nat = compileWith(TABLEFOR_NEWLINE, "scrml-native", "tf-clean");
    expect(nat.errors.length).toBe(0);
  });

  test("regression: the same struct using COMMA separators already worked and still does (no over-correction)", () => {
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
    const nat = compileWith(COMMA, "scrml-native", "tf-comma-nat");
    const def = compileWith(COMMA, null, "tf-comma-def");
    expect(countTh(nat.html)).toBe(4);
    expect(normHtml(nat.html)).toBe(normHtml(def.html));
  });
});
