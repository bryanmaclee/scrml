/**
 * S97 — bare-form event handler reactive-method-call shape
 *
 * The ATTR_CALL tokenization at `tokenizer.ts:399-417` reads the LHS ident
 * greedily including `.` characters — so `onclick=@outer.advance(.X)`
 * produces ATTR_CALL with `name = "@outer.advance"`, `args = [".X"]`.
 * Pre-fix the event-handler call-ref emitter spliced these verbatim into
 * the wrapper:
 *   `function(event) { @outer.advance("Playing".history); }`
 * Invalid JS (`@` not a legal identifier char; `"Playing".history` is
 * meaningless string member access).
 *
 * Affected ALL `@<var>.method(args)` shapes used as bare-call event
 * handlers — array mutations (`@list.push(x)`), engine advance with
 * history-restore (`@engine.advance(.X.history)`), and any compound-cell
 * method call.
 *
 * Fix: in emit-event-wiring.ts call-ref path, when handlerName starts
 * with `@` and handlerArgExprNodes is complete, synthesize a structured
 * CallExpr (callee = MemberExpr chain from the dotted name; args = the
 * pre-parsed argExprNodes) and emit via emitExprField. The structured
 * path routes through emit-expr.ts:emitCall — for engine `.advance`
 * shapes it hits the C13 dispatch (including `.X.history` peel-off for
 * history-restore); for non-engine method calls it produces
 * `_scrml_reactive_get("var").method(args)` via emitMember + emitCall.
 *
 * SPEC authority: §5.2 (event handlers); §51.0.G (`.advance(.X)` form);
 *                  §51.0.N (history-restore `.X.history` target form).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import fs from "fs";
import path from "path";
import os from "os";

function compileSrcToTmp(src, basename = "method-call-test") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rmc-"));
  const srcPath = path.join(tmpDir, `${basename}.scrml`);
  fs.writeFileSync(srcPath, src);
  try {
    compileScrml({
      inputFiles: [srcPath],
      write: true,
      outputDir: tmpDir,
    });
    const clientPath = path.join(tmpDir, `${basename}.client.js`);
    return fs.existsSync(clientPath) ? fs.readFileSync(clientPath, "utf-8") : null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("§1 — reactive method call on array cell", () => {
  test("§1.1 onclick=@items.push(x) emits _scrml_reactive_get().push", () => {
    const src = `<program>
    <items> = ["a", "b"]
    <button onclick=@items.push("c")>Add</button>
</program>`;
    const client = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    // Pre-fix symptom: `function(event){ @items.push("c"); }` (invalid JS)
    expect(client).not.toMatch(/function\(event\)\s*\{\s*@/);
    expect(client).toMatch(/_scrml_reactive_get\("items"\)\.push\("c"\)/);
    expect(() => new Function(client)).not.toThrow();
  });

  test("§1.2 onclick=@items.sort() handles zero-arg method call", () => {
    const src = `<program>
    <items> = [3, 1, 2]
    <button onclick=@items.sort()>Sort</button>
</program>`;
    const client = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(client).not.toMatch(/function\(event\)\s*\{\s*@/);
    expect(client).toMatch(/_scrml_reactive_get\("items"\)\.sort\(\)/);
    expect(() => new Function(client)).not.toThrow();
  });
});

describe("§2 — engine .advance(.X) dispatches via C13", () => {
  test("§2.1 onclick=@engine.advance(.Variant) emits _scrml_engine_advance", () => {
    const src = `type Mode:enum = { A, B }

<program>
    <engine for=Mode initial=.A>
        <A rule=.B/>
        <B rule=.A/>
    </>
    <button onclick=@mode.advance(.B)>Go</button>
</program>`;
    const client = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    // Should use the engine-advance runtime helper, not `@mode.advance(...)`
    expect(client).not.toMatch(/@mode\.advance/);
    expect(client).toMatch(/_scrml_engine_advance\("mode",\s*"B"/);
    expect(() => new Function(client)).not.toThrow();
  });

  test("§2.2 onclick=@engine.advance(.X.history) peels off .history and passes isHistoryRestore=true", () => {
    const src = `type Outer:enum = { Idle, Playing }
type Inner:enum = { Slow, Fast }

<program>
    <engine for=Outer initial=.Idle>
        <Idle rule=.Playing/>
        <Playing history rule=.Idle>
            <engine for=Inner initial=.Slow>
                <Slow rule=.Fast/>
                <Fast rule=.Slow/>
            </>
        </>
    </>
    <button onclick=@outer.advance(.Playing.history)>Resume</button>
</program>`;
    const client = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    // Pre-fix symptom: `@outer.advance("Playing".history)` — broken JS
    expect(client).not.toMatch(/@outer\.advance/);
    expect(client).not.toMatch(/"Playing"\.history/);
    // Post-fix: engine-advance call with `.history` peeled + isHistoryRestore=true
    // Signature: _scrml_engine_advance(varName, variant, transitions, ..., history, isHistoryRestore)
    expect(client).toMatch(/_scrml_engine_advance\("outer",\s*"Playing",[^)]*,\s*true\)/);
    expect(() => new Function(client)).not.toThrow();
  });
});

describe("§3 — regression: bare-call without @ unchanged", () => {
  test("§3.1 onclick=fn() still emits the simple bare-call wrapper", () => {
    const src = `<program>
    <count> = 0
    <button onclick=doIt()>+</button>
    ${"$"}{ function doIt() { @count = @count + 1 } }
</program>`;
    const client = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    // No reactive-get/set on the handler invocation itself; just the function call
    expect(client).toMatch(/function\(event\)\s*\{\s*_scrml_doIt[^(]*\(\)/);
    expect(() => new Function(client)).not.toThrow();
  });

  test("§3.2 onclick=fn(literal) still passes the literal", () => {
    const src = `<program>
    <selected> = ""
    <button onclick=pick("alpha")>Alpha</button>
    ${"$"}{ function pick(v) { @selected = v } }
</program>`;
    const client = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    expect(client).toMatch(/_scrml_pick[^(]*\("alpha"\)/);
    expect(() => new Function(client)).not.toThrow();
  });
});
