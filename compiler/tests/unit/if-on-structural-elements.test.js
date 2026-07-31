/**
 * §17.1.2 — `if=` on the three scrml-defined structural elements
 * (`<engine>`, `<match>`, `<each>`).
 *
 * THE DEFECT THIS PINS. Those three are not `kind:"markup"`. The block splitter
 * raw-captures them and `buildBlock` reconstructs each one by regexing NAMED
 * attributes out of the opener header (`for=`, `initial=`, `on=`, `in=`, `key=`,
 * `as`, …). An attribute nobody regexes for was DISCARDED — the node had no
 * `attrs` array to hold it. `if=` therefore parsed, vanished, and the compile
 * stayed green (exit 0, zero diagnostics) while the element rendered
 * unconditionally and PERMANENTLY: an `<engine … if=@shown>` shipped its
 * `initial=` arm with `@shown` false and never removed it.
 *
 * The corroborating canary, asserted below because it is what makes the bug
 * self-evident: all three ALSO emitted `E-DG-002 — reactive variable declared but
 * never consumed` for the condition cell. The dependency graph never saw the
 * predicate either.
 *
 * WHAT IS ASSERTED HERE
 *   §1  TAB capture      — `ifRaw` / `ifCond` survive the opener parse, in every
 *                          §5.2 value shape, on all three elements, on BOTH
 *                          match-block constructors, and are `null` when absent.
 *   §2  Masking          — an engine opener's own `effect=${ if (…) … }` body is
 *                          not mistaken for an opener `if=`.
 *   §3  Emission         — ONE lowering: `<template>` + `<!--scrml-if-marker:N-->`
 *                          + a mount-toggle controller, byte-shape identical to
 *                          the `if=` an ordinary HTML element gets.
 *   §4  Chunk gate       — the `ifmount` runtime chunk actually ships. A missed
 *                          gate is a green compile whose bundle dies at load.
 *   §5  No-op invariance — a structural element WITHOUT `if=` emits exactly what
 *                          it emitted before §17.1.2 (this is a WIDENING).
 *   §6  Scope fence     — the capture is exactly three elements wide.
 *   §7  Parity with the markup `if=` on the checks that are NOT about emission
 *                          (S239 fix round — see below).
 *
 * §7 EXISTS BECAUSE OF ONE REPEATED OMISSION. The premise of this whole change is
 * that a structural node has NO `attrs` array. Giving `ifCond` a home on the node
 * did not give it a route to the three consumers that were reading `attrs`, and
 * each miss was silent:
 *
 *   type-system `visitAttr`  -> no scope check. `if=@typo` compiled clean and the
 *                               construct never rendered; `if="yes"` compiled
 *                               clean and threw `yes is not defined` out of the
 *                               mount controller, killing boot for the WHOLE page.
 *   emit-html `refuseConditionalInDispatchedArm`
 *                            -> the dispatched-arm guard was markup-only, so a
 *                               `<each if=…>` in a `<match>` arm went from
 *                               rendering (main) to vanishing permanently.
 *   dependency-graph attr walk
 *                            -> credited from a private raw scan instead of the
 *                               shared handler.
 *
 * Each is now routed through the SAME function the markup path uses, and §7
 * asserts the PARITY rather than the individual behaviours — a parity assertion
 * cannot rot into "markup does X, structural does Y" the way two separate
 * expectations can.
 *
 * The DOM-level behaviour (removal vs hiding, the engine render-vs-lifecycle
 * split, fence-range teardown) is asserted by execution, not by shape:
 * `compiler/tests/browser/if-on-structural-elements.browser.test.js` and the
 * `control-flow/if-on-{engine,match,each}-*` conformance cases.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse `src` and collect every structural node, in document order. */
function structuralNodes(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-if-struct-"));
  const path = join(dir, "case.scrml");
  try {
    writeFileSync(path, src);
    const out = buildAST(splitBlocks(path, src));
    const ast = out.ast ?? out;
    const found = [];
    const seen = new Set();
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (seen.has(n)) return;
      seen.add(n);
      if (n.kind === "engine-decl" || n.kind === "match-block" || n.kind === "each-block") found.push(n);
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (v && typeof v === "object") walk(v);
      }
    };
    walk(ast.nodes ?? ast);
    return found;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Compile `src` end-to-end and return its emitted artifacts + diagnostics. */
function compile(src, baseName = "case") {
  const dir = mkdtempSync(join(tmpdir(), "scrml-if-struct-c-"));
  const path = join(dir, `${baseName}.scrml`);
  const outDir = join(dir, "out");
  try {
    writeFileSync(path, src);
    const result = compileScrml({ inputFiles: [path], outputDir: outDir, log: () => {} });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    const files = existsSync(outDir) ? readdirSync(outDir) : [];
    const runtimeName = files.find((f) => f.startsWith("scrml-runtime.")) ?? "";
    return {
      errorCodes: (result.errors ?? []).map((e) => e.code),
      warningCodes: (result.warnings ?? []).map((e) => e.code),
      html: read(join(outDir, `${baseName}.html`)),
      clientJs: read(join(outDir, `${baseName}.client.js`)),
      runtimeJs: runtimeName ? read(join(outDir, runtimeName)) : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Count `<!--scrml-if-marker:N-->` placeholders in emitted HTML. */
const markerCount = (html) => (html.match(/<!--scrml-if-marker:/g) ?? []).length;
/** Count `<template id="...">` wrappers in emitted HTML. */
const templateCount = (html) => (html.match(/<template id="/g) ?? []).length;

// ---------------------------------------------------------------------------
// Source fixtures. Every one is V5-strict: top-level `<x> = …` declarations,
// `@x` only inside `${ … }`.
// ---------------------------------------------------------------------------

const ENGINE = (opener) => `\${
    type Mode:enum = { Off, On }
    <shown> = false
}
<engine for=Mode initial=.Off${opener}>
    <Off rule=.On>
        <p id="arm-off">OFF</>
    </>
    <On rule=.Off>
        <p id="arm-on">ON</>
    </>
</>
<program>
<p id="cell">\${@mode}</>
<p id="gate">\${@shown}</>
</program>
`;

const MATCH = (opener) => `\${
    type Phase:enum = { Loading, Ready }
    <phase>: Phase = .Loading
    <shown> = false
}
<match for=Phase on=@phase${opener}>
    <Loading>
        <p id="arm-loading">loading</p>
    </>
    <Ready>
        <p id="arm-ready">ready</p>
    </>
</match>
<p id="gate">\${@shown}</>
`;

const EACH = (opener) => `\${
    <items> = [{ id: 1, label: "one" }]
    <shown> = false
}
<ul id="list">
    <each in=@items key=@.id as item${opener}>
        <li class="row">\${item.label}</li>
    </each>
</ul>
<p id="gate">\${@shown}</>
`;

// ---------------------------------------------------------------------------
// §1 — TAB capture
// ---------------------------------------------------------------------------

describe("§17.1.2 §1 — the `if=` predicate survives the structural opener parse", () => {
  const shapes = [
    ["engine-decl", ENGINE],
    ["match-block", MATCH],
    ["each-block", EACH],
  ];

  for (const [kind, src] of shapes) {
    test(`${kind}: bare \`if=@cell\` is captured as a variable-ref`, () => {
      const [node] = structuralNodes(src(" if=@shown"));
      expect(node.kind).toBe(kind);
      expect(node.ifRaw).toBe("@shown");
      expect(node.ifCond).toBeTruthy();
      expect(node.ifCond.kind).toBe("variable-ref");
      expect(node.ifCond.name).toBe("@shown");
    });

    test(`${kind}: NO \`if=\` leaves the keys ABSENT, not null`, () => {
      // Absence, not `null`, is the deliberate shape — and it is asserted rather
      // than assumed because it is load-bearing for the native-parser within-node
      // parity canary, which compares FIELD SETS. Null-stamping three keys on
      // every engine/match/each in the corpus registered as a divergence at the
      // ~2 nested-engine positions where live emits `text`/`comment` and native
      // emits an `engine-decl`; omitting keeps that pre-existing divergence at
      // its measured size instead of growing the allowlist to absorb a field
      // neither pipeline actually disagrees about. Every consumer tests
      // truthiness, so absent and null are indistinguishable downstream.
      const [node] = structuralNodes(src(""));
      expect(node.kind).toBe(kind);
      expect(node.ifRaw).toBeUndefined();
      expect(node.ifCond).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(node, "ifRaw")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(node, "ifCond")).toBe(false);
    });

    test(`${kind}: a parenthesised operator condition is captured as an \`expr\` with refs`, () => {
      // §17.1 — a bare operator condition is E-ATTR-UNQUOTED-OPERATOR; the
      // parenthesised form is the canonical one and must reach codegen with the
      // cells it reads enumerated, or the gate never re-evaluates.
      const [node] = structuralNodes(src(" if=(@shown == true)"));
      expect(node.ifRaw).toBe("(@shown == true)");
      expect(node.ifCond.kind).toBe("expr");
      expect(node.ifCond.refs).toContain("shown");
      expect(node.ifCond.exprNode).toBeTruthy();
    });

    test(`${kind}: a bare call condition is captured as a call-ref`, () => {
      const [node] = structuralNodes(src(" if=ready()"));
      expect(node.ifRaw).toBe("ready()");
      expect(node.ifCond.kind).toBe("call-ref");
      expect(node.ifCond.name).toBe("ready");
    });

    test(`${kind}: a dotted condition keeps the whole path`, () => {
      const [node] = structuralNodes(src(" if=@ui.open"));
      expect(node.ifRaw).toBe("@ui.open");
      expect(node.ifCond.kind).toBe("variable-ref");
      expect(node.ifCond.name).toBe("@ui.open");
    });
  }

  test("each-block: `if=` BEFORE the `as` bareword does not swallow it, and vice versa", () => {
    // `<each>`'s opener mixes `name=value` attributes with the bareword `as name`
    // form. The `if=` value scanner has to stop at BOTH boundaries.
    const before = structuralNodes(`\${
    <items> = []
    <shown> = false
}
<ul><each in=@items if=@shown key=@.id as item><li>\${item.id}</li></each></ul>
`)[0];
    expect(before.ifRaw).toBe("@shown");
    expect(before.asName).toBe("item");
    expect(before.inExprRaw).toBe("@items");
    expect(before.keyExprRaw).toBe("@.id");

    const after = structuralNodes(`\${
    <items> = []
    <shown> = false
}
<ul><each in=@items key=@.id as item if=@shown><li>\${item.id}</li></each></ul>
`)[0];
    expect(after.ifRaw).toBe("@shown");
    expect(after.asName).toBe("item");
    expect(after.inExprRaw).toBe("@items");
    expect(after.keyExprRaw).toBe("@.id");
  });

  test("`else-if=` is NOT mistaken for the opener's own `if=`", () => {
    // The name search requires a standalone `if` token, so the `-if=` tail of
    // `else-if=` must not match. (`else-if=` on a structural opener has no
    // meaning today; what matters is that it cannot masquerade as `if=`.)
    const [node] = structuralNodes(ENGINE(" else-if=@shown"));
    expect(node.ifRaw).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §2 — masking
// ---------------------------------------------------------------------------

describe("§17.1.2 §2 — the condition search is masked against opener sub-syntax", () => {
  test("an engine opener's own boot `effect=` body containing `if (…)` is not read as `if=`", () => {
    const src = `\${
    type Mode:enum = { Off, On }
    <n> = 0
}
<engine for=Mode initial=.Off effect=\${ if (@n > 1) { @n = 0 } }>
    <Off rule=.On><p id="arm-off">OFF</></>
    <On rule=.Off><p id="arm-on">ON</></>
</>
`;
    const [node] = structuralNodes(src);
    expect(node.kind).toBe("engine-decl");
    expect(node.ifRaw).toBeUndefined();
    expect(node.ifCond).toBeUndefined();
    // …and the opener effect itself still parsed.
    expect(node.openerEffect).toBeTruthy();
  });

  test("the word `if` inside a quoted attribute value is not read as `if=`", () => {
    const src = `\${
    type Phase:enum = { Loading, Ready }
    <phase>: Phase = .Loading
}
<match for=Phase on="@phase /* if= */">
    <Loading><p id="arm-loading">loading</p></>
    <Ready><p id="arm-ready">ready</p></>
</match>
`;
    const [node] = structuralNodes(src);
    expect(node.kind).toBe("match-block");
    expect(node.ifRaw).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §3 — emission: ONE lowering
// ---------------------------------------------------------------------------

describe("§17.1.2 §3 — all three route through the §17.1 template+marker lowering", () => {
  test("engine: the mount slot moves INSIDE an inert <template>, behind a marker", () => {
    const out = compile(ENGINE(" if=@shown"), "eng");
    expect(out.errorCodes).toEqual([]);
    expect(markerCount(out.html)).toBe(1);
    expect(templateCount(out.html)).toBe(1);
    // The engine mount slot — and therefore its initial arm — is inside the
    // template, not loose in the body. Before §17.1.2 it was loose and PERMANENT.
    expect(out.html).toMatch(/<template id="[^"]+"><div data-scrml-engine-mount="[^"]+">/);
    // The controller is the SAME one an `if=` on a <div> gets.
    expect(out.clientJs).toContain("_scrml_mount_template");
    expect(out.clientJs).toContain("_scrml_unmount_scope");
    expect(out.clientJs).toContain("if= mount/unmount controller");
  });

  test("match: the dispatch mount slot moves inside the <template>", () => {
    const out = compile(MATCH(" if=@shown"), "mat");
    expect(out.errorCodes).toEqual([]);
    expect(markerCount(out.html)).toBe(1);
    expect(out.html).toMatch(/<template id="[^"]+"><div data-scrml-match-mount="[^"]+">/);
    expect(out.clientJs).toContain("_scrml_mount_template");
  });

  test("each: the COMMENT FENCE moves inside the <template> — no element wrapper is invented", () => {
    // A wrapper element would be invalid inside <ul>/<tbody>/<select>, so the
    // gated <each> is the shape that exercises the mount primitive's node-RANGE
    // contract. Assert no wrapper was smuggled in.
    const out = compile(EACH(" if=@shown"), "eac");
    expect(out.errorCodes).toEqual([]);
    expect(markerCount(out.html)).toBe(1);
    expect(out.html).toMatch(/<template id="[^"]+"><!--scrml-each:[^>]+--><!--\/scrml-each:[^>]+--><\/template>/);
    expect(out.clientJs).toContain("_scrml_mount_template");
  });

  test("the emitted controller shape is identical to an ordinary element's `if=`", () => {
    // ONE lowering means the only difference between hosts is WHAT sits inside
    // the <template>. Compare the controller lines with the markup baseline.
    const markup = compile(`\${
    <shown> = false
}
<div id="panel" if=@shown><p id="inner">x</></div>
`, "mk");
    const engine = compile(ENGINE(" if=@shown"), "eng2");
    const controllerLines = (js) =>
      js.split("\n")
        .map((l) => l.trim())
        .filter((l) => l.includes("_scrml_mount_template") || l.includes("_scrml_unmount_scope") || l.includes("_scrml_mount_wire"))
        // strip the generated ids so only the SHAPE is compared
        .map((l) => l.replace(/_scrml_(if_marker|scrml_tpl|ifm|ifa|mr|ms|ifd|if_mount|if_unmount)_[A-Za-z0-9_]+/g, "ID"))
        .sort();
    expect(controllerLines(engine.clientJs)).toEqual(controllerLines(markup.clientJs));
  });

  test("the condition cell is credited as a reader — no E-DG-002 false-fire", () => {
    // The pre-fix canary: all three warned "`@shown` declared but never consumed".
    for (const [label, src] of [["engine", ENGINE(" if=@shown")], ["match", MATCH(" if=@shown")], ["each", EACH(" if=@shown")]]) {
      const out = compile(src, "dg");
      expect(`${label}:${out.errorCodes.join(",")}`).toBe(`${label}:`);
      expect(`${label}:${out.warningCodes.includes("E-DG-002")}`).toBe(`${label}:false`);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 — runtime-chunk gate
// ---------------------------------------------------------------------------

describe("§17.1.2 §4 — the `ifmount` runtime chunk actually ships", () => {
  // A missed chunk gate is the highest-blast-radius defect class in this
  // compiler: green compile, `node --check`-clean bundle, dead at load.
  for (const [label, src] of [["engine", ENGINE(" if=@shown")], ["match", MATCH(" if=@shown")], ["each", EACH(" if=@shown")]]) {
    test(`${label}: every helper the emitted controller calls is present in the runtime`, () => {
      const out = compile(src, "chunk");
      expect(out.errorCodes).toEqual([]);
      for (const fn of ["_scrml_find_if_marker", "_scrml_mount_template", "_scrml_unmount_scope", "_scrml_create_scope", "_scrml_mount_wire"]) {
        expect(`${label}/${fn}: ${out.runtimeJs.includes(`function ${fn}(`)}`).toBe(`${label}/${fn}: true`);
      }
    });
  }

  test("a gated <each> also ships the each-renderer registry it re-invokes on mount", () => {
    const out = compile(EACH(" if=@shown"), "chunk2");
    expect(out.runtimeJs).toContain("function _scrml_remount_each_fence(");
    expect(out.runtimeJs).toContain("_scrml_each_renderers");
  });
});

// ---------------------------------------------------------------------------
// §5 — no-op invariance (this is a WIDENING)
// ---------------------------------------------------------------------------

describe("§17.1.2 §5 — a structural element WITHOUT `if=` is untouched", () => {
  for (const [label, src] of [["engine", ENGINE("")], ["match", MATCH("")], ["each", EACH("")]]) {
    test(`${label}: emits no <template>, no marker, no mount controller`, () => {
      const out = compile(src, "noif");
      expect(out.errorCodes).toEqual([]);
      expect(markerCount(out.html)).toBe(0);
      expect(templateCount(out.html)).toBe(0);
      expect(out.clientJs).not.toContain("_scrml_mount_template");
      // …and the `ifmount` chunk is tree-shaken back out.
      expect(out.runtimeJs).not.toContain("function _scrml_mount_template(");
    });
  }

  test("engine: the mount slot is still emitted loose, exactly as before", () => {
    const out = compile(ENGINE(""), "noif2");
    expect(out.html).toMatch(/<div data-scrml-engine-mount="[^"]+">/);
    expect(out.html).not.toContain("<template");
  });
});

// ---------------------------------------------------------------------------
// §6 — the scope fence: the widening is EXACTLY three elements wide
// ---------------------------------------------------------------------------

describe("§17.1.2 §6 — the capture is exactly three elements wide", () => {
  // §17.1.2: "Every other scrml-defined structural element continues to REJECT
  // `if=` — <onTransition>, <onTimeout>, <onIdle>, <errors>, <channel>, <page>,
  // <auth>. … The widening is exactly three elements wide and SHALL NOT be
  // generalized to the registry."
  //
  // What THIS file owns is the CAPTURE half of that fence: the structural `if=`
  // capture must fire on those three openers and nowhere else. The DIAGNOSTIC
  // half — whether each of the other elements actually rejects `if=` — is a
  // pre-existing surface this dispatch did not touch and is measured, not
  // asserted, in its report.

  test("`<onTransition … if=…>` inside an engine BODY is an existing §51.0.H guard, not an opener gate", () => {
    // The single most dangerous false positive: `<onTransition to=.B if=(…)>` is
    // a RATIFIED transition guard (conformance `lifecycle/ontransition-once-if-
    // attrs`). The opener capture reads only the header slice the opener-end
    // finder produced, so a body `if=` can never reach it.
    const src = `\${
    type Mode:enum = { A, B }
    <over> = false
    <n> = 0
}
<engine for=Mode initial=.A>
    <A rule=.B>
        <onTransition to=.B if=(@over == false)>\${ @n = @n + 1 }</>
        <p id="arm-a">a</p>
    </>
    <B rule=.A><p id="arm-b">b</p></>
</>
`;
    const [node] = structuralNodes(src);
    expect(node.kind).toBe("engine-decl");
    expect(node.ifRaw).toBeUndefined();
    const out = compile(src, "guard");
    expect(out.errorCodes).toEqual([]);
    expect(markerCount(out.html)).toBe(0);
  });

  test("`<onTimeout … if=…>` / `<onIdle … if=…>` in an engine body do not set the opener gate", () => {
    const src = `\${
    type Mode:enum = { A, B }
    <shown> = false
}
<engine for=Mode initial=.A>
    <onIdle after=1000ms to=.B if=@shown/>
    <A rule=.B>
        <onTimeout after=1000ms to=.B if=@shown/>
        <p id="arm-a">a</p>
    </>
    <B rule=.A><p id="arm-b">b</p></>
</>
`;
    const [node] = structuralNodes(src);
    expect(node.ifRaw).toBeUndefined();
    expect(markerCount(compile(src, "hooks").html)).toBe(0);
  });

  test("a per-item `if=` on an `<each>` ROW is a different surface and stays on its own lowering", () => {
    // §17.1.2 gates the LIST; the per-item `if=` (#289's `_scrml_ifrow_apply`
    // path) gates a ROW. Both may appear at once, and the opener capture must see
    // only the opener's.
    const src = `\${
    <items> = [{ id: 1, ok: true }, { id: 2, ok: false }]
    <gate> = true
}
<ul id="list">
    <each in=@items key=@.id as item if=@gate>
        <li class="row" if=item.ok>\${item.id}</li>
    </each>
</ul>
`;
    const [node] = structuralNodes(src);
    expect(node.kind).toBe("each-block");
    expect(node.ifRaw).toBe("@gate");
    const out = compile(src, "both");
    expect(out.errorCodes).toEqual([]);
    // Exactly ONE list-level gate. The per-item gate uses the row-swap primitive,
    // which mints no `scrml-if-marker`.
    expect(markerCount(out.html)).toBe(1);
  });

  test("an `if=` on a NESTED structural element is captured on that element, not the outer one", () => {
    const src = `\${
    type Mode:enum = { A, B }
    <outer> = false
    <inner> = false
    <items> = []
}
<engine for=Mode initial=.A if=@outer>
    <A rule=.B>
        <ul id="list">
            <each in=@items key=@.id as item if=@inner><li class="row">\${item.id}</li></each>
        </ul>
    </>
    <B rule=.A><p id="arm-b">b</p></>
</>
`;
    const nodes = structuralNodes(src);
    const engine = nodes.find((n) => n.kind === "engine-decl");
    const each = nodes.find((n) => n.kind === "each-block");
    expect(engine.ifRaw).toBe("@outer");
    expect(each).toBeTruthy();
    expect(each.ifRaw).toBe("@inner");
  });
});

// ---------------------------------------------------------------------------
// §7 — parity with the markup `if=` on every check that is not about emission
// (S239 fix round)
// ---------------------------------------------------------------------------

/**
 * Compile the SAME condition on a markup host and on each structural host, and
 * compare the diagnostic sets. Asserting PARITY rather than a literal code list
 * is deliberate: it cannot rot into "markup does X, structural does Y", and it
 * keeps holding if the underlying check is later renamed or retuned.
 */
function diagnosticsFor(src) {
  const out = compile(src, "parity");
  return [...out.errorCodes, ...out.warningCodes]
    // Shape lints that depend on the HOST fixture, not on the predicate:
    // W-PROGRAM-* is about the file's root shape, and E-DG-002 counts differ
    // because the four fixtures necessarily declare and consume different cells
    // (an `<engine for=Mode>` needs a `Mode`, a `<match on=@phase>` needs a
    // `@phase`). DG crediting parity is asserted separately, on fixtures built
    // to be comparable — see the DG describe block below.
    .filter((c) => c !== "W-PROGRAM-001" && c !== "W-PROGRAM-SPA-INFERRED" && c !== "E-DG-002")
    .sort()
    .join(",");
}

const PARITY_DECLS = `\${
    type Mode:enum = { Off, On }
    type Phase:enum = { Loading, Ready }
    <phase>: Phase = .Loading
    <items> = [{ id: 1 }]
    <shown> = false
}`;

const HOSTS = {
  markup: (cond) => `${PARITY_DECLS}\n<div id="d" if=${cond}>x</div>\n<p id="keep">\${@shown}</p>\n`,
  engine: (cond) => `${PARITY_DECLS}\n<engine for=Mode initial=.Off if=${cond}>\n<Off rule=.On><p id="a">a</p></>\n<On rule=.Off><p id="b">b</p></>\n</>\n<program><p id="keep">\${@shown}</p></program>\n`,
  match: (cond) => `${PARITY_DECLS}\n<match for=Phase on=@phase if=${cond}>\n<Loading><p id="l">l</p></>\n<Ready><p id="r">r</p></>\n</match>\n<p id="keep">\${@shown}</p>\n`,
  each: (cond) => `${PARITY_DECLS}\n<ul id="l"><each in=@items key=@.id as it if=${cond}><li class="row">\${it.id}</li></each></ul>\n<p id="keep">\${@shown}</p>\n`,
};

describe("§17.1.2 §7 — the structural predicate is scope-checked exactly like a markup one", () => {
  // Each of these compiled CLEAN on the structural elements before the fix
  // round, which is strictly worse than being ignored: the construct silently
  // never rendered, and the quoted-bareword case threw `yes is not defined` out
  // of the mount controller at boot and took the whole page down with it.
  const BAD_CONDITIONS = {
    "an undeclared cell (`@nosuchcell`)": "@nosuchcell",
    "a bare literal (`true`)": "true",
    'a quoted bare word (`"yes"`)': '"yes"',
  };

  for (const [label, cond] of Object.entries(BAD_CONDITIONS)) {
    test(`${label} is rejected on ALL FOUR hosts, identically`, () => {
      const markup = diagnosticsFor(HOSTS.markup(cond));
      // The markup baseline must actually BE a rejection, or the parity
      // assertions below are vacuously satisfied by everything compiling clean.
      expect(markup).toContain("E-SCOPE-001");
      for (const host of ["engine", "match", "each"]) {
        expect(`${host}: ${diagnosticsFor(HOSTS[host](cond))}`).toBe(`${host}: ${markup}`);
      }
    });
  }

  test("a VALID condition still compiles clean on all four hosts", () => {
    // The other half of the parity claim — the check must not over-fire.
    for (const host of Object.keys(HOSTS)) {
      expect(`${host}: ${diagnosticsFor(HOSTS[host]("@shown"))}`).toBe(`${host}: `);
    }
  });

  test("an `<each>` opener condition CANNOT see the row variable", () => {
    // The opener predicate decides whether the list renders AT ALL, so it is
    // evaluated outside the per-item scope. Pre-fix this compiled clean and then
    // threw `Cannot read properties of undefined` at runtime.
    const out = compile(`\${
    <items> = [{ id: 1, ok: true }]
}
<ul id="l"><each in=@items key=@.id as item if=item.ok><li class="row">\${item.id}</li></each></ul>
`, "rowvar");
    expect(out.errorCodes).toContain("E-SCOPE-001");
  });

  test("the row variable IS still in scope inside the row template (the check is not over-wide)", () => {
    const out = compile(`\${
    <items> = [{ id: 1, ok: true }]
    <shown> = false
}
<ul id="l"><each in=@items key=@.id as item if=@shown><li class="row" if=item.ok>\${item.id}</li></each></ul>
`, "rowvar2");
    expect(out.errorCodes).toEqual([]);
  });
});

describe("§17.1.2 §7 — E-IF-IN-DISPATCHED-ARM covers the structural hosts too", () => {
  // REGRESSION GUARD, not merely a missing check. Before the fix round a
  // `<each … if=@shown>` inside a `<match>` arm rendered 2 rows on main and 0 on
  // this branch after an arm round-trip — working code went silently blank —
  // while the equivalent markup `<p if=@shown>` in the identical position was
  // refused at compile time by `2fbe6520`.
  const ARM_HOSTS = {
    "markup <p if=> in a <match> arm (the control)": `\${
    type P:enum = { Loading, Ready }
    <p>: P = .Ready
    <shown> = true
}
<match for=P on=@p>
    <Loading><p id="l">l</p></>
    <Ready><p id="gated" if=@shown>gated</p></>
</match>
`,
    "<each if=> in a <match> arm": `\${
    type P:enum = { Loading, Ready }
    <p>: P = .Ready
    <shown> = true
    <items> = [{ id: 1 }]
}
<match for=P on=@p>
    <Loading><p id="l">l</p></>
    <Ready><ul id="list"><each in=@items key=@.id as it if=@shown><li class="row">\${it.id}</li></each></ul></>
</match>
`,
    "<each if=> in an <engine> state child": `\${
    type M:enum = { A, B }
    <shown> = true
    <items> = [{ id: 1 }]
}
<engine for=M initial=.A>
    <A rule=.B><ul id="list"><each in=@items key=@.id as it if=@shown><li class="row">\${it.id}</li></each></ul></>
    <B rule=.A><p id="b">b</p></>
</>
`,
    "nested <match if=> in a <match> arm": `\${
    type P:enum = { Loading, Ready }
    type Q:enum = { X, Y }
    <p>: P = .Ready
    <q>: Q = .X
    <shown> = true
}
<match for=P on=@p>
    <Loading><p id="l">l</p></>
    <Ready><match for=Q on=@q if=@shown><X><p id="x">x</p></><Y><p id="y">y</p></></match></>
</match>
`,
  };

  for (const [label, src] of Object.entries(ARM_HOSTS)) {
    test(`${label} is refused at compile time`, () => {
      const out = compile(src, "arm");
      expect(`${label}: ${out.errorCodes.includes("E-IF-IN-DISPATCHED-ARM")}`).toBe(`${label}: true`);
    });
  }
});

describe("§17.1.2 §7 — the DG credits the structural predicate through the shared handler", () => {
  // The gate is a READ of every cell in its condition. Parity with markup is the
  // assertion, because the two used to be credited by DIFFERENT code: markup from
  // the parsed value, structural from a private raw scan that both read inside
  // string literals AND missed an `if=fn()` call-ref's transitive reads.
  const DG_DECLS = `\${
    <shown> = false
    <ghost> = 1
    <items> = [{ id: 1 }]
    function gate() { return @shown }
}`;
  const dgCount = (src) => compile(src, "dg2").warningCodes.filter((c) => c === "E-DG-002").length;

  for (const [label, cond] of Object.entries({
    "`@shown`": "@shown",
    '`(@shown and "@ghost" != "")`': '(@shown and "@ghost" != "")',
    "`gate()`": "gate()",
  })) {
    test(`${label}: markup and <each> credit identically`, () => {
      const markup = dgCount(`${DG_DECLS}\n<div id="d" if=${cond}>x</div>\n<ul id="l"><each in=@items key=@.id as it><li class="row">\${it.id}</li></each></ul>\n`);
      const each = dgCount(`${DG_DECLS}\n<div id="d">x</div>\n<ul id="l"><each in=@items key=@.id as it if=${cond}><li class="row">\${it.id}</li></each></ul>\n`);
      expect(`each:${each}`).toBe(`each:${markup}`);
    });
  }

  test("a cell consumed ONLY by a structural gate is not reported unconsumed", () => {
    const out = compile(`\${
    <items> = [{ id: 1 }]
    <shown> = false
}
<ul id="l"><each in=@items key=@.id as it if=@shown><li class="row">\${it.id}</li></each></ul>
`, "dg3");
    expect(out.warningCodes).not.toContain("E-DG-002");
  });
});
