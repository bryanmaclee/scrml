/**
 * Nested <program> — End-to-End Integration Tests (§4.12, Phase 5)
 *
 * Full pipeline: BS → TAB → CE → CG for nested program features.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCEFile } from "../../src/component-expander.js";
import { runCG } from "../../src/codegen/index.ts";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

function fullPipeline(source) {
  const bsOut = splitBlocks("test.scrml", source);
  const tabOut = buildAST(bsOut);
  const ceOut = runCEFile(tabOut);
  const cgOut = runCG({
    files: [ceOut],
    routeMap: { routes: [], functions: new Map(), authMiddleware: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: null,
    embedRuntime: true,
  });
  return { tabOut, ceOut, cgOut };
}

function getOutput(cgOut) {
  const entry = [...cgOut.outputs.values()][0];
  return entry ?? {};
}

// ---------------------------------------------------------------------------
// §A: Inline Worker — full round-trip
// ---------------------------------------------------------------------------

describe("§A Inline worker round-trip (§4.12.4)", () => {
  const src = `<program>
\${ @result = 0 }

<program name="doubler">
    \${ function compute(n) { return n * 2 } }
    \${ when message(data) { send(compute(data)) } }
</>

<button onclick="\${@result = 1}">Click</>
</program>`;

  test("worker bundle exists in output", () => {
    const { cgOut } = fullPipeline(src);
    const output = getOutput(cgOut);
    expect(output.workerBundles).toBeDefined();
    expect(output.workerBundles.has("doubler")).toBe(true);
  });

  test("worker JS has self.onmessage handler", () => {
    const { cgOut } = fullPipeline(src);
    const workerJs = getOutput(cgOut).workerBundles.get("doubler");
    expect(workerJs).toContain("self.onmessage");
  });

  test("worker JS has send() rewritten to self.postMessage()", () => {
    const { cgOut } = fullPipeline(src);
    const workerJs = getOutput(cgOut).workerBundles.get("doubler");
    expect(workerJs).toContain("self.postMessage(");
    expect(workerJs).not.toContain("send(");
  });

  test("worker JS includes function declarations from worker scope", () => {
    const { cgOut } = fullPipeline(src);
    const workerJs = getOutput(cgOut).workerBundles.get("doubler");
    expect(workerJs).toContain("compute");
  });

  test("worker JS does NOT contain parent reactive state", () => {
    const { cgOut } = fullPipeline(src);
    const workerJs = getOutput(cgOut).workerBundles.get("doubler");
    expect(workerJs).not.toContain("_scrml_reactive");
    expect(workerJs).not.toContain("@result");
  });

  test("parent HTML does NOT contain worker children", () => {
    const { cgOut } = fullPipeline(src);
    const html = getOutput(cgOut).html ?? "";
    expect(html).not.toContain("compute");
    expect(html).not.toContain("onmessage");
    expect(html).toContain("button");
  });

  test("parent client JS has worker instantiation", () => {
    const { cgOut } = fullPipeline(src);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(getOutput(cgOut).clientJs ?? ""));
    expect(clientJs).toContain('new Worker("doubler.worker.js")');
    expect(clientJs).toContain("_scrml_worker_doubler.send");
  });
});

// ---------------------------------------------------------------------------
// §B: Scoped DB Context
// ---------------------------------------------------------------------------

describe("§B Scoped DB context (§4.12.6)", () => {
  test("nested <program db=...> parses without errors", () => {
    const src = `<program db="sqlite:./primary.db">
<program db="postgres://analytics:5432/metrics">
    <div>Analytics</>
</>
<div>Main</>
</program>`;
    const { tabOut } = fullPipeline(src);
    const fatalErrors = tabOut.errors.filter(e => !e.code?.startsWith("W-"));
    expect(fatalErrors).toHaveLength(0);
  });

  test("nested DB program children are emitted in parent HTML", () => {
    const src = `<program db="sqlite:./main.db">
<program db="postgres://other">
    <div>Scoped content</>
</>
<div>Main content</>
</program>`;
    const { cgOut } = fullPipeline(src);
    const html = getOutput(cgOut).html ?? "";
    // Both divs should appear — DB scope doesn't remove children from HTML
    expect(html).toContain("Main content");
    expect(html).toContain("Scoped content");
  });
});

// ---------------------------------------------------------------------------
// §C: Multiple workers in same file
// ---------------------------------------------------------------------------

describe("§C Multiple workers (§4.12.4)", () => {
  test("two named workers produce two bundles", () => {
    const src = `<program>
<program name="adder">
    \${ when message(n) { send(n + 1) } }
</>
<program name="multiplier">
    \${ when message(n) { send(n * 2) } }
</>
<div>Main</>
</program>`;
    const { cgOut } = fullPipeline(src);
    const output = getOutput(cgOut);
    expect(output.workerBundles).toBeDefined();
    expect(output.workerBundles.size).toBe(2);
    expect(output.workerBundles.has("adder")).toBe(true);
    expect(output.workerBundles.has("multiplier")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §D: Worker ref rewriting in expressions
// ---------------------------------------------------------------------------

describe("§D <#name>.send() in expressions (§4.12.4)", () => {
  test("worker instantiation code present in client JS when workers exist", () => {
    const src = `<program>
<program name="doubler">
    \${ when message(n) { send(n * 2) } }
</>
<div>Main</>
</program>`;
    const { cgOut } = fullPipeline(src);
    const output = getOutput(cgOut);
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(foldChunkNamespacing(output.clientJs) ?? ""));
    // Worker instantiation + Promise wrapper should be in client JS
    expect(clientJs).toContain("_scrml_worker_doubler");
    expect(clientJs).toContain('new Worker("doubler.worker.js")');
    expect(clientJs).toContain("postMessage(data)");
  });
});
