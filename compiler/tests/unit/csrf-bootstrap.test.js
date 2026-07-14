/**
 * GITI-010 — CSRF bootstrap (mint-on-403 + client single-retry)
 *
 * Before this fix, any .scrml file with ≥1 server function compiled to a
 * .server.js whose baseline CSRF 403 path did NOT emit a Set-Cookie. A
 * cookie-less browser's first POST hit the 403, never received a token,
 * and every subsequent POST returned 403 — loop closed.
 *
 * Fix is in two parts:
 *   Server: the 403 response now sets `scrml_csrf=<token>; Path=/; SameSite=Strict`.
 *           `_scrml_csrf_token` is always valid in scope (existing or
 *           freshly-minted by `_scrml_ensure_csrf_cookie`).
 *   Client: CSRF-enabled mutating fetch stubs route through a shared
 *           `_scrml_fetch_with_csrf_retry(path, method, body)` helper that
 *           retries exactly once on 403, re-reading document.cookie for the
 *           freshly-planted token.
 *
 * Reference: `handOffs/incoming/2026-04-22-0639-csrf-bootstrap.scrml`.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `csrf-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_csrf_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let clientJs = null;
    let serverJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        clientJs = output.clientJs ?? null;
        serverJs = output.serverJs ?? null;
      }
    }
    return { errors: result.errors ?? [], clientJs, serverJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
  }
}

const BASELINE_CSRF_SRC = `<program>
\${
  server function ping() {
    return { ok: true }
  }
}
<div>
  <p>pong: \${@pong}</p>
</div>
</program>`;

describe("GITI-010 — CSRF bootstrap", () => {
  describe("server-side: mint-on-403", () => {
    test("baseline CSRF 403 response includes Set-Cookie with minted token", () => {
      const { serverJs } = compileSource(BASELINE_CSRF_SRC, "baseline-setcookie");
      expect(serverJs).toBeTruthy();
      expect(serverJs).toContain("CSRF validation failed");
      // Locate the CSRF-failure Response — the block between "CSRF validation
      // failed" and the closing `});` that ends it. The block MUST contain a
      // Set-Cookie header with scrml_csrf={minted_token}; SameSite=Strict.
      const failureIdx = serverJs.indexOf(`{ error: "CSRF validation failed" }`);
      expect(failureIdx).toBeGreaterThan(-1);
      const slice = serverJs.slice(failureIdx, failureIdx + 500);
      expect(slice).toContain("Set-Cookie");
      expect(slice).toContain("scrml_csrf=${_scrml_csrf_token}");
      expect(slice).toContain("SameSite=Strict");
    });

    test("_scrml_ensure_csrf_cookie is invoked before the validation check", () => {
      const { serverJs } = compileSource(BASELINE_CSRF_SRC, "ensure-before-validate");
      const ensureIdx = serverJs.indexOf("_scrml_ensure_csrf_cookie(_scrml_req)");
      const validateIdx = serverJs.indexOf("_scrml_validate_csrf(_scrml_req)");
      expect(ensureIdx).toBeGreaterThan(-1);
      expect(validateIdx).toBeGreaterThan(ensureIdx);
    });

    test("200 response still rotates the cookie (regression guard)", () => {
      const { serverJs } = compileSource(BASELINE_CSRF_SRC, "rotate-on-200");
      // Existing behavior: 200 response also Set-Cookies the token.
      // Make sure we didn't remove it.
      expect(serverJs).toContain("status: 200");
      // Both 200 and 403 now emit Set-Cookie; count should be >= 2.
      const setCookieCount = (serverJs.match(/Set-Cookie/g) || []).length;
      expect(setCookieCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("client-side: fetch-with-retry", () => {
    test("_scrml_fetch_with_csrf_retry helper is emitted once", () => {
      const { clientJs } = compileSource(BASELINE_CSRF_SRC, "helper-once");
      expect(clientJs).toBeTruthy();
      const helperMatches = clientJs.match(/async function _scrml_fetch_with_csrf_retry\(/g) || [];
      expect(helperMatches.length).toBe(1);
    });

    test("helper retries on 403 with a second fetch", () => {
      const { clientJs } = compileSource(BASELINE_CSRF_SRC, "retry-on-403");
      const helperMatch = clientJs.match(/async function _scrml_fetch_with_csrf_retry[\s\S]+?\n\}/);
      expect(helperMatch).toBeTruthy();
      const helperBody = helperMatch[0];
      expect(helperBody).toContain("status === 403");
      // Exactly two fetch calls — original + single retry.
      const fetchCount = (helperBody.match(/await fetch\(/g) || []).length;
      expect(fetchCount).toBe(2);
    });

    test("helper re-reads _scrml_get_csrf_token on retry", () => {
      const { clientJs } = compileSource(BASELINE_CSRF_SRC, "retry-reads-token");
      const helperMatch = clientJs.match(/async function _scrml_fetch_with_csrf_retry[\s\S]+?\n\}/);
      const helperBody = helperMatch[0];
      const tokenReads = (helperBody.match(/_scrml_get_csrf_token\(\)/g) || []).length;
      // One in the initial fetch, one in the retry.
      expect(tokenReads).toBe(2);
    });

    test("mutating server-fn stub routes through the retry helper", () => {
      const { clientJs } = compileSource(BASELINE_CSRF_SRC, "stub-uses-helper");
      const stubMatch = clientJs.match(/async function _scrml_fetch_ping[\s\S]+?\n\}/);
      expect(stubMatch).toBeTruthy();
      const stubBody = stubMatch[0];
      expect(stubBody).toContain("_scrml_fetch_with_csrf_retry(");
      // Should NOT contain a direct fetch() — that's the helper's job now.
      expect(stubBody).not.toMatch(/await fetch\(/);
    });

    test("stub passes path, method, and body to helper in that order", () => {
      const { clientJs } = compileSource(BASELINE_CSRF_SRC, "helper-arg-order");
      const stubMatch = clientJs.match(/async function _scrml_fetch_ping[\s\S]+?\n\}/);
      const stubBody = stubMatch[0];
      expect(stubBody).toMatch(/_scrml_fetch_with_csrf_retry\("\/_scrml\/__ri_route_ping_\d+", "POST", _scrml_body\)/);
    });
  });

  describe("helper emission guards", () => {
    test("file with no server function emits no CSRF helper", () => {
      const src = `<program>
\${ @count = 0 }
<p>\${@count}</p>
</program>`;
      const { clientJs } = compileSource(src, "no-server-fn");
      if (clientJs) {
        expect(clientJs).not.toContain("_scrml_fetch_with_csrf_retry");
        expect(clientJs).not.toContain("_scrml_get_csrf_token");
      }
    });
  });
});
