/**
 * sql-table-refs — extract the table identifiers a `?{}` SQL body references.
 *
 * WHY THIS EXISTS (§14.8.11 / g-dbauth-migrate-no-grants-for-unmarked-identity-table).
 * `db-migrate` grants the bounded `scrml_app` role per DB-AUTHORITATIVE table, but the
 * `SET LOCAL ROLE scrml_app` drop is emitted per `?{}` in ANY request scope — so once one
 * table is db-authoritative, EVERY request-scope query runs as `scrml_app`, including reads
 * of tables that were never marked. §14.8.10's corollary PRESCRIBES not marking the identity
 * table (you cannot tenant-scope the table that tells you the tenant), so the prescribed
 * shape yields `permission denied for table users` on login. bryan RULED direction (b) at
 * S292: grant the tables `?{}` actually touches.
 *
 * ⚠️ THIS IS NOT A SQL PARSER, AND MUST NOT PRETEND TO BE ONE.
 * scrml carries no compile-time SQL parser (see g-esql002-normatively-required-no-fire-site).
 * This is a bounded IDENTIFIER SCANNER over the shapes that introduce a table reference. Its
 * contract is therefore two-valued, and the second value is the load-bearing one:
 *
 *   { tables: string[], undetermined: string[] }
 *
 * `undetermined` carries the query fragments whose table set could NOT be established. A
 * caller MUST NOT treat an empty `tables` as "touches nothing" — that is exactly how this
 * bug reproduces on a different table. Under-granting fails CLOSED at runtime with an opaque
 * `permission denied`, which is precisely the failure mode that cost the reporting adopter
 * three sessions. So the caller reports rather than guesses.
 */

/**
 * Clauses after which an identifier is a table reference, PAIRED WITH THE PRIVILEGE that
 * reference implies.
 *
 * The privilege pairing is load-bearing, not decoration. Granting blanket CRUD on every
 * touched table would hand the bounded role DELETE on the IDENTITY TABLE — a table the
 * app only ever SELECTs from during login. That is strictly more permissive than the
 * db-authoritative path beside it (which narrows UPDATE to mutable columns), and (b) is
 * "grant what the queries touch", which includes HOW they touch it.
 */
const TABLE_INTRODUCERS = [
  { re: /\bfrom\s+/gi, priv: "SELECT" },
  { re: /\bjoin\s+/gi, priv: "SELECT" },
  { re: /\binsert\s+into\s+/gi, priv: "INSERT" },
  { re: /\bupdate\s+/gi, priv: "UPDATE" },
  { re: /\bdelete\s+from\s+/gi, priv: "DELETE" },
];

/** `DELETE FROM t` also matches the bare `FROM` rule; DELETE is the real privilege. */
const PRIV_RANK = { SELECT: 0, INSERT: 1, UPDATE: 2, DELETE: 3 };

/**
 * Shapes whose table set this scanner does NOT resolve. Each is listed explicitly so the
 * limitation is a documented decision rather than a silent hole — a reader can see what is
 * excluded and why, per the gate-design discipline (pa-base §8, the non-deterministic input).
 */
const UNRESOLVABLE = [
  { re: /\bwith\b[\s\S]*\bas\s*\(/i, why: "a CTE (WITH …) — its name shadows a real table" },
  { re: /\bfrom\s*\(/i, why: "a subquery in FROM position" },
  { re: /\bjoin\s*\(/i, why: "a subquery in JOIN position" },
  { re: /\blateral\b/i, why: "a LATERAL join" },
  { re: /\bexecute\b/i, why: "a dynamic EXECUTE" },
];

/** `${…}` interpolations are bound PARAMETERS and never identifiers — blank them first. */
function blankInterpolations(sql) {
  return sql.replace(/\$\{[^}]*\}/g, " ? ");
}

/** Strip string literals and comments so their contents cannot be read as identifiers. */
function blankLiteralsAndComments(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, " '' ")
    .replace(/"(?:[^"]|"")*"/g, ' "" ');
}

/**
 * Extract the table identifiers a single SQL body references.
 *
 * @param {string} sql — the raw `?{}` body
 * @returns {{ tables: string[], undetermined: string[] }}
 */
export function tableRefsInSql(sql) {
  if (!sql || typeof sql !== "string") return { tables: [], privileges: {}, undetermined: [] };

  const cleaned = blankLiteralsAndComments(blankInterpolations(sql));

  // A shape we cannot resolve makes the WHOLE body undetermined. Deliberately
  // all-or-nothing: a partial answer here is indistinguishable from a complete one at the
  // call site, and that ambiguity is the bug this module exists to prevent.
  for (const { re, why } of UNRESOLVABLE) {
    if (re.test(cleaned)) {
      return { tables: [], privileges: {}, undetermined: [`${why}: ${sql.trim().slice(0, 120)}`] };
    }
  }

  // An interpolated identifier position (`FROM ?`) is a dynamic table name — unresolvable,
  // and separately a shape that fails 100% at runtime (g-sql-dynamic-identifier-no-form-no-diagnostic).
  if (/\b(?:from|join|into|update)\s+\?/i.test(cleaned)) {
    return { tables: [], privileges: {}, undetermined: [`a dynamic table identifier: ${sql.trim().slice(0, 120)}`] };
  }

  // table -> Set<privilege>
  const found = new Map();
  const KEYWORDS = new Set(["only", "lateral", "select", "values", "unnest", "generate_series"]);
  for (const { re, priv } of TABLE_INTRODUCERS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      const rest = cleaned.slice(m.index + m[0].length);
      const ident = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (!ident) continue;
      const name = ident[1].toLowerCase();
      if (KEYWORDS.has(name)) continue;
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(priv);
    }
  }

  // `DELETE FROM t` matches both the DELETE rule and the bare FROM rule, so the table
  // carries {SELECT, DELETE}. Keep both — a DELETE statement genuinely may read (its
  // WHERE clause), and SELECT is the weaker of the pair, so keeping it never widens
  // beyond what the stronger privilege already implies operationally.
  const tables = [...found.keys()];
  const privileges = {};
  for (const [t, privs] of found) {
    privileges[t] = [...privs].sort((a, b) => PRIV_RANK[a] - PRIV_RANK[b]);
  }

  return { tables, privileges, undetermined: [] };
}

/** Find every `?{ … }` body in a `.scrml` source. Bracket-matched, per §44.8. */
export function sqlBodiesInSource(source) {
  const out = [];
  if (!source || typeof source !== "string") return out;
  for (let i = 0; i < source.length - 1; i++) {
    if (source[i] !== "?" || source[i + 1] !== "{") continue;
    let depth = 0;
    let j = i + 1;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth === 0 && j < source.length) {
      out.push(source.slice(i + 2, j));
      i = j;
    }
  }
  return out;
}

/**
 * The union of table references across every `?{}` in a source, plus every fragment whose
 * table set could not be determined.
 *
 * @returns {{ tables: Set<string>, undetermined: string[] }}
 */
export function tableRefsInSource(source) {
  const tables = new Set();
  const privileges = new Map();
  const undetermined = [];
  for (const body of sqlBodiesInSource(source)) {
    const r = tableRefsInSql(body);
    for (const t of r.tables) {
      tables.add(t);
      if (!privileges.has(t)) privileges.set(t, new Set());
      for (const p of r.privileges?.[t] ?? []) privileges.get(t).add(p);
    }
    undetermined.push(...r.undetermined);
  }
  return { tables, privileges, undetermined };
}
