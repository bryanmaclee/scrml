/**
 * mcp-descriptors-runtime-integration.test.js — MCP-V0 A↔B end-to-end test
 *
 * The cross-cutting integration test (the MCP-V0.A-tests dispatch test 5; the
 * proof of the A↔B contract). A multi-engine + multi-form + multi-channel +
 * multi-server-fn fixture is compiled via the REAL per-route emit path
 * (`compileScrml({ write: true, emitPerRoute: true })`). Then:
 *
 *   1. Assert all four sidecars are present + valid JSON.
 *   2. `loadSidecars(outDir)` reads them into the B runtime shim.
 *   3. `install({reactive_get, derived_get})` connects a MOCK runtime keyed by
 *      the RESOLVED keys taken from the descriptors themselves (so the test is
 *      robust to the key-encoding scheme).
 *   4. Assert getCurrentVariant(engine), getFormStatus(form) INCLUDING
 *      `submitted`, and getChannelState(channel) ALL decode correctly.
 *
 * LOAD-BEARING: `getFormStatus().submitted` decode is the proof the S126
 * contract fix works. `submitted` is compound-only (§55.7 — no per-field
 * equivalent), reachable ONLY through the nested `compoundKeys.submittedKey`.
 * Before the fix (flat keys) B's `descriptor.compoundKeys` was undefined → the
 * per-field fallback returns `submitted: false` UNCONDITIONALLY, so the
 * "submitted decodes to true from the runtime cell" assertion below FAILS
 * pre-fix and PASSES post-fix.
 *
 * Mirrors `unit/mcp-runtime-helpers.test.js` style: plain mock-runtime object,
 * install/_resetForTests lifecycle.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  makeSidecarTmpRoot,
  cleanupSidecarTmpRoot,
  compileAndReadSidecars,
} from "../helpers/mcp-sidecar-compile.js";
import {
  install,
  loadSidecars,
  getCurrentVariant,
  getFormStatus,
  getChannelState,
  _resetForTests,
} from "../../runtime/stdlib/mcp.js";

// ---------------------------------------------------------------------------
// Mock runtime — plain object + reactive_get / derived_get closures over a
// keyed state map (mirrors mcp-runtime-helpers.test.js makeMockRuntime).
// ---------------------------------------------------------------------------

function makeMockRuntime(initial) {
  const state = Object.assign({}, initial || {});
  return {
    state,
    reactive_get(name) { return state[name]; },
    derived_get(name) { return state[name]; },
    set(name, value) { state[name] = value; },
  };
}

// ---------------------------------------------------------------------------
// Fixture — 2 engines + 1 compound form + 2 channels + 3 server fns.
// ---------------------------------------------------------------------------

const MULTI_FIXTURE = `type LoadPhase:enum = { Idle, Loading, Loaded(rows: int), Failed(message: string) }
type Health:enum = { Healthy, AtRisk, Critical }

<program title="MultiSurface" db="./app.db">

<channel name="chat" topic="lobby">
  \${
    <messages> = []
    <count> = 0
    function postMessage(author: string, body: string) {
      @messages = [...@messages, { author, body }]
    }
  }
</>

<channel name="presence" topic="who">
  \${ <online> = 0 }
</>

\${
  <signup>
    <name req length(>=2)> = <input type="text"/>
    <email req> = <input type="email"/>
  </>

  server function loadRows(limit: int) {
    return ?{\`SELECT id FROM items LIMIT \${limit}\`}.all()
  }

  server function saveName(name: string) {
    ?{\`INSERT INTO names (n) VALUES (\${name})\`}.run()
  }
}

<engine for=LoadPhase initial=.Idle>
  <Idle rule=.Loading></>
  <Loading rule=(.Loaded | .Failed)></>
  <Loaded(rows) rule=.Idle>\${rows}</>
  <Failed(msg) rule=.Idle>\${msg}</>
</>

<engine for=Health initial=.Healthy>
  <Healthy rule=.AtRisk></>
  <AtRisk rule=(.Critical | .Healthy)></>
  <Critical rule=.AtRisk></>
</>

<div>app</div>

</program>
`;

let TMP;
let compiled;

beforeAll(() => {
  TMP = makeSidecarTmpRoot("integration");
  compiled = compileAndReadSidecars(MULTI_FIXTURE, TMP);
});

afterAll(() => {
  cleanupSidecarTmpRoot(TMP);
  _resetForTests();
});

beforeEach(() => {
  _resetForTests();
});

// ---------------------------------------------------------------------------
// §1 — all four sidecars present + valid + the expected surfaces
// ---------------------------------------------------------------------------

describe("MCP-V0 integration — sidecar emission", () => {
  test("fixture compiles clean (no fatal errors)", () => {
    expect(compiled.fatal).toEqual([]);
  });

  test("all four sidecars are present + valid JSON arrays", () => {
    expect(Array.isArray(compiled.engines)).toBe(true);
    expect(Array.isArray(compiled.forms)).toBe(true);
    expect(Array.isArray(compiled.channels)).toBe(true);
    expect(Array.isArray(compiled.serverFns)).toBe(true);
  });

  test("multi-engine / multi-form / multi-channel / multi-server-fn surfaces", () => {
    expect(compiled.engines.map((e) => e.name).sort()).toEqual(["health", "loadPhase"]);
    expect(compiled.forms.map((f) => f.formName)).toEqual(["signup"]);
    expect(compiled.channels.map((c) => c.name).sort()).toEqual(["chat", "presence"]);
    // RULING A (S189): a channel cell-write publisher (`postMessage` writes the
    // channel cell `@messages`) runs CLIENT-side and syncs via __sync (§38.4,
    // §12.2 Trigger 7a dropped) — it is NOT a server fn. Only `loadRows` /
    // `saveName` (SQL → server) surface as server fns.
    expect(compiled.serverFns.map((f) => f.name).sort()).toEqual([
      "loadRows",
      "saveName",
    ]);
  });
});

// ---------------------------------------------------------------------------
// §2 — A→B runtime decode: getCurrentVariant
// ---------------------------------------------------------------------------

describe("MCP-V0 integration — getCurrentVariant decode", () => {
  test("decodes the engine's current variant via the descriptor cellKey", () => {
    const load = compiled.engines.find((e) => e.name === "loadPhase");
    const health = compiled.engines.find((e) => e.name === "health");

    // Key the mock runtime by the RESOLVED cellKey from each descriptor.
    const rt = makeMockRuntime({
      [load.cellKey]: { variant: "Loading", data: {} }, // {variant,data} record
      [health.cellKey]: "AtRisk", // bare tag string
    });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    loadSidecars(compiled.outDir);

    expect(getCurrentVariant("loadPhase")).toBe("Loading"); // record normalized
    expect(getCurrentVariant("health")).toBe("AtRisk");
    // Advancing surfaces on next read.
    rt.set(load.cellKey, "Idle");
    expect(getCurrentVariant("loadPhase")).toBe("Idle");
  });
});

// ---------------------------------------------------------------------------
// §3 — A→B runtime decode: getFormStatus INCLUDING submitted (LOAD-BEARING)
// ---------------------------------------------------------------------------

describe("MCP-V0 integration — getFormStatus decode (incl. submitted)", () => {
  test("decodes compound + per-field status via the NESTED compoundKeys", () => {
    const signup = compiled.forms.find((f) => f.formName === "signup");
    const nameF = signup.fields.find((f) => f.name === "name");
    const emailF = signup.fields.find((f) => f.name === "email");

    // Key the mock runtime by the RESOLVED keys from the descriptor —
    // including the compound submittedKey that ONLY exists nested.
    const rt = makeMockRuntime({
      [signup.compoundKeys.isValidKey]: false,
      [signup.compoundKeys.errorsKey]: [{ variant: "Required" }],
      [signup.compoundKeys.touchedKey]: true,
      [signup.compoundKeys.submittedKey]: true, // <-- the load-bearing cell
      [nameF.isValidKey]: true,
      [nameF.errorsKey]: [],
      [nameF.touchedKey]: true,
      [emailF.isValidKey]: false,
      [emailF.errorsKey]: [{ variant: "Required" }],
      [emailF.touchedKey]: true,
    });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    loadSidecars(compiled.outDir);

    const status = getFormStatus("signup");
    // Compound rollups decode from the nested compoundKeys (not per-field fallback).
    expect(status.isValid).toBe(false);
    expect(status.errors).toEqual([{ variant: "Required" }]);
    expect(status.touched).toBe(true);
    // *** LOAD-BEARING: submitted decodes to the runtime value (true). ***
    // Pre-S126 (flat keys) this was UNCONDITIONALLY false (compound-only key
    // unreachable). Post-fix it decodes the real cell.
    expect(status.submitted).toBe(true);

    // Per-field surface decodes too.
    expect(status.perField.name).toEqual({ isValid: true, errors: [], touched: true });
    expect(status.perField.email).toEqual({
      isValid: false,
      errors: [{ variant: "Required" }],
      touched: true,
    });
  });

  test("submitted is the differentiator — a false runtime cell decodes to false (not vacuous)", () => {
    const signup = compiled.forms.find((f) => f.formName === "signup");
    const rt = makeMockRuntime({
      [signup.compoundKeys.isValidKey]: true,
      [signup.compoundKeys.errorsKey]: [],
      [signup.compoundKeys.touchedKey]: false,
      [signup.compoundKeys.submittedKey]: false,
    });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    loadSidecars(compiled.outDir);
    expect(getFormStatus("signup").submitted).toBe(false);

    // Flip the runtime cell — proves the helper READS the submitted cell rather
    // than hardcoding false (which the pre-fix per-field fallback did).
    rt.set(signup.compoundKeys.submittedKey, true);
    expect(getFormStatus("signup").submitted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 — A→B runtime decode: getChannelState
// ---------------------------------------------------------------------------

describe("MCP-V0 integration — getChannelState decode", () => {
  test("decodes each auto-synced cell of each channel via its resolved key", () => {
    const chat = compiled.channels.find((c) => c.name === "chat");
    const presence = compiled.channels.find((c) => c.name === "presence");

    const chatMessages = chat.autoSyncedCells.find((c) => c.name === "messages");
    const chatCount = chat.autoSyncedCells.find((c) => c.name === "count");
    const presenceOnline = presence.autoSyncedCells.find((c) => c.name === "online");

    const rt = makeMockRuntime({
      [chatMessages.key]: [{ author: "ana", body: "hi" }],
      [chatCount.key]: 7,
      [presenceOnline.key]: 3,
    });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    loadSidecars(compiled.outDir);

    const chatState = getChannelState("chat");
    expect(chatState.name).toBe("chat");
    expect(chatState.topic).toBe("lobby");
    expect(chatState.cellState.messages).toEqual([{ author: "ana", body: "hi" }]);
    expect(chatState.cellState.count).toBe(7);

    const presenceState = getChannelState("presence");
    expect(presenceState.topic).toBe("who");
    expect(presenceState.cellState.online).toBe(3);

    // Mutation surfaces on next read.
    rt.set(chatCount.key, 99);
    expect(getChannelState("chat").cellState.count).toBe(99);
  });
});
