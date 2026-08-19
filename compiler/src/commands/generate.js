/**
 * @module commands/generate
 * scrml generate <type> subcommand.
 *
 * Scaffolds adopter-owned source files keyed to the project's existing
 * structure. Universal prior art (Rails `rails generate`, Phoenix `mix
 * phx.gen.X`, Laravel `php artisan make:X`, ASP.NET Core Scaffold Identity)
 * converges on the explicit-generator pattern — the adopter invokes the
 * command; the framework writes a real source file the adopter then owns,
 * edits, and ships.
 *
 * Authored S91 — paired with Sub-task A (W-AUTH-LOGIN-MISSING warning)
 * per OQ-3 ratification (ship E+A together in v0.2.x). The warning's
 * resolution clause points adopters at this command; the command writes
 * a working baseline so the resolution path is one shell command rather
 * than 80 lines of from-scratch authoring.
 *
 * Usage:
 *   scrml generate auth [--target=<path>] [--target-dir=<dir>]
 *
 * Initial type catalog: `auth` only. Future expansions (page / component /
 * model) follow the same dispatcher shape.
 *
 * The `auth` type writes `stdlib/auth/templates/login.scrml` into the
 * project at the chosen target. Behavior:
 *   - Read the project's <program> root file (heuristic: app.scrml in CWD,
 *     or first .scrml file under CWD that contains <program>).
 *   - Resolve the configured login route — default `/login` per SPEC §52.13.
 *     With v0.3 filesystem routing this lands at `pages/login.scrml`.
 *   - If a target file already exists at the resolved path, the generator
 *     skips with a warning (never overwrites — adopter's edits are
 *     load-bearing).
 *   - Detect <db> presence in the program root and emit a hint about the
 *     users-table schema the template expects (full schema introspection
 *     is deferred — see OQ-4 note below).
 *
 * Schema introspection (OQ-4 ratification): the template ships with a
 * canonical users-table shape (id / email / password_hash / last_login_at)
 * in comments. Adopter-side schema migration to match is documented in
 * the template's leading comment. Full schema-read with `<db tables=>`
 * cross-ref is a v0.2.y follow-up — the template's comment block is
 * sufficient for the load-bearing v0.2.x case.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// ANSI color helpers — no dependencies (matches init.js / migrate.js)
// ---------------------------------------------------------------------------

const isTTY = process.stderr.isTTY && process.stdout.isTTY;

const c = {
  red:    (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  green:  (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:   (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  dim:    (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   (s) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

// ---------------------------------------------------------------------------
// Catalog of supported types
// ---------------------------------------------------------------------------

const KNOWN_TYPES = ["auth"];

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

/**
 * Parse generate-command arguments.
 *
 * @param {string[]} args
 * @returns {{ type: string | null, targetPath: string | null, targetDir: string | null, help: boolean }}
 */
function parseArgs(args) {
  let type = null;
  let targetPath = null;
  let targetDir = null;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("--target=")) {
      targetPath = arg.slice("--target=".length);
    } else if (arg === "--target") {
      targetPath = args[++i];
    } else if (arg.startsWith("--target-dir=")) {
      targetDir = arg.slice("--target-dir=".length);
    } else if (arg === "--target-dir") {
      targetDir = args[++i];
    } else if (arg.startsWith("-")) {
      console.error(c.red("error:") + ` Unknown option: ${arg}`);
      console.error(c.dim("Run `scrml generate --help` for usage."));
      process.exit(1);
    } else if (type === null) {
      type = arg;
    } else {
      console.error(c.red("error:") + ` Unexpected positional argument: ${arg}`);
      console.error(c.dim("Run `scrml generate --help` for usage."));
      process.exit(1);
    }
  }

  return { type, targetPath, targetDir, help };
}

// ---------------------------------------------------------------------------
// Project-root discovery
// ---------------------------------------------------------------------------

/**
 * Find the project's <program> root file. Searches:
 *   1. `app.scrml` in CWD
 *   2. `src/app.scrml` (the scrml init scaffold path)
 *   3. First .scrml file under CWD containing `<program>` (depth-first,
 *      skipping node_modules / dist / .git).
 *
 * Returns the absolute path or `null` when nothing matches.
 *
 * @param {string} cwd — absolute path
 * @returns {string | null}
 */
function findProgramRoot(cwd) {
  // Heuristic 1: app.scrml at CWD.
  const candidates = [
    join(cwd, "app.scrml"),
    join(cwd, "src", "app.scrml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const src = readFileSync(p, "utf8");
        if (src.includes("<program")) return p;
      } catch { /* fall through */ }
    }
  }

  // Heuristic 2: scan the tree shallowly for a .scrml with <program>.
  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".claude", "scrml-runtime"]);
  function scan(dir, depth) {
    if (depth > 4) return null;
    let entries;
    // Sort so the first `.scrml` with a `<program>` is chosen deterministically
    // across OS / filesystem readdir order (g-residual-order-bearing-readdir):
    // the auth-scaffold root hint must not depend on which file the FS lists first.
    try { entries = readdirSync(dir).sort(); } catch { return null; }
    for (const name of entries) {
      if (name.startsWith(".") && name !== "." ) continue;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        const hit = scan(full, depth + 1);
        if (hit) return hit;
      } else if (st.isFile() && name.endsWith(".scrml")) {
        try {
          const src = readFileSync(full, "utf8");
          if (src.includes("<program")) return full;
        } catch { /* skip */ }
      }
    }
    return null;
  }

  return scan(cwd, 0);
}

/**
 * Inspect the program root file for an existing <db src=...> declaration.
 * Returns the src= value if present (verbatim), else null.
 *
 * @param {string} programRootPath — absolute path to a .scrml file
 * @returns {string | null}
 */
function findProgramDbSrc(programRootPath) {
  let src;
  try { src = readFileSync(programRootPath, "utf8"); } catch { return null; }
  // Match <db src="..."> attribute literally. Single quotes also valid.
  const m = src.match(/<db\s+[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/);
  if (m) return m[2];
  return null;
}

/**
 * Inspect the program root for an explicit loginRedirect= override.
 * Returns the literal value (e.g., "/signin") or null when absent.
 *
 * @param {string} programRootPath — absolute path
 * @returns {string | null}
 */
function findProgramLoginRedirect(programRootPath) {
  let src;
  try { src = readFileSync(programRootPath, "utf8"); } catch { return null; }
  const m = src.match(/<program\s+[^>]*\bloginRedirect\s*=\s*(["'])([^"']+)\1/);
  if (m) return m[2];
  return null;
}

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a template file. Templates live under
 * `stdlib/auth/templates/` relative to the project root that ships the
 * compiler. The compiler discovers stdlib via its own install location.
 *
 * The stdlib path resolution mirrors the lookup at api.js: stdlib lives
 * at `<compiler-root>/stdlib/`. From this file (`compiler/src/commands/`)
 * three `..` segments reach the project root.
 *
 * @param {string} templateName — e.g., "auth/login.scrml"
 * @returns {string} absolute path to the template
 */
function templatePath(templateName) {
  return resolve(__dirname, "..", "..", "..", "stdlib", templateName);
}

/**
 * Apply trivial textual substitutions to the template body. The substitution
 * surface is intentionally small — the template is adopter-owned after
 * generation, so most customization happens post-write. We rewrite only the
 * load-bearing wiring (DB src path) so the generated file compiles on first
 * invocation against the project's actual DB.
 *
 * @param {string} body
 * @param {object} subs
 *   subs.dbSrc — string|null; replaces the placeholder `./app.db` if set
 * @returns {string}
 */
function applySubstitutions(body, subs) {
  let out = body;
  if (subs.dbSrc) {
    // Match the literal placeholder src="./app.db" emitted by login.scrml.
    // Function-form .replace() so any `$` chars in subs.dbSrc (read from a
    // user's program-root `<db src="...">` attribute) aren't interpreted as
    // `$&` / `$N` backreferences (S100 `01eeda9` bug class).
    out = out.replace(/(<db\s+src=)"\.\/app\.db"/, (_, prefix) => `${prefix}"${subs.dbSrc}"`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-type handlers
// ---------------------------------------------------------------------------

/**
 * Generate the auth scaffold (login.scrml).
 *
 * @param {object} opts
 *   opts.cwd        — absolute path; project root
 *   opts.targetPath — absolute or relative; explicit user-specified path
 *   opts.targetDir  — absolute or relative; user-specified dir, file name = login.scrml
 * @returns {{ wrote: boolean, target: string }}
 */
function generateAuth(opts) {
  const { cwd, targetPath, targetDir } = opts;

  // Find the project root file for context discovery.
  const programRoot = findProgramRoot(cwd);
  if (programRoot) {
    console.log(c.dim(`  project root: ${relative(cwd, programRoot) || programRoot}`));
  } else {
    console.log(c.dim(`  project root: <not detected — generating with default values>`));
  }

  // Discover DB wiring + redirect target from the program root, if present.
  const dbSrc = programRoot ? findProgramDbSrc(programRoot) : null;
  const explicitLoginRedirect = programRoot ? findProgramLoginRedirect(programRoot) : null;
  const loginRedirect = explicitLoginRedirect || "/login";

  if (dbSrc) {
    console.log(c.dim(`  detected <db src="${dbSrc}"> — template will be wired to this DB`));
  } else {
    console.log(c.dim(`  no <db> declaration detected — template ships with default 'app.db' placeholder`));
  }
  console.log(c.dim(`  login route: ${loginRedirect}`));

  // Resolve the output path.
  // Precedence:
  //   1. --target=<path> wins (explicit; never overridden)
  //   2. --target-dir=<dir> → <dir>/login.scrml
  //   3. When the program declares an explicit non-default loginRedirect
  //      (e.g., `/signin`), derive the filesystem path from the route so
  //      the scaffold lands where the auth gate actually points
  //      (e.g., /signin → pages/signin.scrml). v0.3 filesystem-routing
  //      maps URL pattern `/foo/bar` → `pages/foo/bar.scrml`.
  //   4. default: pages/login.scrml under the project root
  //      (filesystem-routing convention; matches default loginRedirect=/login)
  let outAbs;
  if (targetPath) {
    outAbs = resolve(cwd, targetPath);
  } else if (targetDir) {
    outAbs = resolve(cwd, targetDir, "login.scrml");
  } else if (explicitLoginRedirect && explicitLoginRedirect !== "/login") {
    // Strip leading slash; treat root-redirect "/" as a degenerate
    // case that falls back to the default pages/login.scrml so
    // we never write to pages/.scrml or similar.
    const trimmed = explicitLoginRedirect.replace(/^\/+/, "");
    if (trimmed.length === 0) {
      outAbs = resolve(cwd, "pages", "login.scrml");
    } else {
      outAbs = resolve(cwd, "pages", `${trimmed}.scrml`);
    }
  } else {
    outAbs = resolve(cwd, "pages", "login.scrml");
  }

  // Read template body.
  const tplPath = templatePath("auth/templates/login.scrml");
  if (!existsSync(tplPath)) {
    console.error(c.red("error:") + ` Template not found at ${tplPath}`);
    console.error(c.dim("  This is a compiler-internal error — the stdlib template should ship with the compiler."));
    process.exit(2);
  }
  const tplBody = readFileSync(tplPath, "utf8");
  const body = applySubstitutions(tplBody, { dbSrc });

  // Idempotency check — never clobber an existing file.
  if (existsSync(outAbs)) {
    console.warn(c.yellow("warning:") + ` ${relative(cwd, outAbs) || outAbs} already exists — skipping`);
    console.warn(c.dim("  Delete the existing file first if you want to regenerate."));
    return { wrote: false, target: outAbs };
  }

  // Mismatch warning: if the adopter forced an explicit target via
  // --target / --target-dir AND the program declares a non-default
  // loginRedirect, the scaffold may not match the URL the auth gate
  // points to. Surface this so the adopter can re-route.
  if ((targetPath || targetDir) && explicitLoginRedirect && explicitLoginRedirect !== "/login") {
    const scaffoldRoute = "/" + relative(resolve(cwd, "pages"), outAbs).replace(/\.scrml$/, "").replace(/\\/g, "/");
    if (scaffoldRoute !== explicitLoginRedirect) {
      console.warn(c.yellow("warning:") + ` <program loginRedirect="${explicitLoginRedirect}"> but the scaffold was written to a path that filesystem-routes to "${scaffoldRoute}".`);
      console.warn(c.dim("  The runtime auth-check will still 302 to " + explicitLoginRedirect + " — adjust --target / --target-dir, or change loginRedirect to match."));
    }
  }

  // Ensure parent directory exists.
  mkdirSync(dirname(outAbs), { recursive: true });

  // Write.
  writeFileSync(outAbs, body, "utf8");
  console.log(c.green("  created") + ` ${relative(cwd, outAbs) || outAbs}`);
  return { wrote: true, target: outAbs, loginRedirect };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Entry point for the generate subcommand.
 *
 * @param {string[]} args — raw argv slice after "generate"
 */
export function runGenerate(args) {
  const { type, targetPath, targetDir, help } = parseArgs(args);

  if (help || (type === null && args.length === 0)) {
    console.log(`scrml generate <type> [options]

Scaffold adopter-owned source files keyed to the project's structure.

Types:
  auth              Login page scaffold (pages/login.scrml)

Options:
  --target=<path>   Explicit output path (relative to CWD or absolute)
  --target-dir=<d>  Output directory; the generator writes the type's
                    default file name into the directory.
  --help, -h        Show this message

Examples:
  scrml generate auth                        # writes pages/login.scrml
  scrml generate auth --target=./login.scrml # writes to CWD/login.scrml
  scrml generate auth --target-dir=./pages   # writes ./pages/login.scrml

Existing files are never overwritten — conflicting files are skipped
with a warning.
`);
    return;
  }

  if (type === null) {
    console.error(c.red("error:") + " `scrml generate` requires a type argument.");
    console.error(c.dim("  Try `scrml generate auth` or `scrml generate --help`."));
    process.exit(1);
  }

  if (!KNOWN_TYPES.includes(type)) {
    console.error(c.red("error:") + ` Unknown generator type: ${type}`);
    console.error(c.dim(`  Known types: ${KNOWN_TYPES.join(", ")}`));
    process.exit(1);
  }

  const cwd = process.cwd();
  console.log(`\nGenerating ${c.cyan(type)} scaffold in ${c.cyan(relative(process.cwd(), cwd) || ".")}\n`);

  let result;
  if (type === "auth") {
    result = generateAuth({ cwd, targetPath, targetDir });
  } else {
    // KNOWN_TYPES guard above keeps this unreachable; defensive.
    console.error(c.red("error:") + ` No handler implemented for type: ${type}`);
    process.exit(2);
  }

  // Next-steps hint.
  console.log("");
  if (result && result.wrote) {
    // Echo the actual login route the program declared (default `/login`,
    // or the explicit `loginRedirect=` override). Hard-coding `/login`
    // here lies to adopters whose loginRedirect is non-default.
    const visitRoute = (result.loginRedirect && typeof result.loginRedirect === "string")
      ? result.loginRedirect
      : "/login";
    console.log(c.bold(c.green("Done.")));
    console.log(`
Next steps:
  1. Open ${c.cyan(relative(cwd, result.target) || result.target)} and review the scaffold.
     Adjust the form fields, DB schema reference, and post-login redirect.
  2. Make sure your DB has a 'users' table with at least:
       id INTEGER PRIMARY KEY,
       email TEXT UNIQUE NOT NULL,
       password_hash TEXT NOT NULL
  3. Seed a test user (use hashPassword from scrml:auth).
  4. Run ${c.cyan("scrml dev")} and visit ${visitRoute}.
`);
  } else {
    console.log(c.yellow("Nothing written — see warnings above."));
  }
}
