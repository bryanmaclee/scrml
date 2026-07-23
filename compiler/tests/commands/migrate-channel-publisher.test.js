/**
 * Tests for `scrml migrate --fix` Migration 5 (channel-server-publisher-
 * eliminate — RULING A / Enhanced-A, change-id
 * `ss27-5-channel-migrate-autostrip-2026-06-25`).
 *
 * Migration 5 strips the deprecated `server` keyword from a `server function
 * NAME(` CHANNEL PUBLISHER that read-modify-writes a channel-declared cell, so
 * the publisher runs CLIENT-side (SPEC §38.4 — channel cells are client-held)
 * and the write syncs via the auto-`__sync` reactive effect. The deprecated
 * form is server-PLACED by the keyword alone; its server-side READ of the
 * client-held cell fires `E-CHANNEL-SERVER-CELL-READ` (§34). Dropping `server`
 * is the canonical RULING-A fix — the publisher becomes the proven onclient
 * shape (§38.10) and the error clears.
 *
 * SAFETY DISCRIMINATOR (the inverse of Migration 4's W-DEPRECATED signal):
 * strip ONLY where the keyword is the SOLE server-placement reason —
 *   - E-CHANNEL-SERVER-CELL-READ fires on the fn, AND
 *   - W-DEPRECATED-SERVER-MODIFIER does NOT fire on the fn.
 * A broadcast()/disconnect()- or SQL-escalated publisher that also reads a cell
 * fires BOTH (the keyword is redundant, not sole) → Migration 5 leaves it
 * (Migration 4 strips the redundant keyword; the channel-read error needs a
 * manual payload rewrite, §38.6.1). Generators (`server function*`, SSE) are
 * excluded, mirroring Migration 4.
 *
 * `rewriteChannelServerPublisher` is diagnostic-driven (it staged-compiles the
 * source IN PLACE to collect the E-CHANNEL + W-DEPRECATED fire-sites), so each
 * test stages a real on-disk file in a tmp dir.
 *
 * Sections:
 *   §1  POSITIVE     — deprecated channel publisher (keyword sole reason) → STRIPPED.
 *   §2  DISCRIMINATOR — broadcast publisher that reads a cell → NOT stripped.
 *   §3  DISCRIMINATOR — SQL-escalated publisher that reads a cell → NOT stripped.
 *   §4  NEGATIVE     — already-canonical `function` channel publisher → UNTOUCHED.
 *   §5  EXCLUDE      — generator `server function*` channel publisher → UNTOUCHED.
 *   §6  NO-REGRESSION — a non-channel `server function` (SQL body) → Mig5 leaves it.
 *   §7  IDEMPOTENT   — re-run on the stripped output → no change.
 *   §8  INTEGRATION  — migrateFile --fix strips it + the result compiles clean.
 *   §9  COMPOSITION  — channel publisher + unrelated SQL server fn migrate together.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  rewriteChannelServerPublisher,
  migrateFile,
} from "../../src/commands/migrate.js";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Tmp helpers — Migration 5 is disk-staged (reads/writes the file in place to
// collect E-CHANNEL / W-DEPRECATED diagnostics), so fixtures must be real
// on-disk files.
// ---------------------------------------------------------------------------

let tmpDir;

function setupTmp() {
  tmpDir = join(
    tmpdir(),
    `scrml-migrate-chanpub-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
}

function teardownTmp() {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Write `source` to `<tmpDir>/<name>` and return its absolute path. */
function stage(name, source) {
  const p = join(tmpDir, name);
  writeFileSync(p, source, "utf8");
  return p;
}

/** Compile `source` at `path`; return the E-CHANNEL count + fatal-error count. */
function compileChannelDiag(source, path) {
  writeFileSync(path, source, "utf8");
  const r = compileScrml({
    inputFiles: [path],
    write: false,
    gather: true,
    log: () => {},
  });
  const all = [...(r.errors || []), ...(r.warnings || [])];
  const chan = all.filter((d) => d && d.code === "E-CHANNEL-SERVER-CELL-READ");
  const fatal = (r.errors || []).filter(
    (e) => !e.severity || e.severity === "error",
  );
  return { chan: chan.length, fatal: fatal.length };
}

beforeEach(setupTmp);
afterEach(teardownTmp);

// The canonical deprecated channel-publisher fixture: a `server function`
// read-modify-writing the channel cell `@count`. Keyword is the SOLE
// server-placement reason (no broadcast/SQL) → E-CHANNEL fires, W-DEPRECATED
// does NOT → the keyword-sole strip target.
const DEPRECATED_PUBLISHER = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ server function bumpServer() {
      @count = @count + 1
    } }
  </>
</program>`;

// ---------------------------------------------------------------------------
// §1  POSITIVE — deprecated channel publisher → `server` stripped
// ---------------------------------------------------------------------------

describe("§1 deprecated channel publisher → `server` stripped (RULING A / Enhanced-A)", () => {
  test("`server function bumpServer()` writing `@count` → `function bumpServer()`", () => {
    const path = stage("dep.scrml", DEPRECATED_PUBLISHER);

    // Pre-condition: the deprecated form fires E-CHANNEL (keyword-sole).
    expect(compileChannelDiag(DEPRECATED_PUBLISHER, path).chan).toBe(1);

    const r = rewriteChannelServerPublisher(DEPRECATED_PUBLISHER, path);
    expect(r.changed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.rewritten).toContain(`function bumpServer()`);
    expect(r.rewritten).not.toContain(`server function bumpServer()`);
    // The body is otherwise byte-identical.
    expect(r.rewritten).toContain(`@count = @count + 1`);

    // The rewritten (client-side) publisher compiles WITHOUT E-CHANNEL.
    const diag = compileChannelDiag(r.rewritten, path);
    expect(diag.chan).toBe(0);
    expect(diag.fatal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2  DISCRIMINATOR — broadcast publisher that reads a cell → NOT stripped
// ---------------------------------------------------------------------------

describe("§2 broadcast publisher reading a cell → NOT stripped (keyword redundant)", () => {
  test("`server function pub() { broadcast(@count + 1) }` → untouched by Migration 5", () => {
    // broadcast() escalates via §12.2 Trigger 7b regardless of the keyword, so
    // W-DEPRECATED-SERVER-MODIFIER FIRES (keyword redundant). Stripping `server`
    // would leave the fn server (broadcast) and the channel-cell READ error
    // would PERSIST — Migration 5 must NOT touch it. (Migration 4 strips the
    // redundant keyword; the read error needs a manual payload rewrite §38.6.1.)
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ server function pub() {
      broadcast(@count + 1)
    } }
  </>
</program>`;
    const path = stage("bcast.scrml", source);
    const r = rewriteChannelServerPublisher(source, path);
    expect(r.changed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.rewritten).toBe(source);
    expect(r.rewritten).toContain(`server function pub()`);
  });
});

// ---------------------------------------------------------------------------
// §3  DISCRIMINATOR — SQL-escalated publisher that reads a cell → NOT stripped
// ---------------------------------------------------------------------------

describe("§3 SQL-escalated publisher reading a cell → NOT stripped (keyword redundant)", () => {
  test("`server function loader() { ?{...} ; @count = @count + 1 }` → untouched", () => {
    // A `?{}` SQL block escalates via §12.2 Trigger 1 regardless of the keyword,
    // so W-DEPRECATED FIRES (keyword redundant). Same reasoning as §2 — Migration
    // 5 leaves it; the channel-cell read error stays for the manual fix.
    const source = `<program db="./app.db">
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ server function loader() {
      <rows> = ?{ select id from users }.all()
      @count = @count + 1
    } }
  </>
</program>`;
    const path = stage("sql.scrml", source);
    const r = rewriteChannelServerPublisher(source, path);
    expect(r.changed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.rewritten).toBe(source);
    expect(r.rewritten).toContain(`server function loader()`);
  });
});

// ---------------------------------------------------------------------------
// §4  NEGATIVE — already-canonical `function` channel publisher → UNTOUCHED
// ---------------------------------------------------------------------------

describe("§4 already-canonical client-side channel publisher → untouched", () => {
  test("`function ok() { @count = @count + 1 }` (no `server`) → no E-CHANNEL, no change", () => {
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ function ok() {
      @count = @count + 1
    } }
  </>
</program>`;
    const path = stage("canon.scrml", source);
    // Pre-condition: the canonical form has NO E-CHANNEL (it is client-side).
    expect(compileChannelDiag(source, path).chan).toBe(0);

    const r = rewriteChannelServerPublisher(source, path);
    expect(r.changed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.rewritten).toBe(source);
  });
});

// ---------------------------------------------------------------------------
// §5  EXCLUDE — generator `server function*` channel publisher → UNTOUCHED
// ---------------------------------------------------------------------------

describe("§5 generator `server function*` channel publisher → untouched (SSE deferred)", () => {
  test("`server function* genServer() { yield @count }` → NOT stripped", () => {
    // This is the LOAD-BEARING exclusion: a generator channel publisher reading
    // a cell fires E-CHANNEL AND does NOT fire W-DEPRECATED (keyword sole) — so
    // the discriminator alone WOULD strip it. The `server function*` exclusion
    // (Migration 4 parity) is what protects SSE, which is deferred to its own DD.
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ server function* genServer() {
      yield @count
    } }
  </>
</program>`;
    const path = stage("gen.scrml", source);
    // Pre-condition: the generator DOES fire E-CHANNEL (so the exclusion matters).
    expect(compileChannelDiag(source, path).chan).toBe(1);

    const r = rewriteChannelServerPublisher(source, path);
    expect(r.changed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.rewritten).toBe(source);
    expect(r.rewritten).toContain(`server function* genServer()`);
  });
});

// ---------------------------------------------------------------------------
// §6  NO-REGRESSION — a non-channel `server function` (SQL body) → Mig5 leaves it
// ---------------------------------------------------------------------------

describe("§6 non-channel `server function` → Migration 5 leaves it (no E-CHANNEL)", () => {
  test("a plain SQL `server function` outside any channel → untouched by Migration 5", () => {
    // No channel, no channel cell → no E-CHANNEL-SERVER-CELL-READ → Migration 5
    // is a no-op. (Migration 4 owns the redundant-keyword strip for this fn.)
    const source = `<program db="./app.db">
\${
  server function getRows() {
    return ?{ select id from users }.all()
  }
}
<div onclick="getRows()">x</>
</program>`;
    const path = stage("nonchannel.scrml", source);
    const r = rewriteChannelServerPublisher(source, path);
    expect(r.changed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.rewritten).toBe(source);
    expect(r.rewritten).toContain(`server function getRows()`);
  });
});

// ---------------------------------------------------------------------------
// §7  IDEMPOTENT — re-run on the stripped output → no change
// ---------------------------------------------------------------------------

describe("§7 idempotency", () => {
  test("re-running Migration 5 on the stripped (client-side) publisher finds no E-CHANNEL → 0", () => {
    const path = stage("idem.scrml", DEPRECATED_PUBLISHER);

    const first = rewriteChannelServerPublisher(DEPRECATED_PUBLISHER, path);
    expect(first.changed).toBe(true);
    expect(first.count).toBe(1);

    // The stripped `function bumpServer()` is now client-side — E-CHANNEL no
    // longer fires (no server-context read), so there is nothing to strip.
    const second = rewriteChannelServerPublisher(first.rewritten, path);
    expect(second.changed).toBe(false);
    expect(second.count).toBe(0);
    expect(second.rewritten).toBe(first.rewritten);
  });
});

// ---------------------------------------------------------------------------
// §8  INTEGRATION — migrateFile --fix strips it + the result compiles clean
// ---------------------------------------------------------------------------

describe("§8 integration via migrateFile --fix", () => {
  test("dry-run reports channelServerPublisher=1 without writing", () => {
    const path = stage("dep-dry.scrml", DEPRECATED_PUBLISHER);
    const r = migrateFile(path, { dryRun: true, check: false, fix: true }, tmpDir);
    expect(r.status).toBe("changed");
    expect(r.migrations).toBeDefined();
    expect(r.migrations.channelServerPublisher).toBe(1);
    // dry-run does not write.
    expect(readFileSync(path, "utf8")).toBe(DEPRECATED_PUBLISHER);
  });

  test("in-place --fix strips `server` and the rewritten file compiles WITHOUT E-CHANNEL", () => {
    const path = stage("dep-inplace.scrml", DEPRECATED_PUBLISHER);
    const r = migrateFile(path, { dryRun: false, check: false, fix: true }, tmpDir);
    expect(r.status).toBe("changed");
    expect(r.migrations.channelServerPublisher).toBe(1);

    const written = readFileSync(path, "utf8");
    expect(written).toContain(`function bumpServer()`);
    expect(written).not.toContain(`server function bumpServer()`);

    // The migrated file compiles clean (no E-CHANNEL, no fatal errors).
    const compiled = compileScrml({
      inputFiles: [path],
      write: false,
      gather: true,
      log: () => {},
    });
    const fatal = (compiled.errors || []).filter(
      (e) => !e.severity || e.severity === "error",
    );
    expect(fatal).toHaveLength(0);
    expect(
      (compiled.errors || []).some((e) => e && e.code === "E-CHANNEL-SERVER-CELL-READ"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §9  COMPOSITION — channel publisher + unrelated SQL server fn migrate together
// ---------------------------------------------------------------------------

describe("§9 composition — Migration 4 (SQL server fn) + Migration 5 (channel publisher)", () => {
  test("a file with a deprecated channel publisher AND an unrelated SQL `server function` migrates both", () => {
    // The channel publisher (keyword-sole) → Migration 5 strips it to client.
    // The page-scope SQL `server function` (keyword redundant) → Migration 4
    // strips its redundant keyword (stays server). Both land via migrateFile.
    const source = `<program db="./app.db">
\${
  server function getRows() {
    return ?{ select id from users }.all()
  }
}
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ server function bumpServer() {
      @count = @count + 1
    } }
  </>
<div onclick="getRows()">x</>
</program>`;
    const path = stage("compose.scrml", source);
    const r = migrateFile(path, { dryRun: false, check: false, fix: true }, tmpDir);
    expect(r.status).toBe("changed");
    // Migration 4 strips the redundant SQL server-fn keyword.
    expect(r.migrations.serverFnKeyword).toBe(1);
    // Migration 5 strips the keyword-sole channel publisher.
    expect(r.migrations.channelServerPublisher).toBe(1);

    const written = readFileSync(path, "utf8");
    expect(written).toContain(`function getRows()`);
    expect(written).not.toContain(`server function getRows()`);
    expect(written).toContain(`function bumpServer()`);
    expect(written).not.toContain(`server function bumpServer()`);

    // Still compiles clean: no E-CHANNEL, and the SQL stays server-side.
    const compiled = compileScrml({
      inputFiles: [path],
      write: false,
      gather: true,
      log: () => {},
    });
    const fatal = (compiled.errors || []).filter(
      (e) => !e.severity || e.severity === "error",
    );
    expect(fatal).toHaveLength(0);
    const out = [...(compiled.outputs || new Map()).values()][0] || {};
    // No client-flip of the SQL: it stays server-side.
    expect((out.clientJs || "").includes("from users")).toBe(false);
    expect((out.serverJs || "").includes("from users")).toBe(true);
  });
});
