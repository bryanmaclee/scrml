/**
 * mcp-runtime-helpers.test.js — Unit tests for compiler/runtime/stdlib/mcp.js
 *
 * Covers the three V0 MCP read helpers (Sub-unit B), the install/uninstall
 * runtime-injection lifecycle, and the loadSidecars() reader. The MCP server
 * boot path (Sub-unit C) and <program mcp> attribute wiring (Sub-unit D)
 * are out of scope.
 *
 * Strategy:
 *   - Build a mock runtime: a plain JS object {_state} plus reactive_get
 *     and derived_get closures that read from it. This mirrors the surface
 *     the compiled program will pass into install() at MCP server boot.
 *   - Write sidecar JSON files (engines.json / forms.json / channels.json)
 *     into a tmp dir per test; point loadSidecars() at the tmp dir.
 *   - Exercise the helpers; assert shape + update-propagation (mutate the
 *     mock state cell, helper returns the new value).
 *
 * The tests do not import the SCRML runtime (no runtime-template.js
 * evaluation needed) — the helpers are pure consumers of injected refs.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  install,
  uninstall,
  loadSidecars,
  stopWatchers,
  getCurrentVariant,
  getFormStatus,
  getChannelState,
  _stateForTests,
  _resetForTests,
} from "../../runtime/stdlib/mcp.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRuntime(initial) {
  const state = Object.assign({}, initial || {});
  return {
    state: state,
    reactive_get(name) { return state[name]; },
    derived_get(name) { return state[name]; },
    set(name, value) { state[name] = value; },
  };
}

function makeTmpSidecarDir() {
  return mkdtempSync(join(tmpdir(), "scrml-mcp-helpers-"));
}

function writeSidecar(dir, name, value) {
  writeFileSync(join(dir, name), JSON.stringify(value), "utf-8");
}

let tmpDir;

beforeEach(() => {
  _resetForTests();
  tmpDir = makeTmpSidecarDir();
});

afterEach(() => {
  _resetForTests();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// install() / uninstall() lifecycle
// ---------------------------------------------------------------------------

describe("install / uninstall", () => {
  test("install({}) without functions still records a runtime object but helpers refuse", () => {
    install({});
    // _stateForTests().runtime should be set (object with nulls), but
    // _requireRuntime treats it as not-connected because both fns are null.
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);
    expect(() => getCurrentVariant("anything")).toThrow(/runtime not connected/);
  });

  test("install with no arg throws", () => {
    expect(() => install()).toThrow(/install\(\) requires a runtime object/);
  });

  test("install + uninstall + helpers refuse after uninstall", () => {
    const rt = makeMockRuntime({ foo: "Bar" });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", [{ name: "foo" }]);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);
    expect(getCurrentVariant("foo")).toBe("Bar");

    uninstall();
    expect(() => getCurrentVariant("foo")).toThrow(/runtime not connected/);
  });

  test("helpers throw before loadSidecars is called", () => {
    const rt = makeMockRuntime({});
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    expect(() => getCurrentVariant("x")).toThrow(/engines.json not loaded/);
    expect(() => getFormStatus("x")).toThrow(/forms.json not loaded/);
    expect(() => getChannelState("x")).toThrow(/channels.json not loaded/);
  });
});

// ---------------------------------------------------------------------------
// loadSidecars
// ---------------------------------------------------------------------------

describe("loadSidecars", () => {
  test("reads three sidecars from outputDir; populates module state", () => {
    writeSidecar(tmpDir, "engines.json", [{ name: "engine1", cellKey: "engine1" }]);
    writeSidecar(tmpDir, "forms.json", [{ formName: "form1", fields: [] }]);
    writeSidecar(tmpDir, "channels.json", [{ name: "ch1", topic: "t", autoSyncedCells: [] }]);
    loadSidecars(tmpDir);

    const snap = _stateForTests();
    expect(snap.sidecars.engines).toHaveLength(1);
    expect(snap.sidecars.forms).toHaveLength(1);
    expect(snap.sidecars.channels).toHaveLength(1);
    expect(snap.loadedOutputDir).toBe(tmpDir);
  });

  test("missing sidecar files default to [] (no throw)", () => {
    // No files written.
    loadSidecars(tmpDir);
    const snap = _stateForTests();
    expect(snap.sidecars.engines).toEqual([]);
    expect(snap.sidecars.forms).toEqual([]);
    expect(snap.sidecars.channels).toEqual([]);
  });

  test("malformed sidecar JSON degrades to []", () => {
    writeFileSync(join(tmpDir, "engines.json"), "not-json", "utf-8");
    loadSidecars(tmpDir);
    expect(_stateForTests().sidecars.engines).toEqual([]);
  });

  test("sidecar that's a JSON object (not array) coerces to []", () => {
    writeFileSync(join(tmpDir, "engines.json"), JSON.stringify({ shape: "wrong" }), "utf-8");
    loadSidecars(tmpDir);
    expect(_stateForTests().sidecars.engines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getCurrentVariant
// ---------------------------------------------------------------------------

describe("getCurrentVariant", () => {
  test("returns the bare tag string for a primitive cell value", () => {
    const rt = makeMockRuntime({ myEngine: "Idle" });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", [{ name: "myEngine" }]);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);
    expect(getCurrentVariant("myEngine")).toBe("Idle");
  });

  test("normalizes {variant,data} record to tag string", () => {
    const rt = makeMockRuntime({ myEngine: { variant: "Loading", data: { pct: 33 } } });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", [{ name: "myEngine" }]);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);
    expect(getCurrentVariant("myEngine")).toBe("Loading");
  });

  test("honors cellKey override when descriptor.name != state key", () => {
    const rt = makeMockRuntime({ "encoded$myEngine": "Done" });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", [
      { name: "myEngine", cellKey: "encoded$myEngine" },
    ]);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);
    expect(getCurrentVariant("myEngine")).toBe("Done");
  });

  test("returns undefined for unknown engine name (descriptor absent)", () => {
    const rt = makeMockRuntime({});
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", [{ name: "other" }]);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);
    expect(getCurrentVariant("nope")).toBe(undefined);
  });

  test("update propagation: advancing engine state surfaces in next read", () => {
    const rt = makeMockRuntime({ engineA: "Idle" });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", [{ name: "engineA" }]);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);

    expect(getCurrentVariant("engineA")).toBe("Idle");
    rt.set("engineA", "Running");
    expect(getCurrentVariant("engineA")).toBe("Running");
    rt.set("engineA", { variant: "Failed", data: { msg: "oops" } });
    expect(getCurrentVariant("engineA")).toBe("Failed");
  });
});

// ---------------------------------------------------------------------------
// getFormStatus
// ---------------------------------------------------------------------------

describe("getFormStatus", () => {
  test("composes structured shape from compound + per-field keys", () => {
    const rt = makeMockRuntime({
      "form$signup$isValid": true,
      "form$signup$errors": [],
      "form$signup$touched": true,
      "form$signup$submitted": false,
      "form$signup$field$email$isValid": true,
      "form$signup$field$email$errors": [],
      "form$signup$field$email$touched": true,
      "form$signup$field$password$isValid": false,
      "form$signup$field$password$errors": [{ variant: "Required" }],
      "form$signup$field$password$touched": true,
    });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", [
      {
        formName: "signup",
        fields: [
          {
            name: "email",
            qualifiedName: "signup.email",
            isValidKey: "form$signup$field$email$isValid",
            errorsKey: "form$signup$field$email$errors",
            touchedKey: "form$signup$field$email$touched",
          },
          {
            name: "password",
            qualifiedName: "signup.password",
            isValidKey: "form$signup$field$password$isValid",
            errorsKey: "form$signup$field$password$errors",
            touchedKey: "form$signup$field$password$touched",
          },
        ],
        compoundKeys: {
          isValidKey: "form$signup$isValid",
          errorsKey: "form$signup$errors",
          touchedKey: "form$signup$touched",
          submittedKey: "form$signup$submitted",
        },
      },
    ]);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);

    const status = getFormStatus("signup");
    expect(status.isValid).toBe(true);
    expect(status.errors).toEqual([]);
    expect(status.touched).toBe(true);
    expect(status.submitted).toBe(false);
    expect(status.perField.email).toEqual({ isValid: true, errors: [], touched: true });
    expect(status.perField.password).toEqual({
      isValid: false,
      errors: [{ variant: "Required" }],
      touched: true,
    });
  });

  test("rolls up from per-field cells when no compoundKeys present", () => {
    const rt = makeMockRuntime({
      "f$a$isValid": true,
      "f$a$errors": [],
      "f$a$touched": false,
      "f$b$isValid": false,
      "f$b$errors": [{ variant: "LengthFailed", data: { predicate: ">=8" } }],
      "f$b$touched": true,
    });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", [
      {
        formName: "noCompound",
        fields: [
          { name: "a", isValidKey: "f$a$isValid", errorsKey: "f$a$errors", touchedKey: "f$a$touched" },
          { name: "b", isValidKey: "f$b$isValid", errorsKey: "f$b$errors", touchedKey: "f$b$touched" },
        ],
      },
    ]);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);

    const status = getFormStatus("noCompound");
    expect(status.isValid).toBe(false);  // b invalid → roll-up false
    expect(status.touched).toBe(true);   // b touched → roll-up true
    expect(status.submitted).toBe(false);
    expect(status.errors).toEqual([{ variant: "LengthFailed", data: { predicate: ">=8" } }]);
  });

  test("returns undefined for unknown form name", () => {
    const rt = makeMockRuntime({});
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", [{ formName: "other", fields: [] }]);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);
    expect(getFormStatus("nope")).toBe(undefined);
  });

  test("update propagation: toggling a field cell flips compound status on re-read", () => {
    const rt = makeMockRuntime({
      "f$x$isValid": true,
      "f$x$errors": [],
      "f$x$touched": false,
    });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", [
      {
        formName: "single",
        fields: [
          { name: "x", isValidKey: "f$x$isValid", errorsKey: "f$x$errors", touchedKey: "f$x$touched" },
        ],
      },
    ]);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);

    expect(getFormStatus("single").isValid).toBe(true);
    rt.set("f$x$isValid", false);
    rt.set("f$x$errors", [{ variant: "Required" }]);
    rt.set("f$x$touched", true);
    const after = getFormStatus("single");
    expect(after.isValid).toBe(false);
    expect(after.errors).toEqual([{ variant: "Required" }]);
    expect(after.touched).toBe(true);
    expect(after.perField.x.isValid).toBe(false);
  });

  test("handles form with zero fields", () => {
    const rt = makeMockRuntime({});
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", [{ formName: "empty", fields: [] }]);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);

    const status = getFormStatus("empty");
    expect(status.perField).toEqual({});
    expect(status.isValid).toBe(true);   // vacuous truth — no fields invalid
    expect(status.touched).toBe(false);
    expect(status.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getChannelState
// ---------------------------------------------------------------------------

describe("getChannelState", () => {
  test("reads each auto-synced cell by resolved key", () => {
    const rt = makeMockRuntime({
      "ch$chat$count": 42,
      "ch$chat$lastMessage": "hello",
    });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", [
      {
        name: "chat",
        topic: "room:lobby",
        autoSyncedCells: [
          { name: "count", key: "ch$chat$count" },
          { name: "lastMessage", key: "ch$chat$lastMessage" },
        ],
      },
    ]);
    loadSidecars(tmpDir);

    const state = getChannelState("chat");
    expect(state).toEqual({
      name: "chat",
      topic: "room:lobby",
      cellState: { count: 42, lastMessage: "hello" },
    });
  });

  test("returns undefined for unknown channel", () => {
    const rt = makeMockRuntime({});
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", [{ name: "other", topic: "t", autoSyncedCells: [] }]);
    loadSidecars(tmpDir);
    expect(getChannelState("nope")).toBe(undefined);
  });

  test("update propagation: cell mutation surfaces on next read", () => {
    const rt = makeMockRuntime({ "ch$c$v": 1 });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", [
      {
        name: "c",
        topic: "t",
        autoSyncedCells: [{ name: "v", key: "ch$c$v" }],
      },
    ]);
    loadSidecars(tmpDir);
    expect(getChannelState("c").cellState.v).toBe(1);
    rt.set("ch$c$v", 99);
    expect(getChannelState("c").cellState.v).toBe(99);
  });

  test("channel without autoSyncedCells yields empty cellState", () => {
    const rt = makeMockRuntime({});
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", [{ name: "empty", topic: "x" }]);
    loadSidecars(tmpDir);
    const state = getChannelState("empty");
    expect(state.cellState).toEqual({});
    expect(state.topic).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// fs.watch reload (opt-in)
// ---------------------------------------------------------------------------

// CAPABILITY GATE — these three tests assert an OS capability, not a product
// behaviour. `fs.watch` needs a free inotify INSTANCE, and Linux caps those per
// UID at `/proc/sys/fs/inotify/max_user_instances` (128 on the dev box). When
// the box is at the cap, `fs.watch` throws EMFILE, `watcherCount` stays 0, and
// these tests reported `(fail)` — a PRODUCT failure for something the product
// did not do. The pre-commit hook runs with `--bail`, so that false failure
// stops every commit in the repository until the unrelated process holding the
// instances exits.
//
// MEASURED, S349: 122 of 128 instances were held by 64 orphaned
// `scrml.js dev` servers leaked by THREE OTHER agent worktrees' churn tests,
// plus the in-flight review worktree's. A direct three-attempt `fs.watch` probe
// returned EMFILE on all three.
//
// The guard runs the real capability once and SKIPS rather than fails when the
// OS refuses. It does not weaken the assertions: on a box with a free instance
// the probe succeeds and all three run exactly as before. A skip is honest about
// what was measured; a fail is not.
function inotifyAvailable() {
  const probeDir = mkdtempSync(join(tmpdir(), "mcp-watch-probe-"));
  const probeFile = join(probeDir, "probe.json");
  writeFileSync(probeFile, "[]");
  let w = null;
  try {
    w = watch(probeFile, () => {});
    return true;
  } catch {
    return false;
  } finally {
    if (w) w.close();
    rmSync(probeDir, { recursive: true, force: true });
  }
}
const INOTIFY_OK = inotifyAvailable();
if (!INOTIFY_OK) {
  console.warn(
    "[mcp-runtime-helpers] SKIPPING the fs.watch reload tests: fs.watch threw " +
    "(inotify instances exhausted — see /proc/sys/fs/inotify/max_user_instances). " +
    "This is an environment limit, not a product failure."
  );
}

describe("fs.watch reload (watch: true)", () => {
  test.skipIf(!INOTIFY_OK)("registers watchers when watch:true", () => {
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir, { watch: true });
    expect(_stateForTests().watcherCount).toBe(3);
    stopWatchers();
    expect(_stateForTests().watcherCount).toBe(0);
  });

  test("does not register watchers by default", () => {
    writeSidecar(tmpDir, "engines.json", []);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir);
    expect(_stateForTests().watcherCount).toBe(0);
  });

  test.skipIf(!INOTIFY_OK)("reloads engines.json on change event", async () => {
    const rt = makeMockRuntime({ e: "A" });
    install({ reactive_get: rt.reactive_get, derived_get: rt.derived_get });
    writeSidecar(tmpDir, "engines.json", [{ name: "e" }]);
    writeSidecar(tmpDir, "forms.json", []);
    writeSidecar(tmpDir, "channels.json", []);
    loadSidecars(tmpDir, { watch: true });

    expect(getCurrentVariant("e")).toBe("A");

    // Rewrite engines.json with a new engine added.
    writeSidecar(tmpDir, "engines.json", [{ name: "e" }, { name: "e2", cellKey: "e2" }]);
    rt.set("e2", "Beta");

    // fs.watch is async; give the event loop a chance to fire.
    await new Promise(r => setTimeout(r, 200));

    // The new descriptor should be visible after reload.
    expect(getCurrentVariant("e2")).toBe("Beta");
    stopWatchers();
  });
});
