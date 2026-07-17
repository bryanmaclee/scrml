/**
 * mcp-program-attr.test.js — MCP V0 Sub-unit D integration tests
 *
 * Authority: docs/changes/mcp-v0-devtools-scoping/SCOPING.md §3 Sub-unit D.
 *
 * Validates the `<program mcp>` opt-in attribute end-to-end:
 *
 *   1. Bare `<program mcp>` (boolean-attribute idiom) defaults to "dev-only";
 *      compileScrml auto-flips emitPerRoute; descriptor sidecars + chunks.json
 *      land on disk; `generateServerEntry()` emits the boot import + a
 *      NODE_ENV runtime gate AND lifecycle wiring.
 *   2. `<program mcp="always">` produces an unconditional boot block (no
 *      NODE_ENV gate).
 *   3. Explicit `<program mcp="dev-only">` matches the bare-form behavior.
 *   4. Baseline regression: NO `<program mcp>` → ZERO MCP wiring anywhere
 *      (no `result.mcpAutoActivated`, no boot in `_server.js`, NO
 *      auto-flipped emitPerRoute when adopter did not request it).
 *
 * Why both compileScrml AND generateServerEntry — Sub-unit D's auto-wire spans
 * two stages: PRECG attribute detection + per-route auto-flip in compileScrml,
 * and `_server.js` boot injection in `generateServerEntry()` (called by
 * `runBuild`). Both are stable contract surfaces tested here directly.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  makeSidecarTmpRoot,
  cleanupSidecarTmpRoot,
  compileAndReadSidecars,
} from "../helpers/mcp-sidecar-compile.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry } from "../../src/commands/build.js";

// ---------------------------------------------------------------------------
// Shared fixture text — kept minimal so the assertions focus on the attr
// pathway, not on the descriptor emit shape (that is the MCP-V0.A test's job).
// One engine + one server fn is enough to give the descriptor extractor real
// content to write, so the sidecars file-count assertions are non-trivial.
// ---------------------------------------------------------------------------

const FIXTURE_BODY = `type LoadPhase:enum = { Idle, Loading, Loaded(rows: int) }

\${
  server function loadRows(limit: int) {
    return ?{\`SELECT id FROM items LIMIT \${limit}\`}.all()
  }
}

<engine for=LoadPhase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=.Loaded></>
  <Loaded(rows) rule=.Idle>\${rows}</>
</>
`;

function fixtureWithProgramAttr(programAttr) {
  return `<program ${programAttr} db="./app.db">\n${FIXTURE_BODY}</program>\n`;
}

// ---------------------------------------------------------------------------
// Helper — compileScrml WITHOUT pre-setting emitPerRoute, so we can assert
// that the auto-flip surface really did the work.
// ---------------------------------------------------------------------------

function compileForMcpAttr(source, tmpRoot, opts = {}) {
  const dir = join(tmpRoot, `c${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, source);
  const outDir = join(dir, "dist");
  const result = compileScrml({
    inputFiles: [fp],
    outputDir: outDir,
    write: true,
    // Critically: do NOT pre-flip emitPerRoute. The auto-flip is what's under
    // test — if compileScrml's <program mcp> auto-activation works, sidecars
    // land on disk WITHOUT this flag.
    emitPerRoute: opts.preFlipPerRoute === true,
    log: () => {},
  });
  return {
    result,
    outDir,
    sourceFile: fp,
    fatal: (result.errors ?? []).filter(
      (e) =>
        e.severity !== "warning" &&
        !String(e.code ?? "").startsWith("W-") &&
        !String(e.code ?? "").startsWith("I-")
    ),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("MCP V0 Sub-unit D — <program mcp> attribute auto-activation", () => {
  let tmpRoot;
  beforeAll(() => { tmpRoot = makeSidecarTmpRoot("program-attr"); });
  afterAll(() => { cleanupSidecarTmpRoot(tmpRoot); });

  // -------------------------------------------------------------------------
  // 1. Bare `<program mcp>` — boolean-attribute idiom, defaults to dev-only.
  // -------------------------------------------------------------------------
  describe("bare <program mcp>", () => {
    test("compileScrml auto-activates with mode='dev-only'", () => {
      const src = fixtureWithProgramAttr("mcp");
      const { result, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      expect(result.mcpAutoActivated).toBe(true);
      expect(result.mcpMode).toBe("dev-only");
      expect(result.mcpEmitPerRouteAutoFlipped).toBe(true);
    });

    test("sidecars + chunks.json land on disk WITHOUT explicit --emit-per-route", () => {
      const src = fixtureWithProgramAttr("mcp");
      const { outDir, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      expect(existsSync(join(outDir, "engines.json"))).toBe(true);
      expect(existsSync(join(outDir, "forms.json"))).toBe(true);
      expect(existsSync(join(outDir, "channels.json"))).toBe(true);
      expect(existsSync(join(outDir, "serverfns.json"))).toBe(true);
      expect(existsSync(join(outDir, "chunks.json"))).toBe(true);
    });

    test("_scrml/mcp.js shim is bundled (auto-included in stdlib bundle)", () => {
      const src = fixtureWithProgramAttr("mcp");
      const { outDir, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      expect(existsSync(join(outDir, "_scrml", "mcp.js"))).toBe(true);
    });

    test("generateServerEntry emits dev-only boot with NODE_ENV gate + SIGINT/SIGTERM wiring", () => {
      const mcpOpts = { activated: true, mode: "dev-only" };
      const entry = generateServerEntry([], mcpOpts);
      // Import.
      expect(entry).toContain('import { startMcpServer, shutdownMcpServer } from "./_scrml/mcp.js";');
      // Runtime gate.
      expect(entry).toContain('process.env.NODE_ENV !== "production"');
      expect(entry).toContain('_scrml_mcp_boot_enabled');
      // Boot call.
      expect(entry).toContain("startMcpServer({");
      expect(entry).toContain("reactiveGet: globalThis._scrml_reactive_get,");
      expect(entry).toContain("derivedGet: globalThis._scrml_derived_get,");
      expect(entry).toContain("outputDir: SERVE_DIR,");
      // Lifecycle.
      expect(entry).toContain('process.once("SIGINT", _shutdown)');
      expect(entry).toContain('process.once("SIGTERM", _shutdown)');
      // Error path goes to stderr (SCOPING Risk 4).
      expect(entry).toContain("process.stderr.write(");
    });
  });

  // -------------------------------------------------------------------------
  // 2. `<program mcp="always">` — explicit always.
  // -------------------------------------------------------------------------
  describe('<program mcp="always">', () => {
    test("compileScrml auto-activates with mode='always'", () => {
      const src = fixtureWithProgramAttr('mcp="always"');
      const { result, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      expect(result.mcpAutoActivated).toBe(true);
      expect(result.mcpMode).toBe("always");
      expect(result.mcpEmitPerRouteAutoFlipped).toBe(true);
    });

    test("generateServerEntry emits unconditional boot (no NODE_ENV gate)", () => {
      const mcpOpts = { activated: true, mode: "always" };
      const entry = generateServerEntry([], mcpOpts);
      expect(entry).toContain('import { startMcpServer, shutdownMcpServer } from "./_scrml/mcp.js";');
      // No runtime gate.
      expect(entry).not.toContain('process.env.NODE_ENV');
      expect(entry).not.toContain('_scrml_mcp_boot_enabled');
      // Boot + lifecycle still present.
      expect(entry).toContain("startMcpServer({");
      expect(entry).toContain('process.once("SIGINT", _shutdown)');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Explicit `<program mcp="dev-only">` — same as bare form.
  // -------------------------------------------------------------------------
  describe('<program mcp="dev-only">', () => {
    test("compileScrml auto-activates with mode='dev-only'", () => {
      const src = fixtureWithProgramAttr('mcp="dev-only"');
      const { result, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      expect(result.mcpAutoActivated).toBe(true);
      expect(result.mcpMode).toBe("dev-only");
    });

    test("sidecars + boot wiring match the bare form", () => {
      const src = fixtureWithProgramAttr('mcp="dev-only"');
      const { outDir, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      expect(existsSync(join(outDir, "engines.json"))).toBe(true);
      expect(existsSync(join(outDir, "_scrml", "mcp.js"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Baseline regression — NO `<program mcp>` means ZERO MCP wiring.
  // -------------------------------------------------------------------------
  describe("baseline: no <program mcp> attribute", () => {
    test("compileScrml does NOT auto-activate; emitPerRoute stays default-false", () => {
      const src = fixtureWithProgramAttr(""); // <program>
      const { result, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      expect(result.mcpAutoActivated).toBe(false);
      expect(result.mcpMode).toBe(null);
      expect(result.mcpEmitPerRouteAutoFlipped).toBe(false);
    });

    test("NO sidecars + NO chunks.json + NO _scrml/mcp.js shim emitted", () => {
      const src = fixtureWithProgramAttr("");
      const { outDir, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      // Sidecars are inside the emit-per-route branch; without auto-flip
      // and without explicit --emit-per-route, they should NOT exist.
      expect(existsSync(join(outDir, "engines.json"))).toBe(false);
      expect(existsSync(join(outDir, "forms.json"))).toBe(false);
      expect(existsSync(join(outDir, "channels.json"))).toBe(false);
      expect(existsSync(join(outDir, "serverfns.json"))).toBe(false);
      expect(existsSync(join(outDir, "chunks.json"))).toBe(false);
      // The mcp shim is added only on opt-in.
      expect(existsSync(join(outDir, "_scrml", "mcp.js"))).toBe(false);
    });

    test("generateServerEntry without mcpOpts emits NO MCP code (zero opt-out cost)", () => {
      const entry = generateServerEntry([]);
      expect(entry).not.toContain("startMcpServer");
      expect(entry).not.toContain("shutdownMcpServer");
      expect(entry).not.toContain("./_scrml/mcp.js");
      expect(entry).not.toContain("MCP V0");
    });

    test("generateServerEntry with mcpOpts={activated:false} emits NO MCP code", () => {
      const entry = generateServerEntry([], { activated: false });
      expect(entry).not.toContain("startMcpServer");
      expect(entry).not.toContain("shutdownMcpServer");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Auto-activation interaction with adopter-set --emit-per-route.
  //    If adopter already passed emitPerRoute: true, the auto-flip flag
  //    becomes false (we didn't HAVE to flip), but auto-activation still
  //    fires.
  // -------------------------------------------------------------------------
  describe("interaction with adopter-passed --emit-per-route", () => {
    test("adopter-set emitPerRoute + <program mcp> → activated but NOT auto-flipped", () => {
      const src = fixtureWithProgramAttr("mcp");
      const { result, fatal } = compileForMcpAttr(src, tmpRoot, { preFlipPerRoute: true });
      expect(fatal).toEqual([]);
      expect(result.mcpAutoActivated).toBe(true);
      expect(result.mcpEmitPerRouteAutoFlipped).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Q3.4 ratification — unrecognized values fall back to safer 'dev-only'.
  //    VP-1 W-ATTR-002 will warn separately; here we test the behavior.
  // -------------------------------------------------------------------------
  describe("unrecognized mcp value", () => {
    test('mcp="bogus" falls back to mode="dev-only" (safer default; VP-1 warns)', () => {
      const src = fixtureWithProgramAttr('mcp="bogus"');
      const { result, fatal } = compileForMcpAttr(src, tmpRoot);
      expect(fatal).toEqual([]);
      expect(result.mcpAutoActivated).toBe(true);
      // Safer default: never accidentally enable mode='always'.
      expect(result.mcpMode).toBe("dev-only");
      // VP-1 W-ATTR-002 warned on the unrecognized value.
      const w = (result.warnings ?? []).find((x) => x.code === "W-ATTR-002");
      expect(w).toBeTruthy();
    });
  });
});
