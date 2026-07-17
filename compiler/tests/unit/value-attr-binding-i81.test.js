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
    return { errors: result.errors ?? [], html, clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const emittedHtml = (r) => r.html ?? "";
const emittedClient = (r) => r.clientJs ?? "";

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
});

describe("§i81.6 — <match> arm interaction (blast radius)", () => {
  // Found by the blast-radius pass, NOT by the brief (which listed 3
  // touchpoints; this is a 4th). emit-variant-guard.ts's `wireableLogic` filter
  // excludes isConditionalDisplay/isVisibilityToggle/isMountToggle/
  // isReactiveBoolAttr from the per-arm reactive-TEXT emission. A value-attr
  // binding has kind === undefined, so without a symmetric exclusion it fell
  // through to that branch and emitted
  // `_root.querySelector('[data-scrml-logic="_scrml_attr_class_1"]')` — a
  // selector that can NEVER match a `data-scrml-bind-attr-class` placeholder.
  // A dead wire. The bool path is excluded and emits only the global wire; this
  // asserts the value path now behaves identically.
  const armSrc = `<program>
    <div>
      \${
        type Mode:enum = { A, B }
        <m>: Mode = .A
        <cls> = "hot"
      }
      <match for=Mode on=@m>
        <A><div class=(@cls)>arm-a</div></A>
        <B><span title=(@cls)>arm-b</span></B>
      </match>
    </div>
  </program>`;

  test("a value attr in a match arm does NOT emit a dead data-scrml-logic wire", () => {
    const r = compile(armSrc);
    expect(r.errors).toEqual([]);
    const client = emittedClient(r);
    const placeholder = emittedHtml(r).match(/data-scrml-bind-attr-class="([^"]+)"/)?.[1]
      ?? client.match(/data-scrml-bind-attr-class="([^"]+)"/)?.[1];
    expect(placeholder).toBeTruthy();
    // The exact regression: the arm wire must not look for this placeholder id
    // under the reactive-text `data-scrml-logic` selector.
    expect(client).not.toContain(`data-scrml-logic="${placeholder}"`);
  });

  test("a value attr in a match arm still gets its global attr wire (bool parity)", () => {
    const client = emittedClient(compile(armSrc));
    expect(client).toMatch(/querySelector\('\[data-scrml-bind-attr-class="[^"]+"\]'\)/);
    expect(client).toContain('setAttribute("class", String(');
  });
});

describe("§i81.7 — the binding is region-tracked (teardown contract)", () => {
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
