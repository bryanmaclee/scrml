/**
 * gh237-onmount-server-fn-await.browser.test.js — GH #237 (HIGH, fail-open).
 *
 * A server-fn result assigned to a PLAIN LOCAL inside `on mount { … }` emitted
 * with NO `await`:
 *
 *     on mount {
 *         const u = loadMe(1)      // -> const u = _scrml_fetch_loadMe_2(1);  NO await
 *         @you   = loadMe(1)       // -> (async () => set("you", await …))()  awaited
 *         if (u is not) { … } else { … }
 *     }
 *
 * so `u` held a PENDING Promise and every branch below it was wrong:
 *   - `u === null || u === undefined` -> false, so the "not signed in" branch
 *     NEVER runs. A guard that can never take its deny branch is FAIL-OPEN.
 *   - `u.type` -> `undefined`, so any role/shape test silently fails.
 *
 * In the reporting adopter's app this produced an unconditional redirect on
 * every load and made the whole real page body unreachable.
 *
 * SPEC §13.2: "The compiler SHALL insert `await` at every call site where a
 * server-generated fetch call is made." The mount block is emitted at MODULE
 * scope (the chunk body is a SYNC IIFE), so the fix gives it the async scope
 * §13.2 requires — the same `(async () => { … })().catch(…)` shape the already-
 * correct reactive-cell destination uses.
 *
 * This test EXECUTES the emitted bundle. Grepping for `await` is NOT sufficient
 * — the whole defect is that the emitted text looked plausible (S265/S268/S278
 * false-green precedent). The assertions below fail on pre-fix `main`:
 * `denied` stays `false` in BOTH directions and `@me` holds a `Promise`.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const REAL_FETCH = globalThis.fetch;
afterAll(() => { globalThis.fetch = REAL_FETCH; });

const SRC = `<program>
    <me> = not
    <you> = not
    <denied> = false

    \${
        server function loadMe(id) -> { id: number, type: string } {
            return { id: id, type: "admin" }
        }

        on mount {
            const u = loadMe(1)
            @you = loadMe(1)
            if (u is not) {
                @denied = true
            } else {
                @me = u
            }
        }
    }

    <p>\${@denied}</>
</>`;

function compile(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve("/tmp", "scrml-gh237", `case-${uniq}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${baseName}.scrml`);
  writeFileSync(input, source);
  const outDir = resolve(dir, "out");
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8"),
    runtimeJs: readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8"),
  };
}

/**
 * Execute the emitted bundle with a stubbed transport that answers every server
 * call with `payload`, then drain the microtask/macrotask queue so the mount
 * block's async scope has settled before the cells are read.
 */
async function mountWith(compiled, payload) {
  document.body.innerHTML = "";
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
  const exec = new Function(
    "window",
    "document",
    `${compiled.runtimeJs}\n` +
      captureInsideChunkScope(compiled.clientJs, "globalThis.__gh237_get__ = _scrml_reactive_get;\n"),
  );
  let threw = null;
  try {
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  } catch (e) {
    threw = e;
  }
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  const get = globalThis.__gh237_get__;
  return { threw, denied: get("denied"), me: get("me"), you: get("you") };
}

describe("GH #237 — `on mount` server-fn call into a plain local", () => {
  const compiled = compile(SRC, "gh237");

  test("compiles clean", () => {
    expect(compiled.errors).toEqual([]);
  });

  test("the mount block is emitted inside an async scope with the call awaited", () => {
    expect(compiled.clientJs).toMatch(/\(async \(\) => \{[\s\S]*const u = await _scrml_fetch_loadMe_\d+\(1\);/);
  });

  test("EXECUTES: the `is not` deny branch is REACHABLE and denies", async () => {
    // Server answers with absence — the guard MUST take its deny arm.
    const r = await mountWith(compiled, null);
    expect(r.threw).toBeNull();
    expect(r.denied).toBe(true);
    expect(r.me).toBe(null);
  });

  test("EXECUTES: the success branch lands a RESOLVED value, not a Promise", async () => {
    const r = await mountWith(compiled, { id: 1, type: "admin" });
    expect(r.threw).toBeNull();
    expect(r.denied).toBe(false);
    expect(r.me).not.toBeInstanceOf(Promise);
    expect(r.me).toEqual({ id: 1, type: "admin" });
    // A role/shape test downstream of the guard reads a real field, not undefined.
    expect(r.me.type).toBe("admin");
  });

  test("EXECUTES: the sibling reactive-cell destination still resolves (no regression)", async () => {
    const r = await mountWith(compiled, { id: 1, type: "admin" });
    expect(r.you).not.toBeInstanceOf(Promise);
    expect(r.you).toEqual({ id: 1, type: "admin" });
  });

  test("a mount block with NO server call is unchanged (no async scope introduced)", () => {
    const plain = compile(
      `<program>
    <n> = 0
    \${
        function bump() { @n = @n + 1 }
        on mount { bump() }
    }
    <p>\${@n}</>
</>`,
      "gh237plain",
    );
    expect(plain.errors).toEqual([]);
    expect(plain.clientJs).not.toContain("§6.7.1a `on mount` — async scope");
  });
});
