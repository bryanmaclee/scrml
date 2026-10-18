// LSP L2 — workspace cache + cross-file go-to-def + cross-file diagnostics.
//
// L2 wires MOD (module-resolver) into the LSP analysis pipeline so the
// language server can see across .scrml file boundaries:
//   - import { X } from "./other.scrml"  → go-to-def jumps to other.scrml
//   - importing a non-exported name      → E-IMPORT-004 surfaces on the
//                                          import line of the importer
//   - circular imports                   → E-IMPORT-002 surfaces
//
// These tests exercise lsp/workspace.js directly (no LSP transport needed)
// and the workspace-aware overloads of analyzeText / buildDefinitionLocation
// in lsp/handlers.js.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  createWorkspace,
  bootstrapWorkspace,
  updateFileInWorkspace,
  removeFileFromWorkspace,
  lookupCrossFileDefinition,
  getCrossFileDiagnosticsFor,
  scanScrmlFiles,
  rebuildCrossFileGraph,
  tabFile,
} from "../../../lsp/workspace.js";

import {
  analyzeText,
  buildDefinitionLocation,
  pathToUri,
  uriToFilePath,
} from "../../../lsp/handlers.js";

// ---------------------------------------------------------------------------
// Test fixture: two-file workspace where page.scrml imports Card from card.scrml
// ---------------------------------------------------------------------------

let TMP;
let CARD_PATH;
let PAGE_PATH;

function writeWorkspace() {
  writeFileSync(
    CARD_PATH,
    [
      "${",
      "  export const Card = <article class=card>",
      "    <h2>Card</h2>",
      "  </article>",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    PAGE_PATH,
    [
      "${",
      '  import { Card } from "./card.scrml"',
      "}",
      "<Card />",
      "",
    ].join("\n"),
  );
}

beforeAll(() => {
  TMP = join(tmpdir(), `scrml-l2-${Date.now()}`);
  mkdirSync(TMP, { recursive: true });
  CARD_PATH = join(TMP, "card.scrml");
  PAGE_PATH = join(TMP, "page.scrml");
  writeWorkspace();
});

afterAll(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// File scan
// ---------------------------------------------------------------------------

describe("LSP L2 — scanScrmlFiles", () => {
  it("returns every .scrml file under the root, recursively", () => {
    const files = scanScrmlFiles(TMP);
    expect(files).toContain(CARD_PATH);
    expect(files).toContain(PAGE_PATH);
  });

  it("returns [] for missing directories", () => {
    const files = scanScrmlFiles("/nonexistent/path/that/does/not/exist");
    expect(files).toEqual([]);
  });

  it("skips dot-directories and node_modules", () => {
    const sub = join(TMP, "node_modules");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "should-skip.scrml"), "${}\n");
    const files = scanScrmlFiles(TMP);
    expect(files.find((f) => f.includes("node_modules"))).toBeUndefined();
    rmSync(sub, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// tabFile (BS+TAB tolerance)
// ---------------------------------------------------------------------------

describe("LSP L2 — tabFile", () => {
  it("returns an AST for valid scrml", () => {
    const rec = tabFile(CARD_PATH, "${ export const X = 1 }\n");
    expect(rec.ast).toBeTruthy();
    expect(rec.filePath).toBe(CARD_PATH);
  });

  it("returns ast:null when BS/TAB throw — does not crash", () => {
    // BS throwing is unusual; this is the defensive path. Even malformed
    // scrml typically still parses to something (errors flow on the side).
    const rec = tabFile("/t.scrml", "${ this is not valid scrml at all !!! }");
    // Either ast is null OR ast is present with errors. Both are acceptable.
    expect(rec).toHaveProperty("filePath");
    expect(rec).toHaveProperty("errors");
  });
});

// ---------------------------------------------------------------------------
// Workspace bootstrap
// ---------------------------------------------------------------------------

describe("LSP L2 — bootstrapWorkspace", () => {
  it("populates fileASTMap, exportRegistry, importGraph", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    expect(ws.fileASTMap.size).toBeGreaterThanOrEqual(2);
    expect(ws.fileASTMap.get(CARD_PATH)).toBeTruthy();
    expect(ws.fileASTMap.get(PAGE_PATH)).toBeTruthy();

    // Card exports `Card`.
    const cardExports = ws.exportRegistry.get(CARD_PATH);
    expect(cardExports).toBeTruthy();
    expect(cardExports.has("Card")).toBe(true);
    expect(cardExports.get("Card").isComponent).toBe(true);

    // Page imports Card from ./card.scrml.
    const pageEntry = ws.importGraph.get(PAGE_PATH);
    expect(pageEntry).toBeTruthy();
    expect(pageEntry.imports.length).toBe(1);
    expect(pageEntry.imports[0].names).toContain("Card");
    expect(pageEntry.imports[0].absSource).toBe(CARD_PATH);
  });

  it("captures source text for foreign-file Range computation", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    expect(ws.sourceTextByPath.get(CARD_PATH)).toContain("export const Card");
  });

  it("is safe to call with no rootPath (single-file mode)", () => {
    const ws = createWorkspace();
    expect(() => bootstrapWorkspace(ws, null)).not.toThrow();
    expect(ws.fileASTMap.size).toBe(0);
  });

  it("handles a non-existent rootPath without throwing", () => {
    const ws = createWorkspace();
    expect(() => bootstrapWorkspace(ws, "/no/such/path")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cross-file go-to-definition
// ---------------------------------------------------------------------------

describe("LSP L2 — lookupCrossFileDefinition", () => {
  it("resolves an imported component name to its source file", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    const hit = lookupCrossFileDefinition(ws, PAGE_PATH, "Card");
    expect(hit).toBeTruthy();
    expect(hit.filePath).toBe(CARD_PATH);
    expect(hit.span).toBeTruthy();
    // Card's `export const Card = ...` is on line 2 of card.scrml (1-based).
    expect(hit.span.line).toBe(2);
    // The source text is included so spanToRange can compute precise ranges.
    expect(hit.sourceText).toContain("Card");
  });

  it("returns null for an unresolved name", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    const hit = lookupCrossFileDefinition(ws, PAGE_PATH, "Nonsense");
    expect(hit).toBeNull();
  });

  it("returns null when the importer has no import graph entry", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    const hit = lookupCrossFileDefinition(ws, "/never/registered.scrml", "Card");
    expect(hit).toBeNull();
  });

  it("resolves an imported type-decl", () => {
    const tmp = join(TMP, "type-fixture");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "types.scrml"), "${\n  export type Status:enum = { Open, Closed }\n}\n");
    writeFileSync(join(tmp, "use.scrml"), '${\n  import { Status } from "./types.scrml"\n}\n');

    const ws = createWorkspace();
    bootstrapWorkspace(ws, tmp);
    const hit = lookupCrossFileDefinition(ws, join(tmp, "use.scrml"), "Status");
    expect(hit).toBeTruthy();
    expect(hit.filePath).toBe(join(tmp, "types.scrml"));
    expect(hit.kind === "type" || hit.kind === "export").toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves an imported function-decl", () => {
    const tmp = join(TMP, "fn-fixture");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "lib.scrml"), "${\n  export function helper(x) { return x + 1 }\n}\n");
    writeFileSync(join(tmp, "main.scrml"), '${\n  import { helper } from "./lib.scrml"\n}\n');

    const ws = createWorkspace();
    bootstrapWorkspace(ws, tmp);
    const hit = lookupCrossFileDefinition(ws, join(tmp, "main.scrml"), "helper");
    expect(hit).toBeTruthy();
    expect(hit.filePath).toBe(join(tmp, "lib.scrml"));
    expect(hit.kind === "function" || hit.kind === "export").toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Cross-file diagnostics
// ---------------------------------------------------------------------------

describe("LSP L2 — cross-file diagnostics", () => {
  it("surfaces E-IMPORT-004 when an imported name is not exported", () => {
    const tmp = join(TMP, "miss-export");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "lib.scrml"), "${\n  const private_thing = 1\n}\n");
    writeFileSync(join(tmp, "user.scrml"), '${\n  import { private_thing } from "./lib.scrml"\n}\n');

    const ws = createWorkspace();
    bootstrapWorkspace(ws, tmp);

    const errs = getCrossFileDiagnosticsFor(ws, join(tmp, "user.scrml"));
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.find((e) => e.code === "E-IMPORT-004")).toBeTruthy();

    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns [] when the file has no cross-file errors", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    const errs = getCrossFileDiagnosticsFor(ws, CARD_PATH);
    expect(errs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation: updateFileInWorkspace
// ---------------------------------------------------------------------------

describe("LSP L2 — cache invalidation", () => {
  it("flips exportsChanged=true when an export is removed", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);

    const newCardText = "${\n  const Card = <article>hi</article>\n}\n"; // export removed
    const { exportsChanged } = updateFileInWorkspace(ws, CARD_PATH, newCardText);
    expect(exportsChanged).toBe(true);

    // Now page.scrml's import is broken — should surface E-IMPORT-004.
    const errs = getCrossFileDiagnosticsFor(ws, PAGE_PATH);
    expect(errs.find((e) => e.code === "E-IMPORT-004")).toBeTruthy();

    // Restore the original fixture for downstream tests.
    writeWorkspace();
    updateFileInWorkspace(ws, CARD_PATH, [
      "${",
      "  export const Card = <article class=card>",
      "    <h2>Card</h2>",
      "  </article>",
      "}",
      "",
    ].join("\n"));
  });

  it("removeFileFromWorkspace drops the file and rebuilds the graph", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    expect(ws.fileASTMap.has(CARD_PATH)).toBe(true);
    removeFileFromWorkspace(ws, CARD_PATH);
    expect(ws.fileASTMap.has(CARD_PATH)).toBe(false);
    // page.scrml still references card.scrml — depending on existsSync /
    // compile-set semantics this may or may not raise E-IMPORT-006. The
    // test just confirms the eviction itself worked.
  });
});

// ---------------------------------------------------------------------------
// pathToUri / uriToFilePath
// ---------------------------------------------------------------------------

describe("LSP L2 — path/URI conversion", () => {
  it("pathToUri produces a file:// URI", () => {
    expect(pathToUri("/tmp/foo.scrml")).toBe("file:///tmp/foo.scrml");
  });

  it("pathToUri preserves slashes and encodes segments", () => {
    expect(pathToUri("/tmp/has space/foo.scrml")).toBe("file:///tmp/has%20space/foo.scrml");
  });

  it("pathToUri is idempotent on already-encoded URIs", () => {
    expect(pathToUri("file:///tmp/foo.scrml")).toBe("file:///tmp/foo.scrml");
  });

  it("uriToFilePath inverts pathToUri", () => {
    const p = "/tmp/has space/foo.scrml";
    expect(uriToFilePath(pathToUri(p))).toBe(p);
  });

  it("uriToFilePath returns null for empty input", () => {
    expect(uriToFilePath(null)).toBeNull();
    expect(uriToFilePath("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildDefinitionLocation with workspace fall-through
// ---------------------------------------------------------------------------

describe("LSP L2 — buildDefinitionLocation cross-file fall-through", () => {
  it("resolves an imported component to a Location pointing into the foreign file", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    const pageText = [
      "${",
      '  import { Card } from "./card.scrml"',
      "}",
      "<Card />",
      "",
    ].join("\n");
    const { analysis } = analyzeText(PAGE_PATH, pageText, null, ws);

    // Cursor on `Card` in `<Card />` — find the byte offset.
    const offset = pageText.indexOf("<Card") + 1; // points to 'C'
    const loc = buildDefinitionLocation(
      pathToUri(PAGE_PATH),
      pageText,
      offset,
      analysis,
      ws,
      PAGE_PATH,
    );

    expect(loc).toBeTruthy();
    expect(loc.uri).toBe(pathToUri(CARD_PATH));
    expect(loc.range).toBeTruthy();
    // The export-decl span starts on line 2 of card.scrml (0-based: 1).
    expect(loc.range.start.line).toBe(1);
  });

  it("returns null without workspace when the symbol is cross-file only", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    const pageText = [
      "${",
      '  import { Card } from "./card.scrml"',
      "}",
      "<Card />",
      "",
    ].join("\n");
    const { analysis } = analyzeText(PAGE_PATH, pageText);

    const offset = pageText.indexOf("<Card") + 1;
    // No workspace passed — should return null (L1 behavior).
    const loc = buildDefinitionLocation(
      pathToUri(PAGE_PATH),
      pageText,
      offset,
      analysis,
    );

    expect(loc).toBeNull();
  });

  it("does not cross-file-resolve @reactive variables", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    const text = "${\n  @x = 1\n}\n";
    const { analysis } = analyzeText("/t.scrml", text, null, ws);
    // @x is local; even with a workspace, cross-file lookup is skipped for @-words.
    const offset = text.indexOf("@x") + 1;
    const loc = buildDefinitionLocation(
      "file:///t.scrml",
      text,
      offset,
      analysis,
      ws,
      "/t.scrml",
    );
    // Same-file lookup should still hit.
    expect(loc).toBeTruthy();
    expect(loc.uri).toBe("file:///t.scrml");
  });
});

// ---------------------------------------------------------------------------
// analyzeText with workspace — cross-file diagnostics merged in
// ---------------------------------------------------------------------------

describe("LSP L2 — analyzeText emits cross-file diagnostics when workspace is supplied", () => {
  it("merges E-IMPORT-004 into the diagnostics array for the importer", () => {
    const tmp = join(TMP, "merged-diag");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "lib.scrml"), "${\n  const Hidden = 1\n}\n");
    const userPath = join(tmp, "user.scrml");
    const userText = '${\n  import { Hidden } from "./lib.scrml"\n}\n';
    writeFileSync(userPath, userText);

    const ws = createWorkspace();
    bootstrapWorkspace(ws, tmp);

    const { diagnostics } = analyzeText(userPath, userText, null, ws);
    expect(diagnostics.find((d) => d.code === "E-IMPORT-004")).toBeTruthy();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("does NOT emit cross-file diagnostics when workspace is omitted (L1 path)", () => {
    const tmp = join(TMP, "no-ws-diag");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "lib.scrml"), "${\n  const Hidden = 1\n}\n");
    const userPath = join(tmp, "user.scrml");
    const userText = '${\n  import { Hidden } from "./lib.scrml"\n}\n';
    writeFileSync(userPath, userText);

    // No workspace passed — analyzeText behaves as L1 did.
    const { diagnostics } = analyzeText(userPath, userText);
    expect(diagnostics.find((d) => d.code === "E-IMPORT-004")).toBeUndefined();
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// rebuildCrossFileGraph — exposed for advanced cache management
// ---------------------------------------------------------------------------

describe("LSP L2 — rebuildCrossFileGraph", () => {
  it("rebuilds importGraph + exportRegistry from current fileASTMap", () => {
    const ws = createWorkspace();
    bootstrapWorkspace(ws, TMP);
    const before = ws.exportRegistry.size;
    rebuildCrossFileGraph(ws);
    expect(ws.exportRegistry.size).toBe(before);
  });
});

// THROWAWAY (s469-ci-speedup bite proof, branch s469-ci-bite-fail) — must never reach main.
it("s469 ci bite proof — deliberately fails", () => { expect(1).toBe(2); });
