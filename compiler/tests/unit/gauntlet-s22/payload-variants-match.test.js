/**
 * payload-variants-match.test.js — S22 §1a slice 2: match destructuring against
 * the tagged-object payload shape.
 *
 * Before S22 slice 2:
 *   `.Circle(r) => r * 2` parsed the binding but the match emitter dropped it.
 *   The generated JS referenced `r` without declaring it — silent ReferenceError.
 *   Multi-arg `.Rect(w, h)` wasn't parsed at all (regex was `(\w+)` single ident).
 *
 * After S22 slice 2:
 *   - Regex captures raw paren contents; parseBindingList splits by comma.
 *   - The match emitter inserts `const __tag = (v && typeof v === "object") ? v.variant : v;`
 *     so unit variants (plain strings) and payload variants (tagged objects) both
 *     dispatch by `.variant` equality.
 *   - Positional bindings resolve against the file's enum declarations via a
 *     module-level registry populated at the top of generateClientJs.
 *   - Named bindings `(field: local)` resolve directly from the binding.
 *   - `_` discards do not introduce bindings.
 *
 * These tests execute the emitted JS end-to-end against the emitted enum
 * constructor; no scrml runtime is required.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../../src/api.js";
import { unwrapChunkScope } from "../../helpers/chunk-scope.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/payload-variants-match");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

function compileSource(source, filename = "test.scrml") {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: FIXTURE_OUTPUT, write: true });
  const allErrors = result.errors || [];
  const fatalErrors = allErrors.filter((e) => e.severity !== "warning");
  const outPath = join(FIXTURE_OUTPUT, filename.replace(/\.scrml$/, ".client.js"));
  const clientJs = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  return { errors: allErrors, fatalErrors, clientJs };
}

// Build an executable sandbox: strip import and runtime require lines, keep
// everything else, and evaluate in a fresh Function scope so we can call
// generated functions without a DOM. Returns the sandbox's module-like object.
function executeClientJs(clientJs, invocation) {
  // This harness runs the chunk with NO runtime to probe pure lowering, so it
  // needs the chunk's declarations at top level and its cell-scope prologue gone.
  const sanitized = unwrapChunkScope(clientJs)
    .replace(/^\/\/ Requires:.*$/gm, "")
    .replace(/^import .*$/gm, "")
    // The emitted code includes a DOMContentLoaded listener we don't want to
    // trigger; replace with a no-op `window`/`document` shim.
    .replace(/document\.addEventListener/g, "(function(){}).call.bind({})");
  const globals = "var document = { addEventListener: function(){} }; var window = {};";
  return new Function(globals + "\n" + sanitized + "\nreturn (" + invocation + ");")();
}

// The type system currently loses the annotated type at function-parameter
// scope (E-TYPE-025 fires on `match s` where `s: Shape` is a parameter). We
// sidestep that by matching on a file-scope `let` with an explicit enum type,
// which is the scope the spec already guarantees narrows correctly.
describe("S22 §1a slice 2 — match destructures tagged-object payload variants", () => {
  test("positional binding resolves to declared field name: .Circle(r) => r * r", () => {
    const source = `\${\n  type Shape:enum = { Circle(r: number), Rect(w: number, h: number) }\n  let s1:Shape = Shape.Circle(5)\n  let area1 = match s1 { .Circle(r) => r * r  .Rect(w, h) => w * h }\n  let s2:Shape = Shape.Rect(3, 4)\n  let area2 = match s2 { .Circle(r) => r * r  .Rect(w, h) => w * h }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "positional.scrml");
    expect(fatalErrors).toEqual([]);
    expect(clientJs).toMatch(/const r = _scrml_match_\d+\.data\.r;/);
    expect(clientJs).toMatch(/const w = _scrml_match_\d+\.data\.w;\s*const h = _scrml_match_\d+\.data\.h;/);
    // Runtime round-trip — read back the top-level `area1` / `area2` bindings.
    expect(executeClientJs(clientJs, "area1")).toBe(25);
    expect(executeClientJs(clientJs, "area2")).toBe(12);
  });

  test("multi-field positional binding preserves declared order", () => {
    const source = `\${\n  type Triple:enum = { Point(x: number, y: number, z: number) }\n  let t:Triple = Triple.Point(1, 2, 3)\n  let s = match t { .Point(a, b, c) => a + b + c }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "multi-pos.scrml");
    expect(fatalErrors).toEqual([]);
    expect(clientJs).toMatch(/const a = _scrml_match_\d+\.data\.x;\s*const b = _scrml_match_\d+\.data\.y;\s*const c = _scrml_match_\d+\.data\.z;/);
    expect(executeClientJs(clientJs, "s")).toBe(6);
  });

  test("named binding (field: local) destructures from the named field directly", () => {
    const source = `\${\n  type Event:enum = { Reloading(reason: string) }\n  let e:Event = Event.Reloading("ammo")\n  let why = match e { .Reloading(reason: r) => r }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "named.scrml");
    expect(fatalErrors).toEqual([]);
    expect(clientJs).toMatch(/const r = _scrml_match_\d+\.data\.reason;/);
    expect(executeClientJs(clientJs, "why")).toBe("ammo");
  });

  test("mixed unit and payload arms dispatch via the __tag normalization", () => {
    const source = `\${\n  type Shape:enum = { Circle(r: number), Unit }\n  let a:Shape = Shape.Circle(7)\n  let k1 = match a { .Circle(r) => r  .Unit => 0 }\n  let b:Shape = Shape.Unit\n  let k2 = match b { .Circle(r) => r  .Unit => 0 }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "mixed-unit.scrml");
    expect(fatalErrors).toEqual([]);
    // The __tag var is introduced because at least one arm needs it.
    expect(clientJs).toMatch(/const _scrml_tag_\d+ = \(_scrml_match_\d+ != null && typeof _scrml_match_\d+ === "object"\) \? _scrml_match_\d+\.variant : _scrml_match_\d+;/);
    expect(executeClientJs(clientJs, "k1")).toBe(7);
    expect(executeClientJs(clientJs, "k2")).toBe(0);
  });

  test("discard bindings (_) leave no `const _` in the emitted arm body", () => {
    const source = `\${\n  type Shape:enum = { Rect(w: number, h: number) }\n  let s:Shape = Shape.Rect(3, 4)\n  let only = match s { .Rect(w, _) => w }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "discard.scrml");
    expect(fatalErrors).toEqual([]);
    expect(clientJs).toMatch(/const w = _scrml_match_\d+\.data\.w;/);
    expect(clientJs).not.toMatch(/const _ = _scrml_match_\d+\.data\.h;/);
    expect(executeClientJs(clientJs, "only")).toBe(3);
  });

  test("string-only matches do not introduce a __tag var (scalar path preserved)", () => {
    const source = `\${\n  let s:string = "a"\n  let label1 = match s { "a" => "alpha"  "b" => "beta"  else => "other" }\n  let t:string = "x"\n  let label2 = match t { "a" => "alpha"  "b" => "beta"  else => "other" }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "string-only.scrml");
    expect(fatalErrors).toEqual([]);
    // No tag normalization for scalar matches.
    expect(clientJs).not.toMatch(/const _scrml_tag_\d+/);
    expect(executeClientJs(clientJs, "label1")).toBe("alpha");
    expect(executeClientJs(clientJs, "label2")).toBe("other");
  });

  test("pure unit-variant enum matches do not use __tag (no payload arm → scalar path)", () => {
    // Note: arms must be on separate lines for the exhaustiveness checker to
    // see them. The emit-level splitter handles single-line arms, but the
    // exhaustiveness pass parses earlier.
    const source = `\${\n  type Direction:enum = { North, South, East, West }\n  let d:Direction = Direction.East\n  let deg = match d {\n    .North => 0\n    .East => 90\n    .South => 180\n    .West => 270\n  }\n}\n<program><p>ok</></>\n`;
    const { fatalErrors, clientJs } = compileSource(source, "unit-only.scrml");
    expect(fatalErrors).toEqual([]);
    expect(clientJs).not.toMatch(/const _scrml_tag_\d+/);
    expect(executeClientJs(clientJs, "deg")).toBe(90);
  });
});
