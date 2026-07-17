// i81 — Reactive VALUE attribute wiring outside `<each>`
//
// Regression suite for issue #81 (filed by adopter app pjoliver11/assetManagement).
//
// THE DEFECT: the `val.kind === "expr"` attribute dispatch chain in emit-html.ts
// ran if/show -> on* -> REACTIVE_BOOL_ATTRS and then ENDED WITH NO FINAL `else`.
// A dynamic VALUE attribute (`class=`, `style=`, `title=`, `data-*`, `id=`, …)
// therefore matched NO branch: nothing was pushed to `parts` and the attribute
// vanished from the emitted HTML. SILENTLY — clean compile, 0 diagnostics, and
// the CSS written against those classes became dead code that reviewed as
// correct. Inside `<each>` every one of them wired, because emit-each.ts builds
// elements imperatively and calls setAttribute directly; only the non-`<each>`
// static-HTML + wiring-pass path was affected.
//
// Note the sibling file reactive-bool-attrs.test.js, whose header records that
// pre-S105 ALL kind:"expr" attrs other than if/show/on* were dropped. S105 B1
// fixed exactly three names (disabled/readonly/required) via a REACTIVE_BOOL_ATTRS
// allowlist and left the general value case dropped. This suite covers that gap.
//
// SEMANTICS UNDER TEST (SPEC §42.1.1 + §42.9) — absence-driven, NOT truthiness:
//   `not` -> JS `null` (§42.9)        -> removeAttribute
//   `""` / `0` / `false` / `[]`       -> DEFINED values (§42.1.1) -> setAttribute
// §42.1.1 declares treating ""/0/false/[] as absence a SEMANTIC ERROR, so the
// bool path's truthiness test is deliberately NOT mirrored here: a bool attr
// toggles PRESENCE, a value attr sets a STRING.

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import * as acorn from "acorn";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compile(scrmlSource, testName) {
  const tag = testName ?? `i81-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_i81_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    let html = null;
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        html = output.html ?? null;
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], html, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const emittedHtml = (r) => r.html ?? "";
const emittedClient = (r) => r.clientJs ?? "";
// compileScrml returns errors and warnings SEPARATELY — a severity:"warning"
// CGError lands in `warnings`, never in `errors`.
const diagCodes = (r) => [...r.errors, ...r.warnings].map((e) => e.code ?? "");

// ---------------------------------------------------------------------------
// S239 — the EVALUATION bar.
//
// The first cut of this suite asserted only that wires were EMITTED, and stayed
// 100% green through 8 real correctness bugs: a ReferenceError that killed all
// page wiring, a client bundle that was a SyntaxError, a Promise stringified into
// the DOM. Emission proves nothing about evaluation.
//
// It is worse than it looks: `compileScrml({ write: false })` — which every
// codegen unit test uses — SKIPS the S141 emitted-JS acorn gate, because
// api.js:2576 nests it inside `if (write && outputDir)`. So `r.errors` is
// STRUCTURALLY BLIND to codegen validity: it is `[]` while the bundle is a
// SyntaxError. `expect(r.errors).toEqual([])` is NOT a validity assertion.
// These helpers close that hole locally.
// ---------------------------------------------------------------------------

/** Parse-check the emitted bundle. Catches the raw-`@` template-literal leak. */
function expectParses(client) {
  expect(client.length).toBeGreaterThan(0);
  try {
    // Parses without executing — the same failure `node --check` reports.
    new Function(client);
  } catch (e) {
    throw new Error(
      `emitted client bundle is not valid JavaScript: ${e.message}
` +
      `This is what \`r.errors === []\` cannot see (write:false skips the emit gate).`,
    );
  }
}

/**
 * Assert `ident` is not referenced at MODULE scope — i.e. outside every
 * `function …(…, ident, …)` that binds it as a parameter. An arm PAYLOAD ident
 * only exists as a wire-fn parameter; emitting it globally throws a
 * ReferenceError out of the DOMContentLoaded handler and kills ALL page wiring.
 */
function expectNoModuleScopeRef(client, ident) {
  // Acorn scope-walk rather than a regex: an unbound reference is a SCOPING
  // property, and regexes cannot tell `((cls))` at module scope from `((cls))`
  // inside `function wire_Ok(_root, cls)`. That distinction IS the bug.
  const ast = acorn.parse(client, { ecmaVersion: 2022 });
  const unbound = [];
  let boundSomewhere = false;

  const walk = (node, bound) => {
    if (!node || typeof node.type !== "string") return;
    let scope = bound;
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      const names = (node.params ?? [])
        .filter((p) => p && p.type === "Identifier")
        .map((p) => p.name);
      if (names.includes(ident)) boundSomewhere = true;
      if (names.length > 0) scope = new Set([...bound, ...names]);
    }
    if (node.type === "Identifier" && node.name === ident && !scope.has(ident)) {
      unbound.push(node.start);
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      // An Identifier in these positions is a NAME, not a reference to a
      // binding: `{ cls: "hot" }` (property key) and `o.cls` (member property)
      // are not reads of `cls`. Counting them produced false positives on
      // `_scrml_reactive_set("r", { variant: "Ok", data: { cls: "hot" } })`.
      if (key === "key" && node.type === "Property" && !node.computed) continue;
      if (key === "property" && node.type === "MemberExpression" && !node.computed) continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === "string") walk(c, scope);
      } else if (v && typeof v.type === "string") {
        walk(v, scope);
      }
    }
  };
  walk(ast, new Set());

  // The payload MUST be bound as a wire-fn parameter somewhere, or the attr is
  // simply not wired at all and this assertion would pass vacuously.
  expect(boundSomewhere).toBe(true);
  expect(unbound).toEqual([]);
}

describe("§i81.1 — the issue's own reproducer: class= is no longer dropped", () => {
  test("ternary class= emits a data-scrml-bind-attr-class placeholder", () => {
    const src = `<program>
      <mode> = "a"
      <button class=(@mode == "a" ? "tab on" : "tab")>A</button>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    // The regression itself: pre-fix this element emitted a bare `<button>`.
    expect(html).toMatch(/data-scrml-bind-attr-class="[^"]+"/);
    expect(html).toContain("<button");
  });

  test("ternary class= wires a reactive _scrml_effect that sets the attribute", () => {
    const src = `<program>
      <mode> = "a"
      <button class=(@mode == "a" ? "tab on" : "tab")>A</button>
    </program>`;
    const r = compile(src);
    const client = emittedClient(r);
    expect(client).toMatch(/\.querySelector\('\[data-scrml-bind-attr-class="[^"]+"\]'\)/);
    expect(client).toContain('setAttribute("class", String(');
    expect(client).toContain("_scrml_effect");
    // Reactive dependency is actually subscribed, not a one-shot literal.
    expect(client).toContain('_scrml_reactive_get("mode")');
  });

  test("string-concat class= wires", () => {
    const src = `<program>
      <kind> = "warn"
      <div class=("badge " + @kind)>x</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    expect(emittedHtml(r)).toMatch(/data-scrml-bind-attr-class="[^"]+"/);
    expect(emittedClient(r)).toContain('setAttribute("class", String(');
  });
});

describe("§i81.2 — the other dropped value attrs: style=, title=, data-*", () => {
  test("style= wires", () => {
    const src = `<program>
      <c> = "red"
      <div style=("color: " + @c)>x</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    expect(emittedHtml(r)).toMatch(/data-scrml-bind-attr-style="[^"]+"/);
    expect(emittedClient(r)).toContain('setAttribute("style", String(');
  });

  test("title= wires", () => {
    const src = `<program>
      <label> = "hi"
      <span title=(@label)>t</span>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    expect(emittedHtml(r)).toMatch(/data-scrml-bind-attr-title="[^"]+"/);
    expect(emittedClient(r)).toContain('setAttribute("title", String(');
  });

  test("data-* wires and keeps its hyphenated name intact", () => {
    const src = `<program>
      <mode> = "a"
      <div data-mode=(@mode)>d</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    expect(emittedHtml(r)).toMatch(/data-scrml-bind-attr-data-mode="[^"]+"/);
    expect(emittedClient(r)).toContain('setAttribute("data-mode", String(');
  });

  test("id= and alt= wire (the emitter is general, not an allowlist)", () => {
    const src = `<program>
      <n> = "x"
      <div id=(@n)>i</div>
      <img alt=(@n)/>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toMatch(/data-scrml-bind-attr-id="[^"]+"/);
    expect(html).toMatch(/data-scrml-bind-attr-alt="[^"]+"/);
  });
});

describe("§i81.3 — coexistence: multiple placeholders on ONE element", () => {
  // The issue's own first case. A value attr and an event attr on the same
  // element must BOTH survive; pre-fix the event wired and the class vanished.
  test("class= + onclick= both emit placeholders on the same button", () => {
    const src = `<program>
      <mode> = "a"
      \${ function pick() { @mode = "b" } }
      <button class=(@mode == "a" ? "tab on" : "tab") onclick=pick()>A</button>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    const button = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button).toMatch(/data-scrml-bind-attr-class="[^"]+"/);
    expect(button).toMatch(/data-scrml-bind-onclick="[^"]+"/);
    // Both wired, not merely both present in the markup.
    const client = emittedClient(r);
    expect(client).toContain('setAttribute("class", String(');
    expect(client).toContain("addEventListener");
  });

  test("if= + class= on one element: the directive and the value attr coexist", () => {
    const src = `<program>
      <show> = true
      <mode> = "a"
      <div if=@show class=(@mode == "a" ? "on" : "off")>x</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    const div = html.match(/<div[^>]*>/)?.[0] ?? "";
    expect(div).toMatch(/data-scrml-bind-if="[^"]+"/);
    expect(div).toMatch(/data-scrml-bind-attr-class="[^"]+"/);
  });

  test("two distinct value attrs on one element each get their own placeholder", () => {
    const src = `<program>
      <m> = "a"
      <div class=(@m) title=(@m)>x</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const div = emittedHtml(r).match(/<div[^>]*>/)?.[0] ?? "";
    const cls = div.match(/data-scrml-bind-attr-class="([^"]+)"/)?.[1];
    const title = div.match(/data-scrml-bind-attr-title="([^"]+)"/)?.[1];
    expect(cls).toBeTruthy();
    expect(title).toBeTruthy();
    expect(cls).not.toBe(title); // distinct placeholder ids
  });
});

describe("§i81.4 — absence vs defined values (SPEC §42.1.1 / §42.9)", () => {
  // The load-bearing semantic. The bool path removes on FALSY; this path must
  // remove only on ABSENCE, because ""/0/false are DEFINED values in scrml and
  // §42.1.1 calls treating them as absence a SEMANTIC ERROR.
  test("the guard tests for absence (null/undefined), NOT for truthiness", () => {
    const src = `<program>
      <m> = "a"
      <div class=(@m)>x</div>
    </program>`;
    const client = emittedClient(compile(src));
    // SPEC §42.9: `is not` lowers to (x === null || x === undefined) — both,
    // because foreign code may produce either.
    expect(client).toMatch(/=== null \|\| \w+ === undefined/);
    expect(client).toContain('removeAttribute("class")');
    // A truthiness guard would drop ""/0/false. Assert we did NOT emit one.
    expect(client).not.toMatch(/if\s*\(\s*!\s*\(?_scrml_v/);
  });

  test('`not` removes the attribute (absence)', () => {
    const src = `<program>
      <m> = not
      <div class=(@m)>x</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    // `not` compiles to JS null (§42.9), which the emitted guard removes on.
    expect(emittedClient(r)).toContain('removeAttribute("class")');
  });

  test('`""` SETS an empty attribute and is NOT treated as absence', () => {
    const src = `<program>
      <m> = ""
      <div class=(@m)>x</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const client = emittedClient(r);
    // String("") === "" -> setAttribute("class", "") on the else branch.
    // The guard must not short-circuit on falsiness, or "" would be removed.
    expect(client).toContain('setAttribute("class", String(');
    expect(client).toMatch(/=== null \|\| \w+ === undefined/);
  });

  test("falsy-but-defined 0 / false reach setAttribute, not removeAttribute", () => {
    const src = `<program>
      <count> = 0
      <open> = false
      <div data-count=(@count) data-open=(@open)>x</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const client = emittedClient(r);
    // Both stringify (String(0)==="0", String(false)==="false"); the absence
    // guard lets them through. A truthiness guard would have dropped both.
    expect(client).toContain('setAttribute("data-count", String(');
    expect(client).toContain('setAttribute("data-open", String(');
  });

  test("the value is stringified via String(), not concatenated blindly", () => {
    const src = `<program>
      <m> = "a"
      <div title=(@m)>x</div>
    </program>`;
    expect(emittedClient(compile(src))).toContain('setAttribute("title", String(');
  });
});

describe("§i81.5 — no regressions on the paths that already worked", () => {
  test("static class=\"x\" is emitted literally, with no placeholder", () => {
    const src = `<program>
      <p class="static">s</p>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toContain('class="static"');
    expect(html).not.toContain("data-scrml-bind-attr-class");
  });

  test("bool attrs still take the BOOL path, not the new value path", () => {
    const src = `<program>
      <busy> = false
      <button disabled=!@busy>Click</button>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toMatch(/data-scrml-bind-bool-disabled="[^"]+"/);
    // REACTIVE_BOOL_ATTRS must not have been widened / bypassed.
    expect(html).not.toContain("data-scrml-bind-attr-disabled");
    // Bool keeps presence-toggle semantics: setAttribute(name, "").
    expect(emittedClient(r)).toContain('setAttribute("disabled", "")');
  });

  test("readonly/required still bool-wire", () => {
    const src = `<program>
      <locked> = true
      <input type="text" readonly=\${@locked} required=\${@locked}/>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    expect(html).toMatch(/data-scrml-bind-bool-readonly="[^"]+"/);
    expect(html).toMatch(/data-scrml-bind-bool-required="[^"]+"/);
    expect(html).not.toContain("data-scrml-bind-attr-readonly");
  });

  test("if=/show= still route to their directive paths, not the value path", () => {
    const src = `<program>
      <v> = true
      <div if=@v>a</div>
      <div show=@v>b</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    // if=@v takes the mount-toggle lowering (<template> + <!--scrml-if-marker-->),
    // show=@v the display-toggle placeholder. Neither may be swallowed by the
    // new catch-all else.
    expect(html).toContain("scrml-if-marker");
    expect(html).toMatch(/data-scrml-bind-show="[^"]+"/);
    expect(html).not.toContain("data-scrml-bind-attr-if");
    expect(html).not.toContain("data-scrml-bind-attr-show");
  });

  test("interpolated string-literal attrs keep the attr-tpl path (unchanged)", () => {
    const src = `<program>
      <status> = "ok"
      <div class="item-\${@status}">x</div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const html = emittedHtml(r);
    // This form was never broken; it must NOT be rerouted through the new path.
    expect(html).toContain("data-scrml-attr-tpl-class");
    expect(html).not.toContain("data-scrml-bind-attr-class");
  });

  test("inside <each>, class= still wires via the imperative each path (unchanged)", () => {
    const src = `<program>
      <mode> = "a"
      <items> = ["x"]
      <each in=@items as item>
        <button class=(@mode == "a" ? "tab on" : "tab")>e</button>
      </each>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    // emit-each builds elements imperatively; it must keep its own setAttribute
    // path and NOT acquire a data-scrml-bind-attr-* placeholder.
    const client = emittedClient(r);
    expect(client).toContain('setAttribute("class"');
    expect(emittedHtml(r)).not.toContain("data-scrml-bind-attr-class");
  });

  test("a parametric-snippet prop on a component call site still compiles", () => {
    // R26 regression (samples/compilation-tests/snippet-002-parametric.scrml).
    // Component expansion merges call-site props onto the component's ROOT
    // element, so by codegen the tag is `div`, not `List` — the props arrive
    // looking like ordinary attributes. `row=` is a §14.9 parametric-snippet
    // argument whose value is a lambda returning MARKUP; routing it through the
    // value-attr emitter spliced markup into JS (`const _scrml_v = ((item) =>
    // <span>…`) and produced E-CODEGEN-INVALID-LOGIC. The whole test suite was
    // green when this broke — only recompiling the real corpus caught it.
    const src = `<program>
      \${
        type Item:struct = {
          id:    number,
          label: string,
        }
      }
      \${
        const List = <div class="list" props={
            items:  Item[],
            row:    snippet(item: Item),
        }>
            \${ for (i of items) { lift <div class="list__row">\${ row(i) }</div> } }
        </div>
      }
      \${
        @items = [{ id: 1, label: "First" }]
      }
      <List
          items=@items
          row={ (item) => <span>\${item.id}. \${item.label}</span> }
      />
    </program>`;
    const r = compile(src);
    // The exact regression: a codegen crash, not a wrong attribute.
    expect(diagCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    // The prop must NOT be lowered as a DOM attribute.
    expect(emittedHtml(r)).not.toContain("data-scrml-bind-attr-row");
    expect(emittedClient(r)).not.toContain('setAttribute("row"');
  });
});

describe("§i81.6 — <match> arm scoping (S239 findings 1 + 4)", () => {
  // THE test this suite got wrong. Its first cut asserted the arm value attr
  // "still gets its global attr wire (bool parity)" — which IS the bug: a value
  // attr in an arm was kept in GLOBAL emission and excluded per-arm, the exact
  // inverse of correct. An emit-only assertion encoded the defect as intent.
  //
  // Emitting globally is catastrophic, not cosmetic: the expr commonly reads the
  // arm's PAYLOAD binding, which exists only as a wire-fn parameter, so module
  // scope gets `const _scrml_v = ((cls));` → ReferenceError at DOMContentLoaded.
  // The throw escapes the whole wiring handler, so EVERY listener and EVERY
  // effect on the page never wires. Pre-i81 the attr was merely dropped and the
  // page worked — a dead page is worse than the bug being fixed.
  const payloadSrc = `<program>
    <div>
      \${
        type Res:enum = {
          Ok(cls: string)
          Err
        }
        <r>: Res = .Ok("hot")
      }
      <match for=Res on=@r>
        <Ok(cls)><div class=(cls)>ok</div></Ok>
        <Err><span>err</span></Err>
      </match>
    </div>
  </program>`;

  test("an arm PAYLOAD ident is never referenced at module scope (ReferenceError guard)", () => {
    const r = compile(payloadSrc);
    expect(r.errors).toEqual([]);
    const client = emittedClient(r);
    expectParses(client);
    // The regression: `((cls))` inside _scrml_nav_rewire.
    expectNoModuleScopeRef(client, "cls");
  });

  test("the arm payload value attr is wired INSIDE the arm wire fn, via _root", () => {
    const client = emittedClient(compile(payloadSrc));
    // The wire fn must bind the payload as a parameter AND wire the attr there.
    expect(client).toMatch(/function\s+_scrml_[A-Za-z0-9_]*wire_Ok\(_root, cls\)/);
    expect(client).toMatch(/_root\.querySelector\(.*data-scrml-bind-attr-class/);
    expect(client).toContain('setAttribute("class"');
  });

  test("an arm whose ONLY binding is a value attr does not get a no-op wire fn", () => {
    // Regression on the early-return shell: `wireableValueAttrs` had to be added
    // to the "nothing to wire" test or the arm fn returned `function() {}`.
    const client = emittedClient(compile(payloadSrc));
    expect(client).not.toMatch(/function\s+_scrml_[A-Za-z0-9_]*wire_Ok\(_root, cls\)\s*\{\s*return function\(\)\s*\{\};\s*\}/);
  });

  test("the per-arm wire is disposed on variant swap (no leak onto a detached node)", () => {
    const client = emittedClient(compile(payloadSrc));
    // Same contract the class:/attr-tpl per-arm loop uses.
    expect(client).toMatch(/_disposers\.push\(_scrml_effect\(function\(\) \{ \{ const _scrml_w/);
  });

  test("a reactive-cell value attr in an arm also wires per-arm, not globally", () => {
    const src = `<program>
      <div>
        \${
          type Mode:enum = { A, B }
          <m>: Mode = .A
          <cls> = "hot"
        }
        <match for=Mode on=@m>
          <A><div class=(@cls)>a</div></A>
          <B><span title=(@cls)>b</span></B>
        </match>
      </div>
    </program>`;
    const r = compile(src);
    expect(r.errors).toEqual([]);
    const client = emittedClient(r);
    expectParses(client);
    expect(client).toMatch(/_root\.querySelector\(.*data-scrml-bind-attr-class/);
    // Must NOT also be wired from the global pass (double-wiring a node that the
    // arm swap replaces).
    expect(client).not.toMatch(/\(root \|\| document\)\.querySelector\('\[data-scrml-bind-attr-class/);
  });

  test("a value attr in a match arm emits no dead data-scrml-logic wire", () => {
    const client = emittedClient(compile(payloadSrc));
    // The arm body is emitted as a JS STRING inside client.js, so the quotes
    // around the placeholder are backslash-escaped in the source text.
    const ph = client.match(/data-scrml-bind-attr-class=\\"([^"\\]+)/)?.[1];
    expect(ph).toBeTruthy();
    // A value-attr placeholder can never match a reactive-TEXT selector.
    expect(client).not.toContain(`data-scrml-logic="${ph}"`);
  });
});

describe("§i81.9 — fail-closed dispositions (S239 findings 2, 3, 5, 6)", () => {
  // The rule this round established: a shape that cannot be lowered CORRECTLY
  // keeps its pre-i81 drop AND says so. Never emit hopeful JS. A silent drop is
  // a bug; a page that loads dead is worse than the bug.

  test("F2: a template literal reading @cell drops with a diagnostic, and the bundle still parses", () => {
    const src = `<program>
      <c> = "red"
      <div style=(\`color: \${@c}\`)>a</div>
    </program>`;
    const r = compile(src);
    // `emitExprField` emits a template literal verbatim, so the `@c` survives
    // into the JS. Pre-i81 the attr was dropped and the bundle stayed valid; the
    // first cut emitted `(\`color: \${@c}\`)` — a SyntaxError — and via the CLI
    // aborted the WHOLE compile with E-CODEGEN-INVALID-LOGIC on an idiomatic shape.
    const codes = diagCodes(r);
    expect(codes).toContain("W-CG-VALUE-ATTR-UNLOWERABLE");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    // The attribute is NOT emitted (pre-i81 parity) …
    expect(emittedHtml(r)).not.toContain("data-scrml-bind-attr-style");
    // … and the bundle is valid JS. THIS is the assertion `r.errors` cannot make.
    expectParses(emittedClient(r));
  });

  test("F2: the diagnostic is a WARNING — the build still succeeds", () => {
    const src = `<program>
      <c> = "red"
      <div style=(\`color: \${@c}\`)>a</div>
    </program>`;
    const r = compile(src);
    const w = r.warnings.find((e) => (e.code ?? "") === "W-CG-VALUE-ATTR-UNLOWERABLE");
    expect(w).toBeTruthy();
    // Pre-i81 this file compiled clean. Failing the BUILD would be its own
    // regression, so the disposition must be warn-and-drop, not error.
    expect(w.severity).toBe("warning");
  });

  test("F3: style= co-occurring with show= drops style and keeps the toggle correct", () => {
    const src = `<program>
      <isOpen> = false
      <theme> = "color: red"
      <div show=@isOpen style=(@theme)>panel</div>
    </program>`;
    const r = compile(src);
    const html = emittedHtml(r);
    expect(diagCodes(r)).toContain("W-CG-VALUE-ATTR-STYLE-CONFLICT");
    // setAttribute("style", …) replaces the WHOLE attribute, erasing the
    // el.style.display the toggle writes → a hidden panel becomes permanently
    // visible while @isOpen is still false.
    expect(html).not.toContain("data-scrml-bind-attr-style");
    expect(html).toMatch(/data-scrml-bind-show="[^"]+"/);
  });

  test("F3: style= WITHOUT a display directive still binds normally", () => {
    const src = `<program>
      <theme> = "color: blue"
      <div style=(@theme)>plain</div>
    </program>`;
    const r = compile(src);
    expect(diagCodes(r)).not.toContain("W-CG-VALUE-ATTR-STYLE-CONFLICT");
    expect(emittedHtml(r)).toMatch(/data-scrml-bind-attr-style="[^"]+"/);
  });

  test("F5: value= on a form control writes the .value PROPERTY, not the attribute", () => {
    const src = `<program>
      <name> = "x"
      <input type="text" value=(@name)/>
    </program>`;
    const client = emittedClient(compile(src));
    // The value ATTRIBUTE is only the DEFAULT value: the browser stops
    // reflecting it once the control is dirty, so a reactive value= lowered via
    // setAttribute silently stops applying after the user types.
    expect(client).toContain("el.value = _scrml_s");
    expect(client).not.toContain('setAttribute("value"');
    // Guarded so re-assigning an identical string cannot reset the caret.
    expect(client).toContain("if (el.value !== _scrml_s)");
  });

  test("F5: value= on a NON-form element still uses setAttribute", () => {
    const src = `<program>
      <lbl> = "L"
      <div value=(@lbl)>x</div>
    </program>`;
    const client = emittedClient(compile(src));
    expect(client).toContain('setAttribute("value", String(_scrml_x))');
  });

  test("F6: a promise-returning expr is awaited, not stringified to [object Promise]", () => {
    const src = `<program>
      <mode> = "a"
      <div class=(@mode)>x</div>
    </program>`;
    const client = emittedClient(compile(src));
    // Runtime thenable check rather than a compile-time server-fn name match:
    // fnNameMap is not in scope in emit-variant-guard, so a compile-time test
    // could not cover the per-arm path at all.
    expect(client).toContain('typeof _scrml_v.then === "function"');
    expect(client).toContain("_scrml_v.then(_scrml_w)");
  });
});

describe("§i81.10 — component roots (S239 finding 7)", () => {
  test("a component's OWN root value attr binds; a declared PROP never does", () => {
    const src = `<program>
      \${ @theme = "hot" }
      \${
        const Card = <div title=(@theme) props={ label: string }>
          <span>\${label}</span>
        </div>
      }
      <Card label="hello"/>
    </program>`;
    const r = compile(src);
    const html = emittedHtml(r);
    // Finding 7: refusing on `_expandedFrom != null` refused EVERY attribute of
    // every expanded root, leaving #81 unfixed for the whole user-component
    // class. The expander now stamps `_componentPropNames`, so only DECLARED
    // props are refused.
    expect(html).toMatch(/data-scrml-bind-attr-title="[^"]+"/);
    expect(html).not.toContain("data-scrml-bind-attr-label");
    expectParses(emittedClient(r));
  });

  test("a parametric-snippet prop is still refused (no markup spliced into JS)", () => {
    const src = `<program>
      \${
        type Item:struct = {
          id:    number,
          label: string,
        }
      }
      \${
        const List = <div class="list" props={
            items:  Item[],
            row:    snippet(item: Item),
        }>
            \${ for (i of items) { lift <div class="list__row">\${ row(i) }</div> } }
        </div>
      }
      \${ @items = [{ id: 1, label: "First" }] }
      <List items=@items row={ (item) => <span>\${item.id}</span> }/>
    </program>`;
    const r = compile(src);
    expect(diagCodes(r)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(emittedHtml(r)).not.toContain("data-scrml-bind-attr-row");
    expectParses(emittedClient(r));
  });
});

describe("§i81.11 — the post-NR `null` population (S239 finding 8)", () => {
  // The first cut admitted `resolvedKind == null` on a FALSE rationale ("a match
  // arm body is not NR-stamped"). name-resolver.ts:365-369 DOES recurse into
  // `anyN.arms`. The measurement was right but the explanation was wrong, and an
  // unexplained fail-open is a latent hole.
  //
  // Real source: emit-match.ts (~545) RE-PARSES each arm's bodyRaw through BS+TAB
  // as a synthetic fragment AT CODEGEN TIME — long after NR (Stage 3.05) — so
  // those nodes carry no stamp. `null` therefore means "synthesized after NR".
  //
  // The hole was REAL: a DIRECTIVE element inside an arm is also null.
  test("a NON-HTML element inside a <match> arm emits no DOM binding", () => {
    const src = `<program>
      <div>
        \${
          type Mode:enum = { A, B }
          <m>: Mode = .A
          <x> = "v"
        }
        <match for=Mode on=@m>
          <A><myWidget config=(@x)>w</myWidget></A>
          <B><span>b</span></B>
        </match>
      </div>
    </program>`;
    const client = emittedClient(compile(src));
    // `myWidget` is not an HTML element, so `config=` is not a DOM attribute.
    // Under the fail-open cut this emitted 2 bogus data-scrml-bind-attr-config
    // wires. (An imported `<tableFor>` is NOT a usable probe here — it expands to
    // real markup before codegen, so it never reaches this emitter at all; a
    // fixture built on it passes whether or not the hole exists.)
    expect(client).not.toContain("data-scrml-bind-attr-config");
  });

  test("a real HTML element inside a <match> arm still binds (null must not be blanket-refused)", () => {
    const src = `<program>
      <div>
        \${
          type Mode:enum = { A, B }
          <m>: Mode = .A
          <cls> = "hot"
        }
        <match for=Mode on=@m>
          <A><div class=(@cls)>a</div></A>
          <B><span>b</span></B>
        </match>
      </div>
    </program>`;
    const client = emittedClient(compile(src));
    // Dynamic class= inside an arm is idiomatic — the fail-closed fallback must
    // discriminate, not blanket-refuse the whole post-NR population.
    expect(client).toContain("data-scrml-bind-attr-class");
    expectParses(client);
  });
});

describe("§i81.7 — CSS-safe placeholder keys (crash regression)", () => {
  // Found by the blast-radius pass. The catch-all interpolates the attr name
  // into BOTH an HTML attribute and a querySelector attribute SELECTOR. An
  // unescaped `:` in a CSS attribute selector is invalid (colon = pseudo-class)
  // and throws a DOMException — verified against happy-dom. That selector runs
  // at module-init top level UNGUARDED, so the throw would abort the whole
  // client bundle and kill every binding on the page. Pre-i81, `xlink:href=(…)`
  // was silently dropped (inert); a crash would have been strictly worse.
  // Escaping is not viable (happy-dom rejects escaped selectors too), so the
  // KEY is sanitized while the NAME stays intact for setAttribute.
  // `xml:lang` on a plain <div>: an html-builtin element (so it IS lowered)
  // carrying a colon in the attribute name (so the selector guard matters).
  // NOTE: <use xlink:href> is NOT usable here — an SVG child resolves to
  // resolvedKind "unknown" and is not lowered at all (see §i81.9).
  const svgSrc = `<program>
    <l> = "en"
    <vb> = "0 0 16 16"
    <div xml:lang=(@l)>x</div>
    <svg viewBox=(@vb)></svg>
  </program>`;

  test("a colon-bearing attr name yields a CSS-SAFE selector (no raw colon)", () => {
    const r = compile(svgSrc);
    expect(r.errors).toEqual([]);
    const client = emittedClient(r);
    // The crash shape: '[data-scrml-bind-attr-xlink:href="…"]'
    expect(client).not.toMatch(/\[data-scrml-bind-attr-[A-Za-z0-9_-]*:/);
    expect(client).toContain("data-scrml-bind-attr-xml_lang");
    expect(emittedHtml(r)).toContain("data-scrml-bind-attr-xml_lang");
  });

  test("the ORIGINAL attr name still reaches setAttribute (SVG correctness)", () => {
    const client = emittedClient(compile(svgSrc));
    // Sanitization must NOT leak into the DOM write: xlink:href, not xlink_href.
    expect(client).toContain('setAttribute("xml:lang", String(');
    expect(client).not.toContain('setAttribute("xml_lang"');
    // Case must survive too — SVG attribute names are case-sensitive.
    expect(client).toContain('setAttribute("viewBox", String(');
  });

  test("every emitted value-attr selector uses only CSS-identifier-safe chars", () => {
    // Static guard rather than a live querySelector: proving invalidity needs
    // happy-dom's GlobalRegistrator, which mutates globalThis, and this repo
    // confines that to compiler/tests/browser/ — a unit test in the CI gate must
    // not install DOM globals for every other file in the process.
    //
    // The runtime behaviour WAS verified empirically under GlobalRegistrator:
    //   [data-scrml-bind-attr-xlink:href="p"] -> THROWS (invalid CSS)
    //   [data-scrml-bind-attr-xlink_href="p"] -> valid
    //   [data-scrml-bind-attr-viewBox="p"]    -> valid + MATCHes
    // This asserts the emitter never produces the throwing shape.
    const client = emittedClient(compile(svgSrc));
    const keys = [...client.matchAll(/\[data-scrml-bind-attr-([^=\]]+)=/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("hyphenated names are left alone (data-* / aria-* unaffected)", () => {
    const src = `<program>
      <h> = "x"
      <div aria-label=(@h) data-mode=(@h)>a</div>
    </program>`;
    const html = emittedHtml(compile(src));
    expect(html).toContain("data-scrml-bind-attr-aria-label");
    expect(html).toContain("data-scrml-bind-attr-data-mode");
  });
});

describe("§i81.8 — the binding is region-tracked (teardown contract)", () => {
  test("the value-attr effect is registered for region teardown like the bool path", () => {
    const src = `<program>
      <m> = "a"
      <div class=(@m)>x</div>
    </program>`;
    const client = emittedClient(compile(src));
    // Mirrors the bool/if-show contract: effect handle tracked so a region swap
    // disposes it instead of leaking an effect onto a detached node.
    expect(client).toContain("_scrml_region_track");
  });
});
