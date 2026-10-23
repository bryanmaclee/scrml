/**
 * docs-website.spec.ts — smoke + link-integrity for the scrml.dev docs site.
 *
 * S100 (2026-05-17). Validates the docs/website/ static site end-to-end
 * against the same `scrml dev` server adopters use in production.
 *
 * Three test buckets:
 *
 *   1. Route smoke — enumerate every dist HTML at startup, visit each in
 *      the browser, assert HTTP 200, assert shell composition (header nav
 *      present per the S99 MPA fix), assert no JS console errors fired
 *      during page load.
 *
 *   2. Link-integrity — visit every page once, collect every internal
 *      anchor href, then HEAD-request each unique href to verify it
 *      resolves with a non-error status. Catches broken /reference/...
 *      links, missing pages, and dead /articles/... routes.
 *
 *   3. Shell-composition assertion — sample a representative non-entry
 *      page (e.g. /articles/orm-trap) and confirm the entry-file shell
 *      chrome is inlined (header nav with home link + tagline; footer
 *      sections; per-page <main> content present in body).
 *
 * Scope: this catches the bug class surfaced in S99 visit-and-verify
 * (`"the page is largely empty. links exist, plain text ... but the main
 * section is completely empty and the links are all broken"`). The MPA
 * fix `fc27960` + the S100 revert at `6aaa4b0` make the docs site
 * functional; this spec is the regression guard.
 *
 * Browser projects: runs on all three (chromium / firefox / webkit) for
 * shell-composition coverage; link-integrity is HTTP-layer and only needs
 * chromium for speed, but Playwright's project model makes it cheap to
 * include all three.
 */

import { test, expect, DOCS_WEBSITE_BASE_URL } from "../fixtures/dev-server-fixture";
import { readdirSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST_DIR = join(__dirname, "..", "..", "docs", "website", "dist");

/**
 * Enumerate every .html file under DIST_DIR; map each to its URL route
 * by stripping the .html extension and folding `/index` → `/`.
 *
 * Output examples:
 *   dist/index.html                                → "/"
 *   dist/articles/orm-trap.html                    → "/articles/orm-trap"
 *   dist/reference/index.html                      → "/reference"
 *   dist/reference/elements/onTimeout.html         → "/reference/elements/onTimeout"
 *   dist/reference/errors/E-IDLE-MISPLACED.html    → "/reference/errors/E-IDLE-MISPLACED"
 */
function enumerateRoutes(dir: string): string[] {
  const routes: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        let rel = relative(dir, full).replace(/\\/g, "/");
        rel = rel.replace(/\.html$/, "");
        if (rel === "index") {
          routes.push("/");
        } else if (rel.endsWith("/index")) {
          routes.push("/" + rel.slice(0, -"/index".length));
        } else {
          routes.push("/" + rel);
        }
      }
    }
  };
  walk(dir);
  return routes.sort();
}

const ROUTES = enumerateRoutes(DIST_DIR);

// Sanity: site should have at least a home + the major sections we ship.
test("dist enumeration found expected routes", () => {
  expect(ROUTES.length).toBeGreaterThan(20);
  expect(ROUTES).toContain("/");
  expect(ROUTES).toContain("/reference");
  expect(ROUTES).toContain("/articles");
  expect(ROUTES).toContain("/reference/elements/engine");
});

test.describe("docs/website route smoke", () => {
  for (const route of ROUTES) {
    test(`${route} — HTTP 200 + shell composition + no console errors`, async ({ page, docsUrl }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      page.on("pageerror", (err) => {
        pageErrors.push(err.message);
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          // Filter out known-benign noise — favicon 404s, SSE keep-alive
          // notices, etc. — add specific allowlist entries here if they
          // surface during execution and are confirmed safe.
          const text = msg.text();
          if (text.includes("favicon.ico")) return;
          consoleErrors.push(text);
        }
      });

      const response = await page.goto(docsUrl(route));
      expect(response, `${route} should produce an HTTP response`).not.toBeNull();
      expect(response!.status(), `${route} should HTTP 200`).toBeLessThan(400);

      // Shell composition assertion: every page should have header nav
      // containing the scrml.dev home link (the entry-file <a href="/">
      // inlined into per-page bodies by the MPA fix `fc27960`).
      const homeLink = page.locator('header a[href="/"]').first();
      await expect(homeLink, `${route} should have shell header with home link`).toBeVisible();

      // Title element should be present and non-empty (every page has an h1
      // or article-level title).
      const title = await page.title();
      expect(title, `${route} should have a non-empty <title>`).not.toEqual("");

      // No console / page errors during load.
      expect(pageErrors, `${route} should not throw page errors`).toEqual([]);
      expect(consoleErrors, `${route} should not log console errors`).toEqual([]);
    });
  }
});

test.describe("docs/website link-integrity", () => {
  test("every internal href resolves to a non-error HTTP status", async ({ page, request, docsUrl }) => {
    const broken: { from: string; href: string; status: number }[] = [];
    const checked = new Map<string, number>(); // href → status

    for (const route of ROUTES) {
      await page.goto(docsUrl(route));

      const hrefs = await page.locator("a").evaluateAll((anchors) =>
        anchors
          .map((a) => a.getAttribute("href"))
          .filter((h): h is string => h !== null && h.startsWith("/") && !h.startsWith("//")),
      );

      for (const href of Array.from(new Set(hrefs))) {
        // Strip query strings and fragment identifiers for the HEAD probe.
        // The dev server resolves paths; fragments are client-side anchors.
        const cleanHref = href.split(/[#?]/)[0];

        let status = checked.get(cleanHref);
        if (status === undefined) {
          // HEAD request to verify resolution without downloading body.
          // Note: scrml dev server's static-file fallback may not support
          // HEAD properly for trailing-slash folding; retry with GET if
          // HEAD returns 405 Method Not Allowed.
          let response = await request.head(docsUrl(cleanHref), { failOnStatusCode: false });
          if (response.status() === 405 || response.status() === 501) {
            response = await request.get(docsUrl(cleanHref), { failOnStatusCode: false });
          }
          status = response.status();
          checked.set(cleanHref, status);
        }

        if (status >= 400) {
          broken.push({ from: route, href: cleanHref, status });
        }
      }
    }

    // Single assertion at end so the test report shows ALL broken links
    // in one shot, not just the first one. Adopters fixing the site need
    // the full picture.
    expect(
      broken,
      broken.length === 0
        ? "no broken links"
        : `found ${broken.length} broken-link occurrences across the site:\n` +
            broken
              .slice(0, 50)
              .map((b) => `  ${b.from}  →  ${b.href}  (${b.status})`)
              .join("\n") +
            (broken.length > 50 ? `\n  ... and ${broken.length - 50} more` : ""),
    ).toEqual([]);
  });
});

test.describe("docs/website shell-composition canary", () => {
  // Spot-check a representative non-entry-page (an article inside /articles/)
  // to confirm the MPA shell composition produces the expected chrome.
  // If this canary breaks, the MPA fix has regressed in some shape.
  test("/articles/orm-trap has header nav + body content + footer", async ({ page, docsUrl }) => {
    await page.goto(docsUrl("/articles/orm-trap"));

    // Header nav links (5 standard items from app.scrml + scrml.dev home).
    await expect(page.locator('header a[href="/"]')).toBeVisible();
    await expect(page.locator('header a[href="/getting-started"]')).toBeVisible();
    await expect(page.locator('header a[href="/learn"]')).toBeVisible();
    await expect(page.locator('header a[href="/reference"]')).toBeVisible();
    await expect(page.locator('header a[href="/articles"]')).toBeVisible();

    // Article body should contain its own h1 (the article title).
    await expect(page.locator("article h1").first()).toBeVisible();

    // Footer should contain at least the GitHub link.
    await expect(page.locator('a[href*="github.com/scrml-lang/scrml"]').first()).toBeVisible();
  });
});
