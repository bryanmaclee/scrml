/**
 * channel-sync-echo-dedup.test.js
 *
 * §38.4 channel-cell auto-sync ECHO DEDUP (g-channel-sync-echo-storm, S389-peter).
 *
 * A channel with a synced cell and >=2 subscribers used to storm WS `__sync`
 * frames forever on connect: an inbound sync applied as a plain reactive write
 * re-fired the per-cell outbound `syncShared` effect, the server re-broadcast
 * every `__sync`, and `_scrml_reactive_set` has no value-dedup, so identical
 * values bounced without end. The fix records each synced cell's last-synced
 * value (as JSON) on inbound apply AND on a successful outbound send, and the
 * outbound effect skips a send whose value equals that last-synced value.
 *
 * Asserts (i) the EMITTED dedup structure and (ii) RUNTIME behaviour by mounting
 * the compiled client against the real SCRML_RUNTIME with a WebSocket send-spy:
 * inbound apply updates the cell with NO echo; a same-value inbound re-apply does
 * not echo; a DIFFERENT synced cell written after an apply is NOT suppressed
 * (no cross-cell leak); a post-apply local change still propagates (subscription
 * preserved); and a write dropped while the socket is closed is NOT deduped away
 * (record-on-successful-send only).
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const CHANNEL = `export <channel name="beat">
    \${
        <lastBeat> = ""
        <tasks> = []
        function orchBeat(lastSeq) { @lastBeat = "beat " + lastSeq }
        function routed(taskId) { @tasks = [...@tasks, { taskId: taskId }] }
    }
</>`;

const HOST = `\${ import { "beat" as beatChannel } from './channels/beat.scrml' }
<beatChannel/>
<program>
<div id="b">\${@lastBeat}</div>
</program>`;

let clientJs = "";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "scrml-echo-"));
  mkdirSync(join(dir, "channels"), { recursive: true });
  writeFileSync(join(dir, "channels", "beat.scrml"), CHANNEL);
  writeFileSync(join(dir, "app.scrml"), HOST);
  const r = compileScrml({
    inputFiles: [join(dir, "app.scrml"), join(dir, "channels", "beat.scrml")],
    write: false,
    mode: "browser",
  });
  expect(r.errors.length).toBe(0);
  for (const [, o] of r.outputs) {
    if (o.clientJs && /syncShared/.test(o.clientJs)) clientJs = o.clientJs;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("§38.4 echo dedup — emitted structure", () => {
  test("declares a per-channel last-synced map and a normalize-to-key helper", () => {
    expect(clientJs).toContain("const _scrml_ls = {}");
    expect(clientJs).toContain("const _scrml_lk =");
  });

  test("inbound apply records last-synced BEFORE applying the value", () => {
    // the record must precede the reactive set so the effect this set fires dedups
    expect(clientJs).toMatch(/_scrml_ls\["lastBeat"\] = _scrml_lk\(_d\.__val\);\s*_scrml_[a-z_]*reactive_set\("lastBeat"/);
  });

  test("outbound effect dedups against last-synced and records only on a real send", () => {
    // reads the cell first (keeps subscription), dedups on the normalized key, records only after a real send
    expect(clientJs).toMatch(/const _scrml_sv = _scrml_[a-z_]*reactive_get\("lastBeat"\)/);
    expect(clientJs).toMatch(/const _scrml_sj = .*\._lk\(_scrml_sv\)/);
    expect(clientJs).toMatch(/if \(.*syncShared\("lastBeat", _scrml_sv\)\) .*_ls\["lastBeat"\] = _scrml_sj/);
    // the fragile synchronous flag from the reverted first attempt must NOT be present
    expect(clientJs).not.toContain("_scrml_ch_applying");
  });

  test("syncShared reports send success (returns true only when the socket is OPEN)", () => {
    expect(clientJs).toMatch(/syncShared: \(key, val\) => \{ if \(.*readyState === 1\) \{.*return true; \} return false; \}/);
  });
});

describe("§38.4 echo dedup — runtime behaviour", () => {
  function mount() {
    let sent = [];
    let ws;
    const prev = {
      WebSocket: globalThis.WebSocket,
      location: globalThis.location,
      window: globalThis.window,
      document: globalThis.document,
    };
    globalThis.location = { protocol: "http:", host: "localhost" };
    globalThis.WebSocket = class {
      constructor() { this.readyState = 1; ws = this; setTimeout(() => this.onopen && this.onopen(), 0); }
      send(d) { sent.push(JSON.parse(d)); }
      close() {}
    };
    // Minimal DOM shims — this test asserts channel wire behaviour, not rendered
    // DOM, so inert stubs are enough (and are saved/restored so the unit suite is
    // not polluted). Only the surface the channel client touches is provided.
    const inertEl = () => ({ style: {}, setAttribute() {}, appendChild() {}, insertBefore() {}, addEventListener() {}, removeEventListener() {}, textContent: "" });
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.document = {
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      createElement() { return inertEl(); }, createTextNode() { return inertEl(); },
      createDocumentFragment() { return inertEl(); }, body: inertEl(),
    };
    const cap = `globalThis.__cg = _scrml_cs_reactive_get; globalThis.__cs = _scrml_cs_reactive_set;`;
    new Function(`\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs, cap)).call({});
    const restore = () => { Object.assign(globalThis, prev); };
    return {
      get: (k) => globalThis.__cg(k),
      set: (k, v) => globalThis.__cs(k, v),
      inbound: (k, v) => ws.onmessage({ data: JSON.stringify({ __type: "__sync", __key: k, __val: v }) }),
      setOpen: (open) => { ws.readyState = open ? 1 : 0; },
      drain: () => { const s = sent; sent = []; return s; },
      restore,
    };
  }

  test("inbound sync updates the cell and emits NO echo", async () => {
    const c = mount();
    await Promise.resolve();
    c.drain();
    c.inbound("lastBeat", "P1");
    await Promise.resolve();
    expect(c.get("lastBeat")).toBe("P1");
    expect(c.drain().length).toBe(0); // no outbound echo
    c.restore();
  });

  test("a same-value inbound re-apply does not echo", async () => {
    const c = mount();
    await Promise.resolve();
    c.inbound("lastBeat", "P1");
    c.drain();
    c.inbound("lastBeat", "P1");
    await Promise.resolve();
    expect(c.drain().length).toBe(0);
    c.restore();
  });

  test("a DIFFERENT synced cell written after an apply is not suppressed (no cross-cell leak)", async () => {
    const c = mount();
    await Promise.resolve();
    c.inbound("lastBeat", "P1");
    c.drain();
    c.set("tasks", [{ taskId: "X" }]);
    await Promise.resolve();
    const tasksSent = c.drain().filter((m) => m.__key === "tasks");
    expect(tasksSent.length).toBeGreaterThanOrEqual(1);
    c.restore();
  });

  test("a post-apply local change to the same cell still propagates", async () => {
    const c = mount();
    await Promise.resolve();
    c.inbound("lastBeat", "P1");
    c.drain();
    c.set("lastBeat", "L2");
    await Promise.resolve();
    const sent = c.drain().filter((m) => m.__key === "lastBeat" && m.__val === "L2");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    c.restore();
  });

  test("an undefined-serializing cell still dedups (no storm for undefined values)", async () => {
    const c = mount();
    await Promise.resolve();
    c.set("lastBeat", undefined); // JSON.stringify(undefined) === undefined → sentinel key
    await Promise.resolve();
    c.drain();
    c.inbound("lastBeat", undefined); // same value re-applied
    await Promise.resolve();
    expect(c.drain().length).toBe(0); // deduped — no echo, no storm
    c.restore();
  });

  test("a write dropped while the socket is closed is not deduped away (record-on-send only)", async () => {
    const c = mount();
    await Promise.resolve();
    c.setOpen(false);
    c.drain();
    c.set("lastBeat", "offline-1");
    await Promise.resolve();
    expect(c.drain().length).toBe(0); // nothing sent while closed
    c.setOpen(true);
    c.set("lastBeat", "offline-1"); // same value, now online
    await Promise.resolve();
    const sent = c.drain().filter((m) => m.__key === "lastBeat" && m.__val === "offline-1");
    expect(sent.length).toBeGreaterThanOrEqual(1); // not lost
    c.restore();
  });
});
