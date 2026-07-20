/**
 * CONF-SSR-AUTH-SCOPED | §52.15.5 — SSR auto-make-safe (I-SSR-AUTH-SCOPED-CLIENT-HYDRATED)
 *
 * The conformance surface pin (merge-blocker) for the S256-held / re-implemented
 * cross-user SSR-prerender leak fix. The SSR compose route is ANONYMOUS-reachable;
 * baking an auth-scoped, non-row-scoped server-authority cell into that first paint
 * leaked EVERY user's rows to an unauthenticated viewer. The compiler now AUTO-OMITS
 * such a cell from the SSR seed (it hydrates client-side behind its gated /__serverLoad
 * fetch, 401 for anon) + fires the Info lint I-SSR-AUTH-SCOPED-CLIENT-HYDRATED.
 *
 * BOTH halves:
 *   - codes-half: the Info lint fires on an auth-scoped UNSCOPED cell (Tier-1
 *     SELECT *), and does NOT fire on a public (auth="none") cell nor a row-scoped
 *     Pattern-C cell (`${@currentUser.id}` WHERE). NO E-* (idiomatic code compiles).
 *   - runtime-half (DETERMINISTIC): the compiled bundle OMITS the auth-scoped cell
 *     from the compose seed + KEEPS the public sibling; and the shipped compose
 *     handler, EXECUTED with an ANONYMOUS request (no session, no CSRF — the anon
 *     GET is cloud-runner-stable, unlike a session-pinned full-bundle POST), leaks
 *     NEITHER auth-scoped row nor an auth-scoped seed key while serving the public
 *     rows. This is the R26 executed-anon-SSR, pinned directly here.
 *
 * Catalog (SPEC §34, §52.15.5): I-SSR-AUTH-SCOPED-CLIENT-HYDRATED (Info). Firing
 * site: the isServer state-decl block in type-system.ts; the SSR-seed omission +
 * per-cell /__mountHydrate gate in codegen/emit-server.ts.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// The R26 reproducer: an auth-scoped Tier-1 `<Account>` cell + a PUBLIC sibling.
const LEAK_APP = `<program db="sqlite:./app.db" auth="required">
<schema>
  ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)\`}
  ?{\`CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT)\`}
</schema>
<db src="app.db" tables="users,widgets"></db>
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <widgets server auth="none"> = ?{\`SELECT * FROM widgets\`}.all()
}
<main>
  <ul><each in=@accounts key=@.id as a><li class="acct">\${a.name}</li></each></ul>
  <ul><each in=@widgets key=@.id as w><li class="wid">\${w.label}</li></each></ul>
</main>
</program>`;

// A per-user row-scoped Pattern-C cell — the negative control (NOT omitted).
const ROW_SCOPED_APP = `<program db="sqlite:./app.db" auth="required">
<db src="sqlite:./app.db" tables="orders">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id TEXT, item TEXT)\`}.run()
    <orders server> = ?{\`SELECT * FROM orders WHERE user_id = \${@currentUser.id}\`}.all()
  }
  <main><ul><each in=@orders key=@.id><li : @.item></each></ul></main>
</db>
</program>`;

function compile(source, write = false) {
  const dir = mkdtempSync(join(tmpdir(), "conf-ssr-auth-"));
  _tmp.push(dir);
  const file = join(dir, "app.scrml");
  writeFileSync(file, source);
  if (write) {
    const outDir = join(dir, "out");
    compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
    return { serverJs: readFileSync(join(outDir, "app.server.js"), "utf8"), outDir };
  }
  const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
  return { r };
}
const codes = (r) => [...(r.warnings ?? []), ...(r.errors ?? [])];
const hasCode = (r, c) => codes(r).some((d) => d && d.code === c);

describe("CONF-SSR-AUTH-SCOPED (codes-half): the Info lint fires on the leak shape only", () => {
  test("I-SSR-AUTH-SCOPED-CLIENT-HYDRATED fires (Info) on an auth-scoped Tier-1 cell; NO E-*", () => {
    const { r } = compile(LEAK_APP);
    expect(hasCode(r, "I-SSR-AUTH-SCOPED-CLIENT-HYDRATED")).toBe(true);
    const hit = codes(r).find((d) => d.code === "I-SSR-AUTH-SCOPED-CLIENT-HYDRATED");
    expect(hit.severity).toBe("info");
    // idiomatic code still compiles — never a hard error on this axis.
    expect((r.errors ?? []).some((d) => d && String(d.code).startsWith("E-"))).toBe(false);
  });

  test("does NOT fire on the PUBLIC sibling (auth=none) — @widgets is not over-omitted", () => {
    // The single fire is for @accounts only (the public @widgets does not lint).
    const { r } = compile(LEAK_APP);
    const fires = codes(r).filter((d) => d.code === "I-SSR-AUTH-SCOPED-CLIENT-HYDRATED");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("@accounts");
  });

  test("does NOT fire on a per-user row-scoped Pattern-C cell (`${@currentUser.id}`)", () => {
    const { r } = compile(ROW_SCOPED_APP);
    expect(hasCode(r, "I-SSR-AUTH-SCOPED-CLIENT-HYDRATED")).toBe(false);
  });
});

describe("CONF-SSR-AUTH-SCOPED (runtime-half): the compiled bundle omits the seed + the anon compose leaks nothing", () => {
  test("codegen OMITS the auth-scoped Tier-1 cell from the compose seed; KEEPS the public sibling", () => {
    const { serverJs } = compile(LEAK_APP, true);
    // the auth-scoped cell is named in the readable omission comment, NOT seeded.
    expect(serverJs).toContain("NOT SSR-seeded");
    expect(serverJs).toContain("@accounts");
    expect(serverJs).not.toMatch(/_scrml_ssr_state\[[^\]]*\]\s*=\s*await _scrml_sql`SELECT \* FROM users`/);
    // the public sibling IS seeded into the anon compose state.
    expect(serverJs).toContain('_scrml_ssr_state["widgets"] = await _scrml_sql`SELECT * FROM widgets`');
    // the auth-scoped SELECT survives ONLY behind the gated /__serverLoad route.
    const gi = serverJs.indexOf("async function _scrml_serverLoad_accounts_handler");
    expect(gi).toBeGreaterThan(-1);
    expect(serverJs.slice(gi, gi + 300)).toContain("_scrml_serverload_auth");
  });

  test("R26 — the shipped compose handler, invoked ANONYMOUSLY, leaks NO auth-scoped row/key; serves the public rows", async () => {
    const { serverJs, outDir } = compile(LEAK_APP, true);
    // Seed data — an anon request must see NEITHER Alice NOR Bob NOR an accounts key.
    const SEED = {
      users:   [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      widgets: [{ id: 10, label: "PublicWidget" }],
    };
    const stubSql = (strings) => {
      const q = strings.join(" ");
      const m = /FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(q);
      const t = m ? m[1] : null;
      return Promise.resolve(t && SEED[t] ? SEED[t] : []);
    };
    // Strip imports + the real SQL handle; inject the stub as `_scrml_sql`; resolve
    // `import.meta.url` to the emitted app.server.js so the compose reads app.html.
    const src = serverJs
      .replace(/import\s+\{[^}]*\}\s+from\s+["'][^"']+["'];?/g, "")
      .replace(/const _scrml_sql = new SQL\([^)]*\);/g, "")
      .replace(/import\.meta\.url/g, JSON.stringify("file://" + join(outDir, "app.server.js")))
      .replace(/^export\s+/gm, "");
    const factory = new Function(
      "_scrml_sql", "Bun",
      src + "\nreturn typeof _scrml_ssr_compose_handler !== 'undefined' ? _scrml_ssr_compose_handler : null;",
    );
    const compose = factory(stubSql, Bun);
    expect(typeof compose).toBe("function");

    const resp = await compose({});          // anonymous request — no cookies, no session
    const html = await resp.text();
    const seedMatch = /window\.__scrml_ssr_state=([\s\S]*?);<\/script>/.exec(html);
    const seed = seedMatch ? JSON.parse(seedMatch[1]) : {};

    // (a) the auth-scoped rows + seed key are ABSENT from the anon first paint.
    expect(html).not.toContain("Alice");
    expect(html).not.toContain("Bob");
    expect(Object.prototype.hasOwnProperty.call(seed, "accounts")).toBe(false);
    // (b) the PUBLIC sibling is NOT over-omitted — seeded + server-rendered in place.
    expect(Object.prototype.hasOwnProperty.call(seed, "widgets")).toBe(true);
    expect(html).toContain("PublicWidget");
  });
});
