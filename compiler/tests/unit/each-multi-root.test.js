/**
 * each-multi-root — adopter issue #141.
 *
 * An `<each>` body with MORE THAN ONE root element per item used to render only
 * the FIRST root: every root was built and wired into `_itemFrag`, then
 * `return _itemFrag.firstChild;` threw the rest away. Clean build, exit 0, no
 * diagnostic. Same truncation on the Tier-0 `for … lift` path
 * (`return <tmp>.firstChild;`).
 *
 * This is CONFORMANCE RESTORATION, not a widening — two normative sentences
 * already grant N roots:
 *   SPEC §10.8   — "In accumulation mode, `lift` MAY appear multiple times in a
 *                   single logic block; each call appends one item."
 *   SPEC §17.7.2 — "The body of `<each>` SHALL contain at least one per-item
 *                   template element OR the `<empty>` sub-element (or both)."
 *
 * The fix has two halves:
 *   CODEGEN  — the per-item root count is read off the emission. N === 1 stays
 *              `return _itemFrag.firstChild;` BYTE-IDENTICAL; N > 1 returns the
 *              DocumentFragment.
 *   RUNTIME  — `_scrml_reconcile_list`'s createFn may return a Node (unchanged)
 *              or a DocumentFragment; the reconciler owns a node GROUP per key
 *              (key stamped on every top-level node, `_scrml_group_member` on the
 *              non-heads, `_scrml_group` on the head) so insert / remove /
 *              LIS-reorder move a whole run together, in both container modes.
 *
 * PRESERVED, deliberately: a create-time `if=` root is decided ONCE at create
 * time (emit-each.ts ~:860). A reused group does not gain or lose roots on later
 * reconciles. That limitation predates this change and is out of its scope.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

if (!globalThis.document) GlobalRegistrator.register();

function compileToOutputs(source, suffix = "eachmulti") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Compile, load the emitted HTML + client JS into happy-dom, and RUN it. */
function compileAndLoad(source, suffix) {
  const { errors, clientJs, html } = compileToOutputs(source, suffix);
  if (errors.length > 0) {
    throw new Error(`compile errors: ${errors.map((e) => e.code + ": " + e.message).join(", ")}`);
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const code =
    `(function() {\n${SCRML_RUNTIME}\n${clientJs}\n` +
    `window._scrml_reactive_get = _scrml_reactive_get;\n` +
    `window._scrml_reactive_set = _scrml_reactive_set;\n` +
    `})();`;
  // eslint-disable-next-line no-eval
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return {
    clientJs,
    get: (n) => window._scrml_reactive_get(n),
    set: (n, v) => window._scrml_reactive_set(n, v),
    texts: (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent),
    count: (sel) => document.querySelectorAll(sel).length,
  };
}

/** The DOM order of every element matching `sel`, as `class:text` strings. */
function orderOf(rootSel) {
  const root = document.querySelector(rootSel);
  return [...root.children].map((e) => `${e.className}:${e.textContent}`);
}

const ROWS = `[
      { id: 1, label: "a" },
      { id: 2, label: "b" },
      { id: 3, label: "c" },
      { id: 4, label: "d" },
    ]`;

// ---------------------------------------------------------------------------
// §1 — Codegen shape: the fragment form fires ONLY when N > 1
// ---------------------------------------------------------------------------

describe("each-multi-root §1 — codegen root-count gate", () => {
  test("single-root each still emits `return _itemFrag.firstChild;` (byte-level regression)", () => {
    const src = `\${
  <rows> = ${ROWS}
}
<div class="one">
  <each in=@rows as r key=@.id>
    <div class="only">\${r.label}</div>
  </each>
</div>
`;
    const { errors, clientJs } = compileToOutputs(src, "one-root");
    expect(errors).toEqual([]);
    expect(clientJs).toContain("return _itemFrag.firstChild;");
    expect(clientJs).not.toContain("return _itemFrag;");
  });

  test("2-root each emits `return _itemFrag;`", () => {
    const src = `\${
  <rows> = ${ROWS}
}
<div class="two">
  <each in=@rows as r key=@.id>
    <div class="hdr">H\${r.label}</div>
    <div class="row">R\${r.label}</div>
  </each>
</div>
`;
    const { errors, clientJs } = compileToOutputs(src, "two-root");
    expect(errors).toEqual([]);
    expect(clientJs).toContain("return _itemFrag;");
    expect(clientJs).not.toContain("return _itemFrag.firstChild;");
  });

  test("3-root each emits `return _itemFrag;`", () => {
    const src = `\${
  <rows> = ${ROWS}
}
<div class="three">
  <each in=@rows as r key=@.id>
    <div class="t1">1\${r.label}</div>
    <div class="t2">2\${r.label}</div>
    <div class="t3">3\${r.label}</div>
  </each>
</div>
`;
    const { errors, clientJs } = compileToOutputs(src, "three-root");
    expect(errors).toEqual([]);
    expect(clientJs).toContain("return _itemFrag;");
  });

  test("SHADOWING: a single-root OUTER each holding a nested each keeps `.firstChild` (byte-identity guard)", () => {
    // A nested <each> emits its own per-item factory INLINE, declaring its own
    // `const _itemFrag` — the same literal name, shadowed. Counting bare
    // `_itemFrag.appendChild(` occurrences mis-read this outer each as
    // multi-root; the corpus byte-identity gate caught it on
    // examples/25-triage-board.scrml. Both forms must appear, each on its own
    // factory: outer `.firstChild` (1 root), inner fragment (2 roots).
    const src = `\${
  <groups> = [ { id: 1, items: [ { id: 11, t: "x" } ] } ]
}
<div class="outer">
  <each in=@groups as g key=@.id>
    <section class="grp">
      <each in=g.items as it key=@.id>
        <span class="ia">A\${it.t}</span>
        <span class="ib">B\${it.t}</span>
      </each>
    </section>
  </each>
</div>
`;
    const { errors, clientJs } = compileToOutputs(src, "shadow-guard");
    expect(errors).toEqual([]);
    expect(clientJs).toContain("return _itemFrag.firstChild;");
    expect(clientJs).toContain("return _itemFrag;");
    // Exactly one of each — the outer factory and the inner factory.
    expect(clientJs.split("return _itemFrag.firstChild;").length - 1).toBe(1);
    expect(clientJs.split("return _itemFrag;").length - 1).toBe(1);
  });

  test("SHADOWING: a multi-root OUTER each holding a single-root nested each keeps both forms straight", () => {
    const src = `\${
  <groups> = [ { id: 1, name: "g", items: [ { id: 11, t: "x" } ] } ]
}
<div class="outer">
  <each in=@groups as g key=@.id>
    <h3 class="ghdr">\${g.name}</h3>
    <section class="grp">
      <each in=g.items as it key=@.id>
        <span class="ia">A\${it.t}</span>
      </each>
    </section>
  </each>
</div>
`;
    const { errors, clientJs } = compileToOutputs(src, "shadow-guard-2");
    expect(errors).toEqual([]);
    // outer = 2 roots (fragment); inner = 1 root (firstChild).
    expect(clientJs.split("return _itemFrag;").length - 1).toBe(1);
    expect(clientJs.split("return _itemFrag.firstChild;").length - 1).toBe(1);
    const api = compileAndLoad(src, "shadow-guard-2-run");
    expect(api.count(".ghdr")).toBe(1);
    expect(api.count(".grp")).toBe(1);
    expect(api.count(".ia")).toBe(1);
  });

  test("PRESERVED: a conditional (`if=`) root counts toward N and stays a CREATE-TIME decision", () => {
    // emit-each.ts ~:860 gates the append on the predicate at CREATE time only.
    // A reused group does not gain or lose roots on later reconciles — that
    // limitation predates #141 and is deliberately NOT changed here. The
    // fragment form composes with it correctly: the fragment carries however
    // many roots actually got appended, and a 1-node fragment behaves exactly
    // like the single-Node return.
    const src = `\${
  <rows> = [ { id: 1, label: "a", flag: true }, { id: 2, label: "b", flag: false } ]
}
<div class="cond">
  <each in=@rows as r key=@.id>
    <div class="always">A\${r.label}</div>
    <div class="maybe" if=r.flag>M\${r.label}</div>
  </each>
</div>
`;
    const { errors, clientJs } = compileToOutputs(src, "if-root");
    expect(errors).toEqual([]);
    expect(clientJs).toContain("return _itemFrag;");
    // The conditional append is still gated, and still emitted at create time.
    expect(clientJs).toMatch(/if \(r\.flag\) _itemFrag\.appendChild\(/);
    const api = compileAndLoad(src, "if-root-run");
    expect(api.count(".always")).toBe(2);
    expect(api.count(".maybe")).toBe(1);
  });

  test("Tier-0 multi-`lift` (SPEC §10.8) no longer returns `.firstChild`", () => {
    const src = `<div class="wrap">\${
  <rows> = ${ROWS}

  for (let r of @rows) {
    lift <div class="lhdr">
      <span>H\${r.label}</span>
    </div>
    lift <div class="lrow">
      <span>R\${r.label}</span>
    </div>
  }
}</>
`;
    const { errors, clientJs } = compileToOutputs(src, "lift-multi");
    expect(errors).toEqual([]);
    // The reconcile item factory returns the fragment, not its first child.
    expect(clientJs).toMatch(/return _scrml_tmp_\d+;/);
    expect(clientJs).not.toMatch(/return _scrml_tmp_\d+\.firstChild;/);
  });
});

// ---------------------------------------------------------------------------
// §2 — The issue #141 repro, EXECUTED (emitted ≠ runs)
// ---------------------------------------------------------------------------

describe("each-multi-root §2 — issue #141 repro executes and renders every root", () => {
  const src = `\${
  <rows> = ${ROWS}
}
<div class="keyed">
  <each in=@rows as r key=@.id>
    <div class="hdr">H\${r.label}</div>
    <div class="row">R\${r.label}</div>
  </each>
</div>
<div class="unkeyed">
  <each in=@rows as r>
    <div class="uhdr">H\${r.label}</div>
    <div class="urow">R\${r.label}</div>
  </each>
</div>
<div class="triple">
  <each in=@rows as r key=@.id>
    <div class="t1">1\${r.label}</div>
    <div class="t2">2\${r.label}</div>
    <div class="t3">3\${r.label}</div>
  </each>
</div>
`;

  test("keyed 2-root: 4 .hdr AND 4 .row (was 4 and 0)", () => {
    const api = compileAndLoad(src, "i141-keyed");
    expect(api.count(".hdr")).toBe(4);
    expect(api.count(".row")).toBe(4);
  });

  test("unkeyed 2-root: 4 .uhdr AND 4 .urow (was 4 and 0)", () => {
    const api = compileAndLoad(src, "i141-unkeyed");
    expect(api.count(".uhdr")).toBe(4);
    expect(api.count(".urow")).toBe(4);
  });

  test("3-root: 4 each of .t1/.t2/.t3 (was 4 / 0 / 0)", () => {
    const api = compileAndLoad(src, "i141-triple");
    expect(api.count(".t1")).toBe(4);
    expect(api.count(".t2")).toBe(4);
    expect(api.count(".t3")).toBe(4);
  });

  test("roots interleave per item — group order is hdr,row,hdr,row,… not all-hdr-then-all-row", () => {
    compileAndLoad(src, "i141-order");
    expect(orderOf(".keyed")).toEqual([
      "hdr:Ha", "row:Ra",
      "hdr:Hb", "row:Rb",
      "hdr:Hc", "row:Rc",
      "hdr:Hd", "row:Rd",
    ]);
  });
});

// ---------------------------------------------------------------------------
// §3 — Reconcile: reorder / insert / remove move the whole GROUP
// ---------------------------------------------------------------------------

describe("each-multi-root §3 — reconcile keeps groups intact", () => {
  const src = `\${
  <rows> = ${ROWS}
}
<div class="keyed">
  <each in=@rows as r key=@.id>
    <div class="hdr">H\${r.label}</div>
    <div class="row">R\${r.label}</div>
  </each>
</div>
`;

  test("reorder (reverse) moves each item's two roots together, in order", () => {
    const api = compileAndLoad(src, "reorder");
    expect(orderOf(".keyed").length).toBe(8);
    api.set("rows", [
      { id: 4, label: "d" },
      { id: 3, label: "c" },
      { id: 2, label: "b" },
      { id: 1, label: "a" },
    ]);
    expect(orderOf(".keyed")).toEqual([
      "hdr:Hd", "row:Rd",
      "hdr:Hc", "row:Rc",
      "hdr:Hb", "row:Rb",
      "hdr:Ha", "row:Ra",
    ]);
  });

  test("insert in the middle places the new group between the neighbours", () => {
    const api = compileAndLoad(src, "insert");
    api.set("rows", [
      { id: 1, label: "a" },
      { id: 2, label: "b" },
      { id: 9, label: "z" },
      { id: 3, label: "c" },
      { id: 4, label: "d" },
    ]);
    expect(api.count(".hdr")).toBe(5);
    expect(api.count(".row")).toBe(5);
    expect(orderOf(".keyed")).toEqual([
      "hdr:Ha", "row:Ra",
      "hdr:Hb", "row:Rb",
      "hdr:Hz", "row:Rz",
      "hdr:Hc", "row:Rc",
      "hdr:Hd", "row:Rd",
    ]);
  });

  test("remove drops ALL roots of the removed item — no orphan second root", () => {
    const api = compileAndLoad(src, "remove");
    api.set("rows", [
      { id: 1, label: "a" },
      { id: 4, label: "d" },
    ]);
    expect(api.count(".hdr")).toBe(2);
    expect(api.count(".row")).toBe(2);
    expect(orderOf(".keyed")).toEqual(["hdr:Ha", "row:Ra", "hdr:Hd", "row:Rd"]);
  });

  test("clear to empty removes every root", () => {
    const api = compileAndLoad(src, "clear");
    api.set("rows", []);
    expect(api.count(".hdr")).toBe(0);
    expect(api.count(".row")).toBe(0);
  });

  test("single-root each still reorders correctly (regression)", () => {
    const one = `\${
  <rows> = ${ROWS}
}
<div class="one">
  <each in=@rows as r key=@.id>
    <div class="only">\${r.label}</div>
  </each>
</div>
`;
    const api = compileAndLoad(one, "one-reorder");
    expect(api.count(".only")).toBe(4);
    api.set("rows", [
      { id: 3, label: "c" },
      { id: 1, label: "a" },
      { id: 4, label: "d" },
      { id: 2, label: "b" },
    ]);
    expect(orderOf(".one")).toEqual(["only:c", "only:a", "only:d", "only:b"]);
  });
});

// ---------------------------------------------------------------------------
// §4 — <each of=N>, <empty>, and nested <each>
// ---------------------------------------------------------------------------

describe("each-multi-root §4 — of= / <empty> / nested", () => {
  test("<each of=3> with 2 roots renders 3 groups = 6 nodes", () => {
    const src = `<div class="ofn">
  <each of=3 as i>
    <div class="oa">A\${i}</div>
    <div class="ob">B\${i}</div>
  </each>
</div>
`;
    const api = compileAndLoad(src, "of-multi");
    expect(api.count(".oa")).toBe(3);
    expect(api.count(".ob")).toBe(3);
    expect(orderOf(".ofn").length).toBe(6);
  });

  test("<empty> + multi-root: empty state renders the fallback, then the empty→non-empty edge renders every root", () => {
    const src = `\${
  <rows> = []
}
<div class="withempty">
  <each in=@rows as r key=@.id>
    <div class="hdr">H\${r.label}</div>
    <div class="row">R\${r.label}</div>
    <empty><p class="none">nothing</p></empty>
  </each>
</div>
`;
    const api = compileAndLoad(src, "empty-multi");
    expect(api.count(".none")).toBe(1);
    expect(api.count(".hdr")).toBe(0);
    api.set("rows", [
      { id: 1, label: "a" },
      { id: 2, label: "b" },
    ]);
    // The <empty> fallback is cleared and BOTH roots of BOTH items render.
    expect(api.count(".none")).toBe(0);
    expect(api.count(".hdr")).toBe(2);
    expect(api.count(".row")).toBe(2);
    expect(orderOf(".withempty")).toEqual(["hdr:Ha", "row:Ra", "hdr:Hb", "row:Rb"]);
  });

  test("nested <each> with a multi-root inner body renders every inner root", () => {
    const src = `\${
  <groups> = [
    { id: 1, name: "g1", items: [ { id: 11, t: "x" }, { id: 12, t: "y" } ] },
    { id: 2, name: "g2", items: [ { id: 21, t: "z" } ] },
  ]
}
<div class="outer">
  <each in=@groups as g key=@.id>
    <section class="grp">
      <each in=g.items as it key=@.id>
        <span class="ia">A\${it.t}</span>
        <span class="ib">B\${it.t}</span>
      </each>
    </section>
  </each>
</div>
`;
    const api = compileAndLoad(src, "nested-multi");
    expect(api.count(".grp")).toBe(2);
    expect(api.count(".ia")).toBe(3);
    expect(api.count(".ib")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §5 — Tier-0 `for … lift`, EXECUTED
// ---------------------------------------------------------------------------

describe("each-multi-root §5 — Tier-0 multi-`lift` executes", () => {
  test("two `lift`s per iteration render both roots per item (SPEC §10.8)", () => {
    const src = `<div class="wrap">\${
  <rows> = ${ROWS}

  for (let r of @rows) {
    lift <div class="lhdr">
      <span>H\${r.label}</span>
    </div>
    lift <div class="lrow">
      <span>R\${r.label}</span>
    </div>
  }
}</>
`;
    const api = compileAndLoad(src, "lift-run");
    expect(api.count(".lhdr")).toBe(4);
    expect(api.count(".lrow")).toBe(4);
  });
});
