/**
 * g-each-nested-markup-interp-stringifies — the TRANSITIVE residual (S361) | §1.4/§7.4 markup-as-value
 *
 * A nested `<each>` interp of a markup-returning fn call mounts the returned DOM
 * node via the `<span data-scrml-mv>` mount-or-text wrapper (GH #161). But the
 * detector `collectMarkupReturningFnNames` was DIRECT-only: a fn that returns
 * markup only TRANSITIVELY — `fn wrap(n){ return badge(n) }` where `badge`
 * returns markup — was not collected, so `${wrap(it.name)}` emitted
 * `textContent = String(wrap(...))` → `String(<a DOM node>)` = `[object
 * HTMLSpanElement]`. Silent, clean compile.
 *
 * FIX (S361): the collector runs a fixpoint over `fnBodyReturnsCallToMarkupFn`
 * (reusing the interp-site `interpMayYieldNode`) so a chain wrap2→wrap→badge
 * closes fully. Fail-safe: a string-returning fn is never collected (never
 * over-wrapped), and the emitted mount is `instanceof Node`-guarded regardless.
 * Same-file only — cross-file IMPORTED markup fns remain a documented residual.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const D = "$";
const TMP = join(tmpdir(), "scrml-each-transitive-markup");

function clientJs(src) {
  const dir = join(TMP, "case");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "app.scrml");
  writeFileSync(entry, src);
  const result = compileScrml({ inputFiles: [entry], write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  let js = null;
  for (const [fp, o] of result.outputs ?? new Map()) {
    if (fp.endsWith(".client.js")) { js = (o && o.clientJs) || (typeof o === "string" ? o : null); if (js) break; }
  }
  if (!js) for (const [, o] of result.outputs ?? new Map()) if (o && o.clientJs) { js = o.clientJs; break; }
  return { errors, js };
}

describe("g-each transitive markup fn — a nested interp of a transitively-markup fn mounts (not String())", () => {
  beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  test("transitive `fn wrap(n){ return badge(n) }` mounts via the instanceof-Node wrapper", () => {
    const src = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn badge(n: string) { return <span class="b">${D}{n}</span> }
fn wrap(n: string) { return badge(n) }
<ul>
  <each in=@rows as it key=it.id>
    <li>${D}{wrap(it.name)}</li>
  </each>
</ul>
</program>
`;
    const { errors, js } = clientJs(src);
    expect(errors).toEqual([]);
    expect(js).not.toBeNull();
    // the transitive call is mounted (instanceof Node guard), NOT stringified
    expect(js).toMatch(/const _scrml_mv_v_\d+ = \(\s*_scrml_wrap_\d+\s*\(/);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
    expect(js).not.toMatch(/textContent = String\(\s*_scrml_wrap_\d+\s*\(/);
  });

  test("a deeper chain wrap2→wrap→badge closes fully (fixpoint)", () => {
    const src = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn badge(n: string) { return <span class="b">${D}{n}</span> }
fn wrap(n: string) { return badge(n) }
fn wrap2(n: string) { return wrap(n) }
<ul>
  <each in=@rows as it key=it.id>
    <li>${D}{wrap2(it.name)}</li>
  </each>
</ul>
</program>
`;
    const { errors, js } = clientJs(src);
    expect(errors).toEqual([]);
    expect(js).toMatch(/_scrml_mv_v_\d+ instanceof Node/);
    expect(js).not.toMatch(/textContent = String\(\s*_scrml_wrap2_\d+\s*\(/);
  });

  test("fail-safe: a STRING-returning fn is NOT over-wrapped (stays a text node)", () => {
    const src = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn plain(n: string) { return "x-" + n }
<ul>
  <each in=@rows as it key=it.id>
    <li>${D}{plain(it.name)}</li>
  </each>
</ul>
</program>
`;
    const { errors, js } = clientJs(src);
    expect(errors).toEqual([]);
    // a string-returning call stays a bare text node — never mount-wrapped
    expect(js).toMatch(/textContent = String\(\s*_scrml_plain_\d+\s*\(/);
    expect(js).not.toMatch(/const _scrml_mv_v_\d+ = \(\s*_scrml_plain_\d+\s*\(/);
  });
});
