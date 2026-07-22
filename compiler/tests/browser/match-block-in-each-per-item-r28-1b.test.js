/**
 * match-block-in-each-per-item-r28-1b.test.js — Bug R28-1b (HIGH,
 * silent-wrong/missing-output) happy-dom acceptance regression.
 *
 * Bug: a block-form `<match for=T on=@.field>` that is a CHILD of
 * `<each ... as alias>` was structurally unrendered. The per-item factory
 * emitted `// each: unhandled template child kind="match-block"` (the match
 * was DROPPED), and a phantom MODULE-scope dispatcher fired
 * `_scrml_effect(() => __scrml_match_match_NN_dispatch(article.status))` at
 * top level where `article` (the per-item factory param) is UNDEFINED.
 *
 * Fix (S143):
 *   - emit-each.ts renders the block-form match PER ITEM inside the each
 *     factory: an item-local mount element + a per-item dispatch keyed on the
 *     item's discriminant (`@.status` -> `<iterVar>.status`, valid in factory
 *     scope where the iter var IS bound).
 *   - emit-match.ts emits an ITEM-SCOPED dispatch fn
 *     `__scrml_match_match_NN_dispatch(_mount, _v)` (mount passed in, per-mount
 *     dispose isolation, NO module-scope trigger) when the match-block sits
 *     inside an each.
 *
 * Per R26 (S138): node-check passes today and the compile exits 0 — the OUTPUT
 * was wrong. An emit-string assertion is necessary but NOT sufficient. This
 * suite mounts the compiled module in happy-dom and asserts EACH `<li>` renders
 * ITS OWN match arm against the live per-item value (item 1 Draft -> DRAFT,
 * item 2 Published -> PUBLISHED). The unit-level emit-shape guard lives in
 * compiler/tests/unit/match-on-atdot-in-each-r28-bug-1.test.js (§11).
 *
 * Models: compiler/tests/browser/each-runtime-bug-57.test.js (real compile +
 * read result.runtimeFilename + happy-dom mount via `new Function`).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "fs";
import { compileScrml } from "../../src/api.js";

// Block-form `<match>` as a child of `<each>`. The `<empty>` sub-element adds
// the empty-state guard (the each render fn's `if (!_items || length === 0)`
// branch) so the initial module-init render (cell unset -> `[]`) does not enter
// the reconcile path with an undefined list. The match discriminant is the
// per-item `@.status` (SPEC §17.7.3 — aliases `article.status`).
const SRC = `<program title="T">
\${ type Status:enum = { Draft, Published }
   type Article:struct = { id: integer, status: Status, title: string } }
<articles>: Article[] = []
<ul>
  <each in=@articles key=@.id as article>
    <li>
      \${article.title}
      <match for=Status on=@.status>
        <Draft>: <span>DRAFT</span>
        <Published>: <span>PUBLISHED</span>
      </>
    </li>
    <empty>none</>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-r28-1b");

function compileToOutputs(source, baseName = "app") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(
      outDir,
      result.runtimeFilename ?? "scrml-runtime.js",
    );
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath)
        ? readFileSync(runtimePath, "utf8")
        : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — Targeted emit-regression (FAILS pre-fix, PASSES post-fix)
// ---------------------------------------------------------------------------

describe("R28-1b §1 — match-in-each emits per-item dispatch, NOT a dropped child", () => {
  test("compile succeeds with no errors", () => {
    const { errors } = compileToOutputs(SRC);
    expect(errors).toEqual([]);
  });

  test("per-item factory does NOT emit the unhandled-match-block comment", () => {
    const { clientJs } = compileToOutputs(SRC);
    // Pre-fix the each factory dropped the match with this literal comment.
    expect(clientJs).not.toContain('unhandled template child kind="match-block"');
  });

  test("per-item factory dispatches the match on the live item discriminant", () => {
    const { clientJs } = compileToOutputs(SRC);
    // The per-item dispatch passes the item-local mount + `article.status`.
    expect(clientJs).toMatch(/__scrml_match_match_\d+_dispatch\(_scrml_match_mount_\d+, article\.status\)/);
  });

  test("NO phantom module-scope dispatch referencing the per-item iter var", () => {
    const { clientJs } = compileToOutputs(SRC);
    // Pre-fix: `_scrml_effect(() => __scrml_match_match_NN_dispatch(article.status))`
    // at module scope where `article` is undefined.
    expect(clientJs).not.toMatch(/_scrml_effect\(\s*function\(\)\s*\{[\s\S]*__scrml_match_match_\d+_dispatch\(article\.status/);
    expect(clientJs).not.toMatch(/__scrml_match_match_\d+_dispatch\(article\.status\)/);
  });

  test("the match dispatch fn is item-scoped (takes the mount as a parameter)", () => {
    const { clientJs } = compileToOutputs(SRC);
    expect(clientJs).toMatch(/function __scrml_match_match_\d+_dispatch\(_mount, _v\)/);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom runtime drive: EACH <li> renders ITS OWN match arm
// ---------------------------------------------------------------------------

describe("R28-1b §2 — each <li> renders its own match arm in happy-dom", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });

  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount() {
    const { html, clientJs, runtimeJs } = compileToOutputs(SRC);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      mountEl: () => (function(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),n;while((n=w.nextNode())){if(String(n.data||'').trim().indexOf('scrml-each:')===0)return n.parentNode;}return null;})(),
    };
  }

  test("mounting does NOT throw (the per-item match renders cleanly)", () => {
    expect(() => mount()).not.toThrow();
  });

  test("two articles with DIFFERENT statuses each render THEIR OWN match arm", () => {
    const app = mount();
    app.set("articles", [
      { id: 1, status: "Draft", title: "First" },
      { id: 2, status: "Published", title: "Second" },
    ]);
    const lis = app.mountEl().querySelectorAll("li");
    expect(lis.length).toBe(2);

    // Item 1 (Draft) renders the Draft arm: a <span>DRAFT</span>.
    const li0Spans = [...lis[0].querySelectorAll("span")].map((s) => s.textContent);
    expect(li0Spans).toContain("DRAFT");
    expect(li0Spans).not.toContain("PUBLISHED");

    // Item 2 (Published) renders the Published arm: a <span>PUBLISHED</span>.
    const li1Spans = [...lis[1].querySelectorAll("span")].map((s) => s.textContent);
    expect(li1Spans).toContain("PUBLISHED");
    expect(li1Spans).not.toContain("DRAFT");
  });

  test("the per-item match resolves the LIVE per-item value (order-independent)", () => {
    const app = mount();
    // Reverse the statuses — item 1 Published, item 2 Draft. Each <li> must
    // still resolve to ITS OWN item's value, not a shared module-scope one.
    app.set("articles", [
      { id: 1, status: "Published", title: "Alpha" },
      { id: 2, status: "Draft", title: "Beta" },
    ]);
    const lis = app.mountEl().querySelectorAll("li");
    expect(lis.length).toBe(2);
    expect([...lis[0].querySelectorAll("span")].map((s) => s.textContent)).toContain("PUBLISHED");
    expect([...lis[1].querySelectorAll("span")].map((s) => s.textContent)).toContain("DRAFT");
  });

  test("three+ items all the SAME status each render that arm (no clobber)", () => {
    const app = mount();
    app.set("articles", [
      { id: 1, status: "Draft", title: "A" },
      { id: 2, status: "Draft", title: "B" },
      { id: 3, status: "Draft", title: "C" },
    ]);
    const lis = app.mountEl().querySelectorAll("li");
    expect(lis.length).toBe(3);
    for (const li of lis) {
      const spans = [...li.querySelectorAll("span")].map((s) => s.textContent);
      expect(spans).toContain("DRAFT");
      expect(spans).not.toContain("PUBLISHED");
    }
  });

  test("reconcile recreates a fresh item (new key) with ITS OWN match arm", () => {
    const app = mount();
    app.set("articles", [{ id: 1, status: "Draft", title: "Only" }]);
    let lis = app.mountEl().querySelectorAll("li");
    expect([...lis[0].querySelectorAll("span")].map((s) => s.textContent)).toContain("DRAFT");

    // Replace with a DIFFERENT-keyed item. Keyed reconciliation recreates the
    // `<li>` (the old key is gone), re-running the per-item factory → the new
    // item dispatches against ITS value (Published).
    //
    // NB (out of R28-1b scope, pre-existing each limitation): a SAME-key item
    // whose discriminant field changes in-place does NOT re-render, because
    // keyed reconciliation reuses the existing DOM node without re-running the
    // per-item factory. This affects ALL per-item template content equally —
    // e.g., a same-key `${article.title}` change does not update either. It is
    // the general each per-item-reactivity gap, not specific to match-in-each.
    app.set("articles", [{ id: 2, status: "Published", title: "Only" }]);
    lis = app.mountEl().querySelectorAll("li");
    expect(lis.length).toBe(1);
    expect([...lis[0].querySelectorAll("span")].map((s) => s.textContent)).toContain("PUBLISHED");
    expect([...lis[0].querySelectorAll("span")].map((s) => s.textContent)).not.toContain("DRAFT");
  });

  test("adding items dispatches each NEW item against its own discriminant", () => {
    const app = mount();
    app.set("articles", [{ id: 1, status: "Draft", title: "A" }]);
    expect(app.mountEl().querySelectorAll("li").length).toBe(1);

    // Append a Published item — the new <li> renders the Published arm while
    // the existing Draft <li> is untouched.
    app.set("articles", [
      { id: 1, status: "Draft", title: "A" },
      { id: 2, status: "Published", title: "B" },
    ]);
    const lis = app.mountEl().querySelectorAll("li");
    expect(lis.length).toBe(2);
    expect([...lis[0].querySelectorAll("span")].map((s) => s.textContent)).toContain("DRAFT");
    expect([...lis[1].querySelectorAll("span")].map((s) => s.textContent)).toContain("PUBLISHED");
  });
});
