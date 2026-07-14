/**
 * fix-component-def-block-ref-interpolation-in-body — regression suite (Scope C A7 + A8)
 *
 * Bug class: a component-def whose body contains an HTML void element
 * (`<input>`, `<br>`, `<img>`, `<hr>`, etc. — no `/>` self-close, no closer)
 * silently consumed all subsequent sibling declarations into its `raw` body.
 * Only the first component registered; subsequent ones produced E-COMPONENT-020.
 *
 * Bisected (S44): the angle-tracker in `collectExpr` (A3 fix, commit bcd4557)
 * uses element-nesting semantics — `<TAG` increments depth, `</TAG` and `/>`
 * decrement. HTML void elements have NO closer in idiomatic scrml, so they
 * leaked angleDepth permanently. After the wrapper's `</tag>`, depth was
 * still > 0, defeating the IDENT-`=` boundary guard for the next sibling.
 *
 * Originally filed as A7 ("BLOCK_REF interpolation in component def body" —
 * the trigger from ex 05 ConfirmStep contained `<dd>${@firstName}</dd>` and
 * the BLOCK_REF was hypothesised as the cause). Trace proved the BLOCK_REF
 * was a red herring — the actual cause was the void element earlier in the
 * same body (or in a sibling component's body, in the ex 05 case where
 * InfoStep's `<input>` greedily consumed both PreferencesStep + ConfirmStep).
 *
 * A8 ("`<select><option>` children + `bind:value=@x`") is the same bug:
 * PreferencesStep contains `<input type="checkbox" bind:value=@newsletter>`,
 * a void element with no `/>`. Same root cause; same fix.
 *
 * Fix: introduce an HTML_VOID_ELEMENTS set and a `pendingVoidClose` flag.
 * `<voidtag` increments angleDepth (so attributes inside the open tag are
 * tracked as inside-markup); the matching `>` of the open tag decrements it
 * (or `/>` for self-close form). Applied in collectExpr, collectLiftExpr,
 * and parseLiftTag (which also needed a void-element no-children case).
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `defv-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_defv_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let html = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        html = output.html ?? null;
      }
    }
    return { errors: result.errors ?? [], html };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

function noE020(errors) {
  return errors.filter(e => e && e.code === "E-COMPONENT-020");
}

describe("component-def: HTML void elements in body (A7+A8 fix)", () => {
  test("trigger: <div><br></div> + sibling component — both register", () => {
    // Pre-fix: the <br> opens angleDepth without closing, swallowing const Bar
    const src = `<program>
\${
  const Foo = <div><br></div>

  const Bar = <div>x</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors, html } = compileSource(src, "br-then-sibling");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain("x");
  });

  test("trigger: <input bind:value=@x> + sibling component — both register (A8 shape)", () => {
    const src = `<program>
\${ @x = "" }
\${
  const Foo = <div>
    <input bind:value=@x>
  </div>

  const Bar = <div>after</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors, html } = compileSource(src, "input-bindvalue-sibling");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain("after");
  });

  test("trigger: <input> with attributes (no bind, no self-close) + sibling", () => {
    const src = `<program>
\${
  const Foo = <div>
    <input type="text" placeholder="name" required>
  </div>

  const Bar = <div>tail</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors } = compileSource(src, "input-attrs-sibling");
    expect(noE020(errors)).toEqual([]);
  });

  test("trigger: <hr> + sibling component", () => {
    const src = `<program>
\${
  const Foo = <div><hr></div>
  const Bar = <span>tail</span>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors } = compileSource(src, "hr-sibling");
    expect(noE020(errors)).toEqual([]);
  });

  test("trigger: <img src> + sibling component", () => {
    const src = `<program>
\${
  const Foo = <div><img src="/x.png"></div>
  const Bar = <p>tail</p>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors } = compileSource(src, "img-sibling");
    expect(noE020(errors)).toEqual([]);
  });

  test("variation: void element after BLOCK_REF (the original A7 hypothesis)", () => {
    const src = `<program>
\${ @firstName = "Ada" }
\${
  const Foo = <div>
    <dl>
      <dt>Name</dt>
      <dd>\${@firstName}</dd>
    </dl>
    <input type="text" bind:value=@firstName>
  </div>

  const Bar = <div>tail</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors, html } = compileSource(src, "blockref-then-input");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain("tail");
  });

  test("ex 05 PreferencesStep shape — <select><option>...</option></select> + <input type=checkbox bind:value=@x>", () => {
    const src = `<program>
\${ @theme = "light" }
\${ @newsletter = false }
\${
  const PreferencesStep = <div class="step">
    <h2>Preferences</>
    <label>
      Theme:
      <select bind:value=@theme>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
    <label class="checkbox-label">
      <input type="checkbox" bind:value=@newsletter>
      Subscribe to newsletter
    </label>
    <div class="step-nav">
      <button>Back</button>
      <button>Next</button>
    </div>
  </div>

  const Tail = <div>after</div>
}
<div><PreferencesStep/></div>
<div><Tail/></div>
</program>`;
    const { errors, html } = compileSource(src, "ex05-preferences-shape");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain("after");
  });

  test("ex 05 ConfirmStep shape — multi-BLOCK_REF interpolation in <dd>", () => {
    const src = `<program>
\${ @firstName = "" }
\${ @lastName = "" }
\${ @email = "" }
\${ @theme = "light" }
\${ @newsletter = false }
\${
  const ConfirmStep = <div class="step">
    <h2>Confirm</>
    <dl>
      <dt>Name</dt>   <dd>\${@firstName} \${@lastName}</dd>
      <dt>Email</dt>  <dd>\${@email}</dd>
      <dt>Theme</dt>  <dd>\${@theme}</dd>
      <dt>Newsletter</dt> <dd>\${@newsletter ? "Yes" : "No"}</dd>
    </dl>
  </div>

  const Tail = <div>after</div>
}
<div><ConfirmStep/></div>
<div><Tail/></div>
</program>`;
    const { errors, html } = compileSource(src, "ex05-confirm-shape");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain("after");
  });

  test("multi-component file with void elements interleaved (ex 05 reduced)", () => {
    // The ex 05 trigger: 3 components in one logic block, first one has <input>
    const src = `<program>
\${ @firstName = "" }
\${ @theme = "light" }
\${
  const InfoStep = <div class="step">
    <label>First Name <input type="text" bind:value=@firstName required></label>
  </div>

  const PreferencesStep = <div class="step">
    <select bind:value=@theme>
      <option value="light">Light</option>
    </select>
  </div>

  const ConfirmStep = <div class="step">
    <h2>Confirm</>
  </div>
}
<div><InfoStep/></div>
<div><PreferencesStep/></div>
<div><ConfirmStep/></div>
</program>`;
    const { errors, html } = compileSource(src, "ex05-three-comps");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
  });

  test("sanity: void element with explicit self-close /> still works", () => {
    const src = `<program>
\${
  const Foo = <div><input type="text"/></div>
  const Bar = <div>tail</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors } = compileSource(src, "void-selfclose");
    expect(noE020(errors)).toEqual([]);
  });

  test("sanity: non-void element child still works (no regression)", () => {
    const src = `<program>
\${
  const Foo = <div><p>x</p></div>
  const Bar = <div>tail</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors } = compileSource(src, "p-child-sibling");
    expect(noE020(errors)).toEqual([]);
  });

  test("sanity: top-level <input> in markup (not in component def) still works", () => {
    // Make sure non-component-def usage is unaffected
    const src = `<program>
\${ @x = "" }
<div>
  <input type="text" bind:value=@x>
</div>
</program>`;
    const { errors, html } = compileSource(src, "toplevel-input");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain("input");
  });

  test("lift: lift <div><input bind:value=@x></div> with sibling lift parses as markup", () => {
    // collectLiftExpr also had the void-element bug. Pre-fix, the first lift's
    // expr fell into the string-fallback path and emitted only `div >`. After
    // the fix, both lift expressions parse as proper markup AST nodes (expr.kind
    // === 'markup'). We don't assert HTML content here because lift expressions
    // are emitted as runtime-driven `<span data-scrml-logic>` placeholders, not
    // inline HTML — the assertion is "no E-COMPONENT-020 / no parse errors".
    const src = `<program>
\${ @x = "" }
\${ lift <div><input bind:value=@x></div> }
\${ lift <div>after</div> }
</program>`;
    const { errors, html } = compileSource(src, "lift-void-sibling");
    expect(noE020(errors)).toEqual([]);
    expect(html).toBeTruthy();
    // Both lift placeholders should be wired through the runtime
    const matches = html.match(/data-scrml-logic="_scrml_logic_/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("multi-void: <br><br><br> in component body + sibling", () => {
    const src = `<program>
\${
  const Foo = <div><br><br><br></div>
  const Bar = <div>tail</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors } = compileSource(src, "multi-br");
    expect(noE020(errors)).toEqual([]);
  });

  test("nested: void inside nested element (button > input) + sibling", () => {
    const src = `<program>
\${ @x = "" }
\${
  const Foo = <div>
    <label>
      Name <input bind:value=@x required>
    </label>
  </div>
  const Bar = <div>tail</div>
}
<div><Foo/></div>
<div><Bar/></div>
</program>`;
    const { errors } = compileSource(src, "nested-void");
    expect(noE020(errors)).toEqual([]);
  });
});
