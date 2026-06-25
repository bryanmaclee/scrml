// ---------------------------------------------------------------------------
// §61 <endpoint> private-arm reachability — server-retain + client-skip
// (endpoint-private-arm-reachability-2026-06-25)
// ---------------------------------------------------------------------------
//
// SPEC §61.2 names `<FleetStatus : fleetStatus()>` (a terse arm calling a
// private handler fn) THE canonical arm form. But a non-exported pure `fn`
// referenced ONLY from an `<endpoint>` arm body was TREE-SHAKEN: the emitted
// `.server.js` called `fleetStatus(...)` against an UNDEFINED symbol (runtime
// ReferenceError) and a misleading W-DEAD-FUNCTION fired. The fix:
//
//   • route-inference seeds endpoint arm-body callees as SERVER-reachability
//     roots (gated on `<endpoint>` presence) and computes the per-file
//     server-retain / client-skip closure.
//   • emit-server RETAINS each reachable helper as a plain server-side
//     `function NAME(...) { <body> }` (the endpoint handler calls it, §61.5).
//   • emit-functions SKIPS the client body for the server-ONLY subset, so a
//     private endpoint helper never leaks into `.client.js` (§61.6).
//
// These asserts lock the §61.2 canonical form working end-to-end + the S215
// adversarial gate: dead-fn-stays-shaken, transitive-helper-retained, helper-
// used-by-both-in-both, non-endpoint-unchanged, no-client-leak.

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "endpoint-arm-reach-"));

let _seq = 0;
function compile(src) {
  const p = join(TMP, `t-${_seq++}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function serverJs(r) {
  let out = "";
  for (const [, e] of (r.outputs ?? new Map())) {
    if (e && typeof e === "object" && typeof e.serverJs === "string") out += e.serverJs + "\n";
  }
  return out;
}
function clientJs(r) {
  let out = "";
  for (const [, e] of (r.outputs ?? new Map())) {
    if (e && typeof e === "object" && typeof e.clientJs === "string") out += e.clientJs + "\n";
  }
  return out;
}
// W-DEAD-FUNCTION is a W- prefixed (non-fatal) diagnostic — it partitions into
// result.warnings, NOT result.errors. Scan BOTH streams (cross-stream helper)
// so a partition shift can't silently pass the assertion.
function deadFnNames(r) {
  const all = [...(r.warnings ?? []), ...(r.errors ?? [])];
  return all
    .filter((d) => (d.code ?? "") === "W-DEAD-FUNCTION")
    .map((d) => {
      const m = String(d.message ?? "").match(/Function `([^`]+)`/);
      return m ? m[1] : "";
    });
}
function nodeChecks(r, kind) {
  let checked = 0;
  for (const [, e] of (r.outputs ?? new Map())) {
    const js = e && typeof e === "object" ? e[kind] : null;
    if (typeof js === "string" && js.length > 0) {
      const f = join(TMP, `nc-${_seq++}.js`);
      writeFileSync(f, js);
      execFileSync("node", ["--check", f]); // throws → test fails with the node diagnostic
      checked++;
    }
  }
  return checked;
}

// The §61.2 CANONICAL form — every arm calls a private (non-exported) handler fn.
const CANONICAL = `<program>
\${
  type FspMethod:enum = { FleetStatus, Dispatch(prompt: string, project: string), DeltaSince(seq: int) }
  type Snapshot:struct = { active: int, idle: int, offline: int }
  type Ack:struct = { accepted: bool, project: string }
  type Delta:struct = { since: int, count: int }
}
fn fleetStatus() -> Snapshot {
  return { active: 3, idle: 1, offline: 0 }
}
fn dispatch(prompt: string, proj: string) -> Ack {
  return { accepted: true, project: proj }
}
fn deltasSince(seq: int) -> Delta {
  return { since: seq, count: 0 }
}
<endpoint path="/fsp" method="POST" accepts=FspMethod>
  <FleetStatus : fleetStatus()>
  <Dispatch(prompt, proj) : dispatch(prompt, proj)>
  <DeltaSince(seq) : deltasSince(seq)>
</endpoint>
<div><h1>fsp</h1></div>
</program>
`;

// Transitive helper (decorate, called by an arm callee) + a genuinely-dead fn.
const TRANSITIVE_AND_DEAD = `<program>
\${
  type Cmd:enum = { Ping, Echo(msg: string) }
  type Pong:struct = { ok: bool, detail: string }
}
fn decorate(s: string) -> string {
  return "[" + s + "]"
}
fn handleEcho(msg: string) -> Pong {
  return { ok: true, detail: decorate(msg) }
}
fn handlePing() -> Pong {
  return { ok: true, detail: "pong" }
}
fn neverCalled() -> string {
  return "dead"
}
<endpoint path="/cmd" method="POST" accepts=Cmd>
  <Ping : handlePing()>
  <Echo(msg) : handleEcho(msg)>
</endpoint>
<div><h1>cmd</h1></div>
</program>
`;

// A helper used by BOTH the endpoint arm AND client markup.
const BOTH = `<program>
\${
  type Cmd:enum = { Status }
  type Info:struct = { label: string }
}
fn badge() -> string {
  return "OK"
}
fn statusHandler() -> Info {
  return { label: badge() }
}
<endpoint path="/c" method="POST" accepts=Cmd>
  <Status : statusHandler()>
</endpoint>
<div><h1>\${ badge() }</h1></div>
</program>
`;

// A non-endpoint control app — a pure fn used in markup. Must be unchanged.
const NON_ENDPOINT = `<program>
\${ type Info:struct = { label: string } }
fn badge() -> string {
  return "OK"
}
<div><h1>\${ badge() }</h1></div>
</program>
`;

describe("§61 endpoint private-arm reachability — server-retain + client-skip", () => {
  test("canonical fn-call arm: each handler fn is RETAINED server-side (defined, not just called)", () => {
    const js = serverJs(compile(CANONICAL));
    // Defined as a plain server-side function (the bug: these were absent).
    expect(js).toContain("function fleetStatus(");
    expect(js).toContain("function dispatch(");
    expect(js).toContain("function deltasSince(");
    // And the handler actually calls them.
    expect(js).toContain("await (fleetStatus())");
    expect(js).toContain("await (dispatch(prompt, proj))");
    expect(js).toContain("await (deltasSince(seq))");
  });

  test("the retained helpers are server-ONLY — never bundled into the client (§61.6)", () => {
    const cjs = clientJs(compile(CANONICAL));
    expect(cjs).not.toContain("fleetStatus");
    expect(cjs).not.toContain("dispatch");
    expect(cjs).not.toContain("deltasSince");
  });

  test("no W-DEAD-FUNCTION false-fire for endpoint-arm-referenced fns", () => {
    const dead = deadFnNames(compile(CANONICAL));
    expect(dead).not.toContain("fleetStatus");
    expect(dead).not.toContain("dispatch");
    expect(dead).not.toContain("deltasSince");
  });

  test("node --check is clean on both emitted bundles (retained refs resolve, no miscompile)", () => {
    const r = compile(CANONICAL);
    expect(nodeChecks(r, "serverJs")).toBeGreaterThan(0);
    expect(nodeChecks(r, "clientJs")).toBeGreaterThan(0);
  });

  test("a transitive helper of an arm callee is also retained server-side", () => {
    const js = serverJs(compile(TRANSITIVE_AND_DEAD));
    expect(js).toContain("function handleEcho(");
    expect(js).toContain("function handlePing(");
    // `decorate` is reached ONLY transitively (handleEcho calls it) — still retained.
    expect(js).toContain("function decorate(");
  });

  test("a genuinely-dead fn STAYS tree-shaken — W-DEAD fires, NOT retained server-side (no over-retention)", () => {
    const r = compile(TRANSITIVE_AND_DEAD);
    expect(deadFnNames(r)).toContain("neverCalled");
    expect(serverJs(r)).not.toContain("function neverCalled(");
  });

  test("a helper used by BOTH an endpoint arm AND client markup is in BOTH bundles", () => {
    const r = compile(BOTH);
    const sjs = serverJs(r);
    const cjs = clientJs(r);
    // Server retains both (the handler calls statusHandler, which calls badge).
    expect(sjs).toContain("function badge(");
    expect(sjs).toContain("function statusHandler(");
    // Client keeps `badge` (markup `${ badge() }`) but NOT the server-only handler.
    expect(cjs).toContain("badge");
    expect(cjs).not.toContain("statusHandler");
    expect(nodeChecks(r, "serverJs")).toBeGreaterThan(0);
    expect(nodeChecks(r, "clientJs")).toBeGreaterThan(0);
  });

  test("non-endpoint app is UNCHANGED — no §61 server-helper section; pure fn stays client-side", () => {
    const r = compile(NON_ENDPOINT);
    // No endpoint ⇒ no §61 private-helper emission anywhere.
    expect(serverJs(r)).not.toContain("private server-side arm helpers");
    // The markup-used pure fn is still emitted client-side (no behavior change).
    expect(clientJs(r)).toContain("badge");
  });
});
