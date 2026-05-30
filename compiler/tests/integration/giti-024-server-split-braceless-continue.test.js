/**
 * GITI-024 regression — brace-less `if (cond) continue` / `break` / `return`
 * whose following statement is identifier-led mis-parses in a server-split body.
 *
 * Filed: 2026-05-30 (GITI-024, adopter giti). Reproducer (committed sidecar):
 * a plain `export function` that imports `scrml:fs` is classified server-side
 * and emits a `.server.js` HTTP-handler; its for-body has a brace-less
 * `if (line == "skip") continue` followed by `out.push(line)`.
 *
 * Root cause (ast-builder.js parseLogicBody): the brace-less single-statement
 * if-body path calls parseOneStatement(), which for `break`/`continue` read a
 * same-line label heuristic. The guard compared `tok.line` — a property that
 * DOES NOT EXIST on tokens (line lives at `tok.span.line`) — so the comparison
 * was `undefined === undefined` → always TRUE. The next statement's leading
 * identifier (`out`) was wrongly consumed as a labeled-`continue` target,
 * producing `continue out;` and orphaning `out.push(line)` → `. push ( line );`.
 * The `--validate-emit` gate (default-ON) caught it as E-CODEGEN-INVALID-JS
 * ("Unsyntactic continue"); silent-latent before the gate.
 *
 * Fix: compare `tok.span?.line` with a null-guard (mirrors the adjacent
 * `return`-stmt newline heuristic which already used `startTok?.span?.line`).
 * A label is only consumed when both span lines are known AND equal — the
 * correct JS rule (a labeled continue/break may not have a newline before its
 * label per ASI). Applied at all four break/continue label sites in
 * parseLogicBody (the parseOneStatement nested-body path AND the top-level
 * statement loop).
 *
 * The client `.js` path was always correct (it re-emits source faithfully);
 * the defect was reachable only via the server-split body re-serialization.
 *
 * Test structure (two tiers):
 *  - AST-level (tests 1+2): assert the parser produces `label: null` directly
 *    from buildAST(splitBlocks(...)). This is the AUTHORITATIVE guard — the bug
 *    is in the parser, so this is mode/escalation-agnostic and where the fix
 *    actually lives.
 *  - End-to-end (tests 3+4+5): compile with the --validate-emit gate ON and
 *    assert a valid re-serialized `.server.js`. These use BROWSER mode with a
 *    `<program>` + a called `server function`, because S145 SPEC §12.6
 *    (library-mode emission) now SUPPRESSES the `.server.js` for a function
 *    escalated PURELY by body content (the original library-mode `export
 *    function` + `scrml:fs` sidecar shape) — so that shape emits no `.server.js`
 *    to assert against. An explicit `server function` in an app `<program>`
 *    RETAINS the route handler (§12.6), exercising the same re-serialization
 *    path the GITI-024 fix protects. (The library-mode suppression of the
 *    original shape is covered by library-mode-suppress-body-escalated-server-js.test.js.)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "giti-024-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Compile with the emitted-JS parse gate ON (validateEmit default-true).
function compileWithGate(name, source) {
  const filePath = join(TMP, name + ".scrml");
  writeFileSync(filePath, source);
  const outDir = join(TMP, name + ".dist");
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    mode: "browser",
    write: true,
    validateEmit: true,
    log: () => {},
  });
  const errors = (result.errors || []).filter(
    e => e.severity == null || e.severity === "error",
  );
  let serverJs = "";
  try { serverJs = readFileSync(join(outDir, name + ".server.js"), "utf8"); } catch { /* missing */ }
  return { errors, serverJs, outDir };
}

// Independent confirmation: node --check the emitted .server.js (write a .mjs
// copy so node parses ES module syntax — the file uses `export`).
function nodeCheckOk(serverJs) {
  const dir = mkdtempSync(join(tmpdir(), "giti-024-check-"));
  try {
    const p = join(dir, "_check.mjs");
    writeFileSync(p, serverJs);
    try {
      execFileSync("node", ["--check", p], { stdio: ["ignore", "ignore", "pipe"] });
      return { ok: true, err: "" };
    } catch (e) {
      return { ok: false, err: e.stderr ? e.stderr.toString() : String(e) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CONTINUE_SRC = [
  '${',
  '  import { readFileSync } from "scrml:fs"',
  '  export function readLines(path) {',
  '    const out = []',
  '    for (const line of readFileSync(path, "utf8").split("\\n")) {',
  '      if (line == "skip") continue',
  '      out.push(line)',
  '    }',
  '    return out',
  '  }',
  '}',
].join("\n");

const BREAK_SRC = [
  '${',
  '  import { readFileSync } from "scrml:fs"',
  '  export function firstFew(path) {',
  '    const out = []',
  '    for (const line of readFileSync(path, "utf8").split("\\n")) {',
  '      if (line == "stop") break',
  '      out.push(line)',
  '    }',
  '    return out',
  '  }',
  '}',
].join("\n");

// Browser-mode `<program>` shapes for the end-to-end emit tests: an explicit
// `server function` (route handler RETAINED under §12.6) called from a client
// handler, so a `.server.js` with the re-serialized body IS emitted (the path
// the GITI-024 fix protects). Body content mirrors the bare-block SRC above.
const CONTINUE_PROG = [
  '<program>',
  '${',
  '  server function readLines(path) {',
  '    const out = []',
  '    for (const line of path.split("\\n")) {',
  '      if (line == "skip") continue',
  '      out.push(line)',
  '    }',
  '    return out',
  '  }',
  '  function go() { @rows = readLines("a\\nskip\\nb") }',
  '}',
  '<rows> = []',
  '<button onclick=go()>go</button>',
  '<p>${@rows.length}</p>',
  '</program>',
].join("\n");

const BREAK_PROG = [
  '<program>',
  '${',
  '  server function firstFew(path) {',
  '    const out = []',
  '    for (const line of path.split("\\n")) {',
  '      if (line == "stop") break',
  '      out.push(line)',
  '    }',
  '    return out',
  '  }',
  '  function go() { @rows = firstFew("a\\nstop\\nb") }',
  '}',
  '<rows> = []',
  '<button onclick=go()>go</button>',
  '<p>${@rows.length}</p>',
  '</program>',
].join("\n");

const RETURN_PROG = [
  '<program>',
  '${',
  '  server function pick(path) {',
  '    const out = []',
  '    for (const line of path.split("\\n")) {',
  '      if (line == "hit") return line',
  '      out.push(line)',
  '    }',
  '    return ""',
  '  }',
  '  function go() { @hit = pick("a\\nhit\\nb") }',
  '}',
  '<hit> = ""',
  '<button onclick=go()>go</button>',
  '<p>${@hit}</p>',
  '</program>',
].join("\n");

function findKind(ast, kind) {
  let found = null;
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.kind === kind) found = n;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  })(ast);
  return found;
}

describe("GITI-024: brace-less continue/break/return in a server-split body", () => {
  // --- AST-level root-cause assertions (FAIL on pre-fix code) -------------
  test("brace-less `if (cond) continue` does NOT capture the next-line ident as a label", () => {
    const node = findKind(buildAST(splitBlocks("p.scrml", CONTINUE_SRC)), "continue-stmt");
    expect(node).not.toBeNull();
    // Pre-fix: label === "out" (next-line ident swallowed). Post-fix: null.
    expect(node.label).toBeNull();
  });

  test("brace-less `if (cond) break` does NOT capture the next-line ident as a label", () => {
    const node = findKind(buildAST(splitBlocks("p.scrml", BREAK_SRC)), "break-stmt");
    expect(node).not.toBeNull();
    expect(node.label).toBeNull();
  });

  // --- End-to-end emit assertions (gate ON + node --check) ----------------
  test("continue: gate-clean compile + valid emitted .server.js", () => {
    const { errors, serverJs } = compileWithGate("readLines", CONTINUE_PROG);
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-JS")).toEqual([]);
    expect(errors).toEqual([]);
    expect(serverJs).not.toContain("continue out");
    expect(serverJs).toMatch(/continue;/);
    expect(nodeCheckOk(serverJs)).toEqual({ ok: true, err: "" });
  });

  test("break: gate-clean compile + valid emitted .server.js", () => {
    const { errors, serverJs } = compileWithGate("firstFew", BREAK_PROG);
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-JS")).toEqual([]);
    expect(errors).toEqual([]);
    expect(serverJs).not.toContain("break out");
    expect(serverJs).toMatch(/break;/);
    expect(nodeCheckOk(serverJs)).toEqual({ ok: true, err: "" });
  });

  test("return: gate-clean compile + valid emitted .server.js", () => {
    const { errors, serverJs } = compileWithGate("pick", RETURN_PROG);
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-JS")).toEqual([]);
    expect(errors).toEqual([]);
    expect(nodeCheckOk(serverJs)).toEqual({ ok: true, err: "" });
  });
});
