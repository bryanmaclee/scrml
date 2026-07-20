/**
 * §52.6 Compiler-Generated Sync Infrastructure (READ-authority half)
 *
 * §52 is a READ-authority + reactive-wiring layer. The compiler generates the
 * READ path for server-authoritative `<var server>` declarations:
 *   1. `emitInitialLoad`       — async IIFE to fetch the initial value on mount
 *   2. `emitUnifiedMountHydrate` — §8.11 coalesced multi-var mount fetch
 *
 * The compiler does NOT generate the WRITE path. Per the Q1=C / Q2=WF ruling
 * (server-state-persist-semantics deep-dive, ratified 2026-06-14), the persist
 * write is the DEVELOPER's own explicit `?{}` server function at both tiers
 * (§52.6.2 / §52.6.6). An assignment to a `<var server>` cell lands locally via
 * the ordinary reactive set — that IS the "immediate-local" responsiveness
 * property; no separately-generated optimistic subscriber is emitted. There is
 * no compiler-generated `_scrml_server_sync_<var>` route and no auto-rollback:
 * the developer's server fn is `await`ed at the assignment call site and its
 * errors are owned by the developer's `!{}` / `on error` handling (§52.6.3).
 *
 * Tier 1 (type-level authority with `table=`) read-authority codegen (the
 * `SELECT *` initial load + SSR pre-render) is a committed follow-on; see the
 * interim W-AUTH-002 honesty warning in the type system, which surfaces the
 * residual gap (today a Tier-1 server-authority type is otherwise a silent
 * no-op).
 *
 * Generated output is appended to client JS by emitReactiveWiring after the
 * top-level logic statements pass (Step 4b).
 */

// ---------------------------------------------------------------------------
// §52.6.1 Initial Load
// ---------------------------------------------------------------------------

/**
 * Emit an async IIFE that populates the server-authoritative variable on mount.
 *
 * Strategy:
 *   - If `initExpr` contains a function call (has `(`), treat it as the load
 *     function. Await it and set the reactive variable.
 *   - If `initExpr` has no function call, this is a literal placeholder
 *     (e.g. `<count server> = 0`). The type system already emitted W-AUTH-001.
 *     No async load is generated — return empty lines.
 *
 * §52.4.3: The initExpr is the CLIENT-SIDE PLACEHOLDER shown while loading.
 * The async IIFE replaces the placeholder with the authoritative value once
 * the server responds.
 *
 * Pattern:
 * ```javascript
 * // <var server> @varName — initial load on mount (§52.6.1)
 * (async () => {
 *   _scrml_reactive_set("varName", await (loadFn()));
 * })();
 * ```
 *
 * @param varName  - reactive variable name (no `@` prefix)
 * @param initExpr - raw initializer expression from the state-decl node
 */
export function emitInitialLoad(varName: string, initExpr: string): string[] {
  // If no function call detected in initExpr, no initial load is generated.
  // W-AUTH-001 was already emitted by the type system for this case.
  if (!initExpr || !initExpr.includes("(")) {
    return [];
  }

  const varJs = JSON.stringify(varName);

  return [
    `// <${varName} server> — initial load on mount (§52.6.1)`,
    `(async () => {`,
    `  _scrml_reactive_set(${varJs}, await (${initExpr}));`,
    `})();`,
  ];
}

// ---------------------------------------------------------------------------
// §52.6.1 / §52.3.5 Tier-1 server-authority TYPE initial load (SELECT *)
// ---------------------------------------------------------------------------

/**
 * Emit the client-side initial-load IIFE for a Tier-1 server-authority TYPE
 * instance (`< Type authority="server" table="…"> … </>` + `< Type> @var`).
 *
 * Per §52.6.1: "For Tier 1 types with table=, the compiler generates a SELECT *
 * from the table." The query runs server-side; the client fetches it through the
 * compiler-generated `/__serverLoad/<var>` route (symmetric to /__mountHydrate)
 * and lands the rows via the ordinary reactive set, replacing the local
 * placeholder once the rows resolve (§52.6.1, second paragraph).
 *
 * The WRITE is the developer's own `?{}` server fn (§52.6.2, Q1=C) — nothing is
 * emitted here for it.
 *
 * Pattern:
 * ```javascript
 * // < Type authority="server" table="cards"> @cards — SELECT * load on mount (§52.6.1)
 * (async () => {
 *   const _r = await fetch("/__serverLoad/cards", { method: "POST", ... });
 *   _scrml_reactive_set("cards", await _r.json());
 * })();
 * ```
 *
 * @param varName - reactive variable name (no `@` prefix)
 * @param table   - the `table=` name (the SELECT * source)
 */
export function emitServerAuthorityLoad(varName: string, table: string): string[] {
  const varJs = JSON.stringify(varName);
  const routeJs = JSON.stringify(`/__serverLoad/${varName}`);
  return [
    `// < ${varName} > server-authority type — SELECT * FROM ${table} load on mount (§52.6.1)`,
    `(async () => {`,
    // §52.8 (ssr-b-substrate) — skip the fetch RTT when the SSR pre-render
    // already seeded this cell from window.__scrml_ssr_state (graceful no-op
    // when the page was served without SSR — the fetch then runs unchanged).
    `  if (_scrml_ssr_seeded(${varJs})) return;`,
    `  const _scrml_sa_res = await fetch(${routeJs}, {`,
    `    method: "POST",`,
    `    headers: { "Content-Type": "application/json" },`,
    `    body: "{}",`,
    `  });`,
    `  _scrml_reactive_set(${varJs}, await _scrml_sa_res.json());`,
    `})();`,
  ];
}

// ---------------------------------------------------------------------------
// §52.6.5 Pattern C — inline-`?{}` RHS decl LOAD (S216 disposition A)
// ---------------------------------------------------------------------------

/**
 * Emit the client-side initial-load IIFE for a Tier-2 `<var server>` whose RHS
 * is a PARAM-FREE inline `?{}` query (§52.6.5 Pattern C).
 *
 * The `?{}` on the declaration RHS IS the cell's mount load. The query runs
 * server-side through the compiler-generated `/__serverLoad/<var>` route
 * (emitted by generateServerJs, running the cell's actual `?{}` via the
 * canonical §44 SQL lowering); the client fetches it on mount and lands the
 * result via the ordinary reactive set, replacing the in-flight placeholder
 * (`not`) once the query resolves (§52.4.3 — the placeholder is the VALUE shown
 * while loading, not the query).
 *
 * Symmetric to `emitServerAuthorityLoad` (the Tier-1 `SELECT * FROM <table>`
 * load): both POST an empty body. A PARAM-BEARING query (`?{ … ${@cell} … }`)
 * needs POST-body param-passing — a bounded follow-on, NOT this path (the caller
 * filters it out via collect.ts `serverVarDeclLoadKind` and emits W-AUTH-004).
 *
 * Pattern:
 * ```javascript
 * // <driver server> = ?{…} — inline-?{} RHS load on mount (§52.6.5 Pattern C)
 * (async () => {
 *   const _r = await fetch("/__serverLoad/driver", { method: "POST", ... });
 *   _scrml_reactive_set("driver", await _r.json());
 * })();
 * ```
 *
 * @param varName - reactive variable name (no `@` prefix)
 */
export function emitDeclRhsSqlLoad(varName: string): string[] {
  const varJs = JSON.stringify(varName);
  const routeJs = JSON.stringify(`/__serverLoad/${varName}`);
  return [
    `// <${varName} server> = ?{…} — inline-?{} RHS load on mount (§52.6.5 Pattern C)`,
    `(async () => {`,
    // §52.8 (ssr-b-substrate) — skip the fetch RTT when the SSR pre-render
    // already seeded this cell from window.__scrml_ssr_state.
    `  if (_scrml_ssr_seeded(${varJs})) return;`,
    `  const _scrml_sl_res = await fetch(${routeJs}, {`,
    `    method: "POST",`,
    `    headers: { "Content-Type": "application/json" },`,
    `    body: "{}",`,
    `  });`,
    `  _scrml_reactive_set(${varJs}, await _scrml_sl_res.json());`,
    `})();`,
  ];
}

// ---------------------------------------------------------------------------
// §52.6.2 Assignment Semantics — local landing only (NO emitter)
// ---------------------------------------------------------------------------
//
// Under the Q1=C ruling there is NO emitOptimisticUpdate and NO
// emitServerSyncStub. An assignment to a `<var server>` cell is the ordinary
// reactive set (already emitted by the assignment lowering) — that is the
// "immediate-local" property. The persist is the developer's `?{}` server fn,
// awaited at the assignment call site; the compiler emits nothing extra for the
// write path. (Earlier drafts emitted a reactive subscriber whose whole body
// was `try { await _scrml_server_sync_<var>(next) } catch { rollback }` — a
// driver for the now-retracted auto-persist route. Both are deleted.)

// ---------------------------------------------------------------------------
// §8.11 Mount-Hydration Coalescing (client side)
// ---------------------------------------------------------------------------

/**
 * Emit one unified client-side IIFE that fetches /__mountHydrate once on mount
 * and demultiplexes the keyed response into per-var `_scrml_reactive_set` calls.
 *
 * Paired with the synthetic server handler emitted by generateServerJs (§8.11.2).
 * Only fires when ≥2 `<var server>` decls with callable initExprs share a page
 * (§8.11.1). Writes are the developer's own `?{}` server fns (§52.6.2) — there
 * is no compiler-generated write route to coalesce (§8.11.3).
 *
 * Pattern:
 * ```javascript
 * // <var server> initial loads — coalesced via /__mountHydrate (§8.11)
 * (async () => {
 *   const _r = await fetch("/__mountHydrate", { method: "POST", ... });
 *   const _j = await _r.json();
 *   _scrml_reactive_set("a", _j["a"]);
 *   _scrml_reactive_set("b", _j["b"]);
 * })();
 * ```
 */
export function emitUnifiedMountHydrate(varNames: string[]): string[] {
  if (varNames.length === 0) return [];
  const lines: string[] = [];
  lines.push(`// <var server> initial loads — coalesced via /__mountHydrate (§8.11)`);
  lines.push(`(async () => {`);
  // §52.8 (ssr-b-substrate) — when the SSR pre-render seeded EVERY coalesced cell
  // from window.__scrml_ssr_state, skip the whole /__mountHydrate RTT. With §52.15.5
  // PER-CELL omission a public cell is seeded but a gated cell is not, so all-seeded
  // means "no gated cell" and the fetch is unnecessary; otherwise the fetch runs.
  const _ssrGuard = varNames.map((n) => `_scrml_ssr_seeded(${JSON.stringify(n)})`).join(" && ");
  lines.push(`  if (${_ssrGuard}) return;`);
  lines.push(`  const _scrml_mh_res = await fetch("/__mountHydrate", {`);
  lines.push(`    method: "POST",`);
  lines.push(`    headers: { "Content-Type": "application/json" },`);
  lines.push(`    body: "{}",`);
  lines.push(`  });`);
  // §52.15.5 (S255) — a genuine error (network / non-200) must not overwrite cells
  // from a failed response, and a null/empty body must not crash the keyed demux.
  lines.push(`  if (!_scrml_mh_res.ok) return;`);
  lines.push(`  const _scrml_mh_json = (await _scrml_mh_res.json()) || {};`);
  // §52.15.5 — hydrate PER CELL, skipping any cell already SSR-seeded (a public
  // cell keeps its first-paint value; the /__mountHydrate response may re-serve it,
  // but re-setting is not needed and would clobber a seeded value with the mixed
  // response when a sibling cell was gated). Gated cells are never SSR-seeded, so
  // this only lands their (per-cell-authorized) payload — anon → absent → unhydrated.
  for (const name of varNames) {
    lines.push(`  if (!_scrml_ssr_seeded(${JSON.stringify(name)})) _scrml_reactive_set(${JSON.stringify(name)}, _scrml_mh_json[${JSON.stringify(name)}]);`);
  }
  lines.push(`})();`);
  return lines;
}
