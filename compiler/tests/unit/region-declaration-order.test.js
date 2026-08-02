/**
 * region-declaration-order.test.js — §20.8.8 step 3: region-associated bodies
 * emit (and therefore run) in DECLARATION order, not in bucket order.
 *
 * Gap: `g-region-bodies-emit-in-bucket-order-not-declaration-order` (MED).
 * Change-id: `region-declaration-order` (U1a).
 *
 * NORMATIVE TEXT
 * --------------
 * §20.8.8 step 3 — "`route-enter` fires after §20.8.2 step 4 (Hydrate/Adopt) …
 *   Bodies associated with the region run in declaration order."
 * §20.8.8(6) — "Initial load. The first rendering of route content into the
 *   `<outlet>` on document load IS a `route-enter`. Region-associated bodies
 *   therefore run exactly once on initial load — never zero times, never twice."
 * §6.7.2.1 — "Every `${}` logic block, `on mount` body, `<request>`, `<timer>`,
 *   `<poll>`, and `cleanup()` registration is associated at compile time with
 *   the nearest enclosing element scope or route region."
 *
 * Together those bind a page that never navigates: at module init the EMITTED
 * order IS the run order, so emitted position must follow source position.
 *
 * THE DEFECT (pre-fix, reproduced on 60cd90e3)
 * --------------------------------------------
 * `emitReactiveWiring` emitted five sequential BUCKET passes — Step 5 lifecycle
 * (`<timer>`/`<poll>`) → 5b input-state → 5.5 channel → 5c `<request>`. Within a
 * bucket the walk is source-ordered; ACROSS buckets every `<timer>` preceded
 * every `<request>` regardless of authoring, so a `<timer>` declared SECOND ran
 * before a `<request>` declared FIRST.
 *
 * SCOPE — three of §6.7.2.1's six kinds are classified by this emitter
 * (`<timer>`, `<poll>`, `<request>`) and only those three are reordered.
 * `<keyboard>`/`<mouse>`/`<gamepad>`, `<channel>` and `<timeout>` are NOT in
 * §6.7.2.1's set; §5 below is the negative assertion that they did not move.
 *
 * Coverage:
 *   §1  request → timer → request  (url= mode) emits in declaration order
 *   §2  timer → request → timer    (the mirror; rules out "requests first")
 *   §3  <poll> participates too, and a 5-node interleaving round-trips exactly
 *   §4  §60.4 `api=` mode interleaves identically to url= mode
 *   §5  NEGATIVE — <keyboard>/<channel>/<timeout> keep their bucket order
 *   §6  single-kind files are unchanged (byte-parity guard for the corpus)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/region-declaration-order");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function compileSource(name, src) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  const result = compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
  const out = result.outputs.get(path);
  if (!out) throw new Error(`no output for ${name}: ${(result.errors ?? []).map(e => e.code).join(", ")}`);
  return out.clientJs;
}

/**
 * The ORACLE. Every reactive-wiring emitter opens each node's block with a
 * marker comment naming the source tag and its id, so the emitted marker
 * sequence IS the emitted position order. Returns e.g.
 * ["request:first", "timer:tick", "request:third"].
 */
function emittedOrder(clientJs) {
  const seq = [];
  for (const line of clientJs.split("\n")) {
    let m;
    if ((m = line.match(/^\/\/ <(timer|poll) id="([^"]+)"> interval=/))) seq.push(`${m[1]}:${m[2]}`);
    else if ((m = line.match(/^\/\/ <request id="([^"]+)"(?: api="[^"]*")?>/))) seq.push(`request:${m[1]}`);
    else if ((m = line.match(/^\/\/ <(keyboard|mouse|gamepad) id="([^"]+)"/))) seq.push(`${m[1]}:${m[2]}`);
    else if ((m = line.match(/^\/\/ <timeout id="([^"]+)" delay=/))) seq.push(`timeout:${m[1]}`);
    else if ((m = line.match(/^\/\/ <channel name="([^"]+)" topic="[^"]*"> — WebSocket client/))) seq.push(`channel:${m[1]}`);
  }
  return seq;
}

/** The DECLARATION order, read straight off the source text. */
function declaredOrder(src) {
  const seq = [];
  const re = /<(timer|poll|request|keyboard|mouse|gamepad|timeout|channel)\b[^>]*?\b(?:id|name)="([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) seq.push(`${m[1]}:${m[2]}`);
  return seq;
}

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("§20.8.8 step 3 — region-associated bodies emit in declaration order", () => {
  // -------------------------------------------------------------------------
  // §1 — the reported shape: request, timer, request.
  // -------------------------------------------------------------------------
  test("§1 request → timer → request emits in declaration order (the reported defect)", () => {
    const src = `<program>
  <log>: string[] = []
  <request id="first" url="/api/a"/>
  <timer id="tick" interval=1000>
    \${ @log = [...@log, "tick"] }
  </timer>
  <request id="third" url="/api/c"/>
  <div><p>\${@log.length}</p></div>
</>
`;
    const js = compileSource("req-timer-req.scrml", src);
    expect(emittedOrder(js)).toEqual(["request:first", "timer:tick", "request:third"]);
    // And it agrees with the source, read independently.
    expect(emittedOrder(js)).toEqual(declaredOrder(src));
  });

  // -------------------------------------------------------------------------
  // §2 — the mirror. Rules out a fix that merely moved requests to the front.
  // -------------------------------------------------------------------------
  test("§2 timer → request → timer emits in declaration order (mirror of §1)", () => {
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
    const js = compileSource("timer-req-timer.scrml", src);
    expect(emittedOrder(js)).toEqual(["timer:early", "request:middle", "timer:late"]);
    expect(emittedOrder(js)).toEqual(declaredOrder(src));
  });

  // -------------------------------------------------------------------------
  // §3 — <poll> is in §6.7.2.1's set too; a 5-node interleaving round-trips.
  // -------------------------------------------------------------------------
  test("§3 a five-node <request>/<timer>/<poll> interleaving round-trips exactly", () => {
    const src = `<program>
  <log>: string[] = []
  <request id="r1" url="/api/1"/>
  <poll id="p1" interval=5000>
    \${ @log = [...@log, "p1"] }
  </poll>
  <request id="r2" url="/api/2"/>
  <timer id="t1" interval=1000>
    \${ @log = [...@log, "t1"] }
  </timer>
  <request id="r3" url="/api/3"/>
  <div><p>\${@log.length}</p></div>
</>
`;
    const js = compileSource("five-node-interleave.scrml", src);
    expect(emittedOrder(js)).toEqual(["request:r1", "poll:p1", "request:r2", "timer:t1", "request:r3"]);
    expect(emittedOrder(js)).toEqual(declaredOrder(src));
  });

  // -------------------------------------------------------------------------
  // §4 — §60.4 `api=` mode (typed external API) interleaves identically.
  // -------------------------------------------------------------------------
  test("§4 §60.4 api= requests interleave with <timer> in declaration order", () => {
    const src = `<api base="https://api.example.com">
  getStatus(StatusQuery) -> GET "/status" : StatusResult
</api>

<program>
  type StatusQuery:struct = { id: int }
  type StatusResult:enum = { Up, Down }
  <q>: StatusQuery = { id: 1 }
  <log>: string[] = []

  <request id="before" api="getStatus" args=@q/>
  <timer id="tick" interval=1000>
    \${ @log = [...@log, "tick"] }
  </timer>
  <request id="after" api="getStatus" args=@q/>
  <div><p>\${@log.length}</p></div>
</>
`;
    const js = compileSource("api-mode-interleave.scrml", src);
    expect(emittedOrder(js)).toEqual(["request:before", "timer:tick", "request:after"]);
  });

  // -------------------------------------------------------------------------
  // §5 — NEGATIVE. The out-of-set kinds were NOT widened into the ordering.
  //
  // §6.7.2.1's set is exactly six kinds. `<keyboard>`/`<mouse>`/`<gamepad>`,
  // `<channel>` and `<timeout>` are not among them, so they keep their own
  // bucket passes and their fixed relative order (input-state → channel →
  // timeout) EVEN WHEN the source declares them in another order. Reordering
  // them would be a semantics change with no clause behind it.
  // -------------------------------------------------------------------------
  test("§5 NEGATIVE — <timeout>, <channel> and input-state keep bucket order, not source order", () => {
    const src = `<program>
  <log>: string[] = []
  <pressed>: bool = false

  <timeout id="late" delay=5000>
    \${ @log = [...@log, "late"] }
  </timeout>
  <channel name="feed" topic="updates"/>
  <keyboard id="keys"/>
  <div><p>\${@log.length}</p></div>
</>
`;
    const js = compileSource("out-of-set-order.scrml", src);
    // Declared: timeout, channel, keyboard. Emitted: the fixed bucket order.
    expect(declaredOrder(src)).toEqual(["timeout:late", "channel:feed", "keyboard:keys"]);
    expect(emittedOrder(js)).toEqual(["keyboard:keys", "channel:feed", "timeout:late"]);
  });

  test("§5b NEGATIVE — an out-of-set kind stays put around the in-set ordering", () => {
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
    const js = compileSource("mixed-set-order.scrml", src);
    // The two in-set nodes are in declaration order relative to EACH OTHER;
    // the three out-of-set nodes follow in their own unchanged bucket order.
    expect(emittedOrder(js)).toEqual([
      "request:first", "timer:tick",     // in-set, declaration-ordered
      "keyboard:keys", "channel:feed", "timeout:late", // out-of-set, bucket-ordered
    ]);
  });

  // -------------------------------------------------------------------------
  // §6 — a file declaring only ONE in-set kind is unchanged. This is the guard
  // that made the corpus artifact diff byte-identical: the merged pass occupies
  // the legacy lifecycle slot when any <timer>/<poll> exists and the legacy
  // request slot otherwise, so nothing moves unless the file interleaves.
  // -------------------------------------------------------------------------
  test("§6 timers-only: the lifecycle block still precedes channel + timeout", () => {
    const src = `<program>
  <log>: string[] = []
  <channel name="feed" topic="updates"/>
  <timer id="a" interval=1000>
    \${ @log = [...@log, "a"] }
  </timer>
  <timer id="b" interval=2000>
    \${ @log = [...@log, "b"] }
  </timer>
  <timeout id="late" delay=5000>
    \${ @log = [...@log, "late"] }
  </timeout>
  <div><p>\${@log.length}</p></div>
</>
`;
    const js = compileSource("timers-only.scrml", src);
    expect(emittedOrder(js)).toEqual(["timer:a", "timer:b", "channel:feed", "timeout:late"]);
  });

  test("§6b requests-only: the request block still FOLLOWS channel + input-state", () => {
    const src = `<program>
  <request id="a" url="/api/a"/>
  <channel name="feed" topic="updates"/>
  <keyboard id="keys"/>
  <request id="b" url="/api/b"/>
  <div><p>ok</p></div>
</>
`;
    const js = compileSource("requests-only.scrml", src);
    expect(emittedOrder(js)).toEqual(["keyboard:keys", "channel:feed", "request:a", "request:b"]);
  });
});
