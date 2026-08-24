/**
 * g-each-as-alias-in-fn-body.browser.test.js
 *
 * MERGE BLOCKER for `g-each-as-alias-unbound-in-fn-body` (HIGH).
 *
 * BUG (reproduced on base cb5db9c9): an `<each … as NAME>` whose opener sits
 * inside a `fn` body — i.e. any markup parsed by `parseLiftTag` rather than by
 * the BS-structural `buildBlock` path — never bound NAME. The alias is a
 * BAREWORD PAIR in the §17.7.2 grammar (`as it`, not `as=it`), so lift parsing
 * yields TWO adjacent value-less attributes; `eachBlockFromMarkupNode` read only
 * `attrs.as.value` (which is `{kind:"absent"}`), resolved the alias to null, and
 * fell back to the synthetic `_scrml_each_item` iter var — while the body still
 * lowered `${it}` as a bare identifier. Emitted:
 *
 *     (_scrml_each_item, _scrml_each_idx) => it        // `it` never declared
 *
 * → `ReferenceError: it is not defined` at bundle eval. The whole client script
 * dies, so EVERY feature after the throw is dead too. Compile exited 0 with
 * ZERO diagnostics.
 *
 * SPEC: §17.7.2 "The `as name` clause is OPTIONAL. When present, it binds the
 * current iteration value to the named identifier in the body scope"; §17.7.3
 * "When `as name` is declared on the enclosing `<each>` opener, `name` and `@.`
 * SHALL both resolve to the current iteration value (aliases)." The shape was
 * already normatively legal — this gate is a conformance RESTORATION, not a
 * widening.
 *
 * ⚑ Runtime gate: this test EXECUTES the emitted bundle in happy-dom. The
 * emitted text looked plausible in several intermediate states of this bug;
 * only execution distinguishes "declared" from "referenced".
 *
 * Controls B/C/D are the non-regression set from the dispatch brief: they
 * passed BEFORE the fix and must still pass after.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

const DOLLAR = "$";

// (A) THE BUG — `<each … as it>` inside a `fn` body.
const SRC_FN_ALIAS = `<program>
<rows> = ["a", "b"]
fn listing() {
    return <ul>
        <each in=@rows as it key=it>
            <li>${DOLLAR}{it}</li>
        </each>
    </ul>
}
<div>${DOLLAR}{listing()}</div>
</program>
`;

// (A2) THE BUG, brief's verbatim `${…}`-wrapped declaration form. Same defect,
// different §40.8 entry path (explicit logic block vs. default-logic auto-lift).
const SRC_FN_ALIAS_WRAPPED = `<program>
<rows> = ["a", "b"]
${DOLLAR}{
    fn listing() {
        return <ul>
            <each in=@rows as it key=it>
                <li>${DOLLAR}{it}</li>
            </each>
        </ul>
    }
}
<div>${DOLLAR}{listing()}</div>
</program>
`;

// (A3) `of=` count form with an alias, inside a `fn` body — the §17.7.2 Shape-4
// sibling. Same lift path, same alias mechanism, so it must bind too.
const SRC_FN_ALIAS_OF = `<program>
<slots> = 3
fn listing() {
    return <ul>
        <each of=@slots as n key=n>
            <li>slot-${DOLLAR}{n}</li>
        </each>
    </ul>
}
<div>${DOLLAR}{listing()}</div>
</program>
`;

// (B) CONTROL — same `fn` body, NO alias, `@.` sigil. Worked before the fix.
const SRC_FN_SIGIL = `<program>
<rows> = ["a", "b"]
fn listing() {
    return <ul>
        <each in=@rows>
            <li>${DOLLAR}{@.}</li>
        </each>
    </ul>
}
<div>${DOLLAR}{listing()}</div>
</program>
`;

// (C) CONTROL — same alias, `<each>` at TOP LEVEL (BS-structural path).
const SRC_TOPLEVEL_ALIAS = `<program>
<rows> = ["a", "b"]
<ul>
    <each in=@rows as it key=it>
        <li>${DOLLAR}{it}</li>
    </each>
</ul>
</program>
`;

// (D) CONTROL — top level + a markup-returning fn called with the alias.
const SRC_TOPLEVEL_MARKUP_FN = `<program>
<rows> = ["a", "b"]
fn badge(v) {
    return <span class="b">${DOLLAR}{v}</span>
}
<ul>
    <each in=@rows as it key=it>
        <li>${DOLLAR}{badge(it)}</li>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-as-alias-fn-body");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-each-as-alias-unbound-in-fn-body — `<each … as NAME>` binds NAME inside a fn body", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  /**
   * Compile + EXECUTE. `thrown` carries the bundle-eval error rather than
   * letting it escape, so the alias defect surfaces as a NAMED assertion
   * ("ReferenceError: it is not defined") instead of an anonymous test crash.
   */
  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    let thrown = null;
    try {
      const exec = new Function(
        "window",
        "document",
        `${runtimeJs}\n${clientJs}\n` +
          `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
          `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`,
      );
      exec(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } catch (e) {
      thrown = e;
    }
    const cellKey = clientJs ? chunkCellKey(clientJs) : (n) => n;
    return {
      errors,
      clientJs,
      thrown,
      set: (name, val) => globalThis.__scrml_set__(cellKey(name), val),
      items: () => [...document.querySelectorAll("li")].map((n) => n.textContent.trim()),
      bodyText: () => document.body.textContent,
    };
  }

  // -----------------------------------------------------------------------
  // (A) the bug
  // -----------------------------------------------------------------------

  test("(A) fn body + `as it`: bundle executes with ZERO errors and renders both rows", () => {
    const app = mount(SRC_FN_ALIAS, "fnalias");
    // Compile side stays clean — this was never a diagnostics bug.
    expect(app.errors.filter((e) => String(e.severity ?? "error") === "error")).toEqual([]);
    // THE BITE: pre-fix this is `ReferenceError: it is not defined`.
    // Surface the message in the failure output rather than a bare `null` diff.
    expect(app.thrown === null ? "no error" : String(app.thrown)).toBe("no error");
    expect(app.items()).toEqual(["a", "b"]);
  });

  test("(A) the alias is DECLARED in the emitted per-item factory, not merely referenced", () => {
    const { clientJs } = compileToOutputs(SRC_FN_ALIAS, "fnaliasemit");
    // The generic fallback name must not appear as the iter var alongside a
    // body that references `it` — that mismatch IS the bug.
    expect(clientJs).not.toContain("(_scrml_each_item, _scrml_each_idx) => it");
    expect(clientJs).toContain("(it, _scrml_each_idx) => it");
  });

  test("(A2) `${…}`-wrapped fn declaration form: same alias, same clean execution", () => {
    const app = mount(SRC_FN_ALIAS_WRAPPED, "fnaliaswrapped");
    expect(app.thrown).toBeNull();
    expect(app.items()).toEqual(["a", "b"]);
  });

  test("(A3) `of=` count form with `as n` inside a fn body binds the index alias", () => {
    const app = mount(SRC_FN_ALIAS_OF, "fnaliasof");
    expect(app.thrown).toBeNull();
    expect(app.items()).toEqual(["slot-0", "slot-1", "slot-2"]);
  });

  test("(A) the alias stays bound across a reactive re-render", () => {
    const app = mount(SRC_FN_ALIAS, "fnaliasreactive");
    expect(app.thrown).toBeNull();
    app.set("rows", ["x", "y", "z"]);
    expect(app.items()).toEqual(["x", "y", "z"]);
  });

  // -----------------------------------------------------------------------
  // (B) (C) (D) — non-regression controls; all three passed pre-fix.
  // -----------------------------------------------------------------------

  test("(B) CONTROL: fn body + `@.` sigil (no alias) still renders both rows", () => {
    const app = mount(SRC_FN_SIGIL, "fnsigil");
    expect(app.thrown).toBeNull();
    expect(app.items()).toEqual(["a", "b"]);
  });

  test("(C) CONTROL: top-level `<each … as it>` still renders both rows", () => {
    const app = mount(SRC_TOPLEVEL_ALIAS, "toplevelalias");
    expect(app.thrown).toBeNull();
    expect(app.items()).toEqual(["a", "b"]);
  });

  test("(D) CONTROL: top-level alias + markup-returning fn still MOUNTS the <span>", () => {
    const app = mount(SRC_TOPLEVEL_MARKUP_FN, "toplevelmarkupfn");
    expect(app.thrown).toBeNull();
    expect(document.querySelectorAll("li span.b").length).toBe(2);
    expect([...document.querySelectorAll("li span.b")].map((n) => n.textContent.trim()))
      .toEqual(["a", "b"]);
    expect(app.bodyText()).not.toContain("[object");
  });
});
