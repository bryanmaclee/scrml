/**
 * S461 — runtime tree-shake: code an app does not use leaves the shared runtime.
 *
 * Ruling (bryan, S459, scrml-support/user-voice-scrml.md): "yes, measure first, 1 and 3 for sure"
 * — (3) move code an app does not use out of the shared runtime into on-demand chunks.
 * Measurements and the corpus proofs: docs/changes/s461-runtime-tree-shake/progress.md.
 *
 * Tree-shaking fails SILENTLY: a helper moved out that some program still calls is a
 * `ReferenceError` at page init AFTER a green compile (#1029). So every section here pins BOTH
 * directions — the chunk is gone where nothing names it, AND it is present wherever the emitted
 * client (or another shipped chunk) names it.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { compileScrml } from "../../src/api.js";
import { RUNTIME_CHUNKS, CHUNK_DEPENDENCIES, applyChunkDependencies } from "../../src/codegen/runtime-chunks.ts";

const REPO = resolve(import.meta.dir, "../../..");

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "s461-tree-shake-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function compileSource(source, opts = {}) {
  const inputDir = mkdtempSync(join(TMP, "in-"));
  const filePath = join(inputDir, "app.scrml");
  writeFileSync(filePath, source);
  return compileFiles([filePath], inputDir, opts);
}

function compileRepoFile(rel, opts = {}) {
  const inputDir = mkdtempSync(join(TMP, "repo-"));
  const filePath = join(inputDir, rel.split("/").pop());
  copyFileSync(join(REPO, rel), filePath);
  return compileFiles([filePath], inputDir, opts);
}

function compileFiles(inputFiles, inputDir, opts) {
  const outDir = join(inputDir, "dist");
  const result = compileScrml({ inputFiles, outputDir: outDir, write: true, log: () => {}, ...opts });
  const hard = result.errors.filter((e) => e.severity !== "warning");
  expect(hard).toEqual([]);
  const runtime = readFileSync(join(outDir, result.runtimeFilename), "utf8");
  const clients = [];
  for (const [, out] of result.outputs) if (out && out.clientJs) clients.push(out.clientJs);
  return { result, runtime, client: clients.join("\n") };
}

/** Top-level names a script declares. */
function topLevelDecls(src) {
  const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script" });
  const names = new Set();
  for (const st of ast.body) {
    if (st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") names.add(st.id.name);
    else if (st.type === "VariableDeclaration") for (const d of st.declarations) if (d.id.type === "Identifier") names.add(d.id.name);
  }
  return names;
}

/** Identifier tokens in reference position (not after a member dot), via acorn's tokenizer. */
function referencedNames(src) {
  const out = new Set();
  let prev = null;
  for (const t of acorn.tokenizer(src, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true })) {
    if (t.type.label === "name" && !(prev && prev.type.label === ".")) out.add(t.value);
    prev = t;
  }
  return out;
}

/**
 * The S461 proof shape, in miniature: every name the emitted client references that
 * a moved chunk DEFINES must be defined by the runtime the page loads.
 */
function expectNoDanglingFrom(chunkNames, { runtime, client }) {
  const shipped = topLevelDecls(runtime);
  const refs = referencedNames(client);
  for (const chunk of chunkNames) {
    for (const name of topLevelDecls(RUNTIME_CHUNKS[chunk])) {
      if (refs.has(name)) expect({ chunk, name, defined: shipped.has(name) }).toEqual({ chunk, name, defined: true });
    }
  }
}

const COUNTER = `<count> = 0

<button onclick={ @count = @count + 1 }>
  count is \${@count}
</button>
`;

const SHELL = `<program>
  <h1>App shell</h1>
  <outlet/>
</program>
`;

// ---------------------------------------------------------------------------
// (a) the 'errors' chunk is no longer seeded into every page
// ---------------------------------------------------------------------------

describe("(a) errors chunk ships by post-emit reference, not unconditionally", () => {
  test("a page that names no error class / reporter ships without it", () => {
    for (const src of [COUNTER, SHELL]) {
      const { runtime, client } = compileSource(src);
      expect(client).not.toMatch(/_scrml_error_boundary_log|NetworkError/);
      expect(runtime).not.toContain("class _ScrmlError");
      expect(runtime).not.toContain("function _scrml_error_boundary_log");
    }
  });

  test("a page whose emitted client calls _scrml_error_boundary_log ships the chunk", () => {
    const built = compileRepoFile("examples/09-error-handling.scrml");
    expect(built.client).toContain("_scrml_error_boundary_log(");
    expect(built.runtime).toContain("function _scrml_error_boundary_log");
    expectNoDanglingFrom(["errors"], built);
  });

  test("a server-fn page: the chunk ships iff the client names a definition (a quoted variant TAG does not count)", () => {
    // `variant: "NetworkError"` in a fetch stub is data; the gate's quote-adjacency rule keeps it
    // from counting. The handler's async catch DOES call the reporter, so this page needs it.
    const src = `<program>
  \${ server function ping() { return 1 } }
  <button onclick=ping()>ping</button>
</program>
`;
    const { runtime, client } = compileSource(src);
    expect(client).toContain("_scrml_error_boundary_log(");
    const named = /(?<![\w$.'"`])(?:_ScrmlError|NetworkError|ValidationError|SQLError|AuthError|TimeoutError|ParseError|NotFoundError|ConflictError|_scrml_error_boundary_log|_scrml_error_boundary_uncaught)(?![\w$'"`])/.test(client);
    expect(runtime.includes("class _ScrmlError")).toBe(named);
    expectNoDanglingFrom(["errors"], { runtime, client });
  });

  test("every chunk whose own helpers report through _scrml_error_boundary_log pulls 'errors'", () => {
    // Those calls are typeof-guarded, so a missing edge would not throw — it would silently drop
    // the report. Derived from the chunk text, not a hand list.
    const errorsDefs = topLevelDecls(RUNTIME_CHUNKS.errors);
    for (const [name, text] of Object.entries(RUNTIME_CHUNKS)) {
      if (name === "errors" || !text) continue;
      const refs = referencedNames(text);
      // A chunk that BINDS the name itself (stdlib-data's own `const ParseError`) is not
      // referring to the runtime class.
      const names = [...errorsDefs].filter((d) => refs.has(d) && !new RegExp(`\\b(?:const|let|var|function|class)\\s+${d}\\b`).test(text));
      if (names.length === 0) continue;
      const closed = applyChunkDependencies(new Set([name]));
      expect({ chunk: name, names, pullsErrors: closed.has("errors") }).toEqual({ chunk: name, names, pullsErrors: true });
    }
  });

  test("the edge table records those chunks explicitly", () => {
    expect(CHUNK_DEPENDENCIES.reset).toContain("errors");
    expect(CHUNK_DEPENDENCIES.ssr).toContain("errors");
    expect(CHUNK_DEPENDENCIES.urlguard).toContain("errors");
  });
});
