#!/usr/bin/env bun
/**
 * Puppeteer smoke test for all compiled scrml examples.
 *
 * For each example:
 *   1. Load the HTML in headless Chrome
 *   2. Check for console errors (JS exceptions)
 *   3. Verify the page rendered content (not blank)
 *   4. Run example-specific interaction tests where applicable
 *
 * Usage: bun examples/test-examples.js
 */

import puppeteer from "puppeteer";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { resolve, join, extname } from "path";

const DIST = resolve(import.meta.dir, "dist");

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function serve(dir) {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      const url = req.url === "/" ? "/index.html" : req.url;
      const filePath = join(dir, url);
      if (!existsSync(filePath)) {
        resp.writeHead(404);
        resp.end("Not found");
        return;
      }
      const ext = extname(filePath);
      resp.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
      resp.end(readFileSync(filePath));
    });
    server.listen(0, () => res({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// Example-specific tests
// ---------------------------------------------------------------------------

const EXAMPLE_TESTS = {
  "01-hello": async (page) => {
    const text = await page.$eval("body", (el) => el.textContent);
    return text.includes("Hello") ? null : "Expected 'Hello' in body text";
  },

  "02-counter": async (page) => {
    // Should have buttons and a displayed count
    const buttons = await page.$$("button");
    if (buttons.length === 0) return "No buttons found";
    const text = await page.$eval("body", (el) => el.textContent);
    if (!text.includes("0")) return "Expected initial count '0'";
    return null;
  },

  "04-live-search": async (page) => {
    const input = await page.$("input");
    if (!input) return "No search input found";
    return null;
  },

  "05-multi-step-form": async (page) => {
    const text = await page.$eval("body", (el) => el.textContent);
    if (!text.includes("Info") && !text.includes("Step")) return "Expected step content";
    return null;
  },

  "06-kanban-board": async (page) => {
    const text = await page.$eval("body", (el) => el.textContent);
    if (!text.includes("Todo") && !text.includes("Board") && !text.includes("Kanban"))
      return "Expected kanban board content";
    return null;
  },

  "10-inline-tests": async (page) => {
    const text = await page.$eval("body", (el) => el.textContent);
    if (text.trim().length === 0) return "Page is blank";
    return null;
  },

  "12-snippets-slots": async (page) => {
    const text = await page.$eval("body", (el) => el.textContent);
    if (text.trim().length === 0) return "Page is blank";
    return null;
  },

  "14-mario-state-machine": async (page) => {
    const buttons = await page.$$("button");
    if (buttons.length === 0) return "No buttons found";
    const text = await page.$eval("body", (el) => el.textContent);
    if (!text.includes("MARIO")) return "Expected 'MARIO' in content";
    return null;
  },
};

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function main() {
  const { server, port } = await serve(DIST);
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const examples = [
    "01-hello",
    "02-counter",
    "03-contact-book",
    "04-live-search",
    "05-multi-step-form",
    "06-kanban-board",
    "07-admin-dashboard",
    "08-chat",
    "09-error-handling",
    "10-inline-tests",
    "11-meta-programming",
    "12-snippets-slots",
    "13-worker",
    "14-mario-state-machine",
  ];

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const name of examples) {
    const url = `http://localhost:${port}/${name}.html`;
    const page = await browser.newPage();

    // Collect console errors
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    try {
      await page.goto(url, { waitUntil: "networkidle0", timeout: 10000 });

      // Wait a tick for reactive initialization
      await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));

      // Check 1: no JS errors.
      //
      // SERVER examples fetch from a scrml server route; this harness serves the
      // STATIC dist with NO server, so a data fetch 404s. Tolerate ONLY the
      // literal network-absence artifact (the 404 body "Not found") — NOT
      // `_scrml_fetch_` / `SyntaxError`. Those are the codegen-bug class
      // (acceptance bug 2: an unbound `_scrml_fetch_` ref / invalid emitted JS);
      // blanket-suppressing them HID real bugs of that shape. The
      // NO-ERROR-CLASS-SUPPRESSION discipline (compiler/tests/e2e-render-map/) is
      // the canonical, no-suppression error-class classifier for these server
      // examples — it mounts them server-less and records their state directly
      // (and adds an explicit needs-server cell-state). This static smoke test
      // tolerates only the genuine missing-server network signature.
      const SERVER_EXAMPLES = new Set([
        "03-contact-book", "07-admin-dashboard", "08-chat",
      ]);
      const jsErrors = errors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("404") &&
          !(SERVER_EXAMPLES.has(name) && e.includes("Not found"))
      );

      // Check 2: page has content
      const bodyText = await page.$eval("body", (el) => el.textContent.trim());
      const hasContent = bodyText.length > 0;

      // Check 3: example-specific tests
      const testFn = EXAMPLE_TESTS[name];
      let specificError = null;
      if (testFn) {
        try {
          specificError = await testFn(page);
        } catch (e) {
          specificError = `Test threw: ${e.message}`;
        }
      }

      // Report
      const ok = jsErrors.length === 0 && hasContent && !specificError;
      if (ok) {
        console.log(`  PASS  ${name}`);
        passed++;
      } else {
        const reasons = [];
        if (jsErrors.length > 0) reasons.push(`JS errors: ${jsErrors.join("; ")}`);
        if (!hasContent) reasons.push("Page is blank");
        if (specificError) reasons.push(specificError);
        console.log(`  FAIL  ${name} — ${reasons.join(" | ")}`);
        failed++;
        failures.push({ name, reasons });
      }
    } catch (e) {
      console.log(`  FAIL  ${name} — ${e.message}`);
      failed++;
      failures.push({ name, reasons: [e.message] });
    }

    await page.close();
  }

  await browser.close();
  server.close();

  // Summary
  console.log("");
  console.log(`${passed} pass, ${failed} fail out of ${examples.length} examples`);

  if (failures.length > 0) {
    console.log("");
    console.log("Failures:");
    for (const f of failures) {
      console.log(`  ${f.name}:`);
      for (const r of f.reasons) {
        console.log(`    - ${r}`);
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
