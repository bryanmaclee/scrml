/**
 * E-CHANNEL-INSIDE-NESTED-PROGRAM — a `<channel>` inside a nested
 * `<program name=>` (§4.12 + §38.1).
 *
 * THE BUG (reproduced on `origin/main` before this fix): the shape compiled
 * exit 0 and shipped a client that dialled `/_scrml_ws/<name>` against a route
 * no server ever mounted. Because the emitted client sets
 * `_ws.onclose = () => { _reconn = setTimeout(_connect, 2000); }`, the runtime
 * symptom was a SILENT INFINITE 2-second reconnect loop. No diagnostic.
 *
 * THE MECHANISM (measured, not assumed — see progress.md for the probe output).
 * It is NOT "the symbol table registers channels globally". It is a STALE
 * ANALYSIS SNAPSHOT taken before a tree-mutating pre-pass:
 *
 *   - `analyzeAll` runs at `codegen/index.ts` BEFORE the §4.12.4 worker
 *     extraction, and `analysis.channelNodes` holds direct object references.
 *   - `extractWorkerPrograms` then splices the nested `<program>` subtree out.
 *     The cached array still points at the removed `<channel>`.
 *   - CLIENT (`emit-reactive-wiring.ts`) reads `ctx.analysis.channelNodes` —
 *     the STALE view — and emits the WebSocket connection.
 *   - SERVER (`emit-server.ts`) falls back to `collectChannelNodes(...)` over
 *     the LIVE post-splice tree (index.ts calls `generateServerJs` on the
 *     legacy positional signature, so its `ctxForCache` is null) and emits
 *     nothing.
 *
 *   Instrumented compile of the two-channel repro, on the pre-fix tree:
 *     [PROBE] server ctxForCache=NULL analysis.channelNodes=n/a liveWalk=1
 *     [PROBE] client analysis=PRESENT analysis.channelNodes=2   liveWalk=1
 *
 * THE FIX has two halves, and both are pinned here:
 *   1. SYM refuses the shape (E-CHANNEL-INSIDE-NESTED-PROGRAM) so no GREEN
 *      build can contain it.
 *   2. codegen refreshes the stale snapshot after the splice, so the dangling
 *      dial is absent from the emitted BYTES too. That matters because
 *      `scrml build` writes its dist even on a failed build (pre-existing, and
 *      general to every fatal error — verified independently on E-SCOPE-001).
 *
 * THE DISCRIMINATOR is EXTRACTION, not `name=`.
 *
 * When this file landed it keyed on `name=`, on the empirical ground that
 * `extractWorkerPrograms` claimed exactly the `name=`d nested programs. That
 * was true of the compiler and WRONG about the language: the §4.12.3 table
 * reads `Scoped DB context | name= (OPTIONAL), db=`, so
 * `<program name="analytics" db="…">` is a legal scoped-DB context and its
 * channel was being refused. The extractor over-claimed; the diagnostic
 * inherited the over-claim.
 *
 * Corrected S356 (the operator ruling): both consumers now call
 * `nestedProgramSubtreeIsExtracted` (`compiler/src/nested-program-kind.ts`),
 * so the refusal keys on the same predicate that decides whether the subtree is
 * actually removed. The four extracted contexts are the §4.12.4 inline worker,
 * the §4.12.5 foreign sidecar, the §4.12.3 WASM module and the §4.12.2 `route=`
 * server endpoint. A §4.12.6 scoped-DB context — with OR without `name=` — is
 * not extracted, its channel stays in the tree, and server route + client dial
 * match. Both scoped-DB spellings must keep compiling.
 */

import { describe, test, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compileSrc(src, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "chan-nested-"));
  const file = join(root, "app.scrml");
  writeFileSync(file, src);
  const outDir = join(root, "dist");
  const result = compileScrml({
    inputFiles: [file],
    outputDir: outDir,
    write: true,
    log: () => {},
    ...opts,
  });
  const read = (name) => {
    const p = join(outDir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const out = {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    clientJs: read("app.client.js"),
    serverJs: read("app.server.js"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  return out;
}

const codesOf = (o) => [...o.errors, ...o.warnings].map((e) => e.code);
/** WebSocket topics the emitted CLIENT dials. */
const clientDials = (o) =>
  [...new Set([...(o.clientJs ?? "").matchAll(/_scrml_ws\/([a-z0-9_]+)/g)].map((m) => m[1]))].sort();
/** WebSocket topics the emitted SERVER mounts a route for. */
const serverRoutes = (o) =>
  [...new Set([...(o.serverJs ?? "").matchAll(/_scrml_route_ws_([a-z0-9_]+)/g)].map((m) => m[1]))].sort();

// The brief's exact repro: one canonical top-level channel + one inside a
// nested `<program name="worker">`.
const NESTED_WORKER_CHANNEL = `<program db="postgres://localhost/app">
  <channel name="canonical-feed">
    <messages> = []
  </channel>
  <program name="worker">
    <channel name="nested-feed">
      <items> = []
    </channel>
  </program>
</program>
`;

describe("E-CHANNEL-INSIDE-NESTED-PROGRAM — the refusal", () => {
  test("a <channel> inside a nested <program name=> is a hard error", () => {
    const o = compileSrc(NESTED_WORKER_CHANNEL);
    try {
      const hit = o.errors.find((e) => e.code === "E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(hit).toBeDefined();
      expect(hit.severity).toBe("error");
      // The message must name the ROOT CAUSE, not just the symptom: which
      // channel, which nested program, and why the route cannot exist.
      expect(hit.message).toContain('<channel name="nested-feed">');
      expect(hit.message).toContain('<program name="worker">');
      expect(hit.message).toContain("SEPARATE COMPILATION UNIT");
      expect(hit.message).toContain("§4.12.1");
    } finally { o.cleanup(); }
  });

  test("the canonical sibling channel is untouched — exactly one error, on the nested one", () => {
    const o = compileSrc(NESTED_WORKER_CHANNEL);
    try {
      const hits = o.errors.filter((e) => e.code === "E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(hits.length).toBe(1);
      // and no collateral placement diagnostics on the good channel
      expect(codesOf(o)).not.toContain("E-CHANNEL-OUTSIDE-PROGRAM");
      expect(codesOf(o)).not.toContain("E-CHANNEL-INSIDE-PAGE");
    } finally { o.cleanup(); }
  });
});

describe("E-CHANNEL-INSIDE-NESTED-PROGRAM — no dangling dial in the emitted bytes", () => {
  // `scrml build` writes its dist even when the build FAILS (pre-existing, and
  // general to every fatal error). So the refusal alone is not enough: the
  // bytes that land on disk must not carry a connection to a route that does
  // not exist.
  test("every client WS dial has a matching server route", () => {
    const o = compileSrc(NESTED_WORKER_CHANNEL);
    try {
      expect(o.clientJs).not.toBeNull();
      expect(clientDials(o)).toEqual(["canonical_feed"]);
      expect(serverRoutes(o)).toEqual(["canonical_feed"]);
      expect(clientDials(o)).toEqual(serverRoutes(o));
    } finally { o.cleanup(); }
  });

  test("the §23.4 SIDECAR splice path also clears the stale snapshot", () => {
    // The sidecar branch of `extractWorkerPrograms` splices WITHOUT registering
    // a worker. Gating the snapshot refresh on `workerDefs.size > 0` missed it
    // and left `_scrml_ws/side_feed` in the client. Regression pin.
    const o = compileSrc(`<program db="postgres://localhost/app">
  <program name="ml" lang="go" build="go build" port="9001" health="/health">
    <channel name="side-feed">
      <items> = []
    </channel>
  </program>
  <div>hi</>
</program>
`);
    try {
      expect(codesOf(o)).toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(clientDials(o)).toEqual([]);
    } finally { o.cleanup(); }
  });

  test("the WASM-module shape leaves no dangling dial", () => {
    const o = compileSrc(`<program db="postgres://localhost/app">
  <program name="calc" lang="rust" mode="wasm">
    <channel name="wasm-feed">
      <items> = []
    </channel>
  </program>
  <div>hi</>
</program>
`);
    try {
      expect(codesOf(o)).toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(clientDials(o)).toEqual([]);
    } finally { o.cleanup(); }
  });

  test("a nested <program route=> — SPEC calls it a server endpoint — is also refused for now", () => {
    // §4.12.2 lists `route=` as valid nested and describes it as "a server
    // endpoint", so this is the shape where a channel is most plausibly
    // COHERENT one day. It is refused today because the compiler does not
    // implement `route=` at all: `extractWorkerPrograms` claims any `name=`d
    // nested program as a WEB WORKER regardless of `route=`. Refusing is the
    // reversible direction; see progress.md DESIGN FORK.
    const o = compileSrc(`<program db="postgres://localhost/app">
  <program name="api" route="/api/v1">
    <channel name="route-feed">
      <items> = []
    </channel>
  </program>
  <div>hi</>
</program>
`);
    try {
      expect(codesOf(o)).toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(clientDials(o)).toEqual([]);
    } finally { o.cleanup(); }
  });
});

describe("E-CHANNEL-INSIDE-NESTED-PROGRAM — the carve-out that must NOT fire", () => {
  test("§4.12.6 scoped-DB context (<program db=> with no name=) keeps its channel", () => {
    // This shape is NOT extracted, so the channel stays in the tree and the
    // server/client pair matches. It compiled correctly before this change and
    // must keep compiling: over-firing here would break a working program.
    const o = compileSrc(`<program db="postgres://localhost/app">
  <program db="postgres://localhost/analytics">
    <channel name="scoped-feed">
      <items> = []
    </channel>
  </program>
  <div>n: \${@items.length}</>
</program>
`);
    try {
      expect(codesOf(o)).not.toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(o.errors).toEqual([]);
      expect(clientDials(o)).toEqual(["scoped_feed"]);
      expect(serverRoutes(o)).toEqual(["scoped_feed"]);
    } finally { o.cleanup(); }
  });

  test("§4.12.6 scoped-DB context WITH a name= keeps its channel too (S356 — the false positive)", () => {
    // The N3 dissolution, pinned. §4.12.3: `Scoped DB context | name= (optional),
    // db=`. The `name=`-keyed discriminator refused this LEGAL shape. It is not
    // extracted, so the channel stays in the tree and both halves are emitted.
    const o = compileSrc(`<program db="postgres://localhost/app">
  <program name="analytics" db="postgres://localhost/analytics">
    <channel name="scoped-feed">
      <items> = []
    </channel>
  </program>
  <div>n: \${@items.length}</>
</program>
`);
    try {
      expect(codesOf(o)).not.toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(o.errors).toEqual([]);
      expect(clientDials(o)).toEqual(["scoped_feed"]);
      expect(serverRoutes(o)).toEqual(["scoped_feed"]);
      // and no worker artifact was invented for it
      expect(o.clientJs).not.toContain("new Worker(");
    } finally { o.cleanup(); }
  });

  test("a channel directly under the top-level <program> is canonical and silent", () => {
    const o = compileSrc(`<program db="postgres://localhost/app">
  <channel name="canonical-feed">
    <messages> = []
  </channel>
  <div>n: \${@messages.length}</>
</program>
`);
    try {
      expect(codesOf(o)).not.toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(o.errors).toEqual([]);
      expect(clientDials(o)).toEqual(["canonical_feed"]);
      expect(serverRoutes(o)).toEqual(["canonical_feed"]);
    } finally { o.cleanup(); }
  });

  test("a nested <program name=> WITHOUT a channel is unaffected", () => {
    // §4.12.4 inline worker, the normal case. Must still compile clean and
    // still emit its worker bundle reference.
    const o = compileSrc(`<program>
  <program name="doubler">
    \${ when message(data) { send({ result: data.value * 2 }) } }
  </>
  \${
    <out> = not
    function go() { <#doubler>.send({ value: 1 }) }
    when message from <#doubler> (d) { @out = d.result }
  }
  <div><button onclick=go()>Go</></>
</program>
`);
    try {
      expect(codesOf(o)).not.toContain("E-CHANNEL-INSIDE-NESTED-PROGRAM");
      expect(o.errors).toEqual([]);
      expect(o.clientJs).toContain('new Worker("app.doubler.worker.js")');
    } finally { o.cleanup(); }
  });
});
