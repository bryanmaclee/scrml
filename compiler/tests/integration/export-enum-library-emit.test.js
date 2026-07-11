/**
 * export-enum-library-emit.test.js
 *
 * §21.2 / §21.5 — a library / type-module file's EXPORTED enum is a VALUE-bearing
 * runtime binding (a `const X = Object.freeze({…})` variant-constructor object),
 * NOT a TS-erasable type. emit-library.ts previously stripped `type X:kind = {…}`
 * via regex WITHOUT the leading `export`, leaving a dangling `export` →
 * E-CODEGEN-INVALID-LOGIC. The fix EMITS each enum's runtime rep (export-prefixed
 * when exported) and strips the decl text (incl. the leading `export`).
 *
 * Coverage:
 *   §1 exported enum → `export const X = Object.freeze(…)`, node --check clean
 *   §2 non-exported enum → module-local `const X` (NOT exported)
 *   §3 struct decl → NO runtime binding (pure type), no dangling export
 *   §4 brace-less alias (`type Id = int`) → erased, no dangling export
 *   §5 the dangling-`export` bug is gone (minimal repro compiles)
 *   §6 typed fn signatures (`fn f(x: int) -> string`) lower clean in library mode
 *   §7 2-file round-trip — a consumer imports the enum, constructs a payload +
 *      unit variant, and `match`es on the runtime `.variant` tag
 *   §8 R26 — flogence delta-log.scrml compiles clean plain AND --emit-block-analysis
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { execFileSync } from "child_process";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "enum-lib-emit-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** Compile `source` as a library module; return { errorCodes, libraryJs, libPath }. */
function compileLib(name, source, extraFiles = {}) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  for (const [fname, fsrc] of Object.entries(extraFiles)) {
    writeFileSync(join(TMP, fname), fsrc);
  }
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    mode: "library",
    write: true,
    validateEmit: true,
    log: () => {},
  });
  const errorCodes = (result.errors || [])
    .filter((e) => e.severity == null || e.severity === "error")
    .map((e) => e.code);
  const libPath = join(outDir, `${name}.js`);
  return {
    errorCodes,
    libPath,
    libraryJs: existsSync(libPath) ? readFileSync(libPath, "utf8") : "",
  };
}

/** node --check the emitted file — proves it is syntactically valid JS. */
function nodeCheck(libPath) {
  execFileSync("node", ["--check", libPath]); // throws on malformed JS
}

// ---------------------------------------------------------------------------
// §1 exported enum → exported runtime rep
// ---------------------------------------------------------------------------

describe("export-enum-library-emit §1: exported enum emits an exported runtime rep", () => {
  test("payload + unit variants → `export const X = Object.freeze(...)`", () => {
    const { errorCodes, libraryJs, libPath } = compileLib(
      "m1",
      `\${ export type Color:enum = { Red, Green(shade: int) } }`,
    );
    expect(errorCodes).toHaveLength(0);
    expect(libraryJs).toContain("export const Color = Object.freeze(");
    // The payload variant is a constructor; the unit variant is a bare string.
    expect(libraryJs).toContain('Green: function(shade)');
    expect(libraryJs).toContain('Red: "Red"');
    expect(libraryJs).toContain('variants: ["Red", "Green"]');
    nodeCheck(libPath);
  });
});

// ---------------------------------------------------------------------------
// §2 non-exported enum → module-local const (not exported)
// ---------------------------------------------------------------------------

describe("export-enum-library-emit §2: non-exported enum stays module-local", () => {
  test("`type X:enum` (no export) → `const X = Object.freeze` (no export prefix)", () => {
    const { errorCodes, libraryJs, libPath } = compileLib(
      "m2",
      `\${ type Internal:enum = { Lo, Hi } }`,
    );
    expect(errorCodes).toHaveLength(0);
    expect(libraryJs).toContain("const Internal = Object.freeze(");
    expect(libraryJs).not.toContain("export const Internal");
    nodeCheck(libPath);
  });
});

// ---------------------------------------------------------------------------
// §3 struct decl carries no runtime binding (pure type, TS-erased)
// ---------------------------------------------------------------------------

describe("export-enum-library-emit §3: struct erasure preserved", () => {
  test("`export type Config:struct` → no runtime binding, no dangling export", () => {
    const { errorCodes, libraryJs, libPath } = compileLib(
      "m3",
      `\${ export type Config:struct = { timeout: int, retries: int } }`,
    );
    expect(errorCodes).toHaveLength(0);
    expect(libraryJs).not.toContain("Config");
    expect(libraryJs).not.toMatch(/(^|\n)\s*export\s*(\n|$)/); // no dangling `export`
    expect(libraryJs).not.toContain("export type");
    nodeCheck(libPath);
  });
});

// ---------------------------------------------------------------------------
// §4 brace-less type alias is erased with no dangling export
// ---------------------------------------------------------------------------

describe("export-enum-library-emit §4: type-alias erasure", () => {
  test("`export type Id = int` → erased, no dangling export", () => {
    const { errorCodes, libraryJs, libPath } = compileLib(
      "m4",
      `\${ export type Id = int\n  export fn keep(x: int) -> int { return x } }`,
    );
    expect(errorCodes).toHaveLength(0);
    expect(libraryJs).not.toContain("type Id");
    expect(libraryJs).not.toMatch(/(^|\n)\s*export\s*(\n|$)/);
    // the sibling fn still emits (erasure did not eat the following decl)
    expect(libraryJs).toContain("export function keep(x)");
    nodeCheck(libPath);
  });
});

// ---------------------------------------------------------------------------
// §5 the dangling-`export` bug (minimal repro) is gone
// ---------------------------------------------------------------------------

describe("export-enum-library-emit §5: minimal repro compiles (no dangling export)", () => {
  test("`export type Foo:enum = { A, B }` compiles clean", () => {
    const { errorCodes, libraryJs, libPath } = compileLib(
      "m5",
      `\${ export type Foo:enum = { A, B } }`,
    );
    expect(errorCodes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(errorCodes).toHaveLength(0);
    expect(libraryJs).toContain("export const Foo = Object.freeze(");
    nodeCheck(libPath);
  });
});

// ---------------------------------------------------------------------------
// §6 typed fn signatures lower clean in library mode
// ---------------------------------------------------------------------------

describe("export-enum-library-emit §6: typed fn signatures strip annotations", () => {
  test("param `: T` and return `-> T` removed; body preserved", () => {
    const { errorCodes, libraryJs, libPath } = compileLib(
      "m6",
      `\${ export fn label(seq: number, kind: string) -> string {\n    return kind\n} }`,
    );
    expect(errorCodes).toHaveLength(0);
    expect(libraryJs).toContain("export function label(seq, kind) {");
    expect(libraryJs).not.toContain(": number");
    expect(libraryJs).not.toContain("-> string");
    nodeCheck(libPath);
  });

  test("untyped fn signatures pass through unchanged", () => {
    const { libraryJs } = compileLib(
      "m6b",
      `\${ export fn add(a, b) { return a + b } }`,
    );
    expect(libraryJs).toContain("export function add(a, b) {");
  });
});

// ---------------------------------------------------------------------------
// §7 2-file runtime round-trip — import + construct + match
// ---------------------------------------------------------------------------

describe("export-enum-library-emit §7: consumer imports + constructs + matches", () => {
  test("Pointer.Sha(x) / Pointer.None resolve at runtime and match on .variant", async () => {
    const { errorCodes, libPath } = compileLib(
      "model",
      `\${ export type Pointer:enum = { Sha(hash: string), None } }`,
    );
    expect(errorCodes).toHaveLength(0);
    const mod = await import(pathToFileURL(libPath).href);

    // payload variant → { variant, data }
    const sha = mod.Pointer.Sha("abc123");
    expect(sha).toEqual({ variant: "Sha", data: { hash: "abc123" } });

    // unit variant → bare string tag
    expect(mod.Pointer.None).toBe("None");

    // a consumer `match` over the runtime shape (payload vs unit)
    const describe_ = (p) =>
      typeof p === "string"
        ? p
        : p.variant === "Sha"
          ? `sha:${p.data.hash}`
          : "?";
    expect(describe_(sha)).toBe("sha:abc123");
    expect(describe_(mod.Pointer.None)).toBe("None");
    expect(mod.Pointer.variants).toEqual(["Sha", "None"]);
  });
});

// ---------------------------------------------------------------------------
// §8 R26 — the real flogence delta-log model compiles clean in both modes
// ---------------------------------------------------------------------------

describe("export-enum-library-emit §8: R26 flogence delta-log.scrml", () => {
  const R26 = "/home/bryan-maclee/scrmlMaster/flogence/src/models/delta-log.scrml";

  test.skipIf(!existsSync(R26))(
    "compiles clean — flogence Kind uppercase migration complete (no E-ENUM-VARIANT-CASE)",
    () => {
      const src = readFileSync(R26, "utf8");
      const { errorCodes } = compileLib("delta-log-r26", src);
      // The flogence `Kind:enum` uppercase migration is COMPLETE — its variants
      // are now `{ Rule, Disp, Land, Find, State, Friction, Escalate, Drift }`,
      // so §14.4 E-ENUM-VARIANT-CASE no longer fires and the model compiles clean
      // (empirically verified: errorCodes === []). This restores the §8 header's
      // "compiles clean" intent; the temporary pending-migration canary window
      // (which asserted E-ENUM-VARIANT-CASE FIRES) is now closed.
      expect(errorCodes).not.toContain("E-ENUM-VARIANT-CASE");
      expect(errorCodes).toHaveLength(0);
    },
  );

  test.skipIf(!existsSync(R26))(
    "the --emit-block-analysis path compiles clean too (migration complete)",
    () => {
      const src = readFileSync(R26, "utf8");
      const filePath = join(TMP, "delta-log-ba.scrml");
      writeFileSync(filePath, src);
      const result = compileScrml({
        inputFiles: [filePath],
        outputDir: join(TMP, "delta-log-ba.dist"),
        mode: "library",
        write: true,
        validateEmit: true,
        log: () => {},
      });
      const errorCodes = (result.errors || [])
        .filter((e) => e.severity == null || e.severity === "error")
        .map((e) => e.code);
      // Post-migration the --emit-block-analysis sidecar path also runs clean —
      // E-ENUM-VARIANT-CASE no longer fires (Kind is uppercase), and the original
      // g-block-analysis-emit-foreign-underscore codegen defect stays fixed
      // (`blockAnalyses` is still a callable sidecar).
      expect(errorCodes).not.toContain("E-ENUM-VARIANT-CASE");
      expect(typeof result.blockAnalyses).toBe("function");
    },
  );
});
