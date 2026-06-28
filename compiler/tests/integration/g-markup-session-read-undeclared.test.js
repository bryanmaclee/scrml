/**
 * g-markup-session-read-undeclared — a `@session` read is a legal AMBIENT read
 * in markup AND logic (S228 user ruling; §51.0.A engine-singleton precedent).
 *
 * Background (Phase 0 survey, 2026-06-28):
 *   - The S224 Ryan #15 fix window-anchored the `@session` auth projection to a
 *     singleton (`var session = window._scrml_session_projection ?? (...)` in
 *     emit-client.ts, emitted only when auth middleware is configured).
 *   - A `@session` read fired E-STATE-UNDECLARED in BOTH markup AND logic (NOT
 *     an asymmetry — the brief's "logic resolves fine" premise was a
 *     mis-inference). The read-side walker (type-system.ts) rejected it, and the
 *     codegen lowered it to `_scrml_reactive_get("session")` → `_scrml_state
 *     ["session"]` (undefined; the projection is NOT a reactive-store cell) →
 *     `.current` crash. So BOTH the diagnostic AND the codegen were broken.
 *
 * Fix (4 surfaces):
 *   - type-system.ts: RESERVED_AMBIENT_PROJECTION_NAMES={session} exempts
 *     `@session` in the read-side E-STATE-UNDECLARED `@`-branch.
 *   - emit-expr.ts: _sessionProjectionActive per-file flag → client-mode
 *     `@session` lowers to the bare projection var `session`.
 *   - index.ts: flag = (auth configured) AND (no user `session` reactive cell).
 *   - route-inference.ts: `(?<!@)\bsession\b` so the §20.5 SERVER bare `session`
 *     still escalates but the CLIENT `@session` projection does not.
 *
 * SECURITY (Phase 0 §3): the client `@session` projection is fed across the HTTP
 * boundary (`fetch('/_scrml/session')`); it never references the §20.5 server-only
 * `session` object. The markup read exposes only the network-delivered client-safe
 * payload — no server-only leak.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "g-markup-session-read-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  // Errors only (severity error / null); warnings + info live on .warnings.
  const errors = (result.errors || []).filter(
    e => e.severity == null || e.severity === "error",
  );
  let clientJs = "";
  let serverJs = "";
  try { clientJs = readFileSync(join(outDir, `${name}.client.js`), "utf8"); } catch { /* missing */ }
  try { serverJs = readFileSync(join(outDir, `${name}.server.js`), "utf8"); } catch { /* missing */ }
  return { errors, clientJs, serverJs, outDir, clientPath: join(outDir, `${name}.client.js`) };
}

const AUTH = `<program auth="required">`;

describe("g-markup-session-read-undeclared — @session ambient read (S228)", () => {
  test("markup @session read resolves (no E-STATE-UNDECLARED) + emits the projection access", () => {
    const src = `${AUTH}
    <h1>Welcome</h1>
    <p>\${@session.current}</p>
</program>`;
    const { errors, clientJs } = compileSource("markup-read", src);

    expect(errors.filter(e => e.code === "E-STATE-UNDECLARED")).toEqual([]);
    expect(errors).toEqual([]);
    // The read accesses the bare `session` projection var, NOT the universal
    // reactive accessor (which reads an unregistered key -> undefined -> crash).
    expect(clientJs).toContain("session.current");
    expect(clientJs).not.toContain('_scrml_reactive_get("session")');
    // The window-anchored projection is present (the read target exists).
    expect(clientJs).toContain("window._scrml_session_projection");
  });

  test("markup @session client.js is node --check clean + carries no server-only leak", () => {
    const src = `${AUTH}
    <p>User: \${@session.current}</p>
</program>`;
    const { errors, clientJs, clientPath } = compileSource("markup-emit", src);
    expect(errors).toEqual([]);
    // R26: the emitted client JS parses cleanly.
    expect(() => execFileSync("node", ["--check", clientPath])).not.toThrow();
    // No server-only artefacts ride into client.js via the session read.
    expect(clientJs).not.toMatch(/\b_scrml_sql(?:_\d+)?\s*[.`]/);
    expect(clientJs).not.toContain("_scrml_session_middleware");
    expect(clientJs).not.toContain("passwordHash");
  });

  test("inline event-handler @session read resolves + stays client", () => {
    const src = `${AUTH}
    <button on:click=\${ log(@session.current) }>Show</button>
</program>`;
    const { errors, clientJs } = compileSource("inline-read", src);
    expect(errors).toEqual([]);
    expect(clientJs).toContain("session.current");
    expect(clientJs).not.toContain('_scrml_reactive_get("session")');
  });

  test("named-function @session read resolves + stays CLIENT (no spurious server escalation)", () => {
    const src = `${AUTH}
    \${
        function sessionName() {
            const u = @session.current
            return u
        }
    }
    <button on:click=\${ sessionName() }>Who</button>
</program>`;
    const { errors, clientJs, serverJs } = compileSource("named-fn-read", src);
    expect(errors).toEqual([]);
    // The fn body reads the client projection var directly.
    expect(clientJs).toContain("session.current");
    // It must NOT have been auto-escalated to a server route (the pre-fix
    // `(?<!@)` over-match would have made `@session` trigger §20.5 escalation,
    // turning the loud diagnostic into a SILENT server miscompile reading
    // `_scrml_body["session"]`).
    expect(clientJs).not.toContain("__ri_route_sessionName");
    expect(serverJs).not.toContain("session.current");
    expect(serverJs).not.toContain('_scrml_body["session"]');
  });

  test("genuine undeclared @typoCell in markup STILL fires E-STATE-UNDECLARED (no over-suppression)", () => {
    const src = `${AUTH}
    <p>\${@typoCell.value}</p>
</program>`;
    const { errors } = compileSource("typo-read", src);
    expect(errors.some(e => e.code === "E-STATE-UNDECLARED")).toBe(true);
  });

  test("a user `<session>` reactive cell still OWNS the @session read (projection does not shadow it)", () => {
    const src = `${AUTH}
    <session> = { foo: "bar" }
    <p>\${@session.foo}</p>
</program>`;
    const { errors, clientJs } = compileSource("user-cell", src);
    expect(errors).toEqual([]);
    // With a user cell present, the flag is OFF -> the read keeps the universal
    // accessor so the user's reactive cell value is read, NOT the projection var.
    expect(clientJs).toContain('_scrml_reactive_get("session").foo');
  });

  test("§20.5 server-only BARE `session` still escalates to the server (no regression)", () => {
    const src = `${AUTH}
    \${
        function currentUserId() {
            const sid = session.userId
            return sid
        }
    }
    <button on:click=\${ currentUserId() }>Id</button>
</program>`;
    const { serverJs } = compileSource("bare-session", src);
    // The §20.5 server-only `session` object is injected server-side and the
    // function is escalated -> its handler lives in server.js reading `session`.
    expect(serverJs).toContain("_scrml_session_middleware");
    expect(serverJs).toContain("session.userId");
  });
});
