/**
 * g-each-value-form-if-markup-fn-call-branch-stringifies.test.js
 *
 * Bug (MED, silent-wrong): a §17.6 value-form `if` inside an `<each>` interp whose
 * branch CALLS a markup-returning fn rendered `[object HTMLSpanElement]` — the
 * each-interp emitter picked the String() text-node path. The IDENTICAL ternary
 * (`${cond ? badge(a) : badge(b)}`) correctly MOUNTED the returned node. (A
 * worsening introduced by #670; pre-#670 the same source rendered EMPTY.)
 *
 * Root: the each-interp markupCapable discriminant reads `interpExprNode`
 * (emit-each.ts). A value-form `if` is an `if-stmt` carrying no `exprNode`, so
 * interpExprNode stayed null and `interpMayYieldNode(null, …)` → false → text
 * path. The value already lowers to the same ternary string as the twin ternary
 * (via `_eachValueFormIfRaw`); only the discriminant was starved.
 *
 * Fix: (1) set interpExprNode = the if-stmt for the value-form-if case; (2) teach
 * `interpMayYieldNode` (markup-return-scan.js) to recurse an if-stmt's branch
 * bodies (bare-expr exprNode; alternate may be a nested if-stmt for else-if). A
 * value-form-if whose branch calls a markup fn now routes to the mount path,
 * exactly like the ternary; a NON-markup value-form-if returns false → text path,
 * byte-identical to before.
 *
 * VALUE-asserting (R26): compiles real .scrml and asserts emitted-JS shape.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { compileScrml } from "../../src/api.js";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-vfif-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...r.outputs.values()][0] ?? {};
    return { clientJs: out.clientJs ?? "", errors: r.errors ?? [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HEAD = `type Row:struct = { id: string, name: string }
<rows>: Row[] = [{ id: "1", name: "alpha" }]
fn badge(n: string) { return <span class="b">\${n}</span> }`;

const mountsNode = (cj) => /instanceof\s+Node/.test(cj) && /_scrml_each_mv_/.test(cj);
const stringifiesInto = (cj, name) =>
  new RegExp(`_scrml_each_tn_\\d+\\.textContent\\s*=\\s*String\\([^;]*${name}`).test(cj);

function nodeCheckOk(clientJs) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-nc-"));
  try {
    const f = join(dir, "c.js");
    writeFileSync(f, clientJs);
    execFileSync("node", ["--check", f]);
    return true;
  } catch { return false; } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("g-each-value-form-if-markup-fn-call-branch-stringifies", () => {
  test("value-form-if branch calling a markup fn MOUNTS the node (not String())", () => {
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li>\${ if (it.name) { badge(it.name) } else { badge("x") } }</li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsNode(r.clientJs)).toBe(true);
    expect(stringifiesInto(r.clientJs, "badge")).toBe(false);
  });

  test("CONTROL: the twin ternary mounts the node (never regressed)", () => {
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li>\${ it.name ? badge(it.name) : badge("x") }</li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsNode(r.clientJs)).toBe(true);
  });

  test("else-if cascade with a markup fn branch mounts", () => {
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li>\${ if (it.name) { badge(it.name) } else if (it.id) { badge(it.id) } else { badge("z") } }</li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    expect(mountsNode(r.clientJs)).toBe(true);
  });

  test("NO REGRESSION: a NON-markup value-form-if stays on the text path", () => {
    const r = compile(`<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = [{ id: "1", name: "alpha" }]
<ul><each in=@rows as it key=it.id>
  <li>\${ if (it.name) { it.name } else { "none" } }</li>
</each></ul>
</program>`);
    expect(r.errors.length).toBe(0);
    // string branches → no markup-mount path; renders as a text node.
    expect(/_scrml_each_mv_/.test(r.clientJs)).toBe(false);
  });

  test("emitted client JS parses (node --check)", () => {
    const r = compile(`<program>
${HEAD}
<ul><each in=@rows as it key=it.id>
  <li>\${ if (it.name) { badge(it.name) } else { badge("x") } }</li>
</each></ul>
</program>`);
    expect(nodeCheckOk(r.clientJs)).toBe(true);
  });
});
