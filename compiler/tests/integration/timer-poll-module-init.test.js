/**
 * g-timer-poll-body-runs-once-at-module-init (S340-peter) — a `<timer>`/`<poll>`
 * body must execute ON each tick, NOT once at module init.
 *
 * DEFECT (pre-fix): collectTopLevelLogicStatements (collect.ts) descended into a
 * tick-tag node's children, so the `${}` body was ALSO collected as a top-level
 * statement and emitted at module scope — running once at load, before any tick
 * (§6.7.5 says a `<timer>`'s first execution is one interval after arming; the body
 * never runs at load). `<request>` keeps descending — for it the descent IS the
 * designed canonical-form fetch.
 *
 * FIX (fix/timer-poll-module-init-run), two halves that land together (S314 fork,
 * bryan option (b); SPEC §6.7.6 amendment already landed):
 *  1. collect.ts skips descent into `tag` in {timer, poll} → no module-init run.
 *  2. §6.7.6 — a `<poll>` fires an immediate first tick ON ARMING, routed through the
 *     runtime's SAME tick() path (`_scrml_timer_start(..., immediate)`), gated by
 *     `running=`, once per arming (never on resume). A `<timer>` stays strict.
 *
 * Asserts BOTH halves + the timer-stays-strict asymmetry + the running= gate.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function compileClientJs(source) {
  const dir = mkdtempSync(join(tmpdir(), "timer-poll-modinit-"));
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const p = join(dir, "app.scrml");
  writeFileSync(p, source);
  compileScrml({ inputFiles: [p], write: true, outputDir: dist, log: () => {} });
  const client = readdirSync(dist).find((f) => f.endsWith(".client.js"));
  return client ? readFileSync(join(dist, client), "utf8") : "";
}

// Region of the client JS BEFORE the first _scrml_timer_start call — i.e. module
// scope. The tick body must NOT appear here.
function moduleScopeBefore(js, marker = "_scrml_timer_start") {
  const idx = js.indexOf(marker);
  return idx === -1 ? js : js.slice(0, idx);
}

describe("g-timer-poll-body-runs-once-at-module-init — tick body does not run at load", () => {
  test("<timer> body is NOT emitted at module scope (only inside the tick callback)", () => {
    const js = compileClientJs(
      `<ticks> = 0\n<timer interval=1000>\${ @ticks = @ticks + 1 }</timer>\n<p>\${@ticks}</p>\n`,
    );
    expect(js).toContain("_scrml_timer_start");
    // The increment is the tick body — it must appear exactly once, INSIDE the callback.
    const increments = js.split('_scrml_cs_reactive_get("ticks") + 1').length - 1;
    expect(increments).toBe(1);
    // …and it must NOT be at module scope (before the timer_start call).
    expect(moduleScopeBefore(js)).not.toContain('_scrml_cs_reactive_get("ticks") + 1');
  });

  test("<timer> stays strict: no immediate tick (timer_start passes no `immediate`)", () => {
    const js = compileClientJs(
      `<ticks> = 0\n<timer interval=1000>\${ @ticks = @ticks + 1 }</timer>\n`,
    );
    // The timer_start callback closes with `});` — no immediate arg.
    expect(js).toMatch(/_scrml_timer_start\([^;]*\n\s*_scrml_cs_reactive_set\("ticks"[^;]*;\n\}\);/);
    expect(js).not.toContain("}, true);");
  });

  test("<poll> fires an immediate first tick (timer_start closes with `, true)`) and does NOT run at module scope", () => {
    const js = compileClientJs(
      `<serverTime> = ""\n<poll id="serverTime" interval=10000>\${ @serverTime = "x" }</poll>\n`,
    );
    expect(js).toContain("}, true);");
    // The body assignment appears exactly once — inside the tick callback, not module scope.
    const writes = js.split('_scrml_cs_reactive_set("serverTime", "x")').length - 1;
    expect(writes).toBe(1);
    expect(moduleScopeBefore(js)).not.toContain('_scrml_cs_reactive_set("serverTime", "x")');
  });

  test("<poll running=false> does NOT fire an immediate tick (arming has not occurred)", () => {
    const js = compileClientJs(
      `<serverTime> = ""\n<poll id="serverTime" interval=5000 running=false>\${ @serverTime = "x" }</poll>\n`,
    );
    expect(js).toContain("_scrml_timer_start");
    expect(js).not.toContain("}, true);");
    expect(js).toContain("_scrml_timer_pause");
  });

  test("<poll running=@cell> gates the immediate tick on the cell value at arming", () => {
    const js = compileClientJs(
      `<active> = true\n<serverTime> = ""\n<poll id="serverTime" interval=5000 running=@active>\${ @serverTime = "x" }</poll>\n`,
    );
    // immediate arg is the runtime value of the running cell, evaluated at arming.
    expect(js).toMatch(/\}, _scrml_cs_reactive_get\("active"\)\);/);
  });

  // §6.7.8 — a <timeout> body executes exactly once, AFTER `delay` — never at module
  // init. Same collect.ts-descent leak class as <timer>/<poll>; converged into
  // DEFERRED_LIFECYCLE_BODY_TAGS. (g-timeout-body-runs-once-at-module-init)
  test("<timeout> body is NOT emitted at module scope (only inside the setTimeout callback)", () => {
    const js = compileClientJs(
      `<program>\n<fired> = false\n<timeout id="g" delay=1000>\${ @fired = true }</timeout>\n<p>\${@fired}</p>\n</program>\n`,
    );
    expect(js).toContain("setTimeout");
    // The `@fired = true` body assignment must appear exactly once — inside the
    // setTimeout callback, not at module scope. (`g_fired` is the separate <#g>.fired
    // property accounting and is matched with a word boundary so it is not counted.)
    const bodyWrites = js.split(/(?<![a-zA-Z_])_scrml_cs_reactive_set\("fired", true\)/).length - 1;
    expect(bodyWrites).toBe(1);
    expect(moduleScopeBefore(js, "setTimeout")).not.toMatch(
      /(?<![a-zA-Z_])_scrml_cs_reactive_set\("fired", true\)/,
    );
  });

  // §6.7.8 companion — <timeout> must not false-fire E-MARKUP-001 ("not a known
  // element"); `timeout` was missing from name-resolver's non-element exclusion set.
  // (g-emarkup001-false-positive-timeout)
  test("<timeout> compiles without a false E-MARKUP-001", () => {
    const js = compileClientJs(
      `<program>\n<fired> = false\n<timeout delay=1000>\${ @fired = true }</timeout>\n</program>\n`,
    );
    // A clean compile emits the timeout runtime; if E-MARKUP-001 had aborted codegen
    // the setTimeout wiring would be absent.
    expect(js).toContain("setTimeout");
  });
});
