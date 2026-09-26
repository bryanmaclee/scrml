/**
 * lift-row-handler-notify-wrapper-not-callable.test.js — S432, regression from #1054.
 *
 * #1054 lowers an expression-position mutating call on a reactive cell to the §6.5.1
 * notify wrapper `((_scrml_m) => (_scrml_reactive_set(k, …), _scrml_m))(<call>)`. The
 * lift-row handler emitter decided "is this handler already a function?" with a prefix
 * regex (`\([^)]*\)\s*=>` — `[^)]*` eats the wrapper's leading `(`), so it registered the
 * wrapper's CALL as the listener: the push ran once at render time, per row, and the
 * click handler was the push's return value (a number). The check is now a parse of the
 * whole emitted text (ArrowFunctionExpression / FunctionExpression only).
 *
 * Emit-shape assertions plus one runtime assertion of the emitted listener semantics.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileClient(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-lift-notify-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: (result.errors ?? []).filter((e) => e.severity !== "warning"),
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function clickListenerLines(js) {
  return js.split(/\r?\n/).filter((l) => l.includes('addEventListener("click"'));
}

const PUSH_ROW = `<program>
<items> = [1, 2]
\${
  for (const x of @items) {
    lift <button class="b" onclick=\${@items.push(9)}>\${x}</button>
  }
}
<p id="c">\${@items.length}</p>
</program>
`;

describe("lift-row handler: the §6.5.1 notify wrapper is a call, not a callable", () => {
  test("a mutating-method handler in a lift row is wrapped in function(event){…}", () => {
    const { errors, clientJs } = compileClient(PUSH_ROW, "push");
    expect(errors).toEqual([]);
    const lines = clickListenerLines(clientJs);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      // The listener must be a function whose BODY performs the push — never the
      // push's (render-time) result.
      expect(l).toMatch(/addEventListener\("click", function\(event\) \{/);
      expect(l).not.toMatch(/addEventListener\("click", \(\(_scrml_m\) =>/);
    }
  });

  test("the emitted listener does not run the mutation until invoked", () => {
    const { clientJs } = compileClient(PUSH_ROW, "rt");
    const line = clickListenerLines(clientJs)[0];
    const listenerSrc = line.slice(line.indexOf('"click", ') + '"click", '.length, line.lastIndexOf(");"));
    const store = { items: [1, 2] };
    const sets = [];
    const env = {
      _scrml_cs_reactive_get: (k) => store[k],
      _scrml_cs_reactive_set: (k, v) => { sets.push(k); store[k] = v; },
      _scrml_reactive_get: (k) => store[k],
      _scrml_reactive_set: (k, v) => { sets.push(k); store[k] = v; },
    };
    const make = new Function(...Object.keys(env), `return (${listenerSrc});`);
    const listener = make(...Object.values(env));
    // Building the listener (≈ render time) must not touch the cell.
    expect(store.items).toEqual([1, 2]);
    expect(typeof listener).toBe("function");
    listener({});
    expect(store.items).toEqual([1, 2, 9]);
    expect(sets).toEqual(["items"]);
  });

  test("a real arrow handler in a lift row stays callable-direct (Bug 11/12/73 unaffected)", () => {
    const src = `<program>
<items> = [1, 2]
<last> = 0
<ul>
  \${ for (const y of @items) { lift <li><button class="c" onclick=\${() => @last = y}>\${y}</button></li> } }
</ul>
<p>\${@last}</p>
</program>
`;
    const { errors, clientJs } = compileClient(src, "arrow");
    expect(errors).toEqual([]);
    const lines = clickListenerLines(clientJs);
    expect(lines.length).toBeGreaterThan(0);
    // The arrow is INVOKED inside the Bug-73 live-resolving wrapper, not dead-wrapped.
    expect(lines.some((l) => /\(\(\) => _scrml_cs_reactive_set\("last", y\)\)\(event\)/.test(l))).toBe(true);
  });
});
