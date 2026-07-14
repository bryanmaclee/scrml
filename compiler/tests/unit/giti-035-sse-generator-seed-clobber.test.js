// GITI-035 (giti feed finding #2, RUNTIME half) — an SSE `server function*`
// binding `${ @cell = gen() }` must NOT clobber the cell's declaration seed.
//
// THE BUG (Bug-51 class: compiles + node-checks clean, wrong at runtime):
//   `<status> = { state: Phase.Idle, n: 0 }` emits the typed seed
//   `_scrml_reactive_set("status", _scrml_deep_reactive({...}))`. The following
//   `${ @status = tick() }` (tick = a `server function*` SSE generator) lowered —
//   via the GITI-026 post-sse-reactive-bind stage — to a SPURIOUS
//   `_scrml_reactive_set("status", null)` PLUS the SSE subscription. That null-set
//   CLOBBERED the seed; a synchronous `@status.n` / `@status.state` render on
//   initial paint then hit `null.<field>` and threw. The init_set sidecar
//   `_scrml_init_set("status", () => { sub; return null })` additionally re-nulled
//   the seed on reset AND double-subscribed.
//
// THE FIX (emit-client.ts post-sse-reactive-bind stage): the SSE rewrite is now
// seed-aware. When the cell ALREADY carries a declaration-emitted set/thunk of the
// same shape EARLIER in the module (i.e. it has a real `<cell> = {...}` seed), the
// reactive_set form emits ONLY the subscription (no null-set) and the init_set
// form is SUPPRESSED (the declaration thunk already re-seeds correctly on reset).
// A cell bound SOLELY by `@cell = gen()` (no separate seed — GITI-026's original
// form) keeps the null-seed + return-null-thunk path unchanged.
//
// Cross-refs SPEC §37 (SSE `server function*`); §37.5 client binding; §6.8 reset.
// GITI-026 (giti-025-026-sse-client-stub-wiring) is the sibling that established
// the subscribe-via-callback rewrite this fix makes seed-aware.

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { resolve, dirname, join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";

const _testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmpCounter = 0;

// Compile a single .scrml source string -> {server, client, errors, warnings}.
function compile(source, tag) {
  const _tag = tag ?? `giti35-${++_tmpCounter}`;
  const _tmpDir = resolve(_testDir, `_tmp_giti035_${_tag}`);
  const _tmpInput = resolve(_tmpDir, `${_tag}.scrml`);
  mkdirSync(_tmpDir, { recursive: true });
  writeFileSync(_tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [_tmpInput],
      write: false,
      outputDir: resolve(_tmpDir, "out"),
      log: () => {},
    });
    let server = "";
    let client = "";
    for (const [fp, output] of (result.outputs ?? new Map())) {
      if (fp.includes(_tag)) {
        if (output && typeof output.serverJs === "string") server = output.serverJs;
        if (output && typeof output.clientJs === "string") client = output.clientJs;
      }
    }
    return { server, client, errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(_tmpInput)) rmSync(_tmpInput);
    if (existsSync(_tmpDir)) rmSync(_tmpDir, { recursive: true });
  }
}

// `node --check` a client bundle in isolation (syntax gate — undefined runtime
// references are irrelevant; --check is parse-only). Returns true if clean.
function nodeCheckClean(clientJs) {
  const d = mkdtempSync(join(tmpdir(), "giti035-check-"));
  const f = join(d, "client.js");
  writeFileSync(f, clientJs);
  try {
    execFileSync("node", ["--check", f], { stdio: "pipe" });
    return true;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

// The repro: a TYPED SEED (`<status> = {...}`) then an SSE-generator binding.
const SEEDED_SSE = `<program>
  type Phase:enum = { Idle  Active }
  \${
    server function* tick() { while (true) { yield { state: Phase.Active, n: 1 } } }
  }
  <status> = { state: Phase.Idle, n: 0 }
  \${ @status = tick() }
  <p>n: \${@status.n}</p>
  <match for=Phase on=@status.state>
    <Idle>idle</Idle>
    <Active>active</Active>
  </match>
</program>`;

// GITI-026's original form: the cell is bound SOLELY by `@latest = ticks()` with
// NO separate `<latest>` seed. The null-seed + return-null reset thunk stay.
const NOSEED_SSE = `<program>
  \${
    server function* ticks() { let i = 0  while (i < 3) { yield i  i = i + 1 } }
  }
  \${ @latest = ticks() }
  <div><p>\${@latest}</p></div>
</program>`;

// Edge 4 — a REGULAR (non-generator) server fn bound to a seeded cell. This is a
// DIFFERENT lowering (async fetch await-IIFE), NOT the SSE path. It must not be
// collateral-damaged, and it does not carry the null-clobber (the awaited set
// writes the resolved value; the seed survives until the fetch settles).
const SEEDED_REGULAR_FN = `<program>
  \${ server function getData() { return 42 } }
  <val> = 7
  \${ @val = getData() }
  <p>v: \${@val}</p>
</program>`;

// Edge 5 — a plain client-value reassignment must still emit set(cell, value).
const SEEDED_CLIENT_VALUE = `<program>
  <count> = 0
  \${ @count = 5 }
  <p>c: \${@count}</p>
</program>`;

// ---------------------------------------------------------------------------
// Edge 1 — the seed survives; NO spurious null-set clobbers it.
// ---------------------------------------------------------------------------
describe("GITI-035 edge 1: seeded SSE binding keeps the seed (no null-clobber)", () => {
  test("no `_scrml_reactive_set(\"status\", null)` is emitted", () => {
    const { client, errors } = compile(SEEDED_SSE, "e1-noclobber");
    expect(errors).toHaveLength(0);
    // The clobber line — must be GONE.
    expect(client).not.toMatch(/_scrml_reactive_set\("status",\s*null\)/);
  });

  test("the typed seed set survives verbatim", () => {
    const { client } = compile(SEEDED_SSE, "e1-seed");
    expect(client).toMatch(
      /_scrml_reactive_set\("status", _scrml_deep_reactive\(\{state: Phase\.Idle, n: 0\}\)\)/,
    );
  });

  test("the synchronous `@status.n` / `@status.state` reads survive (crash site)", () => {
    // These reads run on initial paint BEFORE any SSE event; with the seed
    // clobbered to null they threw. Their presence + the surviving seed is the
    // codegen half of the no-crash guarantee (runtime half is the conformance case).
    const { client } = compile(SEEDED_SSE, "e1-reads");
    expect(client).toContain('_scrml_reactive_get("status").n');
    expect(client).toContain('_scrml_reactive_get("status").state');
  });
});

// ---------------------------------------------------------------------------
// Edge 2 — the SSE subscription STILL fires (the stream still updates the cell).
// ---------------------------------------------------------------------------
describe("GITI-035 edge 2: the SSE subscription is preserved", () => {
  test("subscribe routes each event into the cell via the trailing callback", () => {
    const { client } = compile(SEEDED_SSE, "e2-sub");
    expect(client).toMatch(
      /_scrml_sse_tick_\d+\(\(_scrml_d\) => _scrml_reactive_set\("status", _scrml_d\)\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Edge 3 — the init_set sidecar does not re-null the seed.
// ---------------------------------------------------------------------------
describe("GITI-035 edge 3: the reset init-thunk does not re-null the seed", () => {
  test("no SSE `return null` reset thunk is registered for the seeded cell", () => {
    const { client } = compile(SEEDED_SSE, "e3-nonull");
    // The suppressed shape: `_scrml_init_set("status", () => { <sub>; return null; })`.
    expect(client).not.toMatch(/_scrml_init_set\("status", \(\) => \{[\s\S]*?return null/);
  });

  test("the declaration init-thunk survives (reset re-seeds to the typed value)", () => {
    const { client } = compile(SEEDED_SSE, "e3-declthunk");
    expect(client).toMatch(
      /_scrml_init_set\("status", \(\) => \(\{state: Phase\.Idle, n: 0\}\)\)/,
    );
  });

  test("the seeded SSE client bundle is `node --check` clean", () => {
    const { client } = compile(SEEDED_SSE, "e3-nodecheck");
    expect(nodeCheckClean(client)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge 4 — a regular (non-generator) server fn binding is a separate case and
// is not collateral-damaged (no null-clobber; the awaited set writes the result).
// ---------------------------------------------------------------------------
describe("GITI-035 edge 4: regular server-fn binding is a separate, non-clobbering path", () => {
  test("no `_scrml_reactive_set(\"val\", null)` clobber for a regular server fn", () => {
    const { client, errors } = compile(SEEDED_REGULAR_FN, "e4-noclobber");
    expect(errors).toHaveLength(0);
    expect(client).not.toMatch(/_scrml_reactive_set\("val",\s*null\)/);
  });

  test("the seed set survives and the awaited-result set is present", () => {
    const { client } = compile(SEEDED_REGULAR_FN, "e4-shape");
    expect(client).toContain('_scrml_reactive_set("val", 7)');
    expect(client).toMatch(
      /_scrml_reactive_set\("val", await _scrml_fetch_getData_\d+\(\)\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Edge 5 — a normal client-value assignment still emits set(cell, value).
// ---------------------------------------------------------------------------
describe("GITI-035 edge 5: a plain client-value reassignment is untouched", () => {
  test("`@count = 5` still emits `_scrml_reactive_set(\"count\", 5)`", () => {
    const { client, errors } = compile(SEEDED_CLIENT_VALUE, "e5-clientval");
    expect(errors).toHaveLength(0);
    expect(client).toContain('_scrml_reactive_set("count", 5)');
  });
});

// ---------------------------------------------------------------------------
// Regression guard — GITI-026's original NO-seed form is unchanged.
// ---------------------------------------------------------------------------
describe("GITI-035 regression: no-seed SSE binding keeps GITI-026's null-seed path", () => {
  test("a cell bound solely by `@latest = ticks()` still seeds to null", () => {
    const { client } = compile(NOSEED_SSE, "reg-noseed");
    // No prior seed exists, so the SSE rewrite still seeds absence.
    expect(client).toContain('_scrml_reactive_set("latest", null)');
    // And subscribes.
    expect(client).toMatch(
      /_scrml_sse_ticks_\d+\(\(_scrml_d\) => _scrml_reactive_set\("latest", _scrml_d\)\)/,
    );
  });

  test("the no-seed reset thunk still re-subscribes and returns null", () => {
    const { client } = compile(NOSEED_SSE, "reg-noseed-thunk");
    expect(client).toMatch(
      /_scrml_init_set\("latest", \(\) => \{ _scrml_sse_ticks_\d+\(\(_scrml_d\) => _scrml_reactive_set\("latest", _scrml_d\)\); return null; \}\)/,
    );
  });
});
