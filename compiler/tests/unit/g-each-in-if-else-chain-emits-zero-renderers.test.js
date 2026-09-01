/**
 * g-each-in-if-else-chain-emits-zero-renderers.test.js
 *
 * Bug (HIGH, worse-than-silent): an `<each>` (or `<match>`) inside an `if=`
 * branch that has an `else`/`else-if=` sibling emitted ZERO renderer functions —
 * the list rendered permanently EMPTY at exit 0, and the dependency-graph fired
 * two FALSE `E-DG-002` "declared but never consumed" warnings on the guard cell
 * AND the each's iterable, whose only suggested remedy ("remove the unused
 * variable") would DELETE working source. Adding a single `<div else>` sibling
 * flipped render fns from N to 0.
 *
 * Root cause (one shared class across several hand-rolled walks): when an
 * `if=`/`else` chain has an `else`/`else-if=`, `collapseIfChains` (ast-builder.js)
 * replaces the plain `<div if=>` markup node with a NEW `if-chain` node whose
 * branch bodies live under `branches[].element` + `elseBranch` — NONE of the
 * `["children","body","bodyChildren","nodes","arms",...]` container keys the
 * specialized collectors recurse into. So the whole guarded subtree was invisible
 * to:
 *   - collectEachBlocks           (emit-each.ts)     → 0 each render fns
 *   - the arm-payload stamp walk  (emit-each.ts)     → missing arm-payload stamp
 *   - collectMatchBlocks          (emit-match.ts)    → match controller dropped
 *   - the match-arm id-stamp walk (emit-match.ts)
 *   - findEngineVarForType        (emit-match.ts)
 *   - sweepNodeForAtRefs          (dependency-graph.ts) → false E-DG-002
 * The single-branch `if=` (no else) passes the node through as plain markup, so
 * it never hit this — which is why the else sibling was the discriminator.
 *
 * Fix: each walk now descends `branches[].element` + `elseBranch` explicitly
 * (mirrors the existing if-chain descent in component-expander.ts + emit-client.ts
 * walkNodes). The branch `element` is the original markup node still carrying its
 * `if=`/`else-if=` attr, so the DG re-sweep also credits the predicate cell.
 *
 * VALUE-asserting (R26): compiles real .scrml end-to-end via compileScrml and
 * asserts emitted-JS shape + diagnostic set; a synthesized AST would bypass the
 * collapseIfChains restructure that is the actual locus.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { compileScrml } from "../../src/api.js";

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-if-else-each-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...r.outputs.values()][0] ?? {};
    return {
      clientJs: out.clientJs ?? "",
      errors: r.errors ?? [],
      warnings: r.warnings ?? [],
      lints: r.lintDiagnostics ?? [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const dg002 = (r) =>
  [...r.warnings, ...r.lints].filter((w) => (w.code || "").includes("DG-002"));
const dg002On = (r, cell) =>
  dg002(r).filter((w) => (w.message || "").includes("`@" + cell + "`")).length;
const renderFns = (cj) => (cj.match(/_scrml_each_render_/g) || []).length;

const PRELUDE = `type Todo:struct = { id: string, name: string }
type Phase:enum = { Loading, Browsing }
<open>: boolean = true
<phase>: Phase = .Browsing
<todos>: Todo[] = []`;

const P = (body) => `<program>\n${PRELUDE}\n${body}\n</program>\n`;

const EACH_BLOCK = `<div if=@open>
  <ul><each in=@todos key=@.id><li>\${@.name}</li></each></ul>
</div>`;
const ELSE_TAIL = `\n<div else><p>closed</p></div>`;
const ELSEIF_TAIL = `\n<div else-if=@open><p>mid</p></div>` + ELSE_TAIL;

const MATCH_BLOCK = `<div if=@open>
  <match for=Phase on=@phase>
    <Loading><p>loading</p></>
    <Browsing><ul><each in=@todos key=@.id><li>\${@.name}</li></each></ul></>
  </match>
</div>`;

function nodeCheckOk(clientJs) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-nc-"));
  try {
    const f = join(dir, "c.js");
    writeFileSync(f, clientJs);
    execFileSync("node", ["--check", f]);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("g-each-in-if-else-chain-emits-zero-renderers", () => {
  test("CONTROL: <each> under a lone if= emits its render fn (never regressed)", () => {
    const r = compileSource(P(EACH_BLOCK));
    expect(r.errors.length).toBe(0);
    expect(renderFns(r.clientJs)).toBeGreaterThan(0);
    expect(r.clientJs).toContain("_scrml_reconcile_list");
  });

  test("<each> inside if= WITH an <div else> sibling still emits its render fn", () => {
    const r = compileSource(P(EACH_BLOCK + ELSE_TAIL));
    expect(r.errors.length).toBe(0);
    // The bug: this was 0. The each subtree must survive the if-chain collapse.
    expect(renderFns(r.clientJs)).toBeGreaterThan(0);
    expect(r.clientJs).toContain("_scrml_reconcile_list");
  });

  test("<each> inside an else-if= chain still emits its render fn", () => {
    const r = compileSource(P(EACH_BLOCK + ELSEIF_TAIL));
    expect(r.errors.length).toBe(0);
    expect(renderFns(r.clientJs)).toBeGreaterThan(0);
  });

  test("no FALSE E-DG-002 on the guard cell or the each iterable under if/else", () => {
    const r = compileSource(P(EACH_BLOCK + ELSE_TAIL));
    // @open (the if= predicate) and @todos (the each iterable) are both consumed
    // inside the guarded branch — neither may be reported "declared but never
    // consumed". (@phase is genuinely unused here; we do not assert on it.)
    expect(dg002On(r, "open")).toBe(0);
    expect(dg002On(r, "todos")).toBe(0);
  });

  test("<match> inside if= WITH an <div else> sibling still emits its controller", () => {
    const alone = compileSource(P(MATCH_BLOCK));
    const withElse = compileSource(P(MATCH_BLOCK + ELSE_TAIL));
    expect(alone.errors.length).toBe(0);
    expect(withElse.errors.length).toBe(0);
    // The match controller + its arm-nested each both survive the else collapse.
    const ctl = (cj) => (cj.match(/_scrml_match|_scrml_variant|remount_match/g) || []).length;
    expect(ctl(alone.clientJs)).toBeGreaterThan(0);
    expect(ctl(withElse.clientJs)).toBe(ctl(alone.clientJs));
    expect(renderFns(withElse.clientJs)).toBeGreaterThan(0);
  });

  test("emitted client JS parses (node --check) for each + match under if/else", () => {
    expect(nodeCheckOk(compileSource(P(EACH_BLOCK + ELSE_TAIL)).clientJs)).toBe(true);
    expect(nodeCheckOk(compileSource(P(MATCH_BLOCK + ELSE_TAIL)).clientJs)).toBe(true);
  });
});
