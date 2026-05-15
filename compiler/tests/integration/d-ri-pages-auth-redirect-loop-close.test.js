/**
 * D-RI-PAGES — end-to-end auth-redirect loop close (Batch A.1 / S94).
 *
 * Closes the adopter UX loop on the auth-redirect tightening that landed
 * at commit 69260c3 (Batch A.1):
 *
 *   diagnostic fires → adopter runs `scrml generate auth` → scaffold lands
 *   at pages/auth/login.scrml → re-compile → diagnostic clears.
 *
 * Before D-RI-PAGES, `buildPageRouteTree` (route-inference.ts) keyed
 * EXCLUSIVELY on `/routes/` subtrees. Files under `pages/` were treated as
 * single-page apps mapped to `urlPattern: "/"`. The auth-graph redirect
 * cross-ref (auth-graph.ts `crossRefRedirects`) therefore couldn't resolve
 * `<program loginRedirect=...>` to a page URL under `pages/` — the
 * diagnostic continued to fire even after the adopter ran the recommended
 * `scrml generate auth` remediation.
 *
 * Post-fix, `buildPageRouteTree` recognizes BOTH `/routes/` (legacy) AND
 * `/pages/` (v0.3 canonical per SPEC §47.9.2). This file exercises the
 * full compile pipeline (compileScrml → RI → AuthGraph → cross-ref) to
 * verify the loop closes end-to-end.
 *
 * Test matrix:
 *   §1 — pages/ + matching loginRedirect → NO I-AUTH-REDIRECT-UNRESOLVED,
 *        NO W-AUTH-LOGIN-MISSING (loop closes).
 *   §2 — pages/ + non-matching loginRedirect → BOTH diagnostics fire
 *        (the fix doesn't paper over real mismatches).
 *   §3 — routes/ + matching loginRedirect → NO diagnostics
 *        (backward compatibility — legacy projects unaffected).
 *
 * Spec authority:
 *   - SPEC.md §40.1.1 — Static role classification anchor.
 *   - SPEC.md §47.9.2 (line 19314) — pages/ as canonical v0.3 prefix.
 *   - SPEC.md §40.8.1 — pages/ presence suppresses W-PROGRAM-SPA-INFERRED.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "d-ri-pages-loop-close-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

/**
 * Write a synthetic fixture directory rooted at `<TMP>/<name>/` with the
 * named file map (relative-path → source). Returns the array of absolute
 * file paths in deterministic sorted order for passing to compileScrml.
 */
function writeFixture(name, files) {
  const root = join(TMP, name);
  const paths = [];
  for (const [relPath, source] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, source);
    paths.push(abs);
  }
  return paths.sort();
}

function compile(name, files) {
  const inputFiles = writeFixture(name, files);
  const outputDir = join(TMP, name, "dist");
  return compileScrml({
    inputFiles,
    outputDir,
    write: false,
    log: () => {},
  });
}

/** Combined error+warning stream (api.js partitions diagnostics into both). */
function allDiags(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}

function countCode(result, code) {
  return allDiags(result).filter(d => d.code === code).length;
}

// ---------------------------------------------------------------------------
// Minimal scrml sources. The shapes here are deliberately tiny — just
// enough for the route-inference + auth-graph passes to do their work.
// ---------------------------------------------------------------------------

/**
 * Entry file with auth=required + an explicit loginRedirect. The login
 * page lives in a separate file under pages/.
 */
function entryAuthRequired(loginRedirect) {
  return `<program auth="required" loginRedirect="${loginRedirect}">
<page>
  <main>
    <h1>Protected home</h1>
  </main>
</page>
</program>
`;
}

/**
 * Minimal login page — declares <page auth="optional"> to opt out of the
 * global auth gate (matches the canonical scaffold template at
 * stdlib/auth/templates/login.scrml line 25).
 */
const LOGIN_PAGE = `<page auth="optional">
  <main>
    <h1>Sign in</h1>
    <form>
      <input type="email" name="email" />
      <input type="password" name="password" />
      <button>Sign in</button>
    </form>
  </main>
</page>
`;

// ---------------------------------------------------------------------------
// §1 — pages/ + matching loginRedirect → loop closes (NO diagnostics).
// ---------------------------------------------------------------------------

describe("D-RI-PAGES loop close — pages/ + matching loginRedirect", () => {
  test("pages/auth/login.scrml + loginRedirect=/auth/login → NO I-AUTH-REDIRECT-UNRESOLVED, NO W-AUTH-LOGIN-MISSING", () => {
    // This is the post-fix shape adopters arrive at after running
    // `scrml generate auth` (which lands the scaffold at
    // pages/auth/login.scrml) AND setting <program loginRedirect="/auth/login">
    // to match. Pre-D-RI-PAGES, this combination still fired both
    // diagnostics because buildPageRouteTree didn't recognize pages/.
    const result = compile("pages-matching", {
      "app.scrml": entryAuthRequired("/auth/login"),
      "pages/auth/login.scrml": LOGIN_PAGE,
    });

    expect(countCode(result, "I-AUTH-REDIRECT-UNRESOLVED")).toBe(0);
    expect(countCode(result, "W-AUTH-LOGIN-MISSING")).toBe(0);
  });

  test("pages/login.scrml + default loginRedirect (/login) → NO diagnostics", () => {
    // Adopter convention: drop the login page directly at pages/login.scrml
    // (matches the RI default loginRedirect="/login" with no <program>
    // override required). Pre-D-RI-PAGES this resolved to / and the
    // /login target was never matched; post-fix it resolves to /login.
    const result = compile("pages-default-redirect", {
      "app.scrml": `<program auth="required">
<page>
  <main>
    <h1>Protected home</h1>
  </main>
</page>
</program>
`,
      "pages/login.scrml": LOGIN_PAGE,
    });

    expect(countCode(result, "I-AUTH-REDIRECT-UNRESOLVED")).toBe(0);
    expect(countCode(result, "W-AUTH-LOGIN-MISSING")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — pages/ + non-matching loginRedirect → BOTH diagnostics fire
//      (the fix doesn't paper over real mismatches).
// ---------------------------------------------------------------------------

describe("D-RI-PAGES loop close — pages/ + non-matching loginRedirect", () => {
  test("pages/auth/login.scrml + default loginRedirect (/login) → BOTH diagnostics fire", () => {
    // Negative regression: the fix only resolves diagnostics when the
    // page URL pattern truly matches the loginRedirect target. If the
    // adopter runs `scrml generate auth` (which lands at /auth/login)
    // but leaves loginRedirect at the default /login, the diagnostic
    // CORRECTLY continues to fire — there's a real mismatch the adopter
    // needs to resolve (either move the file or override loginRedirect).
    const result = compile("pages-mismatch", {
      "app.scrml": `<program auth="required">
<page>
  <main>
    <h1>Protected home</h1>
  </main>
</page>
</program>
`,
      "pages/auth/login.scrml": LOGIN_PAGE,
    });

    expect(countCode(result, "I-AUTH-REDIRECT-UNRESOLVED")).toBeGreaterThan(0);
    expect(countCode(result, "W-AUTH-LOGIN-MISSING")).toBe(1);
  });

  test("no login page at all under pages/ → BOTH diagnostics fire", () => {
    // Pure structural-gap case (the S86 03-contact-book latent bug
    // shape that W-AUTH-LOGIN-MISSING was introduced to surface): auth
    // gate declared, loginRedirect set, no login page anywhere.
    const result = compile("pages-no-login", {
      "app.scrml": `<program auth="required" loginRedirect="/login">
<page>
  <main>
    <h1>Protected home</h1>
  </main>
</page>
</program>
`,
      "pages/about.scrml": `<page>
  <main><h1>About</h1></main>
</page>
`,
    });

    expect(countCode(result, "I-AUTH-REDIRECT-UNRESOLVED")).toBeGreaterThan(0);
    expect(countCode(result, "W-AUTH-LOGIN-MISSING")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §3 — routes/ + matching loginRedirect → backward compatibility
//      (legacy projects unaffected by the new pages/ recognition).
// ---------------------------------------------------------------------------

describe("D-RI-PAGES loop close — routes/ backward compatibility", () => {
  test("routes/auth/login.scrml + loginRedirect=/auth/login → NO diagnostics", () => {
    // Legacy projects using the routes/ convention continue to work
    // exactly as before. The fix is purely additive — no routes/-using
    // shape changes meaning.
    const result = compile("routes-matching", {
      "app.scrml": entryAuthRequired("/auth/login"),
      "routes/auth/login.scrml": LOGIN_PAGE,
    });

    expect(countCode(result, "I-AUTH-REDIRECT-UNRESOLVED")).toBe(0);
    expect(countCode(result, "W-AUTH-LOGIN-MISSING")).toBe(0);
  });

  test("routes/login.scrml + default loginRedirect (/login) → NO diagnostics", () => {
    const result = compile("routes-default-redirect", {
      "app.scrml": `<program auth="required">
<page>
  <main>
    <h1>Protected home</h1>
  </main>
</page>
</program>
`,
      "routes/login.scrml": LOGIN_PAGE,
    });

    expect(countCode(result, "I-AUTH-REDIRECT-UNRESOLVED")).toBe(0);
    expect(countCode(result, "W-AUTH-LOGIN-MISSING")).toBe(0);
  });
});
