/**
 * Phase 2g if-chain mount/unmount emission — Unit Tests (§17.1.1)
 *
 * Coverage for the new chain handler activated in Phase 2g.
 *
 * Greenlit design (deep-dive §9):
 *   - Approach A + W-keep-chain-only + per-branch mixed-cleanliness dispatch.
 *   - Single chain wrapper `<div data-scrml-if-chain="N">` retained for adopter
 *     CSS targeting.
 *   - Clean branch:
 *       `<template id=...><inner></template><!--scrml-if-marker:...-->`
 *     Per-branch wrapper DROPPED. Controller mounts via _scrml_mount_template
 *     and unmounts via _scrml_unmount_scope. Honors §17.1.1 line 7533
 *     ("only one span exists in DOM at a time").
 *   - Dirty branch:
 *       `<div data-scrml-chain-branch="K" style="display:none"><inner></div>`
 *     Pre-Phase-2g per-branch wrapper retained. Controller toggles wrapper
 *     `style.display` per branch (today's behavior, scoped per branch).
 *   - Strip-precursor (`stripChainBranchAttrs`) applies in BOTH paths.
 *
 * Coverage map:
 *   §1  HTML emission — all-clean chains (N1-N5)
 *   §2  HTML emission — all-dirty chains (today's behavior preserved) (N6-N8)
 *   §3  HTML emission — mixed-cleanliness chains (N9-N12)
 *   §4  Registry binding shape (N13-N17)
 *   §5  Client JS controller shape — all-clean (N18-N22)
 *   §6  Client JS controller shape — all-dirty (N23-N25)
 *   §7  Client JS controller shape — mixed (N26-N28)
 *   §8  Round-trip through full pipeline (N29-N31)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { generateHtml } from "../../src/codegen/emit-html.js";
import { BindingRegistry } from "../../src/codegen/binding-registry.ts";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(source) {
  const bsOut = splitBlocks("/test/app.scrml", source);
  return buildAST(bsOut);
}

function compileToHtml(source) {
  const result = parse(source);
  const registry = new BindingRegistry();
  const html = generateHtml(result.ast.nodes, [], false, registry, result.ast);
  return { html, registry, errors: result.errors };
}

function compileFull(source) {
  const result = parse(source);
  const out = runCG({
    files: [result.ast],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
  const file = out.outputs.get("/test/app.scrml");
  return { html: file?.html ?? "", clientJs: file?.clientJs ?? "", errors: result.errors };
}

beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// §1  HTML emission — all-clean chains (N1-N5)
// ---------------------------------------------------------------------------

describe("§1: all-clean chain HTML emission (N1-N5)", () => {
  test("N1: 2-branch all-clean chain emits chain wrapper + per-branch <template> + marker", () => {
    const { html } = compileToHtml(`<program>
      <h2 if=@editMode>Edit</>
      <h2 else>Add</>
    </>`);
    // Single chain wrapper (W-keep-chain-only).
    expect(html).toMatch(/<div data-scrml-if-chain="[^"]+">/);
    // Two <template> elements (one per branch).
    expect((html.match(/<template id="[^"]+">/g) ?? []).length).toBe(2);
    // Two scrml-if-marker comments (one per branch).
    expect((html.match(/<!--scrml-if-marker:[^-]+-->/g) ?? []).length).toBe(2);
    // No per-branch wrapper for clean branches.
    expect(html).not.toContain("data-scrml-chain-branch=");
  });

  test("N2: 3-branch all-clean chain emits 3 templates + 3 markers", () => {
    const { html } = compileToHtml(`<program>
      <p if=@a>A</>
      <p else-if=@b>B</>
      <p else>C</>
    </>`);
    expect((html.match(/<template id="[^"]+">/g) ?? []).length).toBe(3);
    expect((html.match(/<!--scrml-if-marker:[^-]+-->/g) ?? []).length).toBe(3);
    expect(html).not.toContain("data-scrml-chain-branch=");
  });

  test("N3: clean-chain template content has if=/else-if=/else stripped", () => {
    const { html } = compileToHtml(`<program>
      <p if=@a>A</>
      <p else-if=@b>B</>
      <p else>C</>
    </>`);
    // Inside any <template>, no if=/else-if=/else attribute leaks.
    const tplBodies = [...html.matchAll(/<template id="[^"]+">(.*?)<\/template>/g)].map((m) => m[1]);
    expect(tplBodies.length).toBe(3);
    for (const body of tplBodies) {
      expect(body).not.toMatch(/\bif="/);
      expect(body).not.toMatch(/\belse-if="/);
      expect(body).not.toMatch(/\belse=/);
    }
  });

  test("N4: clean-chain branch bodies are emitted intact inside templates", () => {
    const { html } = compileToHtml(`<program>
      <p if=@a>Apple</>
      <p else-if=@b>Banana</>
      <p else>Cherry</>
    </>`);
    expect(html).toContain("<p>Apple</p>");
    expect(html).toContain("<p>Banana</p>");
    expect(html).toContain("<p>Cherry</p>");
  });

  test("N5: chain wrapper encloses all branches (templates + markers are inside)", () => {
    const { html } = compileToHtml(`<program>
      <h2 if=@a>A</>
      <h2 else>B</>
    </>`);
    // Chain wrapper opens before any branch shape and closes after the last marker.
    const wrapperMatch = html.match(/<div data-scrml-if-chain="[^"]+">([\s\S]*?)<\/div>/);
    expect(wrapperMatch).not.toBeNull();
    const inside = wrapperMatch[1];
    expect(inside).toContain("<template");
    expect(inside).toContain("scrml-if-marker:");
  });
});

// ---------------------------------------------------------------------------
// §2  HTML emission — a WIRING-BEARING chain mounts too (Phase 2 finish, S301)
//
// These three used to pin the per-branch display-toggle wrapper. §17.1.1
// (SPEC.md:7533) says "only one span EXISTS in the DOM at any time" — a hidden
// wrapper exists, so the fallback violated the chain's own normative sentence,
// exactly as the standalone dirty path violated §17.1's. Both fell to the same
// discriminator (`isCleanIfNode` via `isCleanChainBranch`).
// ---------------------------------------------------------------------------

describe("§2: a chain whose branches carry wiring mounts them (N6-N8)", () => {
  test("N6: interpolation-bearing chain emits templates + markers, NO wrapper, NO display:none", () => {
    const { html } = compileToHtml(`<program>
      <p if=@show>Status: \${@status}</>
      <p else>Pending: \${@pending}</>
    </>`);
    expect((html.match(/<template id="[^"]+">/g) ?? []).length).toBe(2);
    expect((html.match(/<!--scrml-if-marker:[^-]+-->/g) ?? []).length).toBe(2);
    // The per-branch wrapper only ever existed to give the display toggle
    // something to hide.
    expect(html).not.toContain('data-scrml-chain-branch="');
    expect(html).not.toContain('style="display:none"');
  });

  test("N7: a wiring-bearing chain still has the single chain wrapper", () => {
    const { html } = compileToHtml(`<program>
      <p if=@show>\${@status}</>
      <p else>\${@pending}</>
    </>`);
    expect(html).toMatch(/<div data-scrml-if-chain="[^"]+">/);
  });

  test("N8: branch content survives the move INTO the template (interp placeholder intact)", () => {
    const { html } = compileToHtml(`<program>
      <p if=@show>X: \${@status}</>
      <p else>Y</>
    </>`);
    // The reactive interp placeholder rides inside the template, so it binds when
    // the branch mounts (via _scrml_mount_wire) rather than at boot.
    expect(html).toMatch(/<template id="[^"]+"><p>X: <span data-scrml-logic="/);
  });
});

// ---------------------------------------------------------------------------
// §3  HTML emission — MIXED branches all take the same path (N9-N12)
//
// The pre-S301 shape dispatched per branch: a wiring-free branch mounted, a
// wiring-bearing one hid. That made `if=` remove and `else-if=` hide IN THE SAME
// CHAIN — a difference an adopter's CSS and `:nth-child` can see, decided by
// whether they happened to put an interpolation in one arm.
// ---------------------------------------------------------------------------

describe("§3: mixed-wiring chains — every branch mounts (N9-N12)", () => {
  test("N9: wiring-free if + event-bearing else — BOTH get template+marker", () => {
    const { html } = compileToHtml(`<program>
      <h2 if=@editMode>Edit</>
      <button else onclick={@cancel}>Cancel</>
    </>`);
    expect((html.match(/<template id="[^"]+">/g) ?? []).length).toBe(2);
    expect((html.match(/<!--scrml-if-marker:[^-]+-->/g) ?? []).length).toBe(2);
    expect(html).not.toContain('data-scrml-chain-branch="');
  });

  test("N10: event-bearing if + wiring-free else — BOTH get template+marker", () => {
    const { html } = compileToHtml(`<program>
      <button if=@show onclick={@cancel}>Click</>
      <h2 else>Done</>
    </>`);
    expect((html.match(/<template id="[^"]+">/g) ?? []).length).toBe(2);
    expect((html.match(/<!--scrml-if-marker:[^-]+-->/g) ?? []).length).toBe(2);
    expect(html).not.toContain('data-scrml-chain-branch="');
  });

  test("N11: 3-branch mixed emits 3 templates + 3 markers and no wrapper", () => {
    const { html } = compileToHtml(`<program>
      <p if=@a>A</>
      <p else-if=@b>B</>
      <button else onclick={@cancel}>C</>
    </>`);
    expect((html.match(/<template id="[^"]+">/g) ?? []).length).toBe(3);
    expect((html.match(/<!--scrml-if-marker:[^-]+-->/g) ?? []).length).toBe(3);
    expect(html).not.toContain('data-scrml-chain-branch="');
  });

  test("N12: every branch's template+marker sits inside the single chain wrapper", () => {
    const { html } = compileToHtml(`<program>
      <h2 if=@editMode>Edit</>
      <button else onclick={@cancel}>Cancel</>
    </>`);
    // With no per-branch wrapper there is no nested </div>, so the chain wrapper's
    // own span is unambiguous and can be matched exactly.
    const inner = html.match(/<div data-scrml-if-chain="[^"]+">([\s\S]*?)<\/div>/);
    expect(inner).not.toBeNull();
    expect((inner[1].match(/<template id="/g) ?? []).length).toBe(2);
    expect((inner[1].match(/scrml-if-marker:/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §4  Registry binding shape (N13-N17)
// ---------------------------------------------------------------------------

describe("§4: registry LogicBinding shape per chain branch (N13-N17)", () => {
  test("N13: clean branch registers if-chain-branch with branchMode=mount + templateId + markerId", () => {
    const { registry } = compileToHtml(`<program>
      <h2 if=@a>A</>
      <h2 else>B</>
    </>`);
    const branches = registry.logicBindings.filter((b) => b.kind === "if-chain-branch");
    expect(branches.length).toBe(1);
    const branch = branches[0];
    expect(branch.branchMode).toBe("mount");
    expect(branch.templateId).toMatch(/^_scrml_scrml_chain_tpl_/);
    expect(branch.markerId).toMatch(/^_scrml_scrml_chain_marker_/);
    expect(branch.branchIndex).toBe(0);
  });

  test("N14: clean else registers if-chain-else with branchMode=mount + templateId + markerId", () => {
    const { registry } = compileToHtml(`<program>
      <h2 if=@a>A</>
      <h2 else>B</>
    </>`);
    const elseB = registry.logicBindings.find((b) => b.kind === "if-chain-else");
    expect(elseB).toBeDefined();
    expect(elseB.branchMode).toBe("mount");
    expect(elseB.templateId).toMatch(/^_scrml_scrml_chain_tpl_/);
    expect(elseB.markerId).toMatch(/^_scrml_scrml_chain_marker_/);
  });

  test("N15: a wiring-bearing branch ALSO registers branchMode=mount + templateId/markerId", () => {
    // Pre-S301 this asserted `branchMode: "display"` and the ABSENCE of a
    // templateId/markerId. `branchMode` is retained in the binding shape (the
    // controller still switches on it) but only ever carries "mount" now.
    const { registry } = compileToHtml(`<program>
      <p if=@show>Status: \${@status}</>
      <p else>Pending: \${@pending}</>
    </>`);
    const branch = registry.logicBindings.find((b) => b.kind === "if-chain-branch");
    expect(branch).toBeDefined();
    expect(branch.branchMode).toBe("mount");
    expect(branch.templateId).toBeDefined();
    expect(branch.markerId).toBeDefined();
    // No binding anywhere in the chain falls back to display mode.
    const display = registry.logicBindings.filter(
      (b) => (b.kind === "if-chain-branch" || b.kind === "if-chain-else") && b.branchMode === "display",
    );
    expect(display).toEqual([]);
  });

  test("N16: chainId is the same across all branches in one chain", () => {
    const { registry } = compileToHtml(`<program>
      <p if=@a>A</>
      <p else-if=@b>B</>
      <p else>C</>
    </>`);
    const chainBindings = registry.logicBindings.filter((b) => b.kind === "if-chain-branch" || b.kind === "if-chain-else");
    expect(chainBindings.length).toBe(3);
    const uniqueChainIds = new Set(chainBindings.map((b) => b.chainId));
    expect(uniqueChainIds.size).toBe(1);
  });

  test("N17: branchIndex on positive branches is 0..N-1; absent on else", () => {
    const { registry } = compileToHtml(`<program>
      <p if=@a>A</>
      <p else-if=@b>B</>
      <p else>C</>
    </>`);
    const positive = registry.logicBindings.filter((b) => b.kind === "if-chain-branch");
    const elseB = registry.logicBindings.find((b) => b.kind === "if-chain-else");
    expect(positive.map((b) => b.branchIndex)).toEqual([0, 1]);
    expect(elseB.branchIndex).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §5  Client JS controller shape — all-clean (N18-N22)
// ---------------------------------------------------------------------------

describe("§5: client JS controller for all-clean chains (N18-N22)", () => {
  test("N18: all-clean chain controller declares per-branch root + scope locals", () => {
    const { clientJs } = compileFull(`<program>
      <h2 if=@editMode>Edit</>
      <h2 else>Add</>
    </>`);
    expect(clientJs).toMatch(/let _scrml_chain__scrml_if_chain_1_b0_root = null;/);
    expect(clientJs).toMatch(/let _scrml_chain__scrml_if_chain_1_b0_scope = null;/);
    expect(clientJs).toMatch(/let _scrml_chain__scrml_if_chain_1_else_root = null;/);
    expect(clientJs).toMatch(/let _scrml_chain__scrml_if_chain_1_else_scope = null;/);
  });

  test("N19: all-clean chain controller mounts via _scrml_mount_template with markerId + templateId", () => {
    const { clientJs } = compileFull(`<program>
      <h2 if=@editMode>Edit</>
      <h2 else>Add</>
    </>`);
    expect(clientJs).toContain("_scrml_create_scope()");
    expect(clientJs).toContain("_scrml_mount_template(");
  });

  test("N20: all-clean chain controller unmounts via _scrml_unmount_scope on transition", () => {
    const { clientJs } = compileFull(`<program>
      <h2 if=@editMode>Edit</>
      <h2 else>Add</>
    </>`);
    expect(clientJs).toContain("_scrml_unmount_scope(");
  });

  test("N21: chain controller has idempotency guard (`if (_next === active) return`)", () => {
    const { clientJs } = compileFull(`<program>
      <h2 if=@editMode>Edit</>
      <h2 else>Add</>
    </>`);
    expect(clientJs).toMatch(/if \(_next === _scrml_chain_[a-zA-Z0-9_]+_active\) return;/);
  });

  test("N22: chain controller invokes _scrml_effect for reactive subscription", () => {
    const { clientJs } = compileFull(`<program>
      <h2 if=@editMode>Edit</>
      <h2 else>Add</>
    </>`);
    expect(clientJs).toMatch(/_scrml_effect\(_update_chain_/);
  });
});

// ---------------------------------------------------------------------------
// §6  Client JS controller shape — all-dirty (N23-N25)
// ---------------------------------------------------------------------------

describe("§6: client JS controller for a wiring-bearing chain (N23-N25)", () => {
  const DIRTY = `<program>
      <p if=@show>Status: \${@status}</>
      <p else>Pending: \${@pending}</>
    </>`;

  test("N23: the controller resolves each branch through _scrml_find_if_marker", () => {
    const { clientJs } = compileFull(DIRTY);
    expect(clientJs).toContain("_scrml_find_if_marker(");
    // The per-branch wrapper querySelector is gone with the wrapper itself.
    expect(clientJs).not.toContain("data-scrml-chain-branch=");
  });

  test("N24: the controller DOES call _scrml_mount_template / _scrml_unmount_scope", () => {
    const { clientJs } = compileFull(DIRTY);
    expect(clientJs).toContain("_scrml_mount_template(");
    expect(clientJs).toContain("_scrml_unmount_scope(");
    // …and re-binds the mounted branch's own wiring.
    expect(clientJs).toContain("_scrml_mount_wire(");
  });

  test("N25: the controller NEVER toggles wrapper.style.display", () => {
    const { clientJs } = compileFull(DIRTY);
    expect(clientJs).not.toContain("_wrapper.style.display");
    expect(clientJs).not.toContain('style.display = "none"');
  });
});

// ---------------------------------------------------------------------------
// §7  Client JS controller shape — mixed-cleanliness (N26-N28)
// ---------------------------------------------------------------------------

describe("§7: client JS controller for a mixed-wiring chain (N26-N28)", () => {
  const MIXED = `<program>
      <h2 if=@editMode>Edit</>
      <button else onclick={@cancel}>Cancel</>
    </>`;

  test("N26: BOTH branches take the mount arm — one uniform dispatch", () => {
    const { clientJs } = compileFull(MIXED);
    const mounts = (clientJs.match(/_scrml_mount_template\(/g) ?? []).length;
    expect(mounts).toBe(2);
    expect(clientJs).not.toContain("_wrapper.style.display");
  });

  test("N27: each branch gets its own root + scope local, and no wrapper lookup", () => {
    const { clientJs } = compileFull(MIXED);
    expect((clientJs.match(/_scrml_chain_[A-Za-z0-9_]+_root/g) ?? []).length).toBeGreaterThan(1);
    expect((clientJs.match(/_scrml_chain_[A-Za-z0-9_]+_scope/g) ?? []).length).toBeGreaterThan(1);
    expect(clientJs).not.toContain("_wrapper = (root || document).querySelector");
  });

  test("N28: the activate switch has ONLY mount arms (no display arm survives)", () => {
    const { clientJs } = compileFull(MIXED);
    expect(clientJs).toContain("_scrml_create_scope();");
    expect(clientJs).not.toMatch(/_wrapper\.style\.display = "";/);
  });
});

// ---------------------------------------------------------------------------
// §8  Round-trip through full pipeline (N29-N31)
// ---------------------------------------------------------------------------

describe("§8: round-trip through full pipeline (N29-N31)", () => {
  test("N29: clean chain emission yields valid JS (no syntax errors)", () => {
    // Smoke check: the emitted client module must be syntactically valid.
    // (navigate-wave1b M1 moved the chain controller into `_scrml_nav_rewire`, so
    // the old 2-space brace-parity extraction no longer bounds it — assert the
    // whole emitted body parses, which is the real invariant.)
    const { clientJs } = compileFull(`<program>
      <h2 if=@editMode>Edit</>
      <h2 else>Add</>
    </>`);
    expect(clientJs).toContain("_update_chain_");
    expect(() => new Function(clientJs.replace(/^\/\/ Requires:.*$/m, ""))).not.toThrow();
  });

  test("N30: condition cascade respects source order in chain controller", () => {
    const { clientJs } = compileFull(`<program>
      <p if=@a>A</>
      <p else-if=@b>B</>
      <p else>C</>
    </>`);
    const chainBlock = clientJs.match(/\/\/ if-chain:[\s\S]*?\n  \}/)?.[0] ?? "";
    const aIdx = chainBlock.indexOf('_scrml_cs_reactive_get("a")');
    const bIdx = chainBlock.indexOf('_scrml_cs_reactive_get("b")');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(bIdx);
  });

  test("N31: standalone if= (no chain) is unaffected — uses Phase 2c B1 single-`if=` shape", () => {
    // Standalone if= without an else sibling should NOT produce a chain
    // wrapper or chain controller. It should use Phase 2c B1 emission.
    const { html, clientJs } = compileFull(`<program>
      <h2 if=@solo>standalone</>
      <p>after</>
    </>`);
    expect(html).not.toContain("data-scrml-if-chain=");
    // Standalone clean if= still uses <template>+marker (Phase 2c B1).
    expect(html).toContain("<template");
    expect(html).toContain("scrml-if-marker");
    // No chain controller emitted.
    expect(clientJs).not.toContain("// if-chain:");
  });
});

// ---------------------------------------------------------------------------
// gate-found-invalid-js-fix-wave (S141 follow-on): an if=/else-if= chain whose
// branch conditions COMPARE against a variant literal (`@step == .Info` /
// `@step == Step::Info`) must lower the variant + ==/!= through the variant-
// aware emitter, NOT leave them RAW in the `_update_chain_*` cascade. Before
// the fix the cascade used the raw-string rewriteReactiveRefs shortcut, which
// left `.Info` / `Step::Info` + `==` verbatim -> E-CODEGEN-INVALID-LOGIC.
// (example 05-multi-step-form shipped invalid .client.js this way.)
// ---------------------------------------------------------------------------

describe("if-chain branch condition compares variant literal -> valid JS (gate fix-wave)", () => {
  const acorn = require("acorn");

  test("else-if=(@step == .Confirm) chain emits valid client.js (no raw `== .Confirm`)", () => {
    const { clientJs } = compileFull(`<program>
      \${
        type Step = .Info | .Confirm
        <step>: Step = .Info
      }
      <div class="wizard">
        <p if=(@step == .Info)>info</p>
        <p else-if=(@step == .Confirm)>confirm</p>
        <p else>done</p>
      </div>
    </>`);
    expect(clientJs.length).toBeGreaterThan(0);
    expect(() => acorn.parse(clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
    // The chain cascade must use the structural-eq lowering, not the raw literal.
    expect(clientJs).toContain("_update_chain_");
    expect(clientJs).toContain("_scrml_structural_eq");
    expect(clientJs).not.toContain("== .Confirm");
    expect(clientJs).not.toContain("== .Info");
  });
});
