/**
 * inline-map-assign-handler-s169.test.js — S177 s169-map-inline-insert (LOW).
 *
 * SPEC §59.7/§59.8 — a value-native map's write methods (`insert`/`remove`/…) are
 * PURE free functions: `@m.insert(k, v)` lowers to `_scrml_map_insert(m, k, v)`
 * (returns a NEW map; `@m = @m.insert(k, v)` rides the existing reactive set).
 * The runtime map is a plain `{ entries, ordered, order }` object with NO
 * `.insert` method on it.
 *
 * BUG: an INLINE event handler `onclick=${@m = @m.insert(k, v)}` routed through
 * the string `rewriteBlockBody` path (emit-event-wiring.ts excluded `assign`
 * nodes from the emitExprField path). rewriteReactiveAssign re-emitted the RHS
 * VERBATIM, producing a bare `_scrml_reactive_get("m").insert(k, v)` — a runtime
 * TypeError on click (no `.insert` method on the map object). The named-fn
 * handler (which goes through emitExpr/emitAssign with ctx.mapVarNames) emitted
 * the correct `_scrml_map_insert(...)`.
 *
 * FIX (emit-event-wiring.ts): narrow the `assign` exclusion so a MAP-VAR assign
 * (`@m = …` with `m` in mapVarNames) routes through emitExprField too — emitAssign
 * lowers the RHS via emitExpr + ctx.mapVarNames, byte-identical to the named-fn
 * path. NON-map assigns (engine `@phase = .X`) keep the rewriteBlockBody path.
 *
 * Coverage:
 *   §1 — inline `@m = @m.insert(k, v)` emits `_scrml_map_insert` (NOT `.insert`)
 *   §2 — inline handler is byte-identical to the named-fn control
 *   §3 — inline `@m = @m.remove(k)` emits `_scrml_map_remove`
 *   §4 — regression: inline engine assign `@phase = .Loading` still lowers normally
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "s169-inline-map-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compileClientJs(filename, source) {
  const abs = join(TMP, filename);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, source);
  compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: true, log: () => {} });
  const p = join(TMP, "dist", filename.replace(/\.scrml$/, "") + ".client.js");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

describe("§1-2 inline map-assign handler lowers `.insert` -> `_scrml_map_insert`", () => {
  const INLINE = `<div class="fare-board">
    \${
        <fareByLane>: [string: int] = ["DAL-001": 4500]
    }
    <h1>Fares by lane</>
    <p>DAL-001: \${@fareByLane["DAL-001"]}</>
    <button onclick=\${@fareByLane = @fareByLane.insert("HOU-002", 3800)}>Add HOU-002</>
</div>`;
  const NAMED = `<div class="fare-board">
    \${
        <fareByLane>: [string: int] = ["DAL-001": 4500]
        function addLane() {
            @fareByLane = @fareByLane.insert("HOU-002", 3800)
        }
    }
    <h1>Fares by lane</>
    <button onclick=\${addLane()}>Add HOU-002</>
</div>`;

  test("§1 inline handler emits `_scrml_map_insert`, not a bare `.insert`", () => {
    const js = compileClientJs("inline.scrml", INLINE);
    expect(js).toContain('_scrml_map_insert(_scrml_reactive_get("fareByLane"), "HOU-002", 3800)');
    // The bare `.insert(` method call (TypeError at click) must be GONE.
    expect(js).not.toContain('_scrml_reactive_get("fareByLane").insert(');
  });

  test("§2 inline handler RHS is byte-identical to the named-fn control", () => {
    const inlineJs = compileClientJs("inline2.scrml", INLINE);
    const namedJs = compileClientJs("named.scrml", NAMED);
    const grab = (s) => {
      const m = s.match(/_scrml_reactive_set\("fareByLane", _scrml_map_insert\([^;]*\)\)/);
      return m ? m[0] : null;
    };
    const inlineCall = grab(inlineJs);
    const namedCall = grab(namedJs);
    expect(inlineCall).not.toBeNull();
    expect(namedCall).not.toBeNull();
    expect(inlineCall).toBe(namedCall);
  });
});

describe("§3 inline map `.remove` also lowers", () => {
  test("`@m = @m.remove(k)` emits `_scrml_map_remove`", () => {
    const js = compileClientJs("remove.scrml", `<div>
    \${
        <m>: [string: int] = ["a": 1]
    }
    <button onclick=\${@m = @m.remove("a")}>Del</>
</div>`);
    expect(js).toContain('_scrml_map_remove(_scrml_reactive_get("m"), "a")');
    expect(js).not.toContain('_scrml_reactive_get("m").remove(');
  });
});

describe("§4 regression — inline engine assign unaffected", () => {
  test("`@phase = .Loading` still lowers to a reactive set", () => {
    const js = compileClientJs("engine.scrml", `<div>
    \${
        type Phase:enum = { Idle, Loading }
        <phase>: Phase = .Idle
    }
    <engine for=Phase initial=.Idle>
        <Idle rule=.Loading><p>Idle</p></>
        <Loading><p>Loading</p></>
    </engine>
    <button onclick=\${@phase = .Loading}>Go</>
</div>`);
    expect(js).toContain('_scrml_reactive_set("phase", "Loading")');
    expect(js).not.toContain('@phase');
  });
});
