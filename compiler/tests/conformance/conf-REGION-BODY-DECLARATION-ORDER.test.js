/**
 * CONF-REGION-BODY-DECLARATION-ORDER | §20.8.8 step 3 + §20.8.8(6) + §6.7.2.1
 *
 * NORMATIVE
 * ---------
 * §20.8.8 step 3 — "`route-enter` fires after §20.8.2 step 4 (Hydrate/Adopt) —
 *   specifically after SSR re-seed and after `each` re-materialisation — and
 *   before step 5 (Transition), so that any paint caused by enter-time author
 *   code is captured inside the View Transition rather than flashing after it.
 *   **Bodies associated with the region run in declaration order.**"
 *
 * §20.8.8(6) — "**Initial load.** The first rendering of route content into the
 *   `<outlet>` on document load **IS a `route-enter`**. Region-associated bodies
 *   therefore run **exactly once** on initial load — never zero times, never
 *   twice."
 *
 * §6.7.2.1 — "Every `${}` logic block, `on mount` body, `<request>`, `<timer>`,
 *   `<poll>`, and `cleanup()` registration is associated **at compile time**
 *   with the nearest enclosing element scope **or route region**."
 *
 * WHAT THIS PINS, AND WHY IT NEEDS NO NAVIGATION MACHINERY
 * -------------------------------------------------------
 * (3) states the ordering; (6) makes initial load a `route-enter`. Together they
 * bind a page that never navigates — which is why this case is assertable in
 * FULL (codes + runtime) today, ahead of the route-region arc. It is INDEPENDENT
 * of CN-1..CN-10 (`docs/changes/route-region-teardown/CONFORMANCE-CN1-CN10.md`),
 * none of which pins the ordering sentence.
 *
 * THE RUNTIME HALF IS EXECUTED, NOT GREPPED. "Emitted ≠ runs" has five recorded
 * occurrences in this project, so the assertion below EVALUATES the emitted
 * client bundle under a recording stub of the runtime and asserts the observed
 * RUN order — `<request>`'s `fetch(...)` call and `<timer>`'s
 * `_scrml_timer_start(...)` — matches the source declaration order.
 *
 * FAIL-BEFORE / PASS-AFTER (measured at 60cd90e3, the pre-fix baseline):
 *   pre-fix  run order: ["timer:1000", "request:/api/a", "request:/api/c"]
 *   post-fix run order: ["request:/api/a", "timer:1000", "request:/api/c"]
 *
 * NEG asserts the complement: `<channel>` / `<keyboard>` / `<timeout>` are NOT
 * in §6.7.2.1's set and SHALL NOT be pulled into the ordering.
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return {
      errors: (result.errors ?? []).filter(e => (e.severity ?? "error") === "error"),
      clientJs: result.outputs.get(tmpInput)?.clientJs ?? "",
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * EXECUTE the emitted module-init and record the order in which the
 * region-associated bodies actually run.
 *
 * The bundle is evaluated inside a `with (sandbox)` block whose Proxy answers
 * `has` for every identifier, so each free `_scrml_*` reference resolves to a
 * recording stub instead of throwing. Only the two calls this case asserts on
 * are instrumented; everything else is an inert no-op. A `<request url=>`'s
 * generated `fetch(...)` argument evaluation happens synchronously, BEFORE the
 * first `await`, so the push order is the module-init run order.
 */
function runOrderOf(clientJs) {
  const order = [];
  const cells = new Map();
  const stubs = {
    fetch: (url) => {
      order.push(`request:${url}`);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    },
    _scrml_timer_start: (_scope, _id, ms) => { order.push(`timer:${ms}`); },
    _scrml_deep_reactive: (o) => o,
    _scrml_reactive_get: (n) => cells.get(n),
    _scrml_reactive_set: (n, v) => { cells.set(n, v); return v; },
    _scrml_init_set: () => {},
    _scrml_effect: (fn) => { try { fn(); } catch { /* stub effect */ } return () => {}; },
    _scrml_channel_open: (name) => { order.push(`channel:${name}`); },
    setTimeout: (_fn, ms) => { order.push(`timeout:${ms}`); return 0; },
    document: {
      readyState: "loading",
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { style: { setProperty: () => {} } },
    },
    window: { addEventListener: () => {}, location: { pathname: "/" } },
  };
  const sandbox = new Proxy(stubs, {
    has: () => true,
    get(target, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (prop in target) return target[prop];
      if (typeof prop === "string" && prop.startsWith("_scrml_")) {
        const noop = () => undefined;
        target[prop] = noop;
        return noop;
      }
      if (typeof prop === "string" && prop in globalThis) return globalThis[prop];
      return undefined;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  const body = clientJs.replace(/^\s*import\s[^;]*;\s*$/gm, "");
  // eslint-disable-next-line no-new-func
  new Function("__sandbox__", `with (__sandbox__) { ${body} }`)(sandbox);
  return order;
}

describe("CONF-REGION-BODY-DECLARATION-ORDER: §20.8.8 step 3 bodies run in declaration order", () => {
  const INTERLEAVED = `<program>
  <log>: string[] = []
  <request id="first" url="/api/a"/>
  <timer id="tick" interval=1000>
    \${ @log = [...@log, "tick"] }
  </timer>
  <request id="third" url="/api/c"/>
  <div><p>\${@log.length}</p></div>
</>
`;

  test("codes: the interleaved region-body shape compiles clean", () => {
    const { errors } = compile(INTERLEAVED, "region-decl-order-codes");
    expect(errors.map(e => e.code)).toEqual([]);
  });

  test("RUNTIME (executed): a <timer> declared between two <request>s runs between them", () => {
    const { clientJs } = compile(INTERLEAVED, "region-decl-order-runtime");
    // Declared: request(first) → timer → request(third).
    expect(runOrderOf(clientJs)).toEqual([
      "request:/api/a",
      "timer:1000",
      "request:/api/c",
    ]);
  });

  test("RUNTIME (executed): the mirror — a <request> declared between two <timer>s runs between them", () => {
    const src = `<program>
  <log>: string[] = []
  <timer id="early" interval=1000>
    \${ @log = [...@log, "early"] }
  </timer>
  <request id="middle" url="/api/b"/>
  <timer id="late" interval=3000>
    \${ @log = [...@log, "late"] }
  </timer>
  <div><p>\${@log.length}</p></div>
</>
`;
    const { clientJs } = compile(src, "region-decl-order-mirror");
    expect(runOrderOf(clientJs)).toEqual([
      "timer:1000",
      "request:/api/b",
      "timer:3000",
    ]);
  });

  test("NEG: <channel>, input-state and <timeout> are NOT in §6.7.2.1's set and are not reordered", () => {
    const src = `<program>
  <log>: string[] = []
  <request id="first" url="/api/a"/>
  <timer id="tick" interval=1000>
    \${ @log = [...@log, "tick"] }
  </timer>
  <channel name="feed" topic="updates"/>
  <keyboard id="keys"/>
  <timeout id="late" delay=5000>
    \${ @log = [...@log, "late"] }
  </timeout>
  <div><p>\${@log.length}</p></div>
</>
`;
    const { clientJs } = compile(src, "region-decl-order-neg");
    const emitted = clientJs
      .split("\n")
      .filter(l => /^\/\/ <(request|timer|keyboard|timeout|channel)\b/.test(l))
      .map(l => l.replace(/^\/\/ </, "<").replace(/ .*$/, "").replace(/>$/, ""));
    // The two IN-SET nodes are declaration-ordered relative to each other; the
    // three OUT-OF-SET nodes keep their own bucket order (input-state, then
    // channel, then timeout) and are untouched by this landing.
    expect(emitted).toEqual(["<request", "<timer", "<keyboard", "<channel", "<timeout"]);
  });
});
