/**
 * §52.8 SSR pre-render — B-substrate (inline-state seed). Change-id
 * ssr-b-substrate-2026-06-30.
 *
 * The compiler emits a request-time SSR HTML-composition GET route that runs the
 * SAME server-authority queries the /__serverLoad + /__mountHydrate routes run
 * (reusing the §14.8.9 _scrml_protect_tag → _scrml_protect_redact egress sink),
 * reads the sibling compiled <base>.html, and injects
 * `<script>window.__scrml_ssr_state={…}</script>` before </head>. The client
 * seeds its cells BEFORE mount (_scrml_ssr_seed_apply) so a seeded cell is
 * construction-resolved; the /__serverLoad fetch IIFEs skip the RTT
 * (_scrml_ssr_seeded), and the engine `server=@cell` ride reads a real value at
 * construction.
 *
 * B-SUBSTRATE ONLY — does NOT close g-tier1-ssr-prerender and does NOT retire
 * W-AUTH-002 (no markup pre-render; that is the A-terminus). These tests assert
 * the seed/skip/redact machinery, NOT the markup-render or the warning retirement.
 *
 * Coverage:
 *   (a) inline <script>window.__scrml_ssr_state=…</script> injected before </head>
 *   (b) a protect='d column is REDACTED in the inline state
 *   (c) the /__serverLoad fetch IIFE is SKIPPED for a seeded cell
 *   (d) the engine server=@cell ride hydrates at construction from the seed
 *   (e) a NON-server-authority / non-protect page emits no SSR script / no guard
 *   Parity: Tier-1 (SELECT *), Tier-2 Pattern-C (inline ?{}), derived-over-server.
 */

import { describe, test, expect } from "bun:test";

import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeRouteMap() {
  return { functions: new Map() };
}
function makeDepGraph() {
  return { nodes: new Map(), edges: [] };
}
// Empty protect analysis (protect inactive — byte-identical egress).
function noProtect() {
  return { views: new Map() };
}
// `users.passwordHash` protected (PA views shape — buildProtectContext input).
function usersProtect() {
  return {
    views: new Map([
      ["db1", {
        tables: new Map([
          ["users", {
            protectedFields: new Set(["passwordHash"]),
            fullSchema: [{ name: "id" }, { name: "name" }, { name: "passwordHash" }],
          }],
        ]),
      }],
    ]),
  };
}

function parseAST(source, filePath) {
  return buildAST(splitBlocks(filePath, source)).ast;
}

function compileBundles(source, { protectAnalysis = noProtect(), filePath = "/test/app.scrml" } = {}) {
  const ast = parseAST(source, filePath);
  const result = runCG({
    files: [ast],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis,
  });
  const out = result.outputs.get(filePath);
  return { clientJs: out?.clientJs ?? "", serverJs: out?.serverJs ?? "", html: out?.html ?? "" };
}

// Full-pipeline compile (SYM/TS passes run) — needed for the §51.0.E engine
// E-leg server-source hydration substrate (the minimal runCG harness above
// decorates the Pattern-C load but not the engine subscription; same caveat
// as server-cell-load-pattern-c.test.js §7).
function compileFull(source) {
  const dir = mkdtempSync(join(tmpdir(), "ssr-b-substrate-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, source);
  try {
    const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const out = result.outputs ? [...result.outputs.values()][0] : null;
    return { clientJs: out?.clientJs ?? "", serverJs: out?.serverJs ?? "", html: out?.html ?? "" };
  } finally {
    try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// Tier-1 server-authority TYPE over a table with a protected column.
const TIER1 = `<program db="sqlite:./test.db">
\${
  < Account authority="server" table="users">
    id: number
    name: string
    passwordHash: string
  </>
  <Account> @accounts
}
<ul><each in=@accounts key=@.id><li : @.name></each></ul>
</program>`;

// Tier-2 Pattern-C inline ?{} cell.
const PATTERNC = `<program db="sqlite:./test.db">
<driver server> = ?{ \`SELECT * FROM drivers WHERE id = 1\` }.get()
<main><p>{@driver.id}</p></main>
</program>`;

// Derived cell over a Tier-1 server source.
const DERIVED = `<program db="sqlite:./test.db">
\${
  < Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts

  const <accountCount> = @accounts.length
}
<main><p>{@accountCount}</p></main>
</program>`;

// Engine server=@cell ride over a Pattern-C source cell.
const ENGINE_RIDE = `<program db="sqlite:./test.db">
type DriverStatus:enum = { OffDuty, Driving, OnDuty, Sleeper }
type Driver:struct = { id: number, current_status: string }

<driver server> : Driver = ?{ \`SELECT * FROM drivers WHERE id = 1\` }.get()

<engine for=DriverStatus server=@driver.current_status initial=.OffDuty>
  <OffDuty rule=(.Driving | .OnDuty | .Sleeper) : "Off duty">
  <Driving rule=(.OnDuty | .OffDuty)            : "Driving">
  <OnDuty  rule=(.Driving | .OffDuty | .Sleeper) : "On duty">
  <Sleeper rule=(.OffDuty | .OnDuty)            : "Sleeper berth">
</>

<main><p>Status: {@driver.current_status}</p></main>
</program>`;

// A plain client-local page — no server-authority cell, no protect.
const NON_SERVER = `<program>
<count> = 0
<main><button onclick=\${@count = @count + 1}>{@count}</button></main>
</program>`;

// ---------------------------------------------------------------------------
// (a) inline <script>window.__scrml_ssr_state=…</script> before </head>
// ---------------------------------------------------------------------------

describe("ssr-b-substrate (a): the SSR HTML-composition route injects the inline seed", () => {
  test("emits a GET route returning text/html that injects window.__scrml_ssr_state before </head>", () => {
    const { serverJs } = compileBundles(TIER1);
    expect(serverJs).toContain("_scrml_route___ssr");
    expect(serverJs).toContain('method: "GET"');
    expect(serverJs).toContain('Content-Type": "text/html');
    expect(serverJs).toContain("window.__scrml_ssr_state=");
    // injected before </head> via a FUNCTION replacer (FIX E — so $-patterns in the
    // seed JSON are spliced literally, not interpreted by String.replace).
    expect(serverJs).toContain('_scrml_html.replace("</head>", () => _scrml_seed_tag + "</head>")');
    // the route is registered in the aggregate routes[] (so the host dispatches it)
    expect(serverJs).toMatch(/export const routes = \[[^\]]*_scrml_route___ssr/);
  });

  test("the seed handler reads the sibling compiled <base>.html via import.meta.url", () => {
    const { serverJs } = compileBundles(TIER1);
    expect(serverJs).toContain('Bun.file(new URL("./app.html", import.meta.url))');
  });

  test("a `<` in the serialized state is escaped so it cannot break out of the <script> tag", () => {
    const { serverJs } = compileBundles(TIER1);
    // String.fromCharCode(92) is a backslash → `<` becomes the JS escape \\u003c.
    expect(serverJs).toContain('.replace(/</g, String.fromCharCode(92) + "u003c")');
  });
});

// ---------------------------------------------------------------------------
// (b) a protect='d column is REDACTED in the inline state
// ---------------------------------------------------------------------------

describe("ssr-b-substrate (b): protected columns are redacted in the inline seed (§14.8.9 reuse)", () => {
  test("the Tier-1 seed tags the SELECT * with the protected columns and redacts at the sink", () => {
    const { serverJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    // tag + redact wrap inside the SSR seed handler (mirrors the /__serverLoad route)
    expect(serverJs).toContain('_scrml_protect_tag(await _scrml_sql`SELECT * FROM users`, ["passwordHash"])');
    expect(serverJs).toContain('_scrml_ssr_state["accounts"] = _scrml_protect_redact(_scrml_rows)');
  });

  test("a protected column never appears as a raw client-side literal (no view-source leak path)", () => {
    const { clientJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    // the redaction is server-side; the inline-state assignment is server-only.
    expect(clientJs).not.toContain("__scrml_ssr_state=");
    expect(clientJs).not.toContain("passwordHash");
  });

  test("no-protect Tier-1 seed bakes the SELECT * untagged (byte-clean for non-protect apps)", () => {
    const { serverJs } = compileBundles(TIER1, { protectAnalysis: noProtect() });
    expect(serverJs).toContain('_scrml_ssr_state["accounts"] = await _scrml_sql`SELECT * FROM users`');
    expect(serverJs).not.toContain("_scrml_protect_tag");
  });
});

// ---------------------------------------------------------------------------
// (c) the /__serverLoad fetch IIFE is SKIPPED for a seeded cell
// ---------------------------------------------------------------------------

describe("ssr-b-substrate (c): the mount fetch IIFE is skipped for a seeded cell", () => {
  test("Tier-1 client load applies the seed then guards the fetch on _scrml_ssr_seeded", () => {
    const { clientJs } = compileBundles(TIER1);
    expect(clientJs).toContain("_scrml_ssr_seed_apply();");
    expect(clientJs).toContain('if (_scrml_ssr_seeded("accounts")) return;');
    expect(clientJs).toContain('fetch("/__serverLoad/accounts"');
    // the guard precedes the fetch (skip wins before the RTT)
    const guardIdx = clientJs.indexOf('if (_scrml_ssr_seeded("accounts")) return;');
    const fetchIdx = clientJs.indexOf('fetch("/__serverLoad/accounts"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(fetchIdx);
  });

  test("Pattern-C client load guards its /__serverLoad fetch on the seed too", () => {
    const { clientJs } = compileBundles(PATTERNC);
    expect(clientJs).toContain('if (_scrml_ssr_seeded("driver")) return;');
    expect(clientJs).toContain('fetch("/__serverLoad/driver"');
  });

  test("seed-apply runs BEFORE the fetch IIFEs (override placeholder, then skip RTT)", () => {
    const { clientJs } = compileBundles(TIER1);
    const applyIdx = clientJs.indexOf("_scrml_ssr_seed_apply();");
    const guardIdx = clientJs.indexOf('if (_scrml_ssr_seeded("accounts")) return;');
    expect(applyIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeLessThan(guardIdx);
  });
});

// ---------------------------------------------------------------------------
// (d) the engine server=@cell ride hydrates at construction from the seed
// ---------------------------------------------------------------------------

describe("ssr-b-substrate (d): the engine server=@cell ride hydrates at construction from the seed", () => {
  test("(full pipeline) the seed is applied before the E-leg reads the source cell at construction", () => {
    const { clientJs } = compileFull(ENGINE_RIDE);
    expect(clientJs).toContain("_scrml_ssr_seed_apply();");
    // E-leg reads the (now seeded) source cell + hydrates guard-free at construction
    expect(clientJs).toContain('_scrml_reactive_get("driver")');
    expect(clientJs).toContain("_scrml_engine_hydrate_init(");
    // seed-apply precedes the immediate E-leg construction read (it rides the seed)
    const applyIdx = clientJs.indexOf("_scrml_ssr_seed_apply();");
    const elegIdx = clientJs.indexOf('_scrml_reactive_get("driver")');
    expect(applyIdx).toBeGreaterThan(-1);
    expect(elegIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeLessThan(elegIdx);
  });

  test("the source cell's /__serverLoad fetch is skipped when seeded (no post-mount fetch)", () => {
    const { clientJs } = compileBundles(ENGINE_RIDE);
    expect(clientJs).toContain('if (_scrml_ssr_seeded("driver")) return;');
  });

  test("the server bundle bakes the engine's source cell into the seed", () => {
    const { serverJs } = compileBundles(ENGINE_RIDE);
    expect(serverJs).toContain('_scrml_ssr_state["driver"]');
  });
});

// ---------------------------------------------------------------------------
// (e) a NON-server-authority page emits no SSR seed (byte-identical class)
// ---------------------------------------------------------------------------

describe("ssr-b-substrate (e): a non-server-authority / non-protect page emits no SSR seed", () => {
  test("no SSR route, no inline-state injection, no protect helper in the server bundle", () => {
    const { serverJs } = compileBundles(NON_SERVER);
    expect(serverJs).not.toContain("_scrml_route___ssr");
    expect(serverJs).not.toContain("__scrml_ssr_state");
    expect(serverJs).not.toContain("_scrml_protect_");
  });

  test("no seed-apply call and no seed-skip guard in the client bundle (fetch path unchanged)", () => {
    const { clientJs } = compileBundles(NON_SERVER);
    expect(clientJs).not.toContain("_scrml_ssr_seed_apply");
    expect(clientJs).not.toContain("_scrml_ssr_seeded");
  });
});

// ---------------------------------------------------------------------------
// Parity — Tier-1 + Tier-2 Pattern-C + derived-over-server (§52.7 uniform)
// ---------------------------------------------------------------------------

describe("ssr-b-substrate parity: Tier-1 + Tier-2 Pattern-C + derived all seed uniformly", () => {
  test("Tier-1 (SELECT *) is baked into the inline seed", () => {
    const { serverJs } = compileBundles(TIER1);
    expect(serverJs).toContain('_scrml_ssr_state["accounts"] = await _scrml_sql`SELECT * FROM users`');
  });

  test("Tier-2 Pattern-C (inline ?{}) is baked into the inline seed via the §44 lowering", () => {
    const { serverJs } = compileBundles(PATTERNC);
    expect(serverJs).toContain('_scrml_ssr_state["driver"]');
    expect(serverJs).toContain("SELECT * FROM drivers");
  });

  test("a derived cell over a server source recomputes from the seeded source (its source is baked, not the derived value)", () => {
    const { serverJs, clientJs } = compileBundles(DERIVED);
    // the SERVER source @accounts is baked; @accountCount is NOT a separate seed key
    expect(serverJs).toContain('_scrml_ssr_state["accounts"]');
    expect(serverJs).not.toContain('_scrml_ssr_state["accountCount"]');
    // client seeds the source, the derived recomputes from it at construction
    expect(clientJs).toContain("_scrml_ssr_seed_apply();");
    expect(clientJs).toContain('if (_scrml_ssr_seeded("accounts")) return;');
  });
});
