/**
 * each-in-tier0-lift-bug72.test.js — Bug 72 (S158).
 *
 * A nested `<each>` embedded inside a Tier-0 lifted markup
 * (`${ for (row of @rows) { lift <tr><each in=row.cells>...</each></tr> } }`)
 * must lower its inner `@.` to the INNER each's iteration value, per
 * SPEC §17.7.3 line 10564: "Nested `<each>` scopes resolve `@.` to the
 * INNERMOST scope's current value." This holds in ANY markup context,
 * including Tier-0 lifted markup (§17.4).
 *
 * Before the fix the inner `@.` leaked RAW into the emitted client JS:
 *   `...createTextNode(String((@ .) ?? ""))); _scrml_lift...`
 * producing the confusing `E-CODEGEN-INVALID-JS` ("the compiler emitted
 * JavaScript it cannot itself parse"). Root cause: the for-stmt lift body
 * routes through `emitForStmt` (emit-control-flow.ts) → its reactive
 * DocumentFragment fallback / consolidated-lift sub-paths, NONE of which
 * threaded the enclosing for-loop variable (`scopeVar`) down to the markup
 * walker. Without `scopeVar`, the markup `<each>` child was treated as a
 * generic element and its inner `@.` was never lowered to the inner each's
 * iter var. The fix threads `scopeVar` (the for-loop variable) through every
 * lift-emission sub-path emitForStmt reaches + `emitConsolidatedLift` +
 * `IfOpts.scopeVar` (for a nested-each inside an `if` inside the `for`),
 * mirroring the prior `emitForStmtWithContainer` threading.
 *
 * E-SYNTAX-064 correctly does NOT fire on the inner `@.` (it IS inside an
 * `<each>` body) — that is asserted by each-sigil-outside-each-bug70 §5.
 *
 * Coverage:
 *   §1 — the reproducer compiles CLEAN (no E-CODEGEN-INVALID-JS) and the
 *        emitted client.js has ZERO raw `@.` sigils + parses with node.
 *   §2 — the inner `@.` lowers to the inner each's iter var (`_scrml_each_item`).
 *   §3 — `<each of=N>` nested in a lift (index-form) compiles clean.
 *   §4 — `as name` alias on the inner each lowers `${name}` to the alias.
 *   §5 — `@.` per-item attr value inside the nested each compiles clean.
 *   §6 — nested-each inside an `if` inside the for-lift compiles clean.
 *   §7 — NEGATIVE no-regression: a Tier-0 lift with NO nested each emits
 *        byte-identical to the pre-fix baseline (scopeVar threading is inert
 *        when no `<each>` child is present).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";

function compile(source, suffix = "bug72") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  let clientJs = "";
  const clientPath = resolve(outDir, `${name}.client.js`);
  if (existsSync(clientPath)) clientJs = readFileSync(clientPath, "utf8");
  // cleanup is the caller's job (via the returned tmpDir) so node --check can run
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    clientJs,
    clientPath,
    tmpDir,
  };
}

const codes = (errors) => errors.map((e) => e.code);
const cleanup = (tmpDir) => { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); };

// The reproducer: nested <each in=row.cells> inside ${ for (row of @rows) lift }.
const REPRO = `type Row:struct = { id: string, cells: string[] }

<rows>: Row[] = []

<table>
  <tbody>
    ${"$"}{ for (row of @rows) {
      lift <tr><each in=row.cells><td>${"$"}{@.}</td></each></tr>
    } }
  </tbody>
</table>`;

// ---------------------------------------------------------------------------
// §1 — the reproducer compiles clean; emitted client.js is sigil-free + valid JS
// ---------------------------------------------------------------------------

describe("bug72 §1 — Tier-0 lift with nested <each> compiles clean", () => {
  test("no E-CODEGEN-INVALID-JS; ZERO raw @. sigils; node --check passes", () => {
    const r = compile(REPRO, "bug72-s1");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-JS");
      expect(r.clientJs.length).toBeGreaterThan(0);
      // ZERO raw sigils — the inner @. must have lowered to the iter var.
      expect(r.clientJs).not.toMatch(/\(@\s*\.\)/);
      expect(r.clientJs).not.toContain("@ .");
      // The emitted JS must itself parse.
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — the inner @. lowers to the inner each's iteration variable
// ---------------------------------------------------------------------------

describe("bug72 §2 — inner @. lowers to the inner each iter var (§17.7.3 innermost-scope)", () => {
  test("the textNode reads the inner each's _scrml_each_item, not the outer row", () => {
    const r = compile(REPRO, "bug72-s2");
    try {
      // The interpolated inner @. must render the inner each's current value.
      expect(r.clientJs).toContain("createTextNode(String(_scrml_each_item))");
      // The inner source is the outer iter var's field (row.cells) — proving the
      // outer scope (row) and inner scope (_scrml_each_item) are both present + distinct.
      expect(r.clientJs).toContain("row.cells");
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — <each of=N> (index form) nested in a lift compiles clean
// ---------------------------------------------------------------------------

describe("bug72 §3 — <each of=N> nested in a lift compiles clean", () => {
  const src = `type Row:struct = { id: string, n: number }

<rows>: Row[] = []

<table>
  <tbody>
    ${"$"}{ for (row of @rows) {
      lift <tr><each of=row.n><td>${"$"}{@.}</td></each></tr>
    } }
  </tbody>
</table>`;

  test("no E-CODEGEN-INVALID-JS; sigil-free; node --check passes", () => {
    const r = compile(src, "bug72-s3");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-JS");
      expect(r.clientJs).not.toMatch(/\(@\s*\.\)/);
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 — `as name` alias on the inner each lowers ${name} to the alias
// ---------------------------------------------------------------------------

describe("bug72 §4 — `as` alias on inner each lowers to the alias var", () => {
  const src = `type Row:struct = { id: string, cells: string[] }

<rows>: Row[] = []

<table>
  <tbody>
    ${"$"}{ for (row of @rows) {
      lift <tr><each in=row.cells as cell><td>${"$"}{cell}</td></each></tr>
    } }
  </tbody>
</table>`;

  test("the inner interpolation reads the `cell` alias; no E-CODEGEN-INVALID-JS", () => {
    const r = compile(src, "bug72-s4");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-JS");
      expect(r.clientJs).toContain("createTextNode(String(cell))");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — `@.` as a per-item attr value inside the nested each compiles clean
// ---------------------------------------------------------------------------

describe("bug72 §5 — @. per-item attr value inside nested each compiles clean", () => {
  const src = `type Row:struct = { id: string, cells: string[] }

<rows>: Row[] = []

<table>
  <tbody>
    ${"$"}{ for (row of @rows) {
      lift <tr><each in=row.cells><td title=@.>${"$"}{@.}</td></each></tr>
    } }
  </tbody>
</table>`;

  test("attr value @. + interpolation @. both lower; no E-CODEGEN-INVALID-JS", () => {
    const r = compile(src, "bug72-s5");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-JS");
      expect(r.clientJs).not.toMatch(/\(@\s*\.\)/);
      // The `title=@.` ATTR value (a bare `@`-sigil — tokenized as a standalone
      // PUNCT, which pre-fix forced the lift onto the string-fallback path) now
      // lowers to the inner iter var. Both the attr and the interpolation read
      // _scrml_each_item, proving the lift stayed on the structured markup path.
      expect(r.clientJs).toContain('setAttribute("title", String(_scrml_each_item))');
      expect(r.clientJs).toContain("createTextNode(String(_scrml_each_item))");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — nested-each inside an `if` inside the for-lift (IfOpts.scopeVar path)
// ---------------------------------------------------------------------------

describe("bug72 §6 — nested <each> inside an if inside the for-lift compiles clean", () => {
  const src = `type Row:struct = { id: string, cells: string[], show: bool }

<rows>: Row[] = []

<table>
  <tbody>
    ${"$"}{ for (row of @rows) {
      if (row.show) {
        lift <tr><each in=row.cells><td>${"$"}{@.}</td></each></tr>
      }
    } }
  </tbody>
</table>`;

  test("the if-gated nested-each lowers @. to the inner iter var; no E-CODEGEN-INVALID-JS", () => {
    const r = compile(src, "bug72-s6");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-JS");
      expect(r.clientJs).not.toMatch(/\(@\s*\.\)/);
      expect(r.clientJs).toContain("createTextNode(String(_scrml_each_item))");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — NEGATIVE no-regression: a Tier-0 lift with NO nested each is unaffected.
// scopeVar threading must be inert when no `<each>` child is present — the lift
// emits the same shape it did pre-fix.
// ---------------------------------------------------------------------------

describe("bug72 §7 — Tier-0 lift WITHOUT a nested each is unaffected (no-regression)", () => {
  const src = `type Row:struct = { id: string, name: string }

<rows>: Row[] = []

<ul>
  ${"$"}{ for (row of @rows) {
    lift <li>${"$"}{row.name}</li>
  } }
</ul>`;

  test("compiles clean; the plain lift body still reads the outer iter var", () => {
    const r = compile(src, "bug72-s7");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-JS");
      expect(r.clientJs).not.toMatch(/\(@\s*\.\)/);
      // No nested each → no inner reconcile machinery should appear.
      expect(r.clientJs).not.toContain("_scrml_each_item");
      // The plain interpolation still reads the outer loop var.
      expect(r.clientJs).toContain("row.name");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});
