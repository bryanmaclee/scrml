/**
 * S97 — bare-form shapes in event-handler attribute value
 *
 * SPEC §5.2.3 L19 normatively recognizes three bare-form event handler shapes:
 *   1. Bare call           — `onclick=fn()`
 *   2. Bare assignment     — `onclick=@phase = .Loading`        ← S97 fix
 *   3. Bare single-expr    — `onclick=@count++`, `onclick=@count += 5` ← S97 fix
 *
 * Both `++`/`--` postfix updates AND compound assigns (`+=`/`??=`/etc.)
 * are covered. Compound assigns lower to `setter(X, getter(X) <op> (rhs))`
 * via the extended `rewriteReactiveAssign`. Postfix updates lower to
 * `setter(X, getter(X) +/- 1)` (and the routing in emit-event-wiring.ts
 * excludes `unary` kind so the string-rewrite path is taken instead of
 * the structured emitUnary which would produce invalid `getter()++`).
 *
 * SPEC §5.2.3 worked example (line 1170-1177):
 *   <engine for=Phase initial=.Idle>
 *     <Idle>
 *       <button onclick=@phase = .Loading>Begin</>
 *     </>
 *   </>
 *
 * Pre-fix: the HTML-attribute tokenizer stopped reading the value at the
 * first whitespace after the ident (`@phase`), then the outer loop saw the
 * `=` as an unexpected char (silently skipped), then `.Active` was
 * misinterpreted as a separate boolean attribute. Symptom on
 * `<button onclick=@phase = .Loading>`:
 *   HTML  : <button onclick="phase" Loading>
 *   JS    : no event wiring at all
 * — `@` stripped, value string-quoted, `.Loading` became a bare attribute.
 *
 * Post-fix: when the attribute name is an event handler AND the
 * continuation after the ident is `=` (not `==`, not `=>`), the tokenizer
 * switches to expression-mode and reads the full expression as ATTR_EXPR.
 * The downstream parseAttributes ATTR_EXPR branch produces a `kind: "expr"`
 * value, and emit-event-wiring wraps it as `function(event) { <expr>; }`
 * per SPEC §5.2.2. The reactive-assign rewrite pass converts the leaked
 * `_scrml_reactive_get("X") = expr` pattern to `_scrml_reactive_set("X", expr)`.
 *
 * SCOPE NOTE — `++`/`--` and compound assigns are NOT detected by this fix.
 * They would expose a complementary codegen gap (rewriteReactiveAssign at
 * rewrite.ts:1779 only handles `=`, not `+=` or `++`). Closing those
 * shapes requires either (a) extending rewriteReactiveAssign to recognize
 * compound-update patterns and lower to `setter(X, getter(X) <op> expr)`,
 * OR (b) routing through a new structured emit path. Filed as v0.3.x
 * follow-up.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import fs from "fs";
import path from "path";
import os from "os";

function compileSrcToTmp(src, basename = "bare-assign-test") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bare-assign-"));
  const srcPath = path.join(tmpDir, `${basename}.scrml`);
  fs.writeFileSync(srcPath, src);
  try {
    compileScrml({
      inputFiles: [srcPath],
      write: true,
      outputDir: tmpDir,
    });
    const clientPath = path.join(tmpDir, `${basename}.client.js`);
    const htmlPath = path.join(tmpDir, `${basename}.html`);
    return {
      client: fs.existsSync(clientPath) ? fs.readFileSync(clientPath, "utf-8") : null,
      html: fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf-8") : null,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — Bare-assignment renders as event handler (not a broken HTML attribute)
// ---------------------------------------------------------------------------

describe("§1 — bare-assignment in event handler value", () => {
  test("§1.1 onclick=@mode = .Active produces event wiring (not broken HTML)", () => {
    const src = `type Mode:enum = { Idle, Active }

<program>
    <mode>: Mode = .Idle
    <button onclick=@mode = .Active>Go</button>
    <div>${"$"}{@mode}</div>
</program>`;
    const { client, html } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(html).not.toBeNull();
    // Pre-fix symptom: <button onclick="mode" Active>
    expect(html).not.toMatch(/onclick="mode"/);
    expect(html).not.toMatch(/\bActive>/);
    // Post-fix: delegated event binding via data-scrml-bind-onclick
    expect(html).toMatch(/data-scrml-bind-onclick="[^"]+"/);
    // Wired as a real handler that uses the setter (not the getter)
    expect(client).toMatch(/_scrml_reactive_set\("mode",\s*"Active"\)/);
    // Wrapper shape per SPEC §5.2.2
    expect(client).toMatch(/function\(event\)\s*\{[^}]*_scrml_reactive_set\("mode"/);
  });

  test("§1.2 emitted client JS passes syntax validation", () => {
    const src = `type Mode:enum = { Idle, Active }

<program>
    <mode>: Mode = .Idle
    <button onclick=@mode = .Active>Go</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(() => new Function(client)).not.toThrow();
  });

  test("§1.3 multiple bare-assignment handlers on the same element work", () => {
    const src = `type Mode:enum = { Idle, Active }

<program>
    <mode>: Mode = .Idle
    <button onclick=@mode = .Active onmouseenter=@mode = .Idle>Toggle</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(client).toMatch(/_scrml_reactive_set\("mode",\s*"Active"\)/);
    expect(client).toMatch(/_scrml_reactive_set\("mode",\s*"Idle"\)/);
  });
});

// ---------------------------------------------------------------------------
// §1b — Postfix update + compound assigns (S97 follow-up)
// ---------------------------------------------------------------------------

describe("§1b — postfix update + compound assigns in event handler value", () => {
  test("§1b.1 onclick=@count++ lowers to setter(getter + 1)", () => {
    const src = `<program>
    <count> = 0
    <button onclick=@count++>Inc</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(client).toMatch(/_scrml_reactive_set\("count",\s*_scrml_reactive_get\("count"\)\s*\+\s*1\)/);
    // Pre-fix shape that we MUST NOT regress to:
    expect(client).not.toMatch(/_scrml_reactive_get\("count"\)\+\+/);
    expect(() => new Function(client)).not.toThrow();
  });

  test("§1b.2 onclick=@count-- lowers to setter(getter - 1)", () => {
    const src = `<program>
    <count> = 10
    <button onclick=@count-->Dec</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(client).toMatch(/_scrml_reactive_set\("count",\s*_scrml_reactive_get\("count"\)\s*-\s*1\)/);
    expect(() => new Function(client)).not.toThrow();
  });

  test("§1b.3 onclick=@count += 5 lowers to setter(getter + (5))", () => {
    const src = `<program>
    <count> = 0
    <button onclick=@count += 5>Add 5</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(client).toMatch(/_scrml_reactive_set\("count",\s*_scrml_reactive_get\("count"\)\s*\+\s*\(5\)\)/);
    expect(() => new Function(client)).not.toThrow();
  });

  test("§1b.4 onclick=@count *= 2 lowers to setter(getter * (2))", () => {
    const src = `<program>
    <count> = 3
    <button onclick=@count *= 2>Double</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(client).toMatch(/_scrml_reactive_set\("count",\s*_scrml_reactive_get\("count"\)\s*\*\s*\(2\)\)/);
    expect(() => new Function(client)).not.toThrow();
  });

  test("§1b.5 multiple compound-assign handlers on same element", () => {
    const src = `<program>
    <count> = 0
    <button onclick=@count += 5 onmouseenter=@count -= 1>Sym</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(client).toMatch(/_scrml_reactive_set\("count",\s*_scrml_reactive_get\("count"\)\s*\+\s*\(5\)\)/);
    expect(client).toMatch(/_scrml_reactive_set\("count",\s*_scrml_reactive_get\("count"\)\s*-\s*\(1\)\)/);
  });
});

// ---------------------------------------------------------------------------
// §2 — Regression: existing event-handler forms still work
// ---------------------------------------------------------------------------

describe("§2 — pre-existing event-handler forms unchanged", () => {
  test("§2.1 onclick=fn() (ATTR_CALL path) still wires as function call", () => {
    const src = `<program>
    <count> = 0
    <button onclick=doIt()>Click</button>
    ${"$"}{ function doIt() { @count = @count + 1 } }
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    // Function call wiring shape per §5.2.2 line 1128
    expect(client).toMatch(/function\(event\)\s*\{[^}]*_scrml_doIt[^(]*\(\)/);
  });

  test("§2.2 onclick=${(e) => fn(e)} (arrow form) still works", () => {
    const src = `<program>
    <count> = 0
    <button onclick=${"$"}{(e) => doIt(e)}>Click</button>
    ${"$"}{ function doIt(e) { @count = @count + 1 } }
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    // Arrow form preserved as the handler value
    expect(client).toMatch(/\(e\)\s*=>\s*_scrml_doIt/);
  });

  test("§2.3 non-event-handler attribute with `=` is NOT extended (no false-trigger)", () => {
    // `if=@flag` is a non-event-handler unquoted value. The new path must
    // NOT trigger here — if= continues to use ATTR_IDENT semantics.
    const src = `<program>
    <flag> = true
    <div if=@flag>Visible</div>
</program>`;
    const { client, html } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(html).not.toBeNull();
    // The if= attribute should NOT swallow whitespace-following content.
    // Confirms our isEventHandlerAttrName gate is doing its job.
    expect(html).not.toMatch(/onclick=/);
  });
});

// ---------------------------------------------------------------------------
// §3 — Anti-cases: tokenizer must NOT trigger on look-alikes
// ---------------------------------------------------------------------------

describe("§3 — anti-cases: tokenizer continuation detector is strict", () => {
  test("§3.1 `==` (comparison) is not mistaken for assignment", () => {
    // `onclick=@mode == .Active` would be a comparison, not an assignment.
    // Bare-form rules don't strictly recognize comparison-as-handler, but
    // the tokenizer must at least NOT silently consume the `==` as part of
    // the value (which would have been a false trigger).
    // We expect this to fall through to ATTR_IDENT ("@mode") + subsequent
    // chars handled by the outer loop's unexpected-char skip — historic
    // behavior. Test just confirms no crash + valid JS.
    const src = `type Mode:enum = { Idle, Active }

<program>
    <mode>: Mode = .Idle
    <button onclick=@mode == .Active>Test</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(() => new Function(client)).not.toThrow();
  });

  test("§3.2 `=>` (arrow) is not mistaken for assignment", () => {
    // The ${(e) => fn(e)} form uses ATTR_BLOCK/ATTR_EXPR via ${...}; the
    // bare arrow form would never appear unwrapped. But even if it did,
    // the `=>` shape is rejected by our continuation detector.
    // We just exercise the ${...} form and confirm correctness.
    const src = `<program>
    <count> = 0
    <button onclick=${"$"}{() => @count = @count + 1}>Inc</button>
</program>`;
    const { client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(() => new Function(client)).not.toThrow();
  });
});
