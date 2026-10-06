/**
 * Schema differ — computes migration SQL from desired vs actual database state.
 *
 * SPEC §38.6: reads desired state from < schema> AST, reads actual state from
 * SQLite PRAGMA table_info(), generates migration SQL.
 *
 * @module schema-differ
 */

import { quoteIdent } from "./codegen/sql-ident.ts";

/**
 * Parse a < schema> AST node into structured table declarations.
 *
 * BACKWARD-COMPAT (§14.8.11.2 P2): the return shape stays `{ tables: [...] }` — all
 * six consumers (`protect-analyzer`, `channel-watches`, `gauntlet-phase1-checks`,
 * `codegen/index`, `db-authoritative`, this module) read `.tables ?? []`. The P2
 * SECURITY-DEFINER `fn` surface adds an ADDITIVE `fns: [...]` (empty for a schema
 * with no `fn` — so existing schemas are unaffected).
 *
 * The scan is BRACE-DEPTH-AWARE (a hand scan, not the old non-nested
 * `/(\w+)\s*\{([^}]*)\}/g` regex): a P2 `fn` carries a `"""…"""`-quoted plpgsql body
 * that itself contains `{`/`}` (an `IF … END IF`), which the `[^}]*` regex would
 * truncate at the first inner `}`. The scanner tolerates a braced/triple-quoted
 * body and still parses a plain `tableName { … }` table identically to the old
 * regex (a table body has no nested braces, so depth returns to 0 at the SAME `}`).
 *
 * @param {object} schemaBody — AST node with body text, or the raw body string
 * @returns {{ tables: TableDecl[], fns: SecdefFnDecl[] }}
 */
// Sticky (`y`) head regexes for `parseSchemaBlock` — matched AT an offset, no slicing.
const FN_HEAD_RE = /fn\s+([A-Za-z_]\w*)\s*\(/y;
const TBL_HEAD_RE = /([A-Za-z_]\w*)\s*\{/y;

export function parseSchemaBlock(schemaBody) {
  const tables = [];
  const fns = [];
  const gluedHeads = [];
  const fnBodySpans = [];
  // Offset of each `tables[k]` head in `text` (parallel array, additive — read by
  // `findTenantDeclarationDisagreements` to locate a declaration for E-SCHEMA-015;
  // the table objects themselves are unchanged).
  const tableOffsets = [];
  let maskedForGlue = null;
  const text = typeof schemaBody === "string" ? schemaBody : (schemaBody?.body ?? "");
  const n = text.length;
  let i = 0;
  // S456 — every `{` / `(` match and next-`{` lookup of this body, answered in amortized
  // linear time (an unbalanced body re-scanned to its end per head: `"a{"`×40k ≈ 13 s).
  const finders = {
    blockEnd: makeSchemaBlockEndFinder(text),
    parenEnd: makeMatchingParenFinder(text),
    nextBrace: makeNextCharFinder(text, "{"),
    inRange: makeRangeMatcher(text),
  };

  while (i < n) {
    // Skip whitespace between top-level entries.
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;

    // LINEAR SCAN (S455 review round 2b — measured: a 40 KB string literal in a `<schema>`
    // cost ~1 s here, 80 KB ~4 s). The scan used to `text.slice(i)` and re-run both
    // head regexes at EVERY offset, and inside a long word run each attempt re-scanned
    // the run's tail. Same matches, same order, without that: the heads are sticky
    // regexes at `i`, and an offset inside a word run is skipped when no head can start
    // there — a table head needs the run to be followed by `\s*{` (then the first
    // letter of the run matches, exactly as before, including the glued-tail cases
    // E-SCHEMA-012/013 rely on), and an `fn` head inside a run can only be its final
    // two characters.
    if (/\w/.test(text[i])) {
      let e = i + 1;
      while (e < n && /\w/.test(text[e])) e++;
      let w = e;
      while (w < n && /\s/.test(text[w])) w++;
      if (text[w] !== "{" && e - i > 2) {
        const fnAt = text.slice(e - 2, e) === "fn" ? e - 2 : e;
        if (fnAt > i) { i = fnAt; continue; }
      }
    }

    // §14.8.11.2 S4 — a SECURITY-DEFINER `fn` decl: `fn NAME(args) …modifiers… { body }`.
    FN_HEAD_RE.lastIndex = i;
    const fnHead = FN_HEAD_RE.exec(text);
    if (fnHead) {
      const parsed = parseFnDecl(text, i, fnHead, finders);
      if (parsed) {
        fns.push(parsed.fn);
        if (parsed.bodySpan) fnBodySpans.push({ fnAt: i, ...parsed.bodySpan });
        i = parsed.next;
        continue;
      }
      // Malformed `fn` head — advance one char and resume (graceful, never throws).
      i++;
      continue;
    }

    // A plain table: `tableName { … }` optionally followed by the `db-authoritative` marker.
    TBL_HEAD_RE.lastIndex = i;
    const tblHead = TBL_HEAD_RE.exec(text);
    if (tblHead) {
      const tableName = tblHead[1];
      const tblStart = i;
      const braceOpen = i + tblHead[0].length - 1; // index of the `{`
      const braceClose = finders.blockEnd(braceOpen);
      if (braceClose === -1) {
        // Unbalanced braces — bail on this entry (mirrors the old regex silently
        // not matching an unterminated block).
        i = braceOpen + 1;
        continue;
      }
      const columnsText = text.slice(braceOpen + 1, braceClose);
      const table = { name: tableName, columns: parseColumns(columnsText) };
      // §39.2 — a DSL head is `table-name '{'`. The one-char recovery below can
      // slide INTO a longer token and match only its tail (`mydb.public.assets {`
      // → `assets`, `données {` → `es`), silently renaming the table — and two
      // qualified heads then collapse onto one key, first-wins (gap
      // g-schema-dsl-qualified-table-head-silently-stripped). The table is still
      // declared exactly as before (the floors never lose it); the glued prefix is
      // RECORDED so GCP1 rejects the program (E-SCHEMA-012 / E-SCHEMA-013).
      // S446 fix round: the backward scan reads the comment/literal-BLANKED text, so a
      // `--` comment ending in `.` (`-- The assets table.`) is not a qualifier.
      if (maskedForGlue === null) maskedForGlue = blankLiteralBodies(text, { comments: true, backtick: false });
      const glue = dslHeadGluePrefix(text, maskedForGlue, i);
      if (glue) gluedHeads.push({ name: tableName, ...glue, offset: i });
      i = braceClose + 1;

      // §14.8.11 opt-in DB-authoritative marker — a bareword `db-authoritative`
      // immediately after the table's closing `}` relocates the tenant-isolation
      // floor to the DB. M1-PROVISIONAL surface. Postgres-only; SQLite hard-fails
      // E-DBAUTH-SQLITE downstream in codegen.
      const trailing = text.slice(i).match(/^\s*db-authoritative\b/);
      if (trailing) {
        table.dbAuthoritative = true;
        i += trailing[0].length;
      }

      tables.push(table);
      tableOffsets.push(tblStart);
      continue;
    }

    // Nothing recognized at this position — advance one char (skips stray tokens
    // like a dangling `db-authoritative` marker whose table already consumed it).
    i++;
  }

  return { tables, fns, gluedHeads, fnBodySpans, tableOffsets };
}

/**
 * Is the DSL table head that `parseSchemaBlock` matched at `i` really the TAIL of
 * a longer token? Returns null for a clean head, else
 *   · `{ kind: "qualified", prefix }`  — a `.` precedes the name (whitespace, and
 *     comments, allowed around it): `mydb.public.assets {`;
 *   · `{ kind: "unreadable", prefix }` — an identifier-ish character is glued to
 *     the name (`données {` matched as `es`, `my-assets {` as `assets`,
 *     `app$v2 {` as `v2`, `1assets {` as `assets`).
 * The scan reads `masked` — `text` with `--` / closed `/* *\/` comments and one-line
 * literals blanked (`blankLiteralBodies`, comment mode), length-preserving — so a
 * `.` or a letter inside a comment or a string is never a glued prefix (S446 fix
 * round: `-- The assets table.` before `assets {` was a false E-SCHEMA-012).
 * `prefix` is the glued text from `text`, for the message.
 */
function dslHeadGluePrefix(text, masked, i) {
  const GLUE = /[\p{L}\p{N}_$\-]/u;
  let j = i - 1;
  if (j >= 0 && GLUE.test(masked[j])) {
    let s = j;
    while (s > 0 && /[\p{L}\p{N}_$\-.]/u.test(masked[s - 1])) s--;
    return { kind: "unreadable", prefix: text.slice(s, i) };
  }
  // Back over whitespace (blanked comments are whitespace in `masked`) to find a `.`.
  while (j >= 0 && /\s/.test(masked[j])) j--;
  if (j >= 0 && masked[j] === ".") {
    let s = j;
    while (s > 0 && /[\p{L}\p{N}_$\-."`[\]\s]/u.test(text[s - 1]) && text[s - 1] !== "\n") s--;
    return { kind: "qualified", prefix: text.slice(s, i).trim() };
  }
  return null;
}

/**
 * The DSL table heads of a `< schema>` body that `parseSchemaBlock` read as the
 * TAIL of a longer token (see `dslHeadGluePrefix`) and that are LIVE — not inside
 * a `--` / closed `/* *\/` comment or a one-line string / `pattern(/…/)` regex,
 * the same exemption E-SCHEMA-012 uses. GCP1 reports "qualified" as E-SCHEMA-012
 * and "unreadable" as E-SCHEMA-013.
 *
 * @param {string} text a `< schema>` body
 * @returns {Array<{kind: "qualified"|"unreadable", name: string, prefix: string, offset: number}>}
 */
export function findGluedDslTableHeads(text) {
  if (typeof text !== "string") return [];
  let parsed;
  try { parsed = parseSchemaBlock(text); } catch { return []; }
  const glued = parsed.gluedHeads ?? [];
  if (glued.length === 0) return [];
  const masked = blankLiteralBodies(text, { comments: true, backtick: false });
  return glued.filter((g) => masked.slice(g.offset, g.offset + g.name.length) === g.name);
}

/**
 * Find the index of the `}` that closes the block opened at `openIdx` (which MUST
 * point at a `{`), tracking brace depth and SKIPPING over `"""…"""` triple-quoted
 * regions (a plpgsql `fn` body, whose `IF … END IF` braces must not miscount).
 * Returns -1 if unbalanced.
 *
 * DELIBERATELY NOT quote-aware for single/double quotes: a plain table body has no
 * nested braces, so brace-depth alone stops at the SAME `}` the old
 * `/\{([^}]*)\}/` regex captured — byte-identical on existing schemas, INCLUDING a
 * `pattern(/o'brien/)` whose lone `'` must stay an ordinary char (skipping to a
 * "matching" quote would swallow the closing brace). A P2 `fn` block is `{ """…""" }`
 * — its plpgsql quotes live inside the triple-quoted region this DOES skip.
 */
/**
 * `findSchemaBlockEnd` for many `{` offsets of ONE text, in amortized linear time
 * (S456, g-tenant-small-residuals-s455 (c): `parseSchemaBlock` re-scanned to the end of
 * the body for EVERY head of an unbalanced block — `"a{"`×40k took ~13 s).
 *
 * Why one scan answers later queries exactly: the scan is a pure function of its
 * position (brace depth aside), so the scan from a `{` that an EARLIER scan visited as an
 * ordinary character (not inside a `"""…"""` region it skipped) is that earlier scan's
 * suffix. Its answer is the `}` that brings the depth back below that `{` — the `}` a
 * stack pairs with it. So a query scans once, from its offset to the END, pairing every
 * `{` it visits (unpaired → -1), and records them all; a later query on a recorded `{`
 * is a lookup. A `{` no earlier scan visited (it sat inside one of their `"""` regions)
 * starts a scan of its own — one per triple-quote alignment, not one per head.
 * Results are identical to `findSchemaBlockEnd` (the S456 unit test asserts it).
 */
function makeSchemaBlockEndFinder(text) {
  const known = new Map();
  const n = text.length;
  return (openIdx) => {
    if (text[openIdx] !== "{") return -1;
    const hit = known.get(openIdx);
    if (hit !== undefined) return hit;
    const open = [];
    let i = openIdx;
    while (i < n) {
      if (text.startsWith('"""', i)) {
        const close = text.indexOf('"""', i + 3);
        i = close === -1 ? n : close + 3;
        continue;
      }
      const ch = text[i];
      if (ch === "{") open.push(i);
      else if (ch === "}" && open.length > 0) known.set(open.pop(), i);
      i++;
    }
    for (const o of open) known.set(o, -1);
    return known.get(openIdx);
  };
}

/**
 * `findMatchingParen` for many `(` offsets of ONE text, in amortized linear time (the
 * `fn` head of `parseSchemaBlock`: `"fn f("`×40k re-scanned to the end per head, ~18 s).
 * Same suffix argument as `makeSchemaBlockEndFinder`, per pass (quote-aware, then
 * quote-blind): a scan records, for each `)` it visits, the paren / bracket depth after
 * it, and for each `(` the depth after it. The scan from a recorded `(` (paren depth `d`
 * after it, bracket depth `b`) returns the first later `)` whose recorded state is
 * (`d - 1`, `b`) — exactly where its own relative depths are both 0.
 */
function makeMatchingParenFinder(text) {
  const passes = [true, false].map((quoteAware) => {
    const known = new Map();     // `(` offset → { scan, d, b }
    const scan = (from) => {
      const closes = new Map();  // "d,b" → increasing `)` offsets
      let depth = 0, bracketDepth = 0, quote = null;
      const rec = { closes };
      for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (quoteAware) {
          if (quote) {
            if (ch === "\\") { i++; continue; }
            if (ch === quote) quote = null;
            continue;
          }
          if (ch === '"' || ch === "'") { quote = ch; continue; }
        }
        if (ch === "(") { depth++; if (!known.has(i)) known.set(i, { rec, d: depth, b: bracketDepth }); }
        else if (ch === ")") {
          depth--;
          const key = depth + "," + bracketDepth;
          let list = closes.get(key);
          if (list === undefined) closes.set(key, (list = []));
          list.push(i);
        } else if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;
      }
    };
    return (openIdx) => {
      if (text[openIdx] !== "(") return -1;
      if (!known.has(openIdx)) scan(openIdx);
      const { rec, d, b } = known.get(openIdx);
      const list = rec.closes.get((d - 1) + "," + b);
      if (list === undefined) return -1;
      let lo = 0, hi = list.length;               // first entry > openIdx
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] > openIdx) hi = mid; else lo = mid + 1; }
      return lo < list.length ? list[lo] : -1;
    };
  });
  return (openIdx) => {
    const hit = passes[0](openIdx);
    return hit !== -1 ? hit : passes[1](openIdx);
  };
}

// The `fn` modifier-run patterns (`parseFnDecl`). Global (`g`) so `makeRangeMatcher` can
// run them over the whole body from an offset; every slice `exec` resets `lastIndex` to 0
// first (a global pattern starts where its last match ended otherwise).
const FN_OWNER_RE = /\bowner\s*\(\s*([A-Za-z_]\w*)\s*\)/g;
const FN_RETURNS_RE = /\breturns\s+([A-Za-z_]\w*)/gi;
const FN_CAP_RE = /\brequires\s+cap\s*\(\s*["']([^"']*)["']\s*\)/gi;
const FN_SECDEF_RE = /\bsecurity\s+definer\b/gi;

/**
 * The first match of a modifier pattern in `text[from, to)` — what `re.exec(text.slice(from,
 * to))` returns, without re-scanning the shared tail for every `fn` head (S456: many
 * malformed heads before one `{` share one modifier run — quadratic). The first match in
 * the WHOLE text at or after `from` is memoized per pattern; `from` only grows, so the
 * scans total linear. Equivalence with the slice: `from` follows a `)` and `to` is a `{`
 * (both non-word, so `\b` reads the same), and a match that starts in range but runs past
 * `to` (only the cap pattern's `[^"']*` can cross a `{`) falls back to the slice.
 */
function makeRangeMatcher(text) {
  const memo = new Map();   // pattern → { lo, m }: m = first match at or after lo (null: none)
  return (re, from, to, slice) => {
    let c = memo.get(re);
    if (c === undefined || from < c.lo || (c.m !== null && c.m.index < from)) {
      re.lastIndex = from;
      c = { lo: from, m: re.exec(text) };
      memo.set(re, c);
    }
    const m = c.m;
    if (m === null || m.index >= to) return null;
    if (m.index + m[0].length > to) { re.lastIndex = 0; const r = re.exec(slice); re.lastIndex = 0; return r; }
    return m;
  };
}

/** `text.indexOf(ch, from)`, memoized for one text: a lookup inside an earlier answered span is O(1). */
function makeNextCharFinder(text, ch) {
  let lo = -1, hi = -1, ans = -1;   // every `from` in [lo, hi] answers `ans`
  return (from) => {
    if (from >= lo && from <= hi && lo !== -1) return ans;
    ans = text.indexOf(ch, from);
    lo = from;
    hi = ans === -1 ? text.length : ans;
    return ans;
  };
}

function findSchemaBlockEnd(text, openIdx) {
  if (text[openIdx] !== "{") return -1;
  const n = text.length;
  let depth = 0;
  let i = openIdx;
  while (i < n) {
    // Triple-quoted plpgsql body — skip the whole `"""…"""` region verbatim.
    if (text.startsWith('"""', i)) {
      const close = text.indexOf('"""', i + 3);
      i = close === -1 ? n : close + 3;
      continue;
    }
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * The ONE recognizer for a raw `CREATE TABLE … (…)` statement.
 *
 * ⚑ IT LIVES HERE, not in protect-analyzer.ts, and that is a fix rather than a
 * preference. protect-analyzer.ts's own line 631 comment says the early PA stage
 * deliberately avoids pulling a codegen module; importing the harvester FROM
 * protect-analyzer into `gauntlet-phase1-checks.js` dragged `bun:sqlite` and
 * `node:fs` into a stage that had been kept free of them — the mirror of the
 * invariant that comment protects. `schema-differ.js` is the `< schema>` parser
 * and imports nothing but `sql-ident.ts`, so BOTH floors and the GCP1 checks can
 * read it without dragging a runtime.
 *
 * ⚑ A QUALIFIED HEAD IN A `< schema>` IS REJECTED (E-SCHEMA-012, SPEC §39.2) —
 * bryan RULED S435 "1 both". History, because the reversal is the point: S405
 * taught this recognizer ONE optional qualifier (`public.assets`) and stripped
 * it, and a `db.public.assets` head then matched NOTHING — so a `< schema>` whose
 * table was spelled with two qualifiers declared no table and left the §14.8.10
 * isolation floor silently inert, with no warning at all once a second table was
 * present (g-tenant-floor-inert-for-a-two-qualifier-create-table). Widening to
 * `n` qualifiers would have collapsed `a.assets` and `b.assets` onto one key,
 * because the qualifier is normalized away for the SQLite shadow DB. The
 * identity model is not decided, so the qualifier — every count, including the
 * one that used to be accepted — is a compile error, and the table head is read
 * STRUCTURALLY (`readCreateTableHead`), so every qualifier count is SEEN rather
 * than a count the pattern did not anticipate falling through to "no table".
 *
 * The harvest below still strips the qualifier (ALL of them) from the stored
 * statement: `resolveDb` REPLAYS these statements into an in-memory SQLite
 * shadow DB with no such namespace, and a rejected program should report the
 * one real error, not an `E-PA-003` / `W-SCHEMA-NO-TABLES-DECLARED` cascade. The
 * harvest is not what makes the qualifier legal — `E-SCHEMA-012` is what makes
 * it illegal.
 */
/**
 * ⚑ THE REGEX MATCHES THE HEAD ONLY. IT DOES NOT MATCH THE COLUMN BODY, AND THAT
 * IS THE WHOLE POINT.
 *
 * The previous shape ended in `\(([^)]+(?:\([^)]*\)[^)]*)*)\)` — a body group
 * good for exactly ONE level of nesting. Every defect this recognizer has had
 * traces to that group. It clips at an inner `)` the moment a column carries a
 * parenthesized type or a `CHECK`, and the clip is silent:
 *   · the stored statement becomes unbalanced, so `resolveDb`'s shadow-DB replay
 *     dies with `E-PA-003: incomplete input` and takes the `< db>` block's whole
 *     type views with it — MEASURED on `VARCHAR(80)`, `NUMERIC(10,2)` and a
 *     `CHECK (…)` first column, and **PRE-EXISTING on origin/main** for the
 *     unqualified spellings (verified by running main's exact regex side by side);
 *   · the column list loses everything after the clip, so a `tenant_id` sitting
 *     behind a `VARCHAR(80)` disappears and the §14.8.10 floor goes inert.
 *
 * The previous round patched that with a `sourceText` re-find, and the patch then
 * COLLIDED with the qualifier normalization landing in the same round: the stored
 * statement said `assets`, the body said `public.assets`, `indexOf` returned -1,
 * and the recovery silently never fired — reproducing the original defect on
 * exactly the Postgres spelling the tier targets.
 *
 * So the body group is DELETED rather than repaired, and with it both sides of
 * that seam. The head reader finds `CREATE … TABLE <name-chain> (`; the balanced,
 * quote- and comment-aware scanner finds the matching `)`. There is no nesting
 * limit left to exceed, no clipped statement to recover from, and no re-find to
 * mis-align.
 *
 * ⚑ THE HEAD ITSELF IS NOW READ, NOT PATTERN-MATCHED (S438). The head regex had
 * the same shape of defect one level up: a slot for "zero or one qualifier", so
 * a THIRD part fell through to no-match and the table silently vanished. The
 * reader below takes the dotted name chain as a LIST of identifier parts (bare,
 * `"…"`, `` `…` ``, `[…]`, `'…'`, with whitespace and comments allowed around
 * each `.`), so the qualifier count is a number it reports, never a shape it can
 * fail to anticipate.
 */
/**
 * ⚑ THE HARVEST IS A SUPERSET OF THE PRE-S438 HARVEST — BY CONSTRUCTION, NOT BY
 * ARGUMENT (S438 fix round, S239 finding F1).
 *
 * The first S438 cut replaced the head regex with a structured reader that also
 * SKIPPED top-level comments. That skip had no string/regex awareness, so a DSL
 * `pattern(/^\/*[a-z0-9-]+$/)` opened a "comment" that swallowed a later
 * `CREATE TABLE assets (…, tenant_id)` from every harvest — a tenant floor the
 * base compiler engaged went silently inert. A security floor may never lose a
 * table to a recognizer change. So the harvest is now TWO READS UNIONED, and the
 * union is the invariant:
 *
 *   1. `LEGACY_CREATE_TABLE_HEAD_RE` — the pre-S438 recognizer, verbatim,
 *      comment-agnostic, ≤1 qualifier. Every table it found is found, with the
 *      statement and body it produced. Base's result per key WINS.
 *   2. `scanCreateTableHeads` — the structured name-chain reader, also
 *      comment-AGNOSTIC (it reads heads wherever they are, as base did). It adds
 *      the tables base could not read (≥2 qualifiers, comments inside the head,
 *      Unicode / `$` names) — keys base did not have.
 *
 * Over-declaring only ADDS floor; under-declaring removes it. Comment awareness
 * is used for exactly one thing: to SUPPRESS a false E-SCHEMA-012 on a head that
 * is genuinely inside a comment or a string (`liveHeadMask`) — never to drop a
 * table from the harvest.
 *
 * The `?{}` walker (`harvestCreateTables`) reads (1) alone — byte-identical to
 * base: E-SCHEMA-012 is `< schema>`-scoped.
 */
const LEGACY_CREATE_TABLE_HEAD_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`'[]?(\w+)["`'\]]?\s*\.\s*)?["`'[]?(\w+)["`'\]]?\s*\(/gi;

/** The pre-S438 scan, verbatim in behaviour. */
function legacyScanCreateTables(text) {
  const found = [];
  if (typeof text !== "string") return found;
  const re = new RegExp(LEGACY_CREATE_TABLE_HEAD_RE.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    const bodyStart = m.index + m[0].length;
    const bodyEnd = findRawDdlBodyEnd(text, bodyStart);
    if (bodyEnd === -1) continue;
    const statementRaw = text.slice(m.index, bodyEnd + 1);
    const statement = m[1]
      ? statementRaw.replace(/(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)["`'[]?\w+["`'\]]?\s*\.\s*/i, "$1")
      : statementRaw;
    found.push({ key: m[2].toLowerCase(), name: m[2], statement, body: text.slice(bodyStart, bodyEnd), offset: m.index, end: bodyEnd + 1 });
    re.lastIndex = bodyEnd + 1;
  }
  return found;
}

/**
 * Where a SQL `--` line comment starting at `i` ends (S456 review F1): the FIRST `\r` or
 * `\n` — Postgres's extent (scan.l `newline [\n\r]`); SQLite and MySQL end it at `\n`
 * only. Every reader here takes the shorter extent, so text after a lone `\r` is read as
 * live SQL; a statement that holds a lone `\r` is also an unmodelled form
 * (`UNMODELED_SQL_FORM`), and the tenant `<schema>` checker charges it, since a `/*`
 * after it can hide text from either database.
 *
 * @param {string} text
 * @param {number} i offset of the `--`
 * @param {number} [to] scan limit
 * @returns {number} offset of the terminator, or `to`
 */
export function sqlLineCommentEnd(text, i, to = text.length) {
  for (let k = i; k < to; k++) if (text[k] === "\n" || text[k] === "\r") return k;
  return to;
}

/** Skip whitespace and SQL `--` / `/* *\/` comments from `i` (inside a head only). */
function skipSqlTrivia(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith("--", i)) {
      const nl = sqlLineCommentEnd(src, i);
      i = nl === src.length ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const close = src.indexOf("*/", i + 2);
      if (close === -1) return i;          // unterminated: not trivia — the head is unreadable
      i = close + 2;
      continue;
    }
    return i;
  }
}

/** An identifier character: any Unicode letter or number, `_`, `$` (SQLite + Postgres). */
const SQL_IDENT_CHAR = /[\p{L}\p{N}_$]/u;
const SQL_IDENT_RUN = /^[\p{L}\p{N}_$]+/u;

/** Case-insensitive keyword at `i`, ending on an identifier boundary. Returns the end index or -1. */
function readSqlKeyword(src, i, word) {
  if (src.slice(i, i + word.length).toUpperCase() !== word) return -1;
  const after = src[i + word.length];
  if (after !== undefined && SQL_IDENT_CHAR.test(after)) return -1;
  return i + word.length;
}

/** A bare word at `i` (letters only) — a candidate table-kind modifier. */
function readSqlWord(src, i) {
  const m = /^[A-Za-z]+/.exec(src.slice(i, i + 64));
  if (!m) return null;
  const after = src[i + m[0].length];
  if (after !== undefined && SQL_IDENT_CHAR.test(after)) return null;
  return m[0];
}

/** The four quoted-identifier spellings the head accepts: opener → closer. */
const SQL_IDENT_QUOTES = { '"': '"', "`": "`", "[": "]", "'": "'" };

/**
 * Read ONE identifier part at `i`: bare (`[\p{L}\p{N}_$]+`), or quoted with any
 * of `SQL_IDENT_QUOTES` (a doubled closer inside is an escaped closer).
 * @returns {{name: string, start: number, end: number} | null}
 */
function readSqlIdentPart(src, i) {
  const open = src[i];
  const close = SQL_IDENT_QUOTES[open];
  if (close) {
    let j = i + 1;
    let name = "";
    while (j < src.length) {
      if (src[j] === close) {
        if (close !== "]" && src[j + 1] === close) { name += close; j += 2; continue; }
        break;
      }
      name += src[j];
      j++;
    }
    if (j >= src.length || name.length === 0) return null;   // unterminated / empty
    return { name, start: i, end: j + 1 };
  }
  const m = SQL_IDENT_RUN.exec(src.slice(i, i + 256));
  if (!m) return null;
  return { name: m[0], start: i, end: i + m[0].length };
}

/**
 * Up to this many ASCII-letter words may sit between `CREATE` and `TABLE` and
 * still be read as a table head.
 */
const MAX_CREATE_TABLE_MODIFIERS = 3;

/**
 * The documented SQLite + Postgres table-kind modifier words
 * (`TEMP` / `TEMPORARY`, `GLOBAL` / `LOCAL TEMPORARY`, `UNLOGGED`, `VIRTUAL`,
 * `FOREIGN`, `OR REPLACE`). A head whose modifier run is drawn ONLY from this set
 * is a KNOWN-KIND head: every rule applies to it, including E-SCHEMA-013 when its
 * name cannot be read. A head with any other word in that position (prose such as
 * `create the table for tenants`) is still read, and still rejected with
 * E-SCHEMA-012 if it parses as a QUALIFIED name — but it is not held to
 * readability, because "a sentence that happens to contain create … table" is not
 * evidence of a declaration the compiler failed to read. Neither kind is harvested
 * (pre-S438 never harvested a modified head).
 */
const CREATE_TABLE_MODIFIER_WORDS = new Set([
  "TEMP", "TEMPORARY", "GLOBAL", "LOCAL", "UNLOGGED", "VIRTUAL", "FOREIGN", "OR", "REPLACE",
]);

/**
 * The token that may FOLLOW a table's name in a `CREATE TABLE` head (SQLite +
 * Postgres grammar): the column list `(`, or one of the clause keywords
 * `AS` (CREATE TABLE … AS query), `USING` (virtual-table module / access method),
 * `WITH` (storage parameters), `ON` (ON COMMIT), `TABLESPACE`, `PARTITION` — ONLY
 * as `PARTITION OF parent` (checked at the use site) — `OF` (typed table `OF
 * type`), `INHERITS`. A name followed by anything else was not read as a name
 * (E-SCHEMA-013). A readable head with no column list declares no columns, so in a
 * `< schema>` it is rejected as E-SCHEMA-014 (S446; was gap
 * g-schema-no-column-list-heads-declare-nothing).
 */
const CREATE_TABLE_NAME_FOLLOWERS = ["AS", "USING", "WITH", "ON", "TABLESPACE", "PARTITION", "OF", "INHERITS"];

/**
 * Read a `CREATE [word…] TABLE [IF NOT EXISTS] <part>[.<part>]*` head whose
 * `CREATE` starts at `i`. Returns null ONLY when the text is not a
 * `CREATE … TABLE` keyword pair at all. Once `CREATE … TABLE` is read, it ALWAYS
 * returns a head — `readable: false` when the name chain cannot be read through
 * to `(` or a `CREATE_TABLE_NAME_FOLLOWERS` keyword; `knownKind: false` when the
 * modifier run holds a word outside `CREATE_TABLE_MODIFIER_WORDS`.
 */
function readCreateTableHead(src, i) {
  // `CREATE` must START a word too (S438 round 3, F-C): `precreate table …` and
  // `xCREATE TABLE …` are not heads for the reader. The boundary is a preceding
  // letter / digit / `_` ONLY — NOT `$` (round 4, F1): `$$CREATE TABLE …$$` and
  // `$f$CREATE TABLE …$f$` are dollar-quote delimiters directly before a real
  // head, and round 3's `$`-inclusive guard hid them from BOTH E-SCHEMA-012 and
  // the structured harvest leg. ⚑ This guard DOES apply to the harvest's
  // structured (extra-keys) leg; the pre-S438 leg, which has no boundary, still
  // reads everything base read — so the ⊇-base guarantee is unaffected, but an
  // extra key before a word character is not read.
  if (i > 0 && /[\p{L}\p{N}_]/u.test(src[i - 1])) return null;
  let j = readSqlKeyword(src, i, "CREATE");
  if (j === -1) return null;
  j = skipSqlTrivia(src, j);
  const modifiers = [];
  let afterTable = readSqlKeyword(src, j, "TABLE");
  while (afterTable === -1) {
    if (modifiers.length >= MAX_CREATE_TABLE_MODIFIERS) return null;
    const w = readSqlWord(src, j);
    if (!w) return null;
    modifiers.push(w.toUpperCase());
    j = skipSqlTrivia(src, j + w.length);
    afterTable = readSqlKeyword(src, j, "TABLE");
  }
  j = skipSqlTrivia(src, afterTable);
  // Optional IF NOT EXISTS — only consumed when all three words are present, so a
  // table genuinely named `if` still reads as its name.
  {
    const a = readSqlKeyword(src, j, "IF");
    if (a !== -1) {
      const b = readSqlKeyword(src, skipSqlTrivia(src, a), "NOT");
      if (b !== -1) {
        const c = readSqlKeyword(src, skipSqlTrivia(src, b), "EXISTS");
        if (c !== -1) j = skipSqlTrivia(src, c);
      }
    }
  }
  const parts = [];
  let danglingDot = false;
  let k = j;
  const first = readSqlIdentPart(src, j);
  if (first) {
    parts.push(first);
    k = skipSqlTrivia(src, first.end);
    while (src[k] === ".") {
      const p = readSqlIdentPart(src, skipSqlTrivia(src, k + 1));
      if (!p) { danglingDot = true; k = skipSqlTrivia(src, k + 1); break; }
      parts.push(p);
      k = skipSqlTrivia(src, p.end);
    }
  }
  const parenAt = parts.length > 0 && !danglingDot && src[k] === "(" ? k : -1;
  const readable = parts.length > 0 && !danglingDot &&
    (parenAt !== -1 || CREATE_TABLE_NAME_FOLLOWERS.some((w) => {
      const e = readSqlKeyword(src, k, w);
      if (e === -1) return false;
      // `PARTITION` is a follower only as `PARTITION OF` (round 4, F3) — the
      // E-SCHEMA-013 message names `PARTITION OF`, and the code must agree.
      return w !== "PARTITION" || readSqlKeyword(src, skipSqlTrivia(src, e), "OF") !== -1;
    }));
  const knownKind = modifiers.every((w) => CREATE_TABLE_MODIFIER_WORDS.has(w));
  return { start: i, modifiers, parts, danglingDot, readable, knownKind, headEnd: k, parenAt };
}

/**
 * Every `CREATE … TABLE` head in `text`, in source order, with the index of its
 * column list's closing `)` (or -1). COMMENT-AGNOSTIC, like the pre-S438 regex:
 * a head is read wherever it is (see the superset note above). A column body is
 * resumed PAST, so a nested `(` inside it is never read as another table; a head
 * with no body advances ONE character, so nothing after it can be skipped.
 */
function scanCreateTableHeads(text) {
  const heads = [];
  if (typeof text !== "string") return heads;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "C" || c === "c") {
      const head = readCreateTableHead(text, i);
      if (head) {
        const bodyEnd = head.parenAt === -1 ? -1 : findRawDdlBodyEnd(text, head.parenAt + 1);
        heads.push({ ...head, bodyEnd });
        i = bodyEnd !== -1 ? bodyEnd + 1 : i + 1;
        continue;
      }
    }
    i++;
  }
  return heads;
}

/**
 * Structured records: one per readable head with a complete column list — the
 * table name (the LAST part of the chain), its qualifiers, the statement with
 * every qualifier stripped (the SQLite shadow DB has no namespace), the body.
 */
function structuredScanCreateTables(text) {
  const found = [];
  for (const h of scanCreateTableHeads(text)) {
    if (h.parenAt === -1 || h.bodyEnd === -1) continue;
    const namePart = h.parts[h.parts.length - 1];
    const statement = text.slice(h.start, h.parts[0].start) + text.slice(namePart.start, h.bodyEnd + 1);
    found.push({
      key: namePart.name.toLowerCase(),
      name: namePart.name,
      qualifiers: h.parts.slice(0, -1).map((p) => p.name),
      modifiers: h.modifiers,
      statement,
      body: text.slice(h.parenAt + 1, h.bodyEnd),
      offset: h.start,
      end: h.bodyEnd + 1,
    });
  }
  return found;
}

/**
 * Where, in a `< schema>` body, is text genuinely a comment or a string/regex
 * literal? Reuses `blankLiteralBodies` (the E-SCHEMA-011 blanker) in its
 * comment-aware mode, so strings, `pattern(/…/)` regexes and `--` / `/* *\/`
 * comments are resolved in ONE left-to-right pass — a `/*` inside a regex or a
 * string is inert, and a `'` inside a comment is inert. A head is LIVE when its
 * `CREATE` survives the blanking.
 *
 * Used ONLY to suppress E-SCHEMA-012 / E-SCHEMA-013 on a dead head. It never
 * touches the harvest.
 */
function isLiveHead(masked, h) {
  return masked.slice(h.start, h.start + 6).toUpperCase() === "CREATE";
}

/**
 * The rejected `CREATE … TABLE` heads of a `< schema>` body (SPEC §39.2) — every
 * LIVE head that either
 *   · names a schema/database QUALIFIER, at ANY count (`public.assets`,
 *     `db.public.assets`, `temp.assets`, a dangling `public.`) — kind "qualified",
 *     E-SCHEMA-012 (bryan RULED S435); or
 *   · is a KNOWN-KIND head (`knownKind`) whose name cannot be read through to
 *     `(` or a `CREATE_TABLE_NAME_FOLLOWERS` keyword (a stray character, an empty
 *     `""`, a fullwidth dot, an unterminated comment) — kind "unreadable",
 *     E-SCHEMA-013. Fail-closed: such a head is an error, never "not a head".
 *
 *   · is readable and unqualified but NOT a plain table declaration — a
 *     table-kind modifier, no column list, an unclosed column list, or a trailing
 *     `INHERITS` — kind "not-a-declaration", E-SCHEMA-014 (bryan RULED S440 #15);
 *     see `notADeclarationReason`.
 *
 * @param {string} text a `< schema>` body
 * @returns {Array<{kind: "qualified"|"unreadable"|"not-a-declaration", reason?: string, name: string|null, qualifiers: string[], headText: string, offset: number}>}
 */
export function findRejectedCreateTableHeads(text) {
  const out = [];
  if (typeof text !== "string") return out;
  const masked = blankLiteralBodies(text, { comments: true, backtick: false });
  // ⚑ NO SECURITY-DEFINER `fn`-BODY EXEMPTION (S438 final round). Round 4 exempted
  // the whole span of every `fn` the `< schema>` parser saw — but that scan sees
  // `fn NAME(…) owner(…)` inside `--` / `/* */` comments, strings, and without a
  // brace, so a COMMENTED `-- fn f() owner(r) {` … `-- }` wrapped a live
  // qualified/unreadable head and silenced E-SCHEMA-012/013 at exit 0. Removed,
  // fail-closed: a qualified/unreadable head inside a real `fn` `"""` body is now
  // reported — the documented false positive, gap
  // g-secdef-fn-body-ddl-false-positive (which records the repair).
  //
  // E-SCHEMA-014 ALONE takes that recorded repair, narrowly (S446), and ONLY for a
  // TEMP / TEMPORARY head (fix round): a `CREATE TEMP TABLE staging … AS SELECT …`
  // inside a SECURITY-DEFINER `fn` body is ordinary runtime plpgsql, and rejecting
  // it would refuse a valid schema.
  // The span exempted is ONLY the `"""…"""` body of a `fn` the `< schema>` parser
  // itself ACCEPTED (`parseFnDecl` — owner(), balanced block) whose `fn` keyword
  // is LIVE (not in a `--` / `/* */` comment or a string) and starts a word. A
  // commented `-- fn f() owner(r) {` forges nothing (the S438 escape), and a head
  // outside the `"""` pair — in the modifier run of a braceless `fn`, or beside
  // the body inside its braces — is still reported. An escape here can only
  // return a head to its pre-S446 behaviour: neither harvest reads a modified or
  // column-list-less head, so no floor is lost relative to base. E-SCHEMA-012 /
  // E-SCHEMA-013 are deliberately NOT exempted (unchanged).
  let secdefSpans = null;
  const inLiveSecdefBody = (at) => {
    if (secdefSpans === null) {
      let spans = [];
      try { spans = parseSchemaBlock(text).fnBodySpans ?? []; } catch { spans = []; }
      secdefSpans = spans.filter((s) =>
        masked.slice(s.fnAt, s.fnAt + 2) === "fn" &&
        (s.fnAt === 0 || !/[\p{L}\p{N}_$]/u.test(text[s.fnAt - 1])));
    }
    return secdefSpans.some((s) => at > s.start && at < s.end);
  };
  for (const h of scanCreateTableHeads(text)) {
    if (!isLiveHead(masked, h)) continue;
    // An unknown modifier word (prose: `create the table for tenants`) counts as a
    // head only if the rest PARSES as one — a readable name chain followed by `(`
    // or a clause keyword. Then it is held to every rule; otherwise it is prose.
    if (!h.knownKind && !h.readable) continue;
    const chain = h.parts.map((p) => text.slice(p.start, p.end)).join(".") + (h.danglingDot ? "." : "");
    const headText = ["CREATE", ...h.modifiers, "TABLE"].join(" ") + (chain ? " " + chain : "");
    if (h.parts.length >= 2 || h.danglingDot) {
      const qualParts = h.danglingDot ? h.parts : h.parts.slice(0, -1);
      out.push({
        kind: "qualified",
        name: h.danglingDot ? null : h.parts[h.parts.length - 1].name,
        qualifiers: qualParts.map((p) => p.name),
        headText,
        offset: h.start,
      });
    } else if (!h.readable) {
      const tail = text.slice(h.headEnd, h.headEnd + 12).split("\n")[0];
      out.push({
        kind: "unreadable",
        name: h.parts.length ? h.parts[0].name : null,
        qualifiers: [],
        headText: headText + (tail ? ` ⟨${tail}⟩` : ""),
        offset: h.start,
      });
    } else {
      // E-SCHEMA-014 (S446, bryan RULED S440 #15 "fix in TS, fail closed") — a
      // readable, unqualified head that is NOT a plain table declaration. Each of
      // these compiled clean and declared NO columns to the §14.8.9 / §14.8.10
      // floors (neither harvest reads a modified head or a head with no column
      // list), so a `tenant_id` table spelled this way was silently not
      // tenant-scoped — beside a second table, with no diagnostic at all.
      const reason = notADeclarationReason(text, h);
      // S446 fix round: the fn-body exemption covers a TEMP / TEMPORARY staging
      // table ONLY — `UNLOGGED`, `GLOBAL TEMPORARY`, a non-temp `AS SELECT` /
      // `PARTITION OF` … inside a fn body are still reported.
      const tempOnly = h.modifiers.length > 0 && h.modifiers.every((w) => w === "TEMP" || w === "TEMPORARY");
      if (reason && !(tempOnly && inLiveSecdefBody(h.start))) {
        out.push({
          kind: "not-a-declaration",
          reason,
          name: h.parts[0].name,
          qualifiers: [],
          headText,
          offset: h.start,
        });
      }
    }
  }
  return out;
}

/**
 * Why a readable, unqualified `CREATE … TABLE` head is not a plain table
 * declaration (E-SCHEMA-014), or null when it is one. The ONLY accepted shape is
 * `CREATE TABLE [IF NOT EXISTS] <name> ( <column list> ) [<trailing clauses>]`:
 *   · "modifier"   — any word between `CREATE` and `TABLE` (`TEMP`, `TEMPORARY`,
 *                    `GLOBAL`/`LOCAL TEMPORARY`, `UNLOGGED`, `VIRTUAL`, …). Neither
 *                    harvest has ever read a modified head (gap
 *                    g-schema-create-temp-table-silently-not-a-declaration), and a
 *                    session-scoped / non-durable table has no schema-as-code meaning.
 *   · "no-columns" — the name is followed by a clause keyword instead of a column
 *                    list (`AS query`, `OF type`, `PARTITION OF parent`, `USING`,
 *                    `WITH`, `ON COMMIT`, `TABLESPACE`, `INHERITS`): the columns
 *                    live elsewhere and the floors cannot see them (gap
 *                    g-schema-no-column-list-heads-declare-nothing).
 *   · "unclosed"   — the column list `(` is never closed, so nothing is read.
 *   · "inherits"   — a column list followed by `INHERITS (parent)`: the parent's
 *                    columns (a `tenant_id`) are not declared on this table.
 * Not a recognizer change: the head itself is read by the same `readCreateTableHead`
 * every other `< schema>` check uses; this only refuses what that read reports.
 */
function notADeclarationReason(text, h) {
  if (h.modifiers.length > 0) return "modifier";
  if (h.parenAt === -1) return "no-columns";
  if (h.bodyEnd === -1) return "unclosed";
  if (readSqlKeyword(text, skipSqlTrivia(text, h.bodyEnd + 1), "INHERITS") !== -1) return "inherits";
  if (findLikeTemplateReference(text.slice(h.parenAt + 1, h.bodyEnd)) !== null) return "like";
  return null;
}

/**
 * A `LIKE <template>` item inside a CREATE TABLE column list (bryan RULED S447
 * "stamp all" (ii), gap g-schema-create-table-like-template-columns-not-declared).
 * `CREATE TABLE assets (LIKE tmpl INCLUDING ALL)` copies `tmpl`'s columns — a
 * `tenant_id` among them — in Postgres, but the floors read no column from it, so
 * the table was silently not tenant-scoped. The item is a TEMPLATE REFERENCE when
 * an unquoted `LIKE` is followed by ONE name chain (bare / quoted parts, `.`-joined)
 * and then `INCLUDING` | `EXCLUDING` | the end of the item (the `,` or `)` that
 * closes it). A column NAMED `like` keeps working when it is quoted (`"like" TEXT`)
 * or when its type is followed by anything other than the end of the item
 * (`like TEXT NOT NULL`, `like VARCHAR(50)`); a bare `like TEXT` is the same token
 * shape as `LIKE tmpl` and is, by the ruling, the template reference (base already
 * read it as one: `isTableLevelConstraint` skipped it, so no column was declared).
 *
 * @param {string} body the text between a column list's `(` and its closing `)`
 * @returns {string|null} the item text, or null when the list has none
 */
const LIKE_TEMPLATE_ITEM_RE = new RegExp(
  "^LIKE\\s+" +
  "(?:[\\p{L}\\p{N}_$]+|\"[^\"]*\"|`[^`]*`|\\[[^\\]]*\\])" +
  "(?:\\s*\\.\\s*(?:[\\p{L}\\p{N}_$]+|\"[^\"]*\"|`[^`]*`|\\[[^\\]]*\\]))*" +
  "\\s*(?:$|(?:INCLUDING|EXCLUDING)(?![\\p{L}\\p{N}_$]))",
  "iu",
);
function findLikeTemplateReference(body) {
  for (const item of splitTopLevelCommas(body)) {
    const trimmed = item.trim();
    if (LIKE_TEMPLATE_ITEM_RE.test(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Harvest every `CREATE TABLE … (…)` in `text` into `out`, keyed by the
 * LOWERCASED unqualified table name — the `?{}` SQL-node walker's harvest.
 *
 * ⚑ BYTE-IDENTICAL TO PRE-S438: the legacy read alone. E-SCHEMA-012 is scoped to
 * `< schema>`; a `?{}` CREATE TABLE is runtime SQL against a real database.
 *
 * @param {string} text
 * @param {Map<string,string>} out
 * @param {boolean} overwrite `true` = a later statement replaces an earlier one
 *   (the `?{}` walker's long-standing behaviour); `false` = first wins.
 */
export function harvestCreateTables(text, out, overwrite) {
  harvestInto(legacyScanCreateTables(text), out, overwrite);
}

function harvestInto(records, out, overwrite) {
  for (const t of records) {
    if (!overwrite && out.has(t.key)) continue;
    out.set(t.key, t.statement);
  }
}

/**
 * The `< schema>` harvest set — legacy ∪ structured, legacy winning per key (see
 * the superset note above). The structured side contributes only keys the legacy
 * side does not have, and only unmodified heads (`TEMP` / `UNLOGGED` / … were
 * never harvested; since S446 such a head is rejected as E-SCHEMA-014 instead of
 * silently declaring nothing — was g-schema-create-temp-table-silently-not-a-declaration). A
 * qualified head is harvested, qualifiers stripped, although E-SCHEMA-012 rejects
 * the program: the rejected program reports that one error rather than a cascade,
 * and the tenant floor stays ENGAGED on the table.
 *
 * ⚑ SCOPE OF THE ⊇-BASE GUARANTEE: it holds PER BODY. Across `< schema>` bodies,
 * the consumers merge first-raw-wins by key (`extractDesiredSchema`,
 * codegen/db-authoritative.ts — the raw-DDL pass; and
 * `extractSchemaCreateTableStatements`, protect-analyzer.ts — its
 * `harvestRawCreateTables(body, result)` call), so an EXTRA key read from an
 * earlier body could pre-empt a base key from a later body. That cross-body case
 * is only reachable in a program with more than one `< schema>` or a misplaced
 * one — which E-SCHEMA-002 / E-SCHEMA-003 already reject — so the guarantee for
 * a program that compiles rests on those two codes.
 */
function schemaCreateTables(text) {
  const legacy = legacyScanCreateTables(text);
  const seen = new Set(legacy.map((t) => t.key));
  const extra = [];
  for (const t of structuredScanCreateTables(text)) {
    if (t.modifiers.length !== 0 || seen.has(t.key)) continue;
    seen.add(t.key);
    extra.push(t);
  }
  return [...legacy, ...extra];
}

/**
 * Harvest the raw-DDL `< schema>` form as TABLE DECLARATIONS — name + column
 * names — reading each body from the original text.
 *
 * This is what `extractDesiredSchema` consumes. It deliberately does NOT go
 * through the statement map and back: a round trip through a stored string is
 * what created the normalize-vs-re-find seam.
 *
 * @returns {Array<{name: string, columns: Array<{name: string, type: string, scrmlType: string}>}>}
 */
export function harvestRawCreateTableDecls(text) {
  return schemaCreateTables(text).map((t) => ({
    name: t.name,
    columns: columnsFromDdlBody(t.body),
  }));
}

/**
 * First-wins harvest of the raw-DDL `< schema>` form (g-schema-block-raw-ddl).
 *
 * THE ONE RECOGNIZER, shared by both security floors. The defect this exists to
 * prevent is precisely that TWO adjacent floors disagreed about what counts as a
 * schema declaration: §14.8.9 was taught the raw-DDL form and §14.8.10 was not,
 * so a raw-DDL + no-`< db>` app got a silently INERT tenant floor at exit 0.
 * See `parseRawCreateTableColumns` below for the column read.
 */
export function harvestRawCreateTables(text, out) {
  harvestInto(schemaCreateTables(text), out, false);
}

/**
 * EVERY raw `CREATE TABLE … (…)` statement in a `< schema>` body — the legacy read
 * UNION the structured read, de-duplicated by SOURCE SPAN, not by key (S450 fix
 * round, S239 F1). `schemaCreateTables` drops a structured hit whose KEY the
 * legacy read already has — right for first-wins, wrong for an all-declarations
 * list: a live head with a comment inside it (`CREATE TABLE assets /* live *\/ (…)`,
 * `CREATE /*x*\/ TABLE …`, `assets -- v2⏎(…)`) is read ONLY by the structured
 * reader, so keying it away hid the live table behind a same-name commented copy
 * and turned the tenant floor OFF at exit 0. A structured hit is the same
 * statement as a legacy one only when it starts inside that legacy statement's
 * raw source span. Modified heads stay out (neither harvest reads them; E-SCHEMA-014).
 * Used ONLY by `schemaTableDeclarations`; the harvest and first-wins are untouched.
 */
function allSchemaCreateTableDecls(text) {
  const legacy = legacyScanCreateTables(text);
  const spans = legacy.map((t) => [t.offset, t.end]);
  const extra = [];
  for (const t of structuredScanCreateTables(text)) {
    if (t.modifiers.length !== 0) continue;
    if (spans.some(([a, b]) => t.offset >= a && t.offset < b)) continue;
    extra.push(t);
  }
  return [...legacy, ...extra];
}

/**
 * `ALTER TABLE` statements in a `< schema>` body that give a table a `tenant_id`
 * column (§14.8.10, S455 — gap g-tenant-floor-alter-add-tenant-column-not-scoped-s455).
 *
 * SPEC §14.8.10: *"A table whose `< schema>` carries a `tenant_id` column IS
 * tenant-scoped; the column's presence is the declaration."* A schema that says
 * `CREATE TABLE notes (id …, body …)` and then `ALTER TABLE notes ADD COLUMN
 * tenant_id TEXT` carries one. Until S455 only CREATE TABLE column lists and DSL
 * heads were read, so `notes` was NOT scoped — its reads served every tenant's rows
 * (executed) and a view over it passed the E-TENANT-SCHEMA-HAZARD checker.
 *
 * FAIL-CLOSED READING (deliberately wide, like every recognizer here — over-
 * declaring only ADDS floor): an `ALTER TABLE [IF EXISTS] [ONLY] <name>` statement
 * whose text names `tenant_id` as a whole word ANYWHERE — `ADD [COLUMN] tenant_id`,
 * `RENAME [COLUMN] x TO tenant_id`, MySQL `CHANGE … tenant_id`, several actions in
 * one statement, a quoted `"tenant_id"`, and also a comment, a string or a `DROP
 * COLUMN tenant_id` — makes `<name>` tenant-scoped. Strings and comments are NOT
 * skipped because skipping them is where a reader goes wrong (a `;` or `'` inside a
 * comment, dialect comment rules); the cost of a false read is a tenant-scoped table
 * with no `tenant_id` column, whose reads then fail at run time (closed, visible),
 * never a leak. The statement runs to the next `ALTER TABLE` head or `?{` / `` `} ``
 * wrapper edge found outside the quote / comment forms the reader models — NOT to a
 * `;`, a `CREATE` or a brace, any of which can sit inside a string, an identifier or a
 * comment. When the statement holds a form the reader does NOT model exactly (SQLite
 * `[ident]`, Postgres `$$…$$` / `E'…\'…'`, a MySQL `\'` escape or `#` comment, a
 * backtick, a `${…}`), it is read to its wrapper edge instead (S455 review F1: a
 * `CREATE` inside `[org create]` cut the statement short and left `notes` unscoped —
 * executed). COMMENT-AGNOSTIC like
 * the CREATE reads: a commented-out ALTER counts (`commented` records it).
 * `ALTER TABLE ONLY <x>` is read both ways (a table may be NAMED `only`).
 *
 * @param {string} text a `< schema>` body
 * @param {string} masked `blankLiteralBodies(text, { comments: true, backtick: false })`
 * @returns {Array<{name: string, key: string, form: "alter", offset: number, tenant: true, commented: boolean, columns: Array<{name: string}>}>}
 */
function alterTableTenantDecls(text, masked) {
  const out = [];
  if (typeof text !== "string" || !/\balter\b/i.test(text)) return out;
  const re = /alter/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const i = m.index;
    if (i > 0 && SQL_IDENT_CHAR.test(text[i - 1])) continue;
    const afterAlter = readSqlKeyword(text, i, "ALTER");
    if (afterAlter === -1) continue;
    const afterTable = readSqlKeyword(text, skipSqlTrivia(text, afterAlter), "TABLE");
    if (afterTable === -1) continue;
    let j = skipSqlTrivia(text, afterTable);
    {
      const a = readSqlKeyword(text, j, "IF");
      if (a !== -1) {
        const b = readSqlKeyword(text, skipSqlTrivia(text, a), "EXISTS");
        if (b !== -1) j = skipSqlTrivia(text, b);
      }
    }
    // The name chain at `at`: its last part, and where the chain ends.
    const readChain = (at) => {
      const first = readSqlIdentPart(text, at);
      if (!first) return null;
      let last = first;
      let k = skipSqlTrivia(text, first.end);
      while (text[k] === ".") {
        const p = readSqlIdentPart(text, skipSqlTrivia(text, k + 1));
        if (!p) break;
        last = p;
        k = skipSqlTrivia(text, p.end);
      }
      return { name: last.name, end: last.end };
    };
    const names = [];
    const direct = readChain(j);
    if (direct) names.push(direct);
    const afterOnly = readSqlKeyword(text, j, "ONLY");
    if (afterOnly !== -1) {
      const viaOnly = readChain(skipSqlTrivia(text, afterOnly));
      if (viaOnly) names.push(viaOnly);
    }
    if (names.length === 0) continue;
    const from = Math.max(...names.map((n) => n.end));
    // The statement as modelled; when it holds a quote / comment form the reader does not
    // model exactly, the statement is read to its wrapper edge instead (fail-closed).
    let stop = alterStatementEnd(text, from);
    if (UNMODELED_SQL_FORM.test(text.slice(i, stop))) stop = Math.max(stop, sqlWrapperEdge(text, from));
    const stmt = text.slice(from, stop);
    if (!namesTenantId(stmt)) continue;
    const commented = masked.slice(i, i + 5).toUpperCase() !== "ALTER";
    for (const n of names) {
      out.push({ name: n.name, key: n.name.toLowerCase(), form: "alter", offset: i, tenant: true, commented, columns: [{ name: "tenant_id" }] });
    }
  }
  return out;
}

/**
 * A quote or comment form the tenant readers here do not model exactly — SQLite
 * `[ident]`, Postgres `$tag$…$tag$` / `E'…'` (its `\'` escape), a MySQL `\` escape or
 * `#` comment, a backtick identifier, a `${…}` interpolation. A statement holding one
 * is read to its wrapper edge (`sqlWrapperEdge`), never to a modelled stop that the
 * form may have hidden or faked (S455 review F1).
 */
const UNMODELED_SQL_FORM = /[[$\\#`]|\r(?!\n)/;   // S456 F1: a lone `\r` (a `--` comment's extent differs by database)

/** Whether `s` names `tenant_id` as a whole word (anywhere — literals and comments included). */
function namesTenantId(s) {
  return /(?:^|[^\p{L}\p{N}_$])tenant_id(?![\p{L}\p{N}_$])/iu.test(s);
}

/**
 * The end of the `?{ … }` wrapper text from `from` lies in: the next `` `} `` close or
 * `?{` open, or the end of the body. Inside a template literal a backtick cannot occur
 * unescaped, so `` `} `` is the wrapper's own close.
 */
function sqlWrapperEdge(text, from) {
  for (let k = from; k < text.length; k++) {
    if (text[k] === "?" && text[k + 1] === "{") return k;
    if (text[k] === "`" && /^`\s*\}/.test(text.slice(k, k + 64))) return k;
  }
  return text.length;
}

/**
 * Where an `ALTER TABLE` statement read from `from` ends as MODELLED (see
 * `alterTableTenantDecls`): at the next `ALTER TABLE` head or `?{` / `` `} `` wrapper
 * edge found outside `'…'` / `"…"` literals and `--` / `/* *\/` comments (nesting model).
 * Not at a `CREATE`, a brace or a `;` — each can sit inside an identifier, a string or a
 * comment form this reader does not model (S455 review F1: `[org create]`). The caller
 * reads to the wrapper edge instead when the statement holds an unmodelled form
 * (`UNMODELED_SQL_FORM`), so a stop this function finds inside such a form cannot cut
 * the statement short. `ALTER COLUMN` (an action of this same statement) is not a stop.
 */
function alterStatementEnd(text, from) {
  for (let k = from; k < text.length; k++) {
    const c = text[k];
    if (c === "'" || c === '"') {
      let j = k + 1;
      while (j < text.length && !(text[j] === c && text[j + 1] !== c)) j += text[j] === c ? 2 : 1;
      k = j;
      continue;
    }
    if (c === "-" && text[k + 1] === "-") {
      k = sqlLineCommentEnd(text, k);
      continue;
    }
    if (c === "/" && text[k + 1] === "*") {
      let depth = 1;
      let j = k + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === "/" && text[j + 1] === "*") { depth++; j += 2; continue; }
        if (text[j] === "*" && text[j + 1] === "/") { depth--; j += 2; continue; }
        j++;
      }
      k = j - 1;
      continue;
    }
    if (c === "?" && text[k + 1] === "{") return k;
    if (c === "`" && /^`\s*\}/.test(text.slice(k, k + 64))) return k;
    if ((c === "a" || c === "A") && !SQL_IDENT_CHAR.test(text[k - 1] ?? " ")) {
      const afterAlter = readSqlKeyword(text, k, "ALTER");
      if (afterAlter !== -1 && readSqlKeyword(text, skipSqlTrivia(text, afterAlter), "TABLE") !== -1) return k;
    }
  }
  return text.length;
}

/**
 * EVERY table declaration in one `< schema>` body that the §14.8.10 tenant floor
 * reads — duplicates INCLUDED, in source order — with whether it carries a
 * `tenant_id` column. The two forms are read by the same recognizers the floor
 * uses: `parseSchemaBlock` for the DSL (`name { … }`) and the raw reads
 * (`allSchemaCreateTableDecls` — legacy ∪ structured, de-duplicated by span) for `CREATE TABLE … (…)`,
 * minus a raw declaration with no readable column (which `extractDesiredSchema`
 * skips too). Both recognizers are COMMENT-AGNOSTIC (the ⊇-base guarantee above),
 * so a commented-out copy is a declaration here exactly as it is to the floor;
 * `commented` records that it sits inside a `--` / closed `/* *\/` comment or a
 * one-line literal, for the E-SCHEMA-015 message only. An `ALTER TABLE` that names
 * `tenant_id` (`alterTableTenantDecls`, S455) is a third form, `"alter"`: it adds
 * `tenant_id` to every declaration of its table in the body and is listed itself.
 *
 * @param {string} text a `< schema>` body
 * @returns {Array<{name: string, key: string, form: "declarative"|"raw"|"alter", offset: number, tenant: boolean, commented: boolean, columns: Array<{name: string}>}>}
 */
export function schemaTableDeclarations(text) {
  const out = [];
  if (typeof text !== "string" || text.length === 0) return out;
  const masked = blankLiteralBodies(text, { comments: true, backtick: false });
  const carriesTenant = (cols) =>
    cols.some((c) => typeof c?.name === "string" && c.name.toLowerCase() === "tenant_id");
  let parsed = { tables: [], tableOffsets: [] };
  try { parsed = parseSchemaBlock(text); } catch { /* graceful — no DSL tables */ }
  (parsed.tables ?? []).forEach((t, k) => {
    if (!t || typeof t.name !== "string") return;
    const offset = parsed.tableOffsets?.[k] ?? -1;
    const columns = Array.isArray(t.columns) ? t.columns : [];
    out.push({
      name: t.name,
      key: t.name.toLowerCase(),
      form: "declarative",
      offset,
      tenant: carriesTenant(columns),
      commented: offset >= 0 && masked.slice(offset, offset + t.name.length) !== t.name,
      columns,
    });
  });
  for (const t of allSchemaCreateTableDecls(text)) {
    let columns = columnsFromDdlBody(t.body);
    if (columns.length === 0) continue;
    // S455 review F1 — the column-list read models `'…'` / `"…"` / backtick literals and
    // `--` / `/* */` comments only. A statement holding a form it does not model
    // (`$$)$$`, `[ident]`, an `E'\''` / MySQL `\'` escape, `#`) may have closed the list
    // early and dropped a `tenant_id` after it: the statement is then read to its wrapper
    // edge, and naming `tenant_id` anywhere there scopes the table (fail-closed).
    if (!carriesTenant(columns) && typeof t.end === "number") {
      const own = text.slice(t.offset, t.end);
      if (UNMODELED_SQL_FORM.test(own) && namesTenantId(text.slice(t.offset, Math.max(t.end, sqlWrapperEdge(text, t.offset))))) {
        columns = [...columns, { name: "tenant_id" }];
      }
    }
    out.push({
      name: t.name,
      key: t.key,
      form: "raw",
      offset: t.offset,
      tenant: carriesTenant(columns),
      commented: masked.slice(t.offset, t.offset + 6).toUpperCase() !== "CREATE",
      columns,
    });
  }
  // …and a head whose column list never closes as modelled (`DEFAULT $$($$`) is no
  // declaration to the readers above at all: when its statement names `tenant_id`, it
  // declares a tenant-scoped table here.
  for (const h of scanCreateTableHeads(text)) {
    if (h.parenAt === -1 || h.bodyEnd !== -1 || h.modifiers.length !== 0 || h.parts.length === 0) continue;
    if (!namesTenantId(text.slice(h.parenAt, sqlWrapperEdge(text, h.parenAt)))) continue;
    const name = h.parts[h.parts.length - 1].name;
    out.push({
      name,
      key: name.toLowerCase(),
      form: "raw",
      offset: h.start,
      tenant: true,
      commented: masked.slice(h.start, h.start + 6).toUpperCase() !== "CREATE",
      columns: [{ name: "tenant_id" }],
    });
  }
  // S455 — an `ALTER TABLE <t> … tenant_id …` gives `<t>` the column: every
  // declaration of `<t>` in this body then carries it (so the floor's union, the
  // E-TENANT-SCHEMA-HAZARD set and E-SCHEMA-015 move together — a CREATE without
  // `tenant_id` plus the ALTER that adds it AGREE, they do not disagree), and the
  // ALTER is itself a declaration of `<t>` (for a `<t>` created in another body or
  // file — the compilation set unions it).
  for (const a of alterTableTenantDecls(text, masked)) {
    for (const d of out) {
      if (d.key === a.key && !d.tenant) {
        d.tenant = true;
        d.columns = [...d.columns, { name: "tenant_id" }];
      }
    }
    out.push(a);
  }
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

/**
 * Same-name `< schema>` declarations that DISAGREE on `tenant_id` — E-SCHEMA-015
 * (bryan RULED S447 "stamp all" (i), gap
 * g-schema-commented-out-declaration-shadows-live-table).
 *
 * The tenant floor reads the UNION of every same-name declaration (a table is
 * tenant-scoped when ANY declaration of it carries `tenant_id` —
 * `extractDesiredSchema` `tenantTables`). The union alone is not safe: a stale
 * commented-out copy WITH `tenant_id` beside a live table WITHOUT it over-scopes
 * the live table (`SELECT *` silently returns `[]`, S446 review of #1209), and
 * first-wins — the pre-ruling read — lets a stale copy WITHOUT `tenant_id` shadow
 * a live table WITH it. So when the declarations of one table (names compared
 * case-insensitively, as the floor keys them) do not all agree on whether the
 * table carries `tenant_id`, the program is rejected and neither direction is
 * silent. Declarations that agree — including a commented-out copy — are quiet.
 *
 * @param {string} text a `< schema>` body
 * @returns {Array<{name: string, withTenant: object[], withoutTenant: object[]}>}
 *   one entry per disagreeing table, in order of first declaration; each list holds
 *   `schemaTableDeclarations` records.
 */
export function findTenantDeclarationDisagreements(text) {
  const groups = new Map();
  for (const d of schemaTableDeclarations(text)) {
    if (!groups.has(d.key)) groups.set(d.key, []);
    groups.get(d.key).push(d);
  }
  const out = [];
  for (const decls of groups.values()) {
    const withTenant = decls.filter((d) => d.tenant);
    const withoutTenant = decls.filter((d) => !d.tenant);
    if (withTenant.length > 0 && withoutTenant.length > 0) {
      out.push({ name: decls[0].name, withTenant, withoutTenant });
    }
  }
  return out;
}

/**
 * Read the table name + COLUMN NAMES out of ONE raw `CREATE TABLE … (…)`
 * statement — the statement text `harvestRawCreateTables` hands back for the
 * raw-DDL `< schema>` form (g-schema-block-raw-ddl).
 *
 * WHY THIS IS NOT "a second harvester" (dpa-039 arc B). Harvesting = FINDING the
 * `CREATE TABLE` statements in a body; that stays in exactly one place
 * (`harvestRawCreateTables` / `scanCreateTableHeads`), because two floors disagreeing
 * about what counts as a table declaration is the defect being closed here. This
 * function does the DIFFERENT job of reading columns out of a statement that
 * recognizer already found, and it deliberately inherits that recognizer's
 * boundary rather than improving on it.
 *
 * SCOPE — deliberately NAMES ONLY, and the fail-direction is the reason.
 * §14.8.10 asks one question of a `< schema>` table: does it carry a `tenant_id`
 * column? That is answered by the column NAME set. This parser therefore does
 * NOT attempt to recover constraints, defaults, foreign keys or CHECK bodies —
 * a partial constraint read would be strictly worse than none, because
 * `diffSchema` would then treat the recovered-but-incomplete table as desired
 * state and emit a LOSSY `CREATE TABLE` (or, on a table that already exists,
 * `W-SCHEMA-002` DROP COLUMN for every constraint-bearing column this parser did
 * not recover — data loss). `diffSchema` accordingly SKIPS `rawDdl` tables; see
 * the guard there.
 *
 * TABLE-LEVEL CONSTRAINT CLAUSES ARE SKIPPED, and skipping them cannot hide a
 * `tenant_id` column: `PRIMARY KEY (tenant_id, id)` / `FOREIGN KEY (tenant_id)
 * REFERENCES …` / `CONSTRAINT … UNIQUE (tenant_id)` all NAME the column without
 * DECLARING it, so treating them as columns would make the floor believe a
 * `tenant_id` output column exists when it does not — and the floor would then
 * emit a projection add against a column the table lacks (a hard SQL failure at
 * runtime, not a safe over-fire). The discriminator word `tenant_id` is itself
 * never a constraint-leader keyword, so a genuine column declaration can never
 * be skipped by this list.
 *
 * ⚑ THE `sourceText` RECOVERY PARAMETER IS GONE, and its removal is the fix
 * rather than a simplification. It existed to re-find a CLIPPED statement inside
 * the body it came from and re-read the columns — and in the very next round it
 * COLLIDED with the qualifier normalization added beside it: the stored statement
 * said `assets`, the body said `public.assets`, `indexOf` returned -1, the
 * recovery silently never fired, and the original defect came back on exactly the
 * Postgres spelling the §14.8.11 tier targets. Two individually-correct fixes
 * cancelling.
 *
 * Statements are no longer clipped AT ALL (`readCreateTableHead` reads only
 * the head; a balanced scanner finds the close), so there is nothing to recover
 * from and no re-find to mis-align. One side of the seam is DELETED instead of
 * both sides being patched.
 *
 * ⚑ NO PRODUCTION CALLER AS OF THIS ROUND — stated rather than left implicit.
 * `extractDesiredSchema` moved to `harvestRawCreateTableDecls`, so every in-tree
 * caller of this function is now a TEST. That is the inverse of a silently dead
 * limb (a path no test enters) and a milder smell, but it is still one: an export
 * whose only consumer is its own suite rots. It is kept as the single-statement
 * entry point — a genuine API shape, and one that CANNOT drift from the harvest
 * because both read columns through `columnsFromDdlBody`. Retiring it in favour
 * of `harvestRawCreateTableDecls(sql)[0]` is a clean follow-up, deliberately not
 * bundled into a defect round.
 *
 * @param {string} createTableSql one complete `CREATE TABLE … (…)` statement
 * @returns {{ name: string, columns: Array<{name: string, type: string, scrmlType: string}> } | null}
 *   null when the text is not a recognizable CREATE TABLE.
 */
export function parseRawCreateTableColumns(createTableSql) {
  if (typeof createTableSql !== "string") return null;
  // The legacy head read first — pre-S438 behaviour, verbatim — then the
  // structured reader for the heads it could not read (the same superset rule as
  // the harvest). A qualified head still yields its columns: this is a column
  // READER, not the `< schema>` acceptance gate — E-SCHEMA-012 at GCP1 is.
  const legacy = new RegExp(LEGACY_CREATE_TABLE_HEAD_RE.source, "i").exec(createTableSql);
  if (legacy) {
    const bodyStart = legacy.index + legacy[0].length;
    const bodyEnd = findRawDdlBodyEnd(createTableSql, bodyStart);
    const body = createTableSql.slice(bodyStart, bodyEnd === -1 ? createTableSql.length : bodyEnd);
    return { name: legacy[2], columns: columnsFromDdlBody(body) };
  }
  const head = scanCreateTableHeads(createTableSql)
    .find((h) => h.parenAt !== -1 && h.modifiers.length === 0);
  if (!head) return null;
  const body = createTableSql.slice(head.parenAt + 1, head.bodyEnd === -1 ? createTableSql.length : head.bodyEnd);
  return { name: head.parts[head.parts.length - 1].name, columns: columnsFromDdlBody(body) };
}

/**
 * Read the COLUMN NAMES out of a CREATE-TABLE column-def body. The single
 * implementation behind both `parseRawCreateTableColumns` (one statement) and
 * `harvestRawCreateTableDecls` (the harvest pass) — so the two can never drift
 * on what counts as a column.
 */
function columnsFromDdlBody(body) {
  const columns = [];
  for (const item of splitTopLevelCommas(body)) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (isTableLevelConstraint(trimmed)) continue;
    // `name TYPE …` — the name may be bare, "double-quoted", `back-quoted`,
    // 'single-quoted' or [bracketed].
    const decl = /^(?:"([^"]+)"|`([^`]+)`|'([^']+)'|\[([^\]]+)\]|([A-Za-z_]\w*))\s*([A-Za-z_]\w*)?/.exec(trimmed);
    if (!decl) continue;
    const name = decl[1] ?? decl[2] ?? decl[3] ?? decl[4] ?? decl[5];
    if (!name) continue;
    const rawType = decl[6] ?? "text";
    columns.push({ name, type: rawType.toUpperCase(), scrmlType: rawType.toLowerCase() });
  }
  return columns;
}

/**
 * Is this comma-separated item a TABLE-LEVEL CONSTRAINT rather than a column?
 *
 * ⚑ A KEYWORD-PREFIX TEST IS WRONG HERE, and measurably so. The first version of
 * this check skipped any item whose leading word was one of nine constraint
 * words, which silently DROPPED real columns that happen to be named with one:
 * `CREATE TABLE settings (key TEXT, value TEXT, tenant_id TEXT)` returned
 * `["value","tenant_id"]` — the `key` column vanished. `key`, `index`, `check`,
 * `unique`, `like`, `exclude`, `primary`, `foreign` and `constraint` are all
 * legal column names.
 *
 * So the test matches the constraint PRODUCTIONS, not the leading word. A
 * table-level constraint is always the keyword followed by something a column
 * declaration never has there — `KEY`, a `(`, or (after `CONSTRAINT <name>`)
 * another constraint keyword — whereas a column is the name followed by its TYPE.
 *
 * MEASURED: this recovers EIGHT of the nine as columns. `like` is the ninth and
 * is irreducible at this grain — `LIKE other_table` (the Postgres table-copy
 * clause, which lives INSIDE the column list) and `like TEXT` (a column) are the
 * same shape, so no leading-word test separates them, and this resolves it as
 * the clause.
 *
 * ⚑ That residual is closed by the SQL grammar rather than by a heuristic:
 * `LIKE` is a RESERVED WORD, so a column genuinely named `like` must be quoted —
 * and `"like" TEXT`, `` `like` TEXT `` and `[like] TEXT` all parse correctly
 * here, while the unquoted copy clause is still skipped. Adding a type-name
 * allowlist to also catch the ILLEGAL unquoted spelling would trade a named
 * residual for a new guess surface, so it is deliberately not done.
 */
function isTableLevelConstraint(item) {
  // ⚑ `KEY`/`INDEX` NEEDS ONE MORE DISCRIMINATOR, because the MySQL constraint
  // `KEY idx_name (col_a, col_b)` and the COLUMN `key VARCHAR(50)` are the same
  // token shape — word, word, parenthesized list. The first version tested only
  // that shape, so `settings (key VARCHAR(50), value TEXT, tenant_id TEXT)`
  // returned `["value","tenant_id"]` and the `key` column vanished. My own doc
  // block claimed this class was measured and fixed; the test only covered
  // `key TEXT`, so the parenthesized-type form was never exercised — the fix
  // landed in a cell nobody had crossed.
  //
  // The discriminator is the paren CONTENT: a TYPE's argument is numeric
  // (`VARCHAR(50)`, `NUMERIC(10,2)`), an index's is a COLUMN LIST (identifiers).
  const keyIndex = /^(?:INDEX|KEY)\s+\w+\s*\(([^)]*)\)/i.exec(item);
  const keyIndexIsConstraint = keyIndex !== null && !/^[\s\d,]*$/.test(keyIndex[1]);
  return (
    /^(?:PRIMARY|FOREIGN)\s+KEY\b/i.test(item) ||
    /^(?:UNIQUE|CHECK|EXCLUDE)\s*\(/i.test(item) ||
    /^UNIQUE\s+KEY\b/i.test(item) ||
    /^(?:INDEX|KEY)\s*\(/i.test(item) ||   // the UNNAMED form `KEY (col)`
    keyIndexIsConstraint ||                 // the NAMED form `KEY idx (col_a, col_b)`
    /^CONSTRAINT\s+\w+\s+(?:PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b/i.test(item) ||
    /^LIKE\s+\w+\s*$/i.test(item)
  );
}

/**
 * Index of the `)` that closes the column-def list opened just before `from`,
 * skipping `'…'` / `"…"` / `` `…` `` literals, `--` line comments and
 * `/* … *\/` block comments. Returns -1 when unbalanced.
 */
function findRawDdlBodyEnd(src, from) {
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      const nl = sqlLineCommentEnd(src, i);
      i = nl === src.length ? src.length : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close === -1 ? src.length : close + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      i = j + 1;
      continue;
    }
    if (c === "(") { depth++; i++; continue; }
    if (c === ")") {
      if (depth === 0) return i;
      depth--; i++; continue;
    }
    i++;
  }
  return -1;
}

/**
 * Split a CREATE-TABLE column-def body on TOP-LEVEL commas — commas not nested
 * inside `(…)` and not inside a quoted literal or a comment. A naive
 * `split(",")` shreds `DECIMAL(10,2)`, `CHECK (x IN ('a','b'))` and a composite
 * `PRIMARY KEY (a, b)`.
 */
function splitTopLevelCommas(body) {
  const items = [];
  let depth = 0;
  let cur = "";
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "-" && body[i + 1] === "-") {
      const nl = sqlLineCommentEnd(body, i);
      i = nl === body.length ? body.length : nl + 1;
      continue;
    }
    if (c === "/" && body[i + 1] === "*") {
      const close = body.indexOf("*/", i + 2);
      i = close === -1 ? body.length : close + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < body.length && body[j] !== c) j++;
      cur += body.slice(i, Math.min(j + 1, body.length));
      i = j + 1;
      continue;
    }
    if (c === "(") { depth++; cur += c; i++; continue; }
    if (c === ")") { depth = Math.max(0, depth - 1); cur += c; i++; continue; }
    if (c === "," && depth === 0) { items.push(cur); cur = ""; i++; continue; }
    cur += c; i++;
  }
  items.push(cur);
  return items;
}

/**
 * Parse a P2 SECURITY-DEFINER `fn` declaration starting at `startIdx`
 * (`fnHead` = the `/^fn\s+NAME\s*\(/` match already run by the caller).
 *
 * Surface (M1-PROVISIONAL, §14.8.11.2):
 *   `fn NAME(arg: type, …) security definer owner(<role>) [returns <type>]
 *      [lang="plpgsql"] [requires cap("x")] { """ <plpgsql statements> """ }`
 *
 * The body carries the plpgsql STATEMENTS only (no outer BEGIN/END — the emitter
 * owns the envelope so the injected cap check is un-bypassable and always first).
 * Every identifier (fn name, arg names, owner role) is captured with a STRICT
 * `[A-Za-z_]\w*` pattern, so a `$`/quote cannot enter and later break a dollar-quote
 * or an identifier — the parse-time defense that complements emit-time quoteIdent.
 *
 * @returns {{ fn: SecdefFnDecl, next: number } | null} null on a malformed decl.
 */
function parseFnDecl(text, startIdx, fnHead, finders = null) {
  const name = fnHead[1];
  const parenOpen = startIdx + fnHead[0].length - 1; // index of `(`
  const parenClose = finders ? finders.parenEnd(parenOpen) : findMatchingParen(text, parenOpen);
  if (parenClose === -1) return null;

  const argText = text.slice(parenOpen + 1, parenClose).trim();
  const args = parseFnArgs(argText);
  if (args === null) return null;

  // The modifier run is everything between `)` and the body-opening `{`.
  const braceOpen = finders ? finders.nextBrace(parenClose + 1) : text.indexOf("{", parenClose + 1);
  if (braceOpen === -1) return null;
  const modifiers = text.slice(parenClose + 1, braceOpen);

  // owner(<role>) — MANDATORY (the SECDEF runs as this bounded NOLOGIN role, NOT
  // scrml_app). Strict identifier capture.
  const modMatch = (re) => {
    if (finders) return finders.inRange(re, parenClose + 1, braceOpen, modifiers);
    re.lastIndex = 0;
    const m = re.exec(modifiers);
    re.lastIndex = 0;
    return m;
  };
  const ownerMatch = modMatch(FN_OWNER_RE);
  if (!ownerMatch) return null;
  const owner = ownerMatch[1];

  // returns <type> — optional; defaults to `void`.
  const returnsMatch = modMatch(FN_RETURNS_RE);
  const returns = returnsMatch ? returnsMatch[1] : "void";

  // requires cap("x") — optional in-body capability gate (extracted, NOT trusted
  // verbatim; the quotes bound the value so no `'` can enter, and we still escape).
  const capMatch = modMatch(FN_CAP_RE);
  const cap = capMatch ? capMatch[1] : null;

  // `security definer` is the only supported mode in P2; its presence is advisory
  // here (every P2 `fn` emits SECURITY DEFINER). We record it for future modes.
  const isSecurityDefiner = modMatch(FN_SECDEF_RE) !== null;

  const braceClose = finders ? finders.blockEnd(braceOpen) : findSchemaBlockEnd(text, braceOpen);
  if (braceClose === -1) return null;
  const blockText = text.slice(braceOpen + 1, braceClose);

  // The body: the `"""…"""` triple-quoted plpgsql statements.
  const bodyMatch = /"""([\s\S]*?)"""/.exec(blockText);
  const body = bodyMatch ? bodyMatch[1] : blockText;

  return {
    fn: { name, args, owner, returns, cap, isSecurityDefiner, body },
    next: braceClose + 1,
    // The `"""…"""` span (delimiters included) in `text`, or null when the block
    // has none — read by `findRejectedCreateTableHeads` (E-SCHEMA-014 only).
    bodySpan: bodyMatch
      ? { start: braceOpen + 1 + bodyMatch.index, end: braceOpen + 1 + bodyMatch.index + bodyMatch[0].length }
      : null,
  };
}

/**
 * Parse a `fn` argument list: comma-separated `name: type` (or `name type`) pairs.
 * Returns `[{ name, type }]`, or `[]` for an empty list, or `null` if any arg is
 * malformed (a strict identifier is required for both name and type token).
 */
function parseFnArgs(argText) {
  if (argText.length === 0) return [];
  const out = [];
  for (const raw of argText.split(",")) {
    const part = raw.trim();
    if (part.length === 0) return null;
    // `name: type` (canonical) or `name type` (SQL-ish).
    const m = /^([A-Za-z_]\w*)\s*(?::\s*|\s+)([A-Za-z_]\w*)$/.exec(part);
    if (!m) return null;
    out.push({ name: m[1], type: m[2] });
  }
  return out;
}

/**
 * Parse column declarations from inside a table block.
 * Format: columnName: type constraint1 constraint2 ...
 *
 * Recognizes:
 *   - SQL-mirror constraints: primary key, not null, unique, default(...),
 *     references table(col), rename from id
 *   - Shared-core predicates (§39.5.7, L4): req, length(...), pattern(...),
 *     min(n), max(n), gt(n), lt(n), gte(n), lte(n), eq(n), neq(n),
 *     oneOf([...]), notIn([...]). Each captured into `sharedCorePredicates`.
 */
/**
 * Blank the BODIES of quoted strings and regex literals, preserving length and
 * the delimiters themselves, so a keyword scan cannot see inside them.
 * Length-preserving so an index into the result is still valid in the input.
 *
 * Used by the E-SCHEMA-011 detection so `default('see references')` and
 * `pattern(/references/)` do not read as a malformed foreign key.
 *
 * `opts.comments` (S438, E-SCHEMA-012/013 dead-head suppression over a WHOLE
 * `< schema>` body, where DSL text and raw SQL mix) — in ONE left-to-right pass,
 * earliest opener wins, so a comment opener inside a literal is inert and a quote
 * inside a comment is inert. The forms blanked:
 *   · `'…'` and `"…"` — bounded to their LINE (an unbalanced `'` in prose must
 *     not blank the rest of the body);
 *   · `/…/` — only directly after a `(` (`pattern(/…/)`, the one place the DSL
 *     grammar puts a regex; SQL `a / b` is division), bounded to its line;
 *   · `--` line comments and CLOSED `/* … *\/` block comments.
 * NOT `"""…"""` and NOT `//` (round 4 — see the note in the body). A SECURITY-
 * DEFINER `fn` body is NOT exempted either (final round) — gap
 * g-secdef-fn-body-ddl-false-positive.
 * `opts.backtick: false` leaves `` `…` `` LIVE: in a `< schema>` body a backtick
 * is either a quoted identifier inside a head or a `?{`…`}` wrapper around live
 * DDL, never inert text. Defaults reproduce the E-SCHEMA-011 behaviour exactly.
 *
 * @param {string} s
 * @param {{comments?: boolean, backtick?: boolean}} [opts]
 * @returns {string}
 */
function blankLiteralBodies(s, opts = {}) {
  const comments = opts.comments === true;
  const backtick = opts.backtick !== false;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // ⚑ NO `"""` AND NO `//` HANDLING HERE (S438 round 4, F2). Round 3 blanked any
    // `"""…"""` pair and any `//`-to-end-of-line; both are also ordinary RAW-SQL
    // text (`"""a"` … `"b"""` quoted identifiers, `DEFAULT $$http://x$$`), so each
    // masked a live qualified head and let it escape E-SCHEMA-012. A `//` line and a
    // SECURITY-DEFINER `fn` `"""` body are both LIVE; a qualified/unreadable head in
    // either is an accepted fail-closed false positive
    // (g-secdef-fn-body-ddl-false-positive for the fn body).
    if (comments && ch === "-" && s[i + 1] === "-") {
      const j = sqlLineCommentEnd(s, i);
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (comments && ch === "/" && s[i + 1] === "*") {
      const close = s.indexOf("*/", i + 2);
      if (close !== -1) {
        out += s.slice(i, close + 2).replace(/[^\n]/g, " ");
        i = close + 2;
        continue;
      }
    }
    if (ch === "'" || ch === '"' || (ch === "`" && backtick)) {
      out += ch;
      i++;
      while (i < s.length && s[i] !== ch && !(comments && s[i] === "\n")) {
        if (s[i] === "\\" && i + 1 < s.length) { out += "  "; i += 2; continue; }
        out += " ";
        i++;
      }
      if (i < s.length && s[i] === ch) { out += s[i]; i++; }
      continue;
    }
    // A regex literal — only `pattern(/…/)`-shaped in this grammar. Require the
    // close on the same line so a lone `/` (never legal here, but cheap to be
    // safe about) cannot swallow the rest of the constraint text.
    if (ch === "/" && s[i + 1] !== "/" && s[i + 1] !== "*" &&
        (!comments || /\(\s*$/.test(s.slice(Math.max(0, i - 16), i)))) {
      let j = i + 1;
      let closed = false;
      while (j < s.length && s[j] !== "\n") {
        if (s[j] === "\\") { j += 2; continue; }
        if (s[j] === "/") { closed = true; break; }
        j++;
      }
      if (closed) {
        out += "/" + " ".repeat(j - i - 1) + "/";
        i = j + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function parseColumns(text) {
  const columns = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (const rawLine of lines) {
    // Strip `//` comments (§27 — the universal scrml comment) BEFORE parsing.
    //
    // S290: until now comments inside a table body were parsed as schema text,
    // with three separate live consequences, all silent:
    //   1. a commented-out column emitted a REAL column — `// owner_id: integer
    //      references owners(id)` became `"// owner_id" integer REFERENCES …`,
    //      quoted, so Postgres accepted it;
    //   2. a TRAILING comment's PROSE was scanned for constraints — `a: integer
    //      // make this unique later` emitted `"a" integer UNIQUE`, and
    //      `b: text // not null yet, TODO` emitted `"b" text NOT NULL`;
    //   3. it false-fired the new E-SCHEMA-011 on any comment mentioning
    //      `references` — which is how the whole class was found.
    // Found by the S239 adversarial pass, not by the corpus sweep: no corpus
    // file happens to comment inside a table body in a way that bites, so the
    // full suite could not have caught it.
    //
    // Comment detection runs over the LITERAL-BLANKED line so a `//` inside a
    // string (`default('http://example.com')`) is not mistaken for a comment;
    // blanking is length-preserving, so the index maps back to the raw line.
    const commentAt = blankLiteralBodies(rawLine).indexOf("//");
    const line = (commentAt === -1 ? rawLine : rawLine.slice(0, commentAt)).trim();
    if (!line) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const name = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    // Parse type (first word)
    const parts = rest.split(/\s+/);
    const type = parts[0] || "text";
    const restStr = rest.slice(type.length).trim();

    const col = {
      name,
      type: mapSqliteType(type),
      scrmlType: type.toLowerCase(),  // preserved for cell-type-aware lowering (e.g., req on text/blob)
      primaryKey: /primary\s+key/i.test(restStr),
      notNull: /not\s+null/i.test(restStr),
      unique: /unique/i.test(restStr),
      // §14.8.11.2 S3 — a per-column `immutable` keyword (mirrors `not null`/`unique`).
      // Consumed ONLY by generateDbAuthoritativeDDL, which narrows the bounded role's
      // table-level UPDATE grant to the mutable columns (a Postgres column-level
      // REVOKE cannot narrow a table GRANT, so the grant itself is re-shaped). On a
      // non-db-authoritative table the flag is inert (there is no bounded-role grant
      // to narrow) — a db-authoritative table is required for enforcement, and that
      // is Postgres-gated by the E-DBAUTH-SQLITE compile gate.
      immutable: /\bimmutable\b/i.test(restStr),
      default: null,
      references: null,
      renameFrom: null,
      sharedCorePredicates: [],
    };

    // Parse default(...) — BALANCED scan, not `[^)]+`. The argument may itself
    // contain parens (`default(now())`) or a quoted string containing one, and the
    // old `default\(([^)]+)\)` stopped at the FIRST `)`: `default(now())` captured
    // `now(`, which emitted an unbalanced `DEFAULT (now() )` that TRUNCATED the
    // whole CREATE TABLE and surfaced as a misleading "syntax error at or near ;"
    // from Postgres. Blocked most tables in a real adopter's schema (S4).
    const _defIdx = restStr.search(/\bdefault\s*\(/i);
    if (_defIdx !== -1) {
      const _defOpen = restStr.indexOf("(", _defIdx);
      const _defClose = _defOpen === -1 ? -1 : findMatchingParen(restStr, _defOpen);
      if (_defClose !== -1) col.default = restStr.slice(_defOpen + 1, _defClose).trim();
    }

    // Parse references table(column)
    const refMatch = restStr.match(/references\s+(\w+)\((\w+)\)/i);
    if (refMatch) col.references = { table: refMatch[1], column: refMatch[2] };

    // §39.5.5 / E-SCHEMA-011 (S290) — the author WROTE `references` but no
    // foreign key was parsed. `references table(column)` is the only grammar
    // production §39.5.5 declares, so every other shape — the dot-in-parens
    // form `references(owners.id)`, a spaced `references owners (id)`, a bare
    // `references owners.id` — fell through this regex, left `col.references`
    // null, and emitted NO `REFERENCES` clause with NO diagnostic. An adopter
    // declared 34 foreign keys in a real 19-table ledger schema and got zero
    // rows in `pg_constraint`; an INSERT naming a non-existent parent was
    // accepted. Compile clean, apply clean, silent.
    //
    // Detect the CLASS (`references` written, nothing parsed) rather than the
    // one reported shape — enumerating shapes inside a function is not the same
    // as enumerating the ways a class of defect can be written (the S288
    // incomplete-fix lesson, handed back by the adopter). String and regex
    // bodies are blanked first so `default('see references')` and
    // `pattern(/references/)` cannot false-fire.
    col.malformedReferences = null;
    if (col.references === null) {
      const scannable = blankLiteralBodies(restStr);
      const refTok = scannable.search(/\breferences\b/i);
      if (refTok !== -1) {
        col.malformedReferences = restStr.slice(refTok, refTok + 48).trim();
      }
    }

    // Parse rename from identifier
    const renameMatch = restStr.match(/rename\s+from\s+(\w+)/i);
    if (renameMatch) col.renameFrom = renameMatch[1];

    // Parse shared-core predicates (§39.5.7, L4 additive vocabulary).
    col.sharedCorePredicates = parseSharedCorePredicates(restStr);

    columns.push(col);
  }

  return columns;
}

/**
 * Universal-core predicate names recognized at the schema locus (§39.5.7).
 * `is some` is enumerated in §55.1 but NOT listed in §39.5.7 — schema has no
 * "EXISTS" notion beyond NOT NULL (handled by `req`).
 */
const SCHEMA_LOCUS_PREDICATES = new Set([
  "req",
  "length", "pattern",
  "min", "max",
  "gt", "lt", "gte", "lte",
  "eq", "neq",
  "oneOf", "notIn",
]);

/**
 * Parse the 13 shared-core predicates from a column constraint string.
 *
 * `req` is bareword-only; it must be matched with whitespace boundaries so
 * `requirement` or `required` (hypothetical user constraint names) don't
 * false-positive. The other predicates are call-form: `name(...)`. Predicate
 * argument extraction tracks nested `()` / `[]` so that `oneOf([1,2,3])`
 * and `pattern(/^abc$/)` capture cleanly without splitting on inner commas.
 *
 * @returns {SharedCorePredicate[]}
 *   Each entry: { name, raw, arg } where `arg` is the verbatim text inside
 *   the outermost parens (`null` for bareword `req`).
 */
function parseSharedCorePredicates(restStr) {
  const predicates = [];
  let i = 0;
  const n = restStr.length;

  while (i < n) {
    // Skip whitespace
    while (i < n && /\s/.test(restStr[i])) i++;
    if (i >= n) break;

    // Try to match an identifier (predicate name or other token)
    const identMatch = restStr.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (!identMatch) {
      // Skip non-ident character (e.g., punctuation from another constraint we don't own)
      i++;
      continue;
    }
    const ident = identMatch[0];
    const identEnd = i + ident.length;

    if (!SCHEMA_LOCUS_PREDICATES.has(ident)) {
      i = identEnd;
      continue;
    }

    // For `req`: must be a bareword (followed by whitespace, end, or another
    // alphanum-leading constraint). A `(` after `req` would mean it's not the
    // bareword form — but §55.1 documents `req` as 0+inline (`req("Please...")`).
    // For the schema locus the inline-message form is permitted but currently
    // emits the same lowering; we accept both forms and treat them as the
    // same predicate for emission (the message is purely client-facing and
    // does NOT affect SQL).
    if (ident === "req") {
      // Skip optional inline-message arg `req("...")`
      let nextChar = identEnd;
      while (nextChar < n && /\s/.test(restStr[nextChar])) nextChar++;
      if (nextChar < n && restStr[nextChar] === "(") {
        const closingIdx = findMatchingParen(restStr, nextChar);
        if (closingIdx === -1) {
          // Malformed; bail without recording the predicate
          i = identEnd;
          continue;
        }
        predicates.push({ name: "req", arg: null, raw: restStr.slice(i, closingIdx + 1) });
        i = closingIdx + 1;
      } else {
        predicates.push({ name: "req", arg: null, raw: ident });
        i = identEnd;
      }
      continue;
    }

    // All other predicates require parens.
    let parenStart = identEnd;
    while (parenStart < n && /\s/.test(restStr[parenStart])) parenStart++;
    if (parenStart >= n || restStr[parenStart] !== "(") {
      // Predicate name without parens — not a valid call form. Skip.
      i = identEnd;
      continue;
    }
    const closingIdx = findMatchingParen(restStr, parenStart);
    if (closingIdx === -1) {
      i = identEnd;
      continue;
    }
    const argRaw = restStr.slice(parenStart + 1, closingIdx).trim();
    predicates.push({
      name: ident,
      arg: argRaw,
      raw: restStr.slice(i, closingIdx + 1),
    });
    i = closingIdx + 1;
  }

  return predicates;
}

/**
 * Given a string and the index of an opening `(`, return the index of the
 * matching `)` (taking nested parens and `[...]` into account). Returns -1
 * if unbalanced. Conservative: does NOT track string literals inside.
 * (Schema column constraints don't embed parens inside strings in practice;
 * if a future extension needs that, this helper will need string-tracking.)
 */
function findMatchingParen(str, openIdx) {
  // S288 — TWO-PASS, quote-aware first with a quote-BLIND fallback.
  //
  // Quote-awareness is needed because a `)` inside a string ARGUMENT closed the
  // predicate early: `oneOf(["x); DROP TABLE u; --"])` yielded a column with NO
  // CHECK AT ALL (a silent constraint downgrade — the same class as the pre-P2
  // brace bug), and `default("a)b")` truncated the default value.
  //
  // But a scrml `pattern(/…/)` argument is a REGEX literal, which may carry an
  // unpaired apostrophe (`pattern(/o'brien/)`). Treating that as an opening quote
  // swallows the rest of the string and loses the predicate — a regression the
  // quote-aware pass introduced and this fallback removes. Distinguishing a regex
  // literal from a string generically is the division-vs-regex ambiguity, so
  // instead: run quote-aware, and if it fails to close, re-run with quote-tracking
  // OFF. Strictly no worse than the pre-S288 behavior in every case, and better
  // whenever the quotes are actually balanced.
  const hit = scanMatchingParen(str, openIdx, true);
  return hit !== -1 ? hit : scanMatchingParen(str, openIdx, false);
}

function scanMatchingParen(str, openIdx, quoteAware) {
  if (str[openIdx] !== "(") return -1;
  let depth = 0;
  let bracketDepth = 0;
  let quote = null;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (quoteAware) {
      if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0 && bracketDepth === 0) return i;
    } else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
  }
  return -1;
}

/**
 * Map scrml schema types to SQLite affinity types (§38.4).
 */
function mapSqliteType(type) {
  const map = {
    text: "TEXT",
    integer: "INTEGER",
    real: "REAL",
    blob: "BLOB",
    boolean: "INTEGER", // SQLite has no BOOLEAN — maps to INTEGER
    timestamp: "TEXT",   // SQLite has no TIMESTAMP — maps to TEXT
  };
  return map[type.toLowerCase()] || "TEXT";
}

/**
 * Map a scrml schema type token to its Postgres-native column type. Used ONLY
 * on the Postgres CREATE-TABLE path (the SQLite path keeps the affinity map
 * above, so existing SQLite output stays byte-identical). The §39.4 core types
 * map to their PG equivalents; any OTHER token (`uuid`, `decimal`, `numeric`,
 * `jsonb`, …) passes through VERBATIM — those are already valid Postgres types
 * and a DB-authoritative table (`id: uuid`, `amount: decimal`) needs them
 * emitted faithfully, not flattened to TEXT. The token is a single whitespace-
 * free word taken from the column declaration at compile time (developer-
 * authored), never runtime input.
 */
function mapPostgresType(scrmlType) {
  const key = String(scrmlType ?? "").toLowerCase();
  const map = {
    text: "text",
    integer: "integer",
    real: "real",
    blob: "bytea",
    boolean: "boolean",
    timestamp: "timestamptz",
  };
  return map[key] || scrmlType;
}

/**
 * Read actual database schema via PRAGMA table_info().
 *
 * @param {object} db — bun:sqlite Database instance
 * @returns {{ tables: ActualTable[] }}
 */
export function readActualSchema(db) {
  const tables = [];
  const tableNames = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_scrml_migrations'"
  ).all();

  for (const { name } of tableNames) {
    const columns = db.query(`PRAGMA table_info(${quoteIdent(name)})`).all();

    // S290 — `PRAGMA table_info` exposes name/type/notnull/dflt_value/pk and
    // NOTHING ELSE. Until now that was the whole actual-state read, so UNIQUE
    // and REFERENCES drift on an existing column was not merely unreconciled,
    // it was INVISIBLE: the differ had no `unique`/`references` on the actual
    // side to compare against. Two more PRAGMAs recover them, bringing the
    // SQLite read to parity with `readActualSchemaPg` so §38.6.2's
    // CREATE INDEX / DROP INDEX / rebuild rows can actually be triggered.

    // Single-column UNIQUE indexes. `origin` is "u" for a UNIQUE constraint
    // declared in CREATE TABLE and "c" for a standalone CREATE UNIQUE INDEX;
    // both make the column unique, so both count. Composite indexes are
    // recorded separately — they are not a per-column property and a
    // single-column comparison must not be fooled by one.
    const uniqueCols = new Set();
    const compositeUnique = [];
    for (const idx of db.query(`PRAGMA index_list(${quoteIdent(name)})`).all()) {
      if (idx.unique !== 1) continue;
      const cols = db.query(`PRAGMA index_info(${quoteIdent(idx.name)})`).all().map(r => r.name);
      if (cols.length === 1) uniqueCols.add(cols[0]);
      else if (cols.length > 1) compositeUnique.push({ name: idx.name, columns: cols });
    }

    // Single-column FOREIGN KEYs, shaped exactly like `parseColumns` produces
    // (`{ table, column }`) so `sameRef` compares like with like. A composite
    // FK is not a per-column property either; record it, do not attribute it.
    const fkByColumn = new Map();
    const compositeFk = [];
    for (const [, rows] of groupBy(
      db.query(`PRAGMA foreign_key_list(${quoteIdent(name)})`).all(),
      r => String(r.id),
    )) {
      if (rows.length !== 1) { compositeFk.push(rows); continue; }
      const r = rows[0];
      // `to` is null when the FK targets the parent's PRIMARY KEY implicitly.
      fkByColumn.set(r.from, { table: r.table, column: r.to ?? "id" });
    }

    tables.push({
      name,
      compositeUnique,
      compositeFk,
      columns: columns.map(c => ({
        name: c.name,
        type: c.type || "TEXT",
        notNull: c.notnull === 1,
        default: c.dflt_value,
        primaryKey: c.pk === 1,
        unique: uniqueCols.has(c.name),
        references: fkByColumn.get(c.name) ?? null,
        // CHECK constraint text is still NOT recoverable through PRAGMA, so
        // shared-core predicate drift (`oneOf`, `length`, `min`…) remains
        // outside the per-column diff. Stated, not silently implied.
        sharedCorePredicates: [],
      })),
    });
  }

  return { tables };
}

/** Group rows by a key, preserving insertion order. */
function groupBy(rows, keyOf) {
  const out = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

/**
 * Compute migration SQL by diffing desired vs actual schema.
 *
 * SPEC §38.6: diff operations are ADD TABLE, ADD COLUMN, DROP TABLE,
 * DROP COLUMN, ALTER COLUMN (via 12-step rebuild), RENAME COLUMN.
 *
 * The optional `options.driver` argument controls driver-specific lowering
 * forms per §39.5.8 (currently only `pattern()` differs across drivers:
 * Postgres uses `~`; SQLite/MySQL use `REGEXP`). Defaults to `"sqlite"` to
 * preserve existing behavior.
 *
 * @param {{ tables: TableDecl[] }} desired
 * @param {{ tables: ActualTable[] }} actual
 * @param {{ driver?: "sqlite"|"postgres"|"mysql", allowDestructive?: boolean }} [options]
 *   `allowDestructive` (default false) gates the §14.8.11-M2 fence: a bare
 *   `DROP TABLE` for an actual-but-not-desired table is emitted ONLY when true
 *   (on Postgres a DROP CASCADE-drops attached RLS policies/grants); when false
 *   the drop is suppressed with a `W-SCHEMA-DESTRUCTIVE-DROP` warning.
 * @returns {{ sql: string[], warnings: string[] }}
 */
/**
 * Which per-column CONSTRAINTS differ between the desired and actual column?
 *
 * §38.6.2's operation table has always listed these — `CREATE INDEX` /
 * `DROP INDEX` for unique drift and "Full table rebuild — all other
 * column-level changes (type changes, constraint changes)" — and §38.6.3
 * names "no constraint changes via ALTER" as the reason the rebuild exists.
 * The implementation nonetheless handled only ADD / DROP / RENAME COLUMN, so
 * three of the eight specified operations were never built and every
 * constraint change on an existing column was silently ignored (S290,
 * `g-db-migrate-ignores-constraint-drift-on-existing-columns`). This is
 * therefore a conformance RESTORATION, not an amendment — the governing
 * sentences pre-date the gap.
 *
 * `default` is compared loosely: drivers echo defaults back with their own
 * quoting/casts, so a raw string compare would report permanent phantom drift
 * — a gate that cries wolf gets bypassed then deleted (`pa-base v2.4` §8).
 *
 * @returns {{ notNull: boolean, unique: boolean, references: boolean, default: boolean }}
 */
export function columnConstraintDrift(desiredCol, actualCol) {
  const wantNotNull = !!(desiredCol.notNull || hasReqPredicate(desiredCol));
  const wantUnique = !!desiredCol.unique;
  const dRef = desiredCol.references ?? null;
  const aRef = actualCol.references ?? null;
  return {
    // A PRIMARY KEY column is implicitly NOT NULL; do not fight the driver over it.
    notNull: !desiredCol.primaryKey && !actualCol.primaryKey && wantNotNull !== !!actualCol.notNull,
    // Likewise a PK is implicitly unique.
    unique: !desiredCol.primaryKey && !actualCol.primaryKey && wantUnique !== !!actualCol.unique,
    references: !(dRef === null && aRef === null) && !sameRef(dRef, aRef),
    default: !sameDefaultText(desiredCol.default, actualCol.default),
  };
}

/**
 * Compare two DEFAULT expressions tolerantly. Postgres echoes `'x'::text` for
 * `'x'` and SQLite re-quotes; comparing raw text would make every already-
 * correct default read as permanent drift.
 */
function sameDefaultText(a, b) {
  const norm = (v) => {
    if (v === null || v === undefined) return null;
    let s = String(v).trim();
    s = s.replace(/::[A-Za-z_][A-Za-z0-9_ ]*$/, "").trim();   // drop a PG cast suffix
    if (/^'(.*)'$/s.test(s)) s = s.slice(1, -1);               // unwrap one quote layer
    else if (/^"(.*)"$/s.test(s)) s = s.slice(1, -1);
    return s.toLowerCase();
  };
  return norm(a) === norm(b);
}

export function diffSchema(desired, actual, options = {}) {
  const driver = options.driver ?? "sqlite";
  const sql = [];
  const warnings = [];

  // ⚑ THE DIFFER SEES NO RAW-DDL TABLES AT ALL, AND THAT IS ENFORCED AT THE
  // CONSUMER, NOT HERE. `extractDesiredSchema` harvests raw `CREATE TABLE`
  // `< schema>` declarations because the §14.8.10 tenant floor needs their column
  // names — but `scrml db-migrate` was never designed for a table whose DDL the
  // compiler only partially recovers, and every defect the migrate half of this
  // arc produced traced to those tables becoming visible to it.
  //
  // So the split is at `extractDesiredSchema`'s TWO CONSUMERS: the tenant path
  // takes the raw tables, the migrate path declines them at its own boundary
  // (`commands/db-migrate.js`, `collectDesired`). This function is therefore
  // BYTE-IDENTICAL to its pre-arc behaviour and needs no `rawDdl` awareness — the
  // four migrate findings are gone BY CONSTRUCTION rather than by guards here.
  // Teaching the differ to migrate a raw-DDL `< schema>` (by REPLAYING the
  // author's own statement, not by regenerating it) is the real fix and is a
  // separate, re-scoped arc.

  const actualMap = new Map(actual.tables.map(t => [t.name, t]));
  const desiredMap = new Map(desired.tables.map(t => [t.name, t]));

  // 1. New tables (in desired but not actual)
  for (const table of desired.tables) {
    if (!actualMap.has(table.name)) {
      sql.push(generateCreateTable(table, driver));
    }
  }

  // 2. Modified tables (in both — check columns)
  for (const table of desired.tables) {
    const actualTable = actualMap.get(table.name);
    if (!actualTable) continue;

    const actualColMap = new Map(actualTable.columns.map(c => [c.name, c]));
    const desiredColMap = new Map(table.columns.map(c => [c.name, c]));

    // New columns
    for (const col of table.columns) {
      // Check rename
      if (col.renameFrom && actualColMap.has(col.renameFrom)) {
        sql.push(`ALTER TABLE ${quoteIdent(table.name)} RENAME COLUMN ${quoteIdent(col.renameFrom)} TO ${quoteIdent(col.name)};`);
        continue;
      }

      if (!actualColMap.has(col.name)) {
        // Simple ADD COLUMN (SQLite supports this for nullable columns without constraints).
        // A column with shared-core `req` lowers to NOT NULL — same constraint,
        // same fast-path requirement (default required for non-null ADD COLUMN).
        const lowersToNotNull = col.notNull || hasReqPredicate(col);
        const canSimpleAdd = !lowersToNotNull || col.default !== null;
        if (canSimpleAdd) {
          sql.push(generateAddColumn(table.name, col, driver));
        } else if (driver === "postgres") {
          // S7-minimal fence (§14.8.11): Postgres has native ADD COLUMN — NEVER
          // DROP/recreate the table (that CASCADE-drops its RLS policy + grants).
          // A NOT NULL add without a default may fail at apply time on a non-empty
          // table, but that is a legitimate migration error, not a silent drop.
          sql.push(generateAddColumn(table.name, col, driver));
        } else {
          // Needs 12-step rebuild (SQLite only)
          const rebuildSql = generate12StepRebuild(table, actualTable, driver);
          sql.push(...rebuildSql);
          break; // Rebuild handles all column changes at once
        }
      }
    }

    // Dropped columns (in actual but not desired, and not renamed)
    const renamedFrom = new Set(table.columns.filter(c => c.renameFrom).map(c => c.renameFrom));
    for (const actualCol of actualTable.columns) {
      if (!desiredColMap.has(actualCol.name) && !renamedFrom.has(actualCol.name)) {
        warnings.push(`W-SCHEMA-002: Dropping column "${actualCol.name}" from table "${table.name}" — data will be lost.`);
        if (driver === "postgres") {
          // S7-minimal fence: native per-column DROP; never rebuild-via-DROP-TABLE.
          sql.push(`ALTER TABLE ${quoteIdent(table.name)} DROP COLUMN ${quoteIdent(actualCol.name)};`);
          continue;
        }
        // DROP COLUMN requires 12-step rebuild on older SQLite
        const rebuildSql = generate12StepRebuild(table, actualTable, driver);
        sql.push(...rebuildSql);
        break;
      }
    }

    // 2c. CONSTRAINT DRIFT on a column present in BOTH — §38.6.2 rows 6/7/8.
    //
    // Never implemented until S290: the loop above handles ADD, the loop below
    // DROP, and RENAME is folded into ADD — so a column whose NOT NULL / UNIQUE
    // / DEFAULT / REFERENCES changed produced NO statement and NO warning, and
    // the planner reported "up to date". An adopter whose tables were already
    // applied could not obtain a declared constraint by any route.
    let rebuiltThisTable = false;
    for (const col of table.columns) {
      const actualCol = actualColMap.get(col.renameFrom && actualColMap.has(col.renameFrom) ? col.renameFrom : col.name);
      if (!actualCol) continue;
      const drift = columnConstraintDrift(col, actualCol);
      if (!drift.notNull && !drift.unique && !drift.references && !drift.default) continue;

      const qt = quoteIdent(table.name);
      const qc = quoteIdent(col.name);
      const wantNotNull = !!(col.notNull || hasReqPredicate(col));

      if (driver === "postgres") {
        // Postgres reconciles every one of these natively. This matters beyond
        // convenience: the §14.8.11 S7 fence forbids DROP/recreate on a
        // db-authoritative table (it CASCADE-drops the RLS policies + grants),
        // so the rebuild path must never be reachable on this driver.
        if (drift.notNull) {
          sql.push(`ALTER TABLE ${qt} ALTER COLUMN ${qc} ${wantNotNull ? "SET" : "DROP"} NOT NULL;`);
          if (wantNotNull) {
            warnings.push(
              `W-SCHEMA-CONSTRAINT-TIGHTENED: adding NOT NULL to existing column "${table.name}"."${col.name}". ` +
              `The migration will FAIL — correctly — if any existing row holds NULL there. ` +
              `Backfill first, or give the column a \`default(...)\`.`,
            );
          }
        }
        if (drift.unique) {
          // A named constraint, so the inverse operation can find it again.
          const cn = quoteIdent(`${table.name}_${col.name}_scrml_key`);
          sql.push(col.unique
            ? `ALTER TABLE ${qt} ADD CONSTRAINT ${cn} UNIQUE (${qc});`
            : `ALTER TABLE ${qt} DROP CONSTRAINT IF EXISTS ${cn};`);
          if (col.unique) {
            warnings.push(
              `W-SCHEMA-CONSTRAINT-TIGHTENED: adding UNIQUE to existing column "${table.name}"."${col.name}". ` +
              `The migration will FAIL — correctly — if duplicate values already exist there.`,
            );
          }
        }
        if (drift.default) {
          sql.push(col.default !== null
            ? `ALTER TABLE ${qt} ALTER COLUMN ${qc} SET DEFAULT ${col.default};`
            : `ALTER TABLE ${qt} ALTER COLUMN ${qc} DROP DEFAULT;`);
        }
        if (drift.references) {
          const cn = quoteIdent(`${table.name}_${col.name}_scrml_fkey`);
          sql.push(`ALTER TABLE ${qt} DROP CONSTRAINT IF EXISTS ${cn};`);
          if (col.references) {
            sql.push(
              `ALTER TABLE ${qt} ADD CONSTRAINT ${cn} FOREIGN KEY (${qc}) ` +
              `REFERENCES ${quoteIdent(col.references.table)}(${quoteIdent(col.references.column)});`,
            );
            warnings.push(
              `W-SCHEMA-CONSTRAINT-TIGHTENED: adding a FOREIGN KEY to existing column "${table.name}"."${col.name}" ` +
              `→ "${col.references.table}"."${col.references.column}". The migration will FAIL — correctly — if any ` +
              `existing row references a parent that does not exist. Reconcile the orphans first.`,
            );
          }
        }
        continue;
      }

      // SQLite. §38.6.2 gives unique drift its own non-destructive operations;
      // everything else needs the full-table rebuild (§38.6.3), because SQLite
      // cannot change a constraint via ALTER at all.
      if (drift.unique && !drift.notNull && !drift.references && !drift.default) {
        const idx = quoteIdent(`${table.name}_${col.name}_scrml_key`);
        sql.push(col.unique
          ? `CREATE UNIQUE INDEX IF NOT EXISTS ${idx} ON ${qt} (${qc});`
          : `DROP INDEX IF EXISTS ${idx};`);
        if (col.unique) {
          warnings.push(
            `W-SCHEMA-CONSTRAINT-TIGHTENED: adding UNIQUE to existing column "${table.name}"."${col.name}". ` +
            `The migration will FAIL — correctly — if duplicate values already exist there.`,
          );
        }
        continue;
      }

      // The rebuild DROPs and recreates the table. §38.6.3 says generate it
      // automatically; §38.6.2 says a DROP requires explicit confirmation.
      // Both hold: generate it, gate it behind the same `--allow-destructive`
      // switch as every other destructive operation, and when suppressed say
      // exactly what was not applied rather than reporting "up to date".
      if (rebuiltThisTable) continue;
      if (options.allowDestructive) {
        sql.push(...generate12StepRebuild(table, actualTable, driver));
        warnings.push(
          `W-SCHEMA-002: rebuilding table "${table.name}" to reconcile a constraint change on ` +
          `"${col.name}" (SQLite cannot ALTER a constraint). The table is recreated and its rows copied.`,
        );
      } else {
        warnings.push(
          `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED: column "${table.name}"."${col.name}" declares a constraint ` +
          `the database does not have (${Object.entries(drift).filter(([, v]) => v).map(([k]) => k).join(", ")}), ` +
          `and SQLite cannot change a constraint via ALTER (§38.6.3). Applying it requires a full-table ` +
          `rebuild, which DROPs and recreates the table — re-run with \`--allow-destructive\` to perform it. ` +
          `NOTHING WAS APPLIED for this column.`,
        );
      }
      rebuiltThisTable = true;
    }
  }

  // §14.8.11 — DB-authoritative DDL (S1 RLS + S6 bounded role). Emitted for every
  // `db-authoritative` table on a Postgres driver, for BOTH new and existing
  // tables: the statements are idempotent, so re-running a migration re-asserts
  // the policy/role (the never-clobber fence — a live policy survives a
  // re-migration). SQLite hard-fails E-DBAUTH-SQLITE upstream in codegen, so this
  // path only runs on Postgres. Appended AFTER all table create/alter statements
  // so the table always exists before ENABLE ROW LEVEL SECURITY runs.
  if (driver === "postgres") {
    for (const table of desired.tables) {
      if (table.dbAuthoritative) {
        sql.push(...generateDbAuthoritativeDDL(table));
      }
    }

    // §14.8.11 S292 — grant the bounded role on tables `?{}` TOUCHES but that are NOT
    // db-authoritative. [[g-dbauth-migrate-no-grants-for-unmarked-identity-table]]:
    // the grant above is per-TABLE, but the `SET LOCAL ROLE scrml_app` drop is emitted
    // per-QUERY in any request scope — so once ANY table is db-authoritative, an unmarked
    // table read at request time runs as `scrml_app` with zero grants and fails
    // `permission denied`. §14.8.10's corollary PRESCRIBES leaving the identity table
    // unmarked (you cannot tenant-scope the table that tells you the tenant), so the
    // documented shape was the broken one. bryan RULED direction (b) at S292: grant what
    // the queries actually touch.
    //
    // Gated on ≥1 db-authoritative table, because that is exactly when the role exists and
    // when the role-drop is emitted. With none, there is no `scrml_app` to grant to and
    // these statements would fail.
    //
    // NO RLS, NO POLICY, NO column-scoped UPDATE narrowing here — those are the
    // db-authoritative tier's guarantees and an unmarked table has deliberately not opted
    // into them. This grants exactly the access the app already demonstrably needs.
    const anyDbAuth = desired.tables.some((t) => t.dbAuthoritative);
    const queried = options.queriedTables;
    const queriedPrivs = options.queriedPrivileges;
    if (anyDbAuth && queried && queried.size > 0) {
      for (const table of desired.tables) {
        if (table.dbAuthoritative) continue;
        const key = String(table.name).toLowerCase();
        if (!queried.has(key)) continue;
        // Grant ONLY the privileges the queries actually exercise. Blanket CRUD here would
        // hand the bounded role DELETE on the identity table, which login merely SELECTs —
        // strictly more permissive than the db-authoritative path beside it. Absent
        // privilege info, fall back to SELECT (the least privilege that can make a read
        // work) rather than to CRUD.
        const privs = queriedPrivs?.get?.(key);
        const list = privs && privs.size > 0 ? [...privs].sort().join(", ") : "SELECT";
        const t = quoteIdent(table.name);
        sql.push(
          `-- §14.8.11: ${table.name} is not db-authoritative but is read under SET LOCAL ROLE ${DBAUTH_ROLE}.`,
          `GRANT ${list} ON ${t} TO ${DBAUTH_ROLE};`,
        );
      }
    }
    // §14.8.11.2 S4 — the SECURITY-DEFINER mutation choke. Emitted AFTER the
    // db-authoritative table DDL (the tables + tenant policy + bounded role must
    // exist first). The `scrml_has_cap` read helper is emitted ONCE when any `fn`
    // is present. All SECDEF/owner-role/grant statements are idempotent (CREATE OR
    // REPLACE FUNCTION, DO-block role, idempotent GRANT/REVOKE), so a re-migration
    // re-asserts them — and scrml NEVER emits a DROP FUNCTION / DROP ROLE, so the
    // never-clobber fence holds by construction for these objects.
    const fns = desired.fns ?? [];
    if (fns.length > 0) {
      const dbAuthTables = desired.tables.filter((t) => t.dbAuthoritative).map((t) => t.name);
      sql.push(generateScrmlHasCapDDL());
      for (const fn of fns) sql.push(...generateSecdefDDL(fn, dbAuthTables));
    }
  }

  // 3. Dropped tables (in actual but not desired).
  //
  // §14.8.11 M2 fence (ruled — Fork 3): a bare `DROP TABLE` is NEVER emitted by
  // default. On Postgres a `DROP TABLE` CASCADE-drops the table's attached RLS
  // policy, grants, and role membership — the exact db-authoritative security
  // objects the tier installs — so the destructive drop is gated behind an
  // explicit `--allow-destructive` opt-in (mirrors Prisma's destructive-change
  // gate). Suppressed → a `W-SCHEMA-DESTRUCTIVE-DROP` warning points the operator
  // at the opt-in; opted-in → the historical `W-SCHEMA-002` + the DROP. A
  // scrml-managed security object is a role/policy, never a table, so the
  // table-DROP gate is the whole fence at the table grain.
  for (const actualTable of actual.tables) {
    if (!desiredMap.has(actualTable.name)) {
      if (options.allowDestructive) {
        warnings.push(`W-SCHEMA-002: Dropping table "${actualTable.name}" — all data will be lost.`);
        sql.push(`DROP TABLE IF EXISTS ${quoteIdent(actualTable.name)};`);
      } else {
        warnings.push(
          `W-SCHEMA-DESTRUCTIVE-DROP: table "${actualTable.name}" exists in the database but ` +
          `not in <schema> — refusing to DROP it (on Postgres a DROP would CASCADE-drop any ` +
          `attached RLS policy, grants, and role membership). Re-run with --allow-destructive to ` +
          `drop it, or add "${actualTable.name}" to <schema> to keep it.`,
        );
      }
    }
  }

  return { sql, warnings };
}

/**
 * Generate CREATE TABLE SQL from a table declaration.
 *
 * Emits SQL-mirror constraints (PRIMARY KEY / NOT NULL / UNIQUE / DEFAULT /
 * REFERENCES) as before, then appends shared-core lowered constraints per
 * §39.5.8. Shared-core `req` adds `NOT NULL` (and a `CHECK (col != '')` for
 * text/blob), other shared-core predicates add `CHECK (...)` clauses.
 */
export function generateCreateTable(table, driver = "sqlite") {
  const colDefs = table.columns.map(col => {
    // On Postgres emit the native type (`uuid`, `decimal`, `timestamptz`, …);
    // on SQLite keep the affinity type (`col.type`) so existing output is
    // byte-identical.
    const columnType = driver === "postgres" ? mapPostgresType(col.scrmlType) : col.type;
    let def = `${quoteIdent(col.name)} ${columnType}`;
    if (col.primaryKey) def += " PRIMARY KEY";

    // SQL-mirror NOT NULL OR shared-core req → NOT NULL.
    // Avoid duplicate NOT NULL when both forms present.
    const wantsNotNull = col.notNull || hasReqPredicate(col);
    if (wantsNotNull) def += " NOT NULL";

    if (col.unique) def += " UNIQUE";
    if (col.default !== null) def += ` DEFAULT (${lowerDefaultToSql(col.default)})`;
    if (col.references) def += ` REFERENCES ${quoteIdent(col.references.table)}(${quoteIdent(col.references.column)})`;

    // §39.5.8 shared-core lowering: append CHECK clauses (and the req empty-
    // string check for text/blob).
    const checkClauses = lowerSharedCoreToChecks(col, driver);
    for (const clause of checkClauses) {
      def += ` ${clause}`;
    }

    return "  " + def;
  });

  return `CREATE TABLE ${quoteIdent(table.name)} (\n${colDefs.join(",\n")}\n);`;
}

// ---------------------------------------------------------------------------
// §14.8.11 DB-authoritative tier (Milestone 1 — reads-authoritative, Postgres).
//
// The spike-validated (real PG16) target shape for a `db-authoritative` table:
//   S6 — a bounded NOLOGIN NOBYPASSRLS role the per-request principal drops to
//        (MANDATORY: a superuser/table-owner BYPASSES `FORCE RLS`, so A1 without
//        S6 is a silent no-op — the exact "looks enforced and isn't" trap).
//   S1 — `ENABLE`+`FORCE ROW LEVEL SECURITY` + a tenant-isolation policy keyed on
//        the pinned `scrml.tenant` GUC (consumed, never derived — stays on the
//        invariant side of the §14.8.10 firewall). `current_setting(..., true)`
//        returns NULL (not an error) for a missing GUC → a NULL tenant matches no
//        row = fail-closed read.
//
// All statements are idempotent so a re-migration NEVER clobbers a live policy
// mid-flight: the role is guarded by a `duplicate_object` catch; ENABLE/FORCE/
// GRANT are naturally idempotent; the policy is `DROP POLICY IF EXISTS` +
// `CREATE POLICY` (only the scrml-managed `scrml_tenant_iso` name is touched —
// a hand-authored policy on the same table survives).
// ---------------------------------------------------------------------------

/** The bounded principal role the per-request A1 wrapper drops to (S6). */
export const DBAUTH_ROLE = "scrml_app";
/** The compiler-managed tenant-isolation policy name (S1). */
export const DBAUTH_POLICY = "scrml_tenant_iso";
/** The transaction-scoped GUC carrying the pinned tenant scalar (S2). */
export const DBAUTH_TENANT_GUC = "scrml.tenant";
/**
 * §14.8.11.2 S4 — the transaction-scoped GUC carrying the principal's capability
 * SET as a JSON array (`["void","reconcile"]`). Injected alongside the tenant GUC
 * by the A1 wrapper (server-resolved, never client-supplied — the E-REACTIVE-003
 * discipline `tenantId` already follows) and READ by the `scrml_has_cap(text)`
 * helper inside a SECURITY-DEFINER body.
 */
export const DBAUTH_CAPS_GUC = "scrml.principal.caps";

/**
 * Emit the S6 bounded-role DDL. Cluster-global and app-shared (a PG role is
 * cluster-global, not per-DB — the shared-`authenticator` PostgREST pattern), so
 * it is emitted once and guarded against duplicate creation.
 *
 * @returns {string} a single idempotent DO-block statement
 */
export function generateBoundedRoleDDL() {
  return (
    `DO $$ BEGIN CREATE ROLE ${DBAUTH_ROLE} NOLOGIN NOBYPASSRLS; ` +
    `EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
  );
}

/**
 * Emit the S1 (RLS + policy) + the per-table S6 GRANT DDL for one
 * `db-authoritative` table. Postgres-only; the caller (diffSchema on a postgres
 * driver) is responsible for gating on the driver.
 *
 * The policy casts the GUC to the `tenant_id` column's Postgres type so the
 * comparison is well-typed (`tenant_id = current_setting('scrml.tenant',
 * true)::uuid`). If the table declares no `tenant_id` column the comparison
 * falls back to a text compare (M1 keys tenant isolation on `tenant_id`; a
 * db-authoritative table is expected to carry one — the §14.8.10 convention).
 *
 * §14.8.11.2 S3 (writes-authority) — a per-column `immutable` keyword narrows the
 * bounded role's write authority. A Postgres column-level `REVOKE` CANNOT narrow a
 * table-level `GRANT`, so when ANY column is `immutable` the blanket table-level
 * `GRANT … UPDATE …` is RE-SHAPED to `GRANT SELECT, INSERT, DELETE` + a `REVOKE
 * UPDATE` (clears any prior table-level UPDATE, e.g. from an M1 migration) + a
 * column-scoped `GRANT UPDATE (<mutable cols>)`. Result: `scrml_app` can never
 * UPDATE an immutable column — the sole sanctioned path is the S4 SECDEF choke.
 * ANTI-REGRESSION: a table with ZERO immutable columns emits BYTE-IDENTICAL to M1
 * (the single table-level `GRANT SELECT, INSERT, UPDATE, DELETE`).
 *
 * @param {TableDecl} table — a table with `dbAuthoritative: true`
 * @returns {string[]} the ordered DDL statements
 */
export function generateDbAuthoritativeDDL(table) {
  const t = quoteIdent(table.name);
  const tenantCol = (table.columns ?? []).find((c) => c.name === "tenant_id");
  const castType = tenantCol ? mapPostgresType(tenantCol.scrmlType) : null;
  const guc = `current_setting('${DBAUTH_TENANT_GUC}', true)`;
  const rhs = castType ? `${guc}::${castType}` : guc;

  const cols = table.columns ?? [];
  const immutableCols = cols.filter((c) => isEffectivelyImmutable(c));

  // S6 — the bounded role's write grant.
  let grantStmts;
  if (immutableCols.length === 0) {
    // No immutable columns → a single table-level grant. In practice a
    // db-authoritative table always has at least its PK here (see
    // `isEffectivelyImmutable`), so this branch is now reached only by a
    // (malformed) table with neither a primary key nor a `tenant_id` — which the
    // `E-DBAUTH-NO-TENANT-COLUMN` pre-flight rejects before apply anyway. Retained
    // as the honest zero case rather than deleted.
    grantStmts = [`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${DBAUTH_ROLE};`];
  } else {
    // S3 — column-scoped write authority: no table-level UPDATE, only the mutable
    // columns. The REVOKE UPDATE clears any prior table-level grant (idempotent —
    // harmless on a fresh table, load-bearing when migrating from M1).
    const mutableCols = cols.filter((c) => !isEffectivelyImmutable(c));
    grantStmts = [
      `GRANT SELECT, INSERT, DELETE ON ${t} TO ${DBAUTH_ROLE};`,
      `REVOKE UPDATE ON ${t} FROM ${DBAUTH_ROLE};`,
    ];
    if (mutableCols.length > 0) {
      const colList = mutableCols.map((c) => quoteIdent(c.name)).join(", ");
      grantStmts.push(`GRANT UPDATE (${colList}) ON ${t} TO ${DBAUTH_ROLE};`);
    }
    // (all columns immutable → no UPDATE grant at all — insert-once, never-update.)
  }

  return [
    // S6 — the bounded principal role (idempotent).
    generateBoundedRoleDDL(),
    // S6 — grant the bounded role its write authority (table-level, or S3 column-scoped).
    ...grantStmts,
    // S1 — turn RLS on and FORCE it (so even the table owner is subject to it).
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    // S1 — the tenant-isolation policy, re-created idempotently (never clobbers a
    // hand-authored policy — only the scrml-managed name is dropped).
    `DROP POLICY IF EXISTS ${DBAUTH_POLICY} ON ${t};`,
    `CREATE POLICY ${DBAUTH_POLICY} ON ${t} USING ("tenant_id" = ${rhs});`,
  ];
}

// ---------------------------------------------------------------------------
// §14.8.11.2 DB-authoritative tier (Milestone 2 — writes-authoritative, Postgres).
//
// P2 is the FIRST milestone that crosses the §14.8.10 invariant/policy firewall:
// scrml begins emitting AUTHORIZATION (who-may-perform-which-operation), not just
// relocating the isolation invariant. The S4 SECURITY-DEFINER mutation choke is the
// sole sanctioned write path for a column `scrml_app` was revoked from (S3).
//
// SECDEF HARDENING is a CODEGEN INVARIANT (a SECDEF that forgot `SET search_path`
// is a CVE-2020-25695 privesc hole — WORSE than no enforcement):
//   • SECURITY DEFINER SET search_path = pg_catalog, public
//       (pg_catalog FIRST pins the built-ins against shadowing; public is REQUIRED
//        so the body's unqualified table refs — `UPDATE invoices …` in public —
//        resolve. `pg_temp` is deliberately NOT on the path.)
//   • owned by a bounded NOLOGIN owner role DISTINCT from scrml_app (a SECDEF runs
//     AS its owner; scrml_app lacks the immutable-column UPDATE, a superuser would
//     over-privilege the choke).
//   • REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO scrml_app (no ambient EXECUTE).
// Every identifier is escaped via quoteIdent (the M2-HIGH lesson) — and the parser
// already constrained fn/owner/arg names to `[A-Za-z_]\w*`, so a `$` can never
// enter and break a dollar-quote.
// ---------------------------------------------------------------------------

/**
 * §14.8.11.2 S4 — the `scrml_has_cap(text)` read helper. Emitted ONCE per apply
 * (idempotent CREATE OR REPLACE) when a schema declares ≥1 SECDEF `fn`. Reads the
 * txn-scoped `scrml.principal.caps` JSON-array GUC; a missing/unpinned GUC yields
 * FALSE (fail-closed — no caps ⇒ no privileged mutation). NOT security-definer
 * (a pure GUC read needs no elevated privilege); still search_path-pinned so the
 * `::jsonb` cast + `?` operator resolve to pg_catalog and cannot be shadowed.
 *
 * @returns {string}
 */
export function generateScrmlHasCapDDL() {
  return (
    `CREATE OR REPLACE FUNCTION scrml_has_cap(cap text) RETURNS boolean\n` +
    `  LANGUAGE sql STABLE\n` +
    `  SET search_path = pg_catalog, public\n` +
    `  AS $scrml_hascap$\n` +
    `    SELECT coalesce(current_setting('${DBAUTH_CAPS_GUC}', true)::jsonb ? cap, false)\n` +
    `  $scrml_hascap$;`
  );
}

/**
 * Pick a dollar-quote tag that does NOT occur in `body`, so an author's plpgsql
 * text can never accidentally terminate the `$…$` wrapper. Tries `$scrml_fn$`,
 * then `$scrml_fn0$`, `$scrml_fn1$`, … (correctness robustness, not a security
 * boundary — the body is compile-time author source at the same trust level as the
 * rest of the schema).
 */
function dollarTag(body) {
  let tag = "scrml_fn";
  let i = 0;
  while (body.includes(`$${tag}$`)) tag = `scrml_fn${i++}`;
  return `$${tag}$`;
}

/**
 * §14.8.11.2 S4 — emit the hardened SECURITY-DEFINER DDL for one `fn` declaration.
 * The body carries the plpgsql STATEMENTS only; the emitter OWNS the `BEGIN … END`
 * envelope and injects the `requires cap("x")` check as the FIRST statement inside
 * it, so the capability gate is un-bypassable and always runs first.
 *
 * The bounded owner role is granted full CRUD on the db-authoritative tables so the
 * body (running AS the owner) can mutate an immutable column scrml_app is revoked
 * from — but the owner is STILL subject to the tenant-isolation policy (which has no
 * TO-clause ⇒ applies to every role), so the SECDEF's writes STACK on top of tenant
 * isolation (the caps txn pins `scrml.tenant`; an unpinned txn ⇒ the body touches
 * zero rows, fail-closed). No permissive owner-bypass policy is emitted — that would
 * let the choke escape tenant scope.
 *
 * @param {SecdefFnDecl} fn — a parsed `fn` (name, args, owner, returns, cap, body)
 * @param {string[]} dbAuthTables — the db-authoritative table names in the schema
 * @returns {string[]} the ordered DDL statements
 */
export function generateSecdefDDL(fn, dbAuthTables = []) {
  const fnName = quoteIdent(fn.name);
  const owner = quoteIdent(fn.owner);
  const createArgs = (fn.args ?? [])
    .map((a) => `${quoteIdent(a.name)} ${mapPostgresType(a.type)}`)
    .join(", ");
  const typeArgs = (fn.args ?? []).map((a) => mapPostgresType(a.type)).join(", ");
  const signature = `${fnName}(${typeArgs})`; // ALTER/REVOKE/GRANT identify by arg TYPES
  const ret = mapPostgresType(fn.returns || "void");

  // The cap gate (first statement inside BEGIN). The cap value came from the parser
  // bounded by quotes (no `'` inside); escaped anyway (SQL single-quote doubling).
  // The call is SCHEMA-QUALIFIED (`public.scrml_has_cap`) — belt-and-suspenders over
  // the pinned `search_path`, so the guard resolves to the compiler-installed helper
  // even if an operator ever re-grants CREATE on `public` to an untrusted role (the
  // CVE-2020-25695 shadowing surface). The helper is installed unqualified into the
  // migrator's default schema (public in the standard deploy — same as the tables).
  const capEsc = String(fn.cap ?? "").replace(/'/g, "''");
  const capGuard = fn.cap
    ? `    IF NOT public.scrml_has_cap('${capEsc}') THEN RAISE EXCEPTION 'denied'; END IF;\n`
    : "";

  const bodyText = indentPlpgsqlBody(fn.body ?? "");
  const tag = dollarTag(fn.body ?? "");

  const stmts = [];

  // 1. the bounded NOLOGIN owner role (idempotent; distinct from scrml_app).
  stmts.push(
    `DO $scrml_secdef$ BEGIN CREATE ROLE ${owner} NOLOGIN NOBYPASSRLS; ` +
      `EXCEPTION WHEN duplicate_object THEN NULL; END $scrml_secdef$;`,
  );
  // 2. provision the owner so the (non-superuser) migrator can reassign the function
  //    to it below — SECURITY-CRITICAL: without the reassignment the SECDEF would run
  //    as the powerful migrator, not the bounded owner. `ALTER FUNCTION … OWNER TO`
  //    requires (a) the migrator can SET ROLE to the owner and (b) the owner holds
  //    CREATE on the function's schema. Both idempotent; both succeed on first deploy
  //    (the migrator created the owner ⇒ holds ADMIN OPTION). PG16 plain GRANT
  //    membership defaults SET TRUE (PG15-portable). (A cluster where a DIFFERENT
  //    migrator pre-created the owner role hits the M1 cluster-global-role open.)
  stmts.push(`GRANT ${owner} TO CURRENT_USER;`);
  stmts.push(`GRANT CREATE ON SCHEMA public TO ${owner};`);
  // 3. grant the owner CRUD on the db-authoritative tables (table-level UPDATE, i.e.
  //    including the immutable columns scrml_app cannot touch). Idempotent.
  for (const tbl of dbAuthTables) {
    stmts.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteIdent(tbl)} TO ${owner};`);
  }
  // 4. the hardened SECDEF function (idempotent CREATE OR REPLACE).
  stmts.push(
    `CREATE OR REPLACE FUNCTION ${fnName}(${createArgs}) RETURNS ${ret}\n` +
      `  LANGUAGE plpgsql\n` +
      `  SECURITY DEFINER\n` +
      `  SET search_path = pg_catalog, public\n` +
      `  AS ${tag}\n` +
      `  BEGIN\n` +
      capGuard +
      bodyText +
      `\n  END\n` +
      `  ${tag};`,
  );
  // 5. bind ownership (the SECDEF now runs as the bounded owner, NOT the migrator).
  stmts.push(`ALTER FUNCTION ${signature} OWNER TO ${owner};`);
  // 6. lock down EXECUTE — no ambient PUBLIC EXECUTE; only the runtime role may CALL.
  stmts.push(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC;`);
  stmts.push(`GRANT EXECUTE ON FUNCTION ${signature} TO ${DBAUTH_ROLE};`);

  return stmts;
}

/**
 * Re-indent a plpgsql body (the `"""…"""` content) to sit cleanly inside the
 * emitter-owned `BEGIN … END`: trim outer blank lines, strip the common leading
 * indentation, then indent every non-empty line by 4 spaces. Readability only —
 * plpgsql is whitespace-insensitive.
 */
function indentPlpgsqlBody(body) {
  const lines = String(body).replace(/\t/g, "  ").split("\n");
  // Drop leading/trailing blank lines.
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) return "";
  // Common leading whitespace across non-blank lines.
  const indents = lines
    .filter((l) => l.trim() !== "")
    .map((l) => (l.match(/^[ ]*/) || [""])[0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((l) => (l.trim() === "" ? "" : "    " + l.slice(common)))
    .join("\n");
}

/**
 * Generate ALTER TABLE ADD COLUMN SQL.
 */
function generateAddColumn(tableName, col, driver = "sqlite") {
  let def = `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${quoteIdent(col.name)} ${col.type}`;

  // NOT NULL on ADD COLUMN requires a default (handled by the diff
  // canSimpleAdd guard). When both shared-core req and a default are present,
  // emit NOT NULL.
  const wantsNotNull = (col.notNull || hasReqPredicate(col)) && col.default !== null;
  if (wantsNotNull) def += " NOT NULL";

  if (col.unique) def += " UNIQUE";
  if (col.default !== null) def += ` DEFAULT (${lowerDefaultToSql(col.default)})`;
  if (col.references) def += ` REFERENCES ${quoteIdent(col.references.table)}(${quoteIdent(col.references.column)})`;

  // Shared-core CHECK clauses (per §39.5.8).
  const checkClauses = lowerSharedCoreToChecks(col, driver);
  for (const clause of checkClauses) {
    def += ` ${clause}`;
  }

  return def + ";";
}

/**
 * Returns true if the column has a shared-core `req` predicate.
 */
function hasReqPredicate(col) {
  return Array.isArray(col.sharedCorePredicates)
    && col.sharedCorePredicates.some(p => p.name === "req");
}

/**
 * Lower a column's shared-core predicates to standard SQL DDL CHECK clauses
 * (and, for `req` on text/blob, an additional CHECK for the empty-string
 * exclusion). Returns the clauses as an array of strings, in source order;
 * the caller concatenates them with leading whitespace.
 *
 * Per §39.5.8:
 *
 *   req               → NOT NULL (emitted by caller) + (text/blob only)
 *                       CHECK (col != '')
 *   length(<rel>)     → CHECK (length(col) <op> N)
 *   pattern(/re/)     → driver-specific:
 *                       SQLite/MySQL: CHECK (col REGEXP 're')
 *                       Postgres:     CHECK (col ~ 're')
 *   min(n)/max(n)     → CHECK (col >= n) / CHECK (col <= n)
 *   gt/lt/gte/lte/eq/neq → analogous CHECK (col <op> n)
 *   oneOf([v1,v2,...]) → CHECK (col IN (v1,v2,...))
 *   notIn([v1,v2,...]) → CHECK (col NOT IN (v1,v2,...))
 *
 * The `?{}` SQL passthrough block is inviolable per §39.5.8 line 16447 — this
 * function emits ONLY DDL constraint clauses; it never touches `?{}` text.
 *
 * @param {ColumnDecl} col
 * @param {"sqlite"|"postgres"|"mysql"} driver
 * @returns {string[]}
 */
function lowerSharedCoreToChecks(col, driver) {
  const out = [];
  const preds = col.sharedCorePredicates ?? [];
  const colName = col.name;
  const quotedCol = quoteIdent(colName);

  for (const p of preds) {
    switch (p.name) {
      case "req": {
        // §39.5.8 line 16445: req → NOT NULL + (text/blob only) CHECK (col != '').
        // The NOT NULL is emitted by generateCreateTable / generateAddColumn at
        // the column-clause level. Here we add the empty-string check ONLY for
        // string-shaped columns (text/blob). Numeric/timestamp columns can't
        // hold the empty string anyway.
        if (col.scrmlType === "text" || col.scrmlType === "blob") {
          out.push(`CHECK (${quotedCol} != '')`);
        }
        break;
      }
      case "length": {
        const inner = lowerLengthArg(p.arg, quotedCol);
        if (inner !== null) out.push(`CHECK (${inner})`);
        break;
      }
      case "pattern": {
        const re = stripPatternLiteral(p.arg);
        if (re === null) break;
        if (driver === "postgres") {
          out.push(`CHECK (${quotedCol} ~ '${escapeSqlString(re)}')`);
        } else {
          // sqlite + mysql
          out.push(`CHECK (${quotedCol} REGEXP '${escapeSqlString(re)}')`);
        }
        break;
      }
      case "min":
        out.push(`CHECK (${quotedCol} >= ${p.arg})`);
        break;
      case "max":
        out.push(`CHECK (${quotedCol} <= ${p.arg})`);
        break;
      case "gt":
        out.push(`CHECK (${quotedCol} > ${p.arg})`);
        break;
      case "lt":
        out.push(`CHECK (${quotedCol} < ${p.arg})`);
        break;
      case "gte":
        out.push(`CHECK (${quotedCol} >= ${p.arg})`);
        break;
      case "lte":
        out.push(`CHECK (${quotedCol} <= ${p.arg})`);
        break;
      case "eq":
        out.push(`CHECK (${quotedCol} = ${p.arg})`);
        break;
      case "neq":
        out.push(`CHECK (${quotedCol} != ${p.arg})`);
        break;
      case "oneOf": {
        const items = lowerArrayLiteralToSqlItems(p.arg);
        if (items === null) break;
        out.push(`CHECK (${quotedCol} IN (${items}))`);
        break;
      }
      case "notIn": {
        const items = lowerArrayLiteralToSqlItems(p.arg);
        if (items === null) break;
        out.push(`CHECK (${quotedCol} NOT IN (${items}))`);
        break;
      }
      // No default — unknown predicates were already filtered by
      // parseSharedCorePredicates' SCHEMA_LOCUS_PREDICATES gate.
    }
  }

  return out;
}

/**
 * Lower the `length(<relational>)` argument to a SQL boolean expression.
 * `arg` is the raw string between the parens of `length(...)`. Per the spec,
 * the inner is a relational predicate: `>=N`, `>N`, `<=N`, `<N`, `==N`, `!=N`.
 *
 * @returns {string|null} — SQL like `length("col") >= 2`, or null on parse fail.
 */
function lowerLengthArg(arg, quotedCol) {
  if (typeof arg !== "string") return null;
  const m = arg.trim().match(/^(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const op = m[1] === "==" ? "=" : m[1];
  const n = m[2];
  return `length(${quotedCol}) ${op} ${n}`;
}

/**
 * Extract the regex source from `pattern(/re/)`. Accepts the slash-delimited
 * form (`/re/`) and a bare-string fallback (`'re'` or `"re"`). Returns null on
 * parse failure.
 */
function stripPatternLiteral(arg) {
  if (typeof arg !== "string") return null;
  const trimmed = arg.trim();
  // /re/ form
  if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  // /re/flags form — strip flags (DDL-level CHECK can't honor JS regex flags;
  // emit pattern bare so the DBMS regex engine evaluates it case-sensitively
  // unless the source literal had no flags). For now, drop flags conservatively.
  const flagMatch = trimmed.match(/^\/(.+)\/[gimsuy]*$/);
  if (flagMatch) return flagMatch[1];
  // 'string' / "string" fallback
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return null;
}

/**
 * Extract array-literal contents from `oneOf([v1, v2, ...])` or
 * `notIn([...])`. Returns the verbatim contents (without surrounding `[` `]`).
 *
 * This is the RAW extraction only — see `lowerArrayLiteralToSqlItems` for the
 * SQL-literal lowering that callers actually emit into a `CHECK … IN (…)`.
 *
 * @returns {string|null}
 */
function stripArrayLiteral(arg) {
  if (typeof arg !== "string") return null;
  const trimmed = arg.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  return trimmed.slice(1, -1).trim();
}

/**
 * §14.8.11.2 S3 — is this column immutable to the bounded `scrml_app` role?
 *
 * A column is immutable if the author WROTE `immutable`, **or** if it is the
 * table's PRIMARY KEY, **or** if it is `tenant_id`.
 *
 * The two automatic members are RULED S288 (bryan), and the reasoning is the same
 * one §14.8.10 already used to reject a per-table tenant opt-in: *a forgettable
 * declaration protecting a security invariant is the wrong shape.* Before this,
 * a db-authoritative table's PK and `tenant_id` were still UPDATE-grantable —
 * cross-tenant re-pointing is blocked by the RLS `WITH CHECK` (it fails safe), but
 * a WITHIN-tenant primary-key UPDATE succeeded. For a ledger, silently re-pointing
 * a row's identity under its own tenant is precisely the class the tier's
 * audit-defensibility claim rests on.
 *
 * CONSEQUENCE, stated plainly: a db-authoritative table now always takes the
 * column-scoped grant path, because it always has at least a PK. The "zero
 * immutable columns → byte-identical to M1" property therefore no longer holds for
 * db-authoritative tables — that is the intended semantic change, not an oversight.
 * Non-db-authoritative tables are untouched (this helper is only consulted from
 * `generateDbAuthoritativeDDL`).
 *
 * An author who genuinely needs a mutable PK has to say so by not marking the table
 * db-authoritative; there is deliberately no per-column opt-OUT, for the same reason
 * there is no per-table tenant opt-in.
 */
function isEffectivelyImmutable(col) {
  if (!col) return false;
  if (col.immutable) return true;
  if (col.primaryKey) return true;
  return typeof col.name === "string" && col.name.toLowerCase() === "tenant_id";
}

/**
 * Lower a `default(...)` value from its scrml form to its SQL form.
 *
 * A scrml STRING literal in either quote form lowers to a SQL single-quoted
 * string literal — `default("US")` previously emitted `DEFAULT ("US")`, a SQL
 * IDENTIFIER, failing at apply with `column "US" does not exist`. That is the
 * SAME literal-as-identifier class the S288 `oneOf` fix addressed, in the sibling
 * path: the fix landed on the item list and MISSED `default()`, one function
 * away. An adopter caught the incomplete fix (S4).
 *
 * Anything that is NOT a scrml literal is passed through VERBATIM, and here that
 * is CORRECT rather than a fallback: a `default()` argument is legitimately a SQL
 * expression — `default(now())`, `default(CURRENT_TIMESTAMP)`, `default(gen_random_uuid())`.
 * This is the deliberate divergence from `oneOf`/`notIn`, where a non-literal item
 * is meaningless and now hard-errors (`E-SCHEMA-010`). Same helper, different
 * disposition for the same residue, because the two positions genuinely differ.
 *
 * @returns {string}
 */
function lowerDefaultToSql(rawDefault) {
  if (typeof rawDefault !== "string") return rawDefault;
  const lowered = lowerArrayItemToSqlLiteral(rawDefault);
  return lowered === null ? rawDefault : lowered;
}

/**
 * Split an array-literal's interior on TOP-LEVEL commas, honoring string
 * literals (`"…"` / `'…'`, with backslash escapes) and nested `(`/`[`/`{`
 * grouping. `"a,b", 'c'` → `['"a,b"', "'c'"]`.
 *
 * @param {string} inner — the text between `[` and `]`
 * @returns {string[]}
 */
function splitTopLevelItems(inner) {
  const items = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (ch === "," && depth === 0) {
      items.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  items.push(inner.slice(start));
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Lower ONE `oneOf`/`notIn` array item from scrml source form to its SQL
 * literal form. Returns `null` if the item is not a shape this lowering is
 * specified for (see `lowerArrayLiteralToSqlItems` for the all-or-nothing rule).
 *
 * scrml source form            → SQL literal
 *   `"income"` (CANONICAL)     → `'income'`
 *   `'income'`                 → `'income'`
 *   `.Admin`   (bare variant)  → `'Admin'`     (§53.15 / §41.15.6)
 *   `42`, `-1`, `3.5`          → verbatim
 *   `true` / `false`           → verbatim
 *
 * @returns {string|null}
 */
function lowerArrayItemToSqlLiteral(item) {
  const t = item.trim();
  if (t.length === 0) return null;

  // scrml string literal → SQL string literal. scrml's CANONICAL string quote is
  // `"` (§5.1 attribute strings, §4.18.3 display-text), which in SQL is an
  // IDENTIFIER quote — passing it through verbatim is the g-db-migrate-check-
  // constraint-oneof-pattern defect (`IN ("income")` → `column "income" does not
  // exist`). Both quote forms normalize to a SQL single-quoted literal.
  if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
      (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) {
    const raw = t.slice(1, -1).replace(/\\(["'\\])/g, "$1");
    return `'${escapeSqlString(raw)}'`;
  }

  // Bare-variant literal `.Admin` → the variant NAME as a string. §41.15.6:
  // "The variant-literal `.Admin` mechanically lowers to the string `'Admin'`
  // exactly as a bare enum field does — no new mini-DSL."
  const variant = /^\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(t);
  if (variant) return `'${escapeSqlString(variant[1])}'`;

  // Numeric literal → verbatim.
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return t;

  // Boolean literal → verbatim (SQL TRUE/FALSE).
  if (t === "true" || t === "false") return t;

  // Anything else (notably a BARE IDENTIFIER — `oneOf([user, admin])`) is NOT a
  // literal, and §39.5.8 specifies a "literal list". Unhandled here on purpose:
  // treating a bareword as a string would INVENT a meaning the SPEC does not
  // state (a widening — pa-base §8), and rejecting it is a newly-rejecting
  // change owing a ruling. Both are bryan's call; until then the caller
  // preserves the pre-existing verbatim behavior for such lists.
  return null;
}

/**
 * Lower an `oneOf([…])` / `notIn([…])` argument to the SQL `IN (…)` item list.
 *
 * ALL-OR-NOTHING: if EVERY item lowers to a specified SQL literal, the lowered
 * list is returned; if ANY item is an unrecognized shape, the ENTIRE interior is
 * returned VERBATIM — the exact pre-fix behavior. A mixed list (some items
 * converted, some raw) would be incoherent, and silently DROPPING the CHECK
 * would be a silent constraint downgrade (the failure class the §14.8.11 M2
 * near-miss guard exists to prevent).
 *
 * Governing sentences (§39.5.8 + §41.15.6 + §53.15): the specified OUTPUT of the
 * enum/`oneOf` lowering is `CHECK (col IN ('Variant1', 'Variant2', …))` — SQL
 * single-quoted STRING literals. §39.5.8's "the literal list is verbatim to the
 * SQL `IN` clause" note only produces that output when the author happens to
 * have written SQL-flavored single quotes, and is corrected in the same landing.
 *
 * @returns {string|null}
 */
function lowerArrayLiteralToSqlItems(arg) {
  const inner = stripArrayLiteral(arg);
  if (inner === null) return null;
  if (inner.length === 0) return inner;

  const items = splitTopLevelItems(inner);
  if (items.length === 0) return inner;

  const lowered = [];
  for (const item of items) {
    const sql = lowerArrayItemToSqlLiteral(item);
    // Unrecognized shape → whole list verbatim. Reaching the emitter with one is
    // now a compile error (`E-SCHEMA-010`, `findNonLiteralSetItems`), so this is
    // the belt-and-braces path for a caller that skipped the check (e.g. an older
    // `scrml db-migrate` invocation against a source the compiler never saw).
    if (sql === null) return inner;
    lowered.push(sql);
  }
  return lowered.join(", ");
}

/**
 * §39.5.8 / `E-SCHEMA-010` — the `oneOf([…])` / `notIn([…])` items on a column
 * that are NOT scrml literals (in practice: a BARE IDENTIFIER, `oneOf([user, admin])`).
 *
 * §39.5.8 specifies a *literal* list, and a bareword is not one — it lowers to a
 * SQL identifier and fails at apply with `column "user" does not exist`. RULED
 * S288 (bryan, option b): reject it at COMPILE time rather than widen a bareword
 * into a string. Rejecting is the reversible direction, it moves the failure from
 * mid-migration to compile, and the migration cost was measured at zero — the only
 * two sites teaching the form were scrml's own reference doc, corrected in #191.
 *
 * @param {{ sharedCorePredicates?: Array<{name: string, arg: string|null}> }} col
 * @returns {Array<{ predicate: string, item: string }>} empty when the column is clean
 */
/**
 * Turn a malformed `references …` snippet into the canonical §39.5.5 form for
 * the E-SCHEMA-011 message, so the diagnostic tells the author exactly what to
 * type instead of only what is wrong.
 *
 * `references(owners.id)` → `owners(id)` · `references owners (id)` →
 * `owners(id)` · `references owners.id` → `owners(id)`. When the two
 * identifiers cannot be recovered, fall back to the grammar placeholder rather
 * than guessing.
 *
 * @param {string} raw the snippet recorded in `col.malformedReferences`
 * @returns {string}
 */
export function referencesHint(raw) {
  const s = String(raw ?? "");
  // Any two dot- or paren-separated identifiers after the keyword.
  const m =
    s.match(/references\s*\(\s*([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\)/i) ||
    s.match(/references\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*\)/i) ||
    s.match(/references\s+([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)/i);
  return m ? `${m[1]}(${m[2]})` : "<table>(<column>)";
}

export function findNonLiteralSetItems(col) {
  const out = [];
  for (const p of col?.sharedCorePredicates ?? []) {
    if (p?.name !== "oneOf" && p?.name !== "notIn") continue;
    const inner = stripArrayLiteral(p.arg);
    if (inner === null || inner.length === 0) continue;
    for (const item of splitTopLevelItems(inner)) {
      if (lowerArrayItemToSqlLiteral(item) === null) out.push({ predicate: p.name, item });
    }
  }
  return out;
}

/**
 * Escape single-quotes for SQL string literal embedding (regex source for the
 * `pattern()` lowering). Not a full SQL injection guard — the regex source is
 * developer-authored at compile time, not user-supplied at runtime.
 */
function escapeSqlString(s) {
  return s.replace(/'/g, "''");
}

/**
 * Generate the 12-step SQLite ALTER TABLE workaround (§38.6.3).
 * Used when column changes can't be done with simple ALTER TABLE.
 */
function generate12StepRebuild(desiredTable, actualTable, driver = "sqlite") {
  const tmpName = `_scrml_tmp_${desiredTable.name}`;
  const lines = [];

  // 1. Create new table with desired schema (temp name)
  lines.push(generateCreateTable({ ...desiredTable, name: tmpName }, driver));

  // 2. Copy data — map columns that exist in both
  const desiredCols = desiredTable.columns.map(c => c.name);
  const actualCols = new Set(actualTable.columns.map(c => c.name));
  const renames = new Map(desiredTable.columns.filter(c => c.renameFrom).map(c => [c.name, c.renameFrom]));

  const selectCols = desiredCols.map(name => {
    if (renames.has(name) && actualCols.has(renames.get(name))) {
      return `${quoteIdent(renames.get(name))} AS ${quoteIdent(name)}`;
    }
    if (actualCols.has(name)) {
      return `${quoteIdent(name)}`;
    }
    // New column — use default or NULL
    const col = desiredTable.columns.find(c => c.name === name);
    if (col?.default !== null) {
      return `${col.default} AS ${quoteIdent(name)}`;
    }
    return `NULL AS ${quoteIdent(name)}`;
  });

  lines.push(`INSERT INTO ${quoteIdent(tmpName)} (${desiredCols.map(n => quoteIdent(n)).join(", ")}) SELECT ${selectCols.join(", ")} FROM ${quoteIdent(desiredTable.name)};`);

  // 3. Drop old table
  lines.push(`DROP TABLE ${quoteIdent(desiredTable.name)};`);

  // 4. Rename temp to final
  lines.push(`ALTER TABLE ${quoteIdent(tmpName)} RENAME TO ${quoteIdent(desiredTable.name)};`);

  return lines;
}

// ---------------------------------------------------------------------------
// Postgres schema introspection (`scrml introspect`, BaaS #3)
//
// The inverse of the SQLite `readActualSchema` + `generateCreateTable` path:
// read a LIVE Postgres database's structure and emit the equivalent scrml
// `<schema>` SOURCE text (NOT SQL DDL). Eases adopter migration. Additive.
//
// PRINCIPLE — SELF-VERIFYING EMIT. `parseSchemaBlock` (this file) is a regex
// parser with real footguns (`[^}]*` table body, line-split columns, a
// `default\(([^)]+)\)` paren-delimited capture, an in-string predicate-name
// scanner). Rather than enumerate those footguns one-by-one, emitScrmlSchemaSource
// GUARANTEES its output round-trips: it re-parses its OWN output via
// parseSchemaBlock and drops any field (default / FK reference / column / table)
// that does NOT survive identically — WITH a W-INTROSPECT-* warning naming what
// was dropped and why. This is the honest best-effort-migration model (Prisma
// db pull / Drizzle introspect: emit what round-trips, loudly flag the rest).
//
// v1 scope (SPEC §39): base tables · columns · single-column PRIMARY KEY /
// NOT NULL / UNIQUE / DEFAULT / single-column FOREIGN KEY · the PG-type map.
// Composite constraints, function/expression defaults, and non-representable
// identifiers are SKIPPED-with-a-warning, never silently corrupted. Out of
// scope: CHECK → shared-core recovery, indexes, enums, views, non-public
// schemas, sequences (serial → integer).
// ---------------------------------------------------------------------------

/**
 * Postgres `information_schema.columns.data_type` (and common pg_catalog short
 * aliases) → scrml `<schema>` column type (SPEC §39.4:
 * text | integer | real | blob | boolean | timestamp). `real` and `boolean`
 * are valid §39.4 column types, so the numeric / boolean families map without
 * loss. Types with no scrml equivalent fall through mapPgTypeToScrml's default
 * to `text` + a warning.
 */
const PG_TYPE_MAP = {
  // integer family
  "integer": "integer", "int": "integer", "int2": "integer", "int4": "integer",
  "int8": "integer", "smallint": "integer", "bigint": "integer",
  "smallserial": "integer", "serial": "integer", "bigserial": "integer",
  // text family
  "text": "text", "varchar": "text", "character varying": "text",
  "char": "text", "character": "text", "bpchar": "text", "citext": "text",
  // boolean
  "boolean": "boolean", "bool": "boolean",
  // real family
  "numeric": "real", "decimal": "real", "real": "real",
  "double precision": "real", "float4": "real", "float8": "real",
  // timestamp family
  "timestamp": "timestamp", "timestamp without time zone": "timestamp",
  "timestamptz": "timestamp", "timestamp with time zone": "timestamp",
  "date": "timestamp",
};

/**
 * Map a raw Postgres data_type string to a scrml `<schema>` column type.
 * Returns `{ scrmlType, unmapped }` — `unmapped: true` (with `scrmlType: "text"`)
 * when the PG type has no scrml equivalent, so the caller can raise
 * W-INTROSPECT-TYPE-UNMAPPED.
 *
 * @param {string} pgType
 * @returns {{ scrmlType: "text"|"integer"|"real"|"boolean"|"timestamp", unmapped: boolean }}
 */
export function mapPgTypeToScrml(pgType) {
  const key = String(pgType ?? "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PG_TYPE_MAP, key)) {
    return { scrmlType: PG_TYPE_MAP[key], unmapped: false };
  }
  return { scrmlType: "text", unmapped: true };
}

/**
 * Whether a scrml identifier (table or column name) is representable in
 * `<schema>` source. parseSchemaBlock scans names with `\w+`, so a Postgres
 * name that is non-`\w` (`"user-profiles"`, `"my col"`, a quoted reserved word)
 * cannot round-trip and MUST NOT be emitted verbatim.
 */
function isRepresentableIdentifier(name) {
  return typeof name === "string" && /^[A-Za-z_]\w*$/.test(name);
}

/**
 * Strip a single trailing Postgres type-cast from a default expression. The
 * cast type may be schema-qualified (`::public.mood`), quoted (`::"My Type"`),
 * multi-word (`::character varying`), and/or an array (`::int[]`).
 */
function stripPgCast(s) {
  return s.replace(/::(?:"?\w+"?\.)?"?\w[\w ]*"?(\[\])?$/, "").trim();
}

/**
 * Whether a (cast-stripped, paren-normalized) Postgres default is a scrml
 * `default(<literal>)` LITERAL (SPEC §39 `default '(' literal ')'`): a number,
 * a boolean, a bare keyword (`CURRENT_TIMESTAMP`), or a single-quoted string
 * with NO parens inside. NOTE: this is a NECESSARY-not-sufficient screen — the
 * self-verify (defaultRoundTrips) is the final authority, catching literals that
 * still mis-parse (`'{}'` braces, embedded newlines, in-string predicate names).
 */
function isEmittableDefaultLiteral(s) {
  if (typeof s !== "string" || s === "") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return true;            // number
  if (/^(?:true|false)$/i.test(s)) return true;            // boolean
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return true;     // bare keyword (CURRENT_TIMESTAMP, …)
  if (/^'(?:[^'()]|'')*'$/.test(s)) return true;           // single-quoted string, no parens inside
  return false;
}

/**
 * Classify a Postgres `column_default` for emission (the SEMANTIC screen; the
 * self-verify is the SYNTACTIC authority on top). Returns:
 *   { kind: "none" }                   — NULL / empty → drop, no warning
 *   { kind: "sequence" }               — `nextval(...)` → drop, no warning
 *                                        (serial → integer; documented mapping)
 *   { kind: "literal", value }         — a candidate scrml default(<literal>)
 *   { kind: "expression", value: raw } — a non-literal default (function call /
 *                                        expression) → drop + W-INTROSPECT-
 *                                        DEFAULT-DROPPED
 *
 * Postgres wraps a negative-numeric default in parens (`DEFAULT -1` serializes
 * as `(-1)`); that wrapping pair is stripped so the literal survives (a negative
 * literal IS representable — `default(-1)` round-trips).
 *
 * @param {string|null|undefined} rawDef
 */
function classifyPgDefault(rawDef) {
  if (typeof rawDef !== "string") return { kind: "none" };
  const trimmed = rawDef.trim();
  if (trimmed === "") return { kind: "none" };
  // Sequence-backed serial/identity default — dropped (serial → integer).
  if (/^nextval\s*\(/i.test(trimmed)) return { kind: "sequence" };
  let candidate = stripPgCast(trimmed);
  // Postgres parenthesizes negative numeric defaults: `(-1)` → `-1`.
  const parenNum = candidate.match(/^\(\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  if (parenNum) candidate = parenNum[1];
  if (isEmittableDefaultLiteral(candidate)) return { kind: "literal", value: candidate };
  return { kind: "expression", value: trimmed };
}

/**
 * SELF-VERIFY probe: does `default(<literal>)` survive a round-trip through
 * parseSchemaBlock IN ISOLATION? Emits a minimal one-column probe schema and
 * confirms the parsed column recovered EXACTLY this default and introduced NO
 * spurious shared-core predicate (an in-string predicate name like `'req'`) and
 * NO extra table/column (a `}` in the literal truncates the probe body). The
 * probe is byte-faithful to the real emission (same `{ … }` body + line shape),
 * so any breakage that would occur in context also breaks the probe.
 */
function defaultRoundTrips(scrmlType, literal) {
  const probe = `<schema>\n  _probe {\n    _col: ${scrmlType} default(${literal})\n  }\n</>`;
  const parsed = parseSchemaBlock(probe);
  if (parsed.tables.length !== 1) return false;
  const t = parsed.tables[0];
  if (t.name !== "_probe" || t.columns.length !== 1) return false;
  const c = t.columns[0];
  return c.name === "_col"
    && c.default === literal
    && (c.sharedCorePredicates?.length ?? 0) === 0;
}

/**
 * SELF-VERIFY probe: does `references <table>(<column>)` survive a round-trip?
 * A target whose NAME collides with a shared-core predicate (`references max(id)`)
 * re-parses as BOTH a reference AND a spurious `max(id)` predicate — that is a
 * structural divergence, so the reference is dropped.
 */
function referencesRoundTrips(refTable, refColumn) {
  const probe = `<schema>\n  _probe {\n    _col: integer references ${refTable}(${refColumn})\n  }\n</>`;
  const parsed = parseSchemaBlock(probe);
  if (parsed.tables.length !== 1) return false;
  const t = parsed.tables[0];
  if (t.name !== "_probe" || t.columns.length !== 1) return false;
  const c = t.columns[0];
  return c.name === "_col"
    && c.references != null
    && c.references.table === refTable
    && c.references.column === refColumn
    && (c.sharedCorePredicates?.length ?? 0) === 0;
}

/**
 * Push a composite-constraint skip warning (shared by the PK/UNIQUE and FK
 * grouping loops).
 */
function pushCompositeSkip(warnings, tableName, type, cols) {
  warnings.push(
    `W-INTROSPECT-COMPOSITE-CONSTRAINT-SKIPPED: table "${tableName}" ${type} ` +
    `(${cols.join(", ")}) is a composite (multi-column) constraint — scrml ` +
    `<schema> supports single-column constraints only (v1); skipped. Re-add it ` +
    `via a ?{} migration block.`,
  );
}

/**
 * Read every base-table name in the current schema (used by the CLI to build a
 * helpful "available tables" list when `--table <name>` names a missing table).
 *
 * @param {object} sql — a Bun.SQL tagged-template handle (async)
 * @returns {Promise<string[]>}
 */
export async function readTableNamesPg(sql) {
  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema = current_schema()
      AND table_name <> '_scrml_migrations'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name);
}

/**
 * Read the actual schema from a LIVE Postgres database via `information_schema`
 * — the ASYNC Postgres sibling of the sync SQLite `readActualSchema`.
 *
 * Returns the SAME structure as readActualSchema, extended per column with
 * `unique` + `references`. Column `type` is the RAW Postgres `data_type` string;
 * emitScrmlSchemaSource maps it. Composite (multi-column) constraints are
 * SKIPPED with a W-INTROSPECT-COMPOSITE-CONSTRAINT-SKIPPED warning.
 *
 * When `opts.tableFilter` is set, only that table is read (the filter is pushed
 * into the `information_schema.tables` WHERE clause, PARAMETERIZED — never
 * string-interpolated) so warnings are naturally scoped to the requested table.
 *
 * @param {object} sql — a Bun.SQL tagged-template handle (async)
 * @param {{ tableFilter?: string|null }} [opts]
 * @returns {Promise<{ tables: Array<object>, warnings: string[] }>}
 */
export async function readActualSchemaPg(sql, opts = {}) {
  const tableFilter = opts.tableFilter ?? null;
  const warnings = [];
  const tables = [];

  const tableRows = tableFilter
    ? await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema = current_schema()
          AND table_name <> '_scrml_migrations'
          AND table_name = ${tableFilter}
        ORDER BY table_name
      `
    : await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema = current_schema()
          AND table_name <> '_scrml_migrations'
        ORDER BY table_name
      `;

  for (const t of tableRows) {
    const tableName = t.table_name;

    const columnRows = await sql`
      SELECT column_name, data_type, is_nullable, column_default, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ${tableName}
      ORDER BY ordinal_position
    `;

    // PRIMARY KEY / UNIQUE columns. The kcu join is correlated on
    // constraint_name + table_schema + TABLE_NAME (Postgres constraint names
    // are unique per-table, NOT schema-global, so the table_name correlation
    // prevents a same-named constraint on another table from cross-contaminating).
    const pkUniqueRows = await sql`
      SELECT tc.constraint_type,
             tc.constraint_name AS constraint_name,
             kcu.column_name    AS column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema   = kcu.table_schema
       AND tc.table_name     = kcu.table_name
      WHERE tc.table_schema = current_schema()
        AND tc.table_name   = ${tableName}
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      ORDER BY tc.constraint_name, kcu.ordinal_position
    `;

    // FOREIGN KEY columns + targets. Uses referential_constraints so each child
    // column is paired with its parent column by POSITION
    // (kcu.position_in_unique_constraint = ccu.ordinal_position) — not
    // "first ccu row" (which mis-pairs / cross-contaminates). Correlated on
    // table_name as above.
    const fkRows = await sql`
      SELECT tc.constraint_name AS constraint_name,
             kcu.column_name    AS column_name,
             kcu.ordinal_position AS key_ordinal,
             ccu.table_name     AS foreign_table,
             ccu.column_name    AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema   = kcu.table_schema
       AND tc.table_name     = kcu.table_name
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name    = rc.constraint_name
       AND tc.constraint_schema  = rc.constraint_schema
      JOIN information_schema.key_column_usage ccu
        ON rc.unique_constraint_name   = ccu.constraint_name
       AND rc.unique_constraint_schema = ccu.constraint_schema
       AND kcu.position_in_unique_constraint = ccu.ordinal_position
      WHERE tc.table_schema = current_schema()
        AND tc.table_name   = ${tableName}
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.constraint_name, kcu.ordinal_position
    `;

    const pkCols = new Set();
    const uniqueCols = new Set();
    const fkByColumn = new Map();

    // PK/UNIQUE grouping — composite (>1 distinct column) is skipped + warned.
    const pkuGroups = new Map();
    for (const r of pkUniqueRows) {
      let g = pkuGroups.get(r.constraint_name);
      if (!g) { g = { type: r.constraint_type, columns: [] }; pkuGroups.set(r.constraint_name, g); }
      g.columns.push(r.column_name);
    }
    for (const [, g] of pkuGroups) {
      const cols = [...new Set(g.columns)];
      if (cols.length > 1) { pushCompositeSkip(warnings, tableName, g.type, cols); continue; }
      if (g.type === "PRIMARY KEY") pkCols.add(cols[0]);
      else uniqueCols.add(cols[0]);
    }

    // FK grouping — composite is skipped + warned; single-column keeps its
    // position-paired target.
    const fkGroups = new Map();
    for (const r of fkRows) {
      let g = fkGroups.get(r.constraint_name);
      if (!g) { g = { rows: [] }; fkGroups.set(r.constraint_name, g); }
      g.rows.push(r);
    }
    for (const [, g] of fkGroups) {
      const cols = [...new Set(g.rows.map((r) => r.column_name))];
      if (cols.length > 1) { pushCompositeSkip(warnings, tableName, "FOREIGN KEY", cols); continue; }
      const row = g.rows[0];
      fkByColumn.set(row.column_name, { table: row.foreign_table, column: row.foreign_column });
    }

    const columns = columnRows.map((c) => ({
      name: c.column_name,
      type: c.data_type || "text",       // RAW pg type; emitter maps it
      notNull: c.is_nullable === "NO",
      default: c.column_default ?? null,  // RAW pg default; emitter classifies it
      primaryKey: pkCols.has(c.column_name),
      unique: uniqueCols.has(c.column_name),
      references: fkByColumn.get(c.column_name) ?? null,
      // CHECK constraints are NOT recovered in v1 (readActualSchema punts too).
      sharedCorePredicates: [],
    }));

    tables.push({ name: tableName, columns });
  }

  return { tables, warnings };
}

/**
 * Render a resolved emit-model (tables → columns, all pieces already
 * representable) to scrml `<schema>` source text.
 */
function renderSchemaModel(model) {
  const lines = ["<schema>"];
  for (const table of model) {
    lines.push(`  ${table.name} {`);
    for (const col of table.columns) {
      const parts = [`${col.name}: ${col.scrmlType}`];
      if (col.primaryKey) parts.push("primary key");
      if (col.emittedNotNull) parts.push("not null");
      if (col.emittedUnique) parts.push("unique");
      if (col.references) parts.push(`references ${col.references.table}(${col.references.column})`);
      if (col.default !== null) parts.push(`default(${col.default})`);
      lines.push(`    ${parts.join(" ")}`);
    }
    lines.push("  }");
  }
  lines.push("</>");
  return lines.join("\n") + "\n";
}

function sameRef(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.table === b.table && a.column === b.column;
}

/**
 * Does a parsed column (from parseSchemaBlock) match the emit-model column
 * EXACTLY, in every representable field? (The emit-model already reflects PK
 * suppression, so emittedNotNull/emittedUnique are the tokens actually emitted.)
 */
function parsedColumnMatches(m, p) {
  return !!p
    && p.scrmlType === m.scrmlType
    && !!p.primaryKey === m.primaryKey
    && !!p.notNull === m.emittedNotNull
    && !!p.unique === m.emittedUnique
    && sameRef(p.references ?? null, m.references)
    && (p.default ?? null) === (m.default ?? null)
    && (p.sharedCorePredicates?.length ?? 0) === 0;
}

/**
 * Emit scrml `<schema>` SOURCE text from an actual-schema structure (as read by
 * readActualSchemaPg) — the source-emitting inverse of generateCreateTable.
 *
 * SELF-VERIFYING: the output is GUARANTEED to round-trip through parseSchemaBlock.
 * The pipeline is (1) build an emit-model applying the semantic guards
 * (identifier / type / composite / default classification), (2) per-field probe
 * every default + FK reference and drop any that does not round-trip in
 * isolation, (3) render, then (4) a whole-schema self-verify that re-parses the
 * rendered source and drops (one per bounded pass) any column/table that still
 * diverges. Every drop emits a W-INTROSPECT-* warning naming what + why.
 *
 * @param {{ tables: Array<object> }} actual
 * @param {{ tableFilter?: string|null }} [opts]
 * @returns {{ source: string, warnings: string[], emittedTables: string[], droppedCount: number }}
 */
export function emitScrmlSchemaSource(actual, opts = {}) {
  const warnings = [];
  let droppedCount = 0;
  const tableFilter = opts.tableFilter ?? null;
  const allTables = Array.isArray(actual?.tables) ? actual.tables : [];
  const filtered = tableFilter ? allTables.filter((t) => t.name === tableFilter) : allTables;

  // (1) Build the emit-model, applying the semantic guards.
  const model = [];
  for (const table of filtered) {
    if (!isRepresentableIdentifier(table.name)) {
      warnings.push(
        `W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE: table "${table.name}" has a name ` +
        `that is not a valid scrml identifier (letters/digits/underscore, ` +
        `non-digit leading char) — the whole table was skipped. Rename it, or ` +
        `map it by hand.`,
      );
      droppedCount++;
      continue;
    }
    const cols = [];
    for (const col of table.columns ?? []) {
      if (!isRepresentableIdentifier(col.name)) {
        warnings.push(
          `W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE: column "${table.name}.${col.name}" ` +
          `has a name that is not a valid scrml identifier — the column was ` +
          `skipped. Rename it, or map it by hand.`,
        );
        droppedCount++;
        continue;
      }
      const { scrmlType, unmapped } = mapPgTypeToScrml(col.type);
      if (unmapped) {
        warnings.push(
          `W-INTROSPECT-TYPE-UNMAPPED: column "${table.name}.${col.name}" has ` +
          `Postgres type "${col.type}" with no scrml column-type equivalent — ` +
          `emitted as \`text\`. Review and adjust if a tighter type applies.`,
        );
      }

      // FK reference — identifier-guarded here; self-verified below.
      let ref = null;
      if (col.references && col.references.table && col.references.column) {
        if (isRepresentableIdentifier(col.references.table) &&
            isRepresentableIdentifier(col.references.column)) {
          ref = { table: col.references.table, column: col.references.column };
        } else {
          warnings.push(
            `W-INTROSPECT-IDENTIFIER-UNREPRESENTABLE: column "${table.name}.${col.name}" ` +
            `references "${col.references.table}(${col.references.column})", whose name ` +
            `is not a valid scrml identifier — the references clause was dropped.`,
          );
          droppedCount++;
        }
      }

      // Default — semantic classification here; self-verified below.
      let dflt = null;
      const cls = classifyPgDefault(col.default);
      if (cls.kind === "literal") {
        dflt = cls.value;
      } else if (cls.kind === "expression") {
        warnings.push(
          `W-INTROSPECT-DEFAULT-DROPPED: column "${table.name}.${col.name}" has a ` +
          `non-literal Postgres default \`${cls.value}\` — scrml <schema> ` +
          `default(...) is literal-only (SPEC §39), so it was dropped. Set this ` +
          `default in application code or a ?{} block.`,
        );
        droppedCount++;
      }
      // kind "none" (NULL) / "sequence" (nextval → serial) drop silently.

      cols.push({
        name: col.name,
        scrmlType,
        primaryKey: !!col.primaryKey,
        emittedNotNull: !!col.notNull && !col.primaryKey,
        emittedUnique: !!col.unique && !col.primaryKey,
        references: ref,
        default: dflt,
      });
    }
    model.push({ name: table.name, columns: cols });
  }

  // (2) Per-field self-verify probes — drop any default / reference that does
  // not round-trip in isolation (braces / newlines / in-string predicate names
  // in a literal; a predicate-named FK target).
  for (const table of model) {
    for (const col of table.columns) {
      if (col.default !== null && !defaultRoundTrips(col.scrmlType, col.default)) {
        warnings.push(
          `W-INTROSPECT-DEFAULT-DROPPED: column "${table.name}.${col.name}" default ` +
          `\`${col.default}\` does not round-trip through the scrml <schema> parser ` +
          `(reserved shape — brace / newline / parser-reserved token) — dropped.`,
        );
        col.default = null;
        droppedCount++;
      }
      if (col.references !== null && !referencesRoundTrips(col.references.table, col.references.column)) {
        warnings.push(
          `W-INTROSPECT-REFERENCE-DROPPED: column "${table.name}.${col.name}" reference ` +
          `to "${col.references.table}(${col.references.column})" does not round-trip ` +
          `(target name collides with a scrml schema predicate) — the references ` +
          `clause was dropped.`,
        );
        col.references = null;
        droppedCount++;
      }
    }
  }

  // (3) + (4) Render, then whole-schema self-verify: re-parse the rendered
  // source and drop (one per bounded pass) any column/table that still diverges
  // from the emit-model, until the source round-trips exactly. Belt over the
  // per-field probes — guarantees the INVARIANT even for a shape they missed.
  let source = renderSchemaModel(model);
  const totalCols = model.reduce((n, t) => n + t.columns.length, 0);
  for (let pass = 0; pass <= totalCols + 1; pass++) {
    const parsed = parseSchemaBlock(source);
    const parsedByName = new Map(parsed.tables.map((t) => [t.name, t]));
    let dropped = false;
    outer:
    for (const table of model) {
      const pt = parsedByName.get(table.name);
      if (!pt) {
        warnings.push(
          `W-INTROSPECT-TABLE-DROPPED: table "${table.name}" does not round-trip ` +
          `through the scrml <schema> parser — dropped.`,
        );
        model.splice(model.indexOf(table), 1);
        droppedCount++;
        dropped = true;
        break outer;
      }
      const pcByName = new Map(pt.columns.map((c) => [c.name, c]));
      for (const col of table.columns) {
        if (!parsedColumnMatches(col, pcByName.get(col.name))) {
          warnings.push(
            `W-INTROSPECT-COLUMN-DROPPED: column "${table.name}.${col.name}" does not ` +
            `round-trip through the scrml <schema> parser — dropped.`,
          );
          table.columns.splice(table.columns.indexOf(col), 1);
          droppedCount++;
          dropped = true;
          break outer;
        }
      }
    }
    if (!dropped) break;
    source = renderSchemaModel(model);
  }

  const emittedTables = model.filter((t) => t.columns.length > 0).map((t) => t.name);
  return { source, warnings, emittedTables, droppedCount };
}

/**
 * §14.8.10 (S456, ruling user-voice-scrml.md S456 "b, startup check lands with it"; S456
 * review round 2 — the boundary moved) — every relation a PROGRAM-BODY `?{}` statement
 * (not a `< schema>` body) CREATES or gives new columns, with its column names when the
 * compiler can determine every one of them, else `columns: null`. The caller
 * (`compiler/src/tenant-undeclared.ts`) refuses — `E-TENANT-UNDECLARED` — a relation outside
 * the compilation's tenant set whose columns are unknown or include `tenant_id`.
 *
 * ⚑ THE QUESTION IS "CAN THE COMPILER DETERMINE EVERY COLUMN OF WHAT THIS CREATES?", NOT
 * "DOES THE TEXT MENTION tenant_id?". Three review rounds patched the mention reading
 * (CREATE / ALTER → `SELECT … INTO` → `SELECT *` over a derived table, a VALUES list, a
 * CTE — each executed on PG16 creating a `tenant_id` table that compiled clean). A column
 * list is KNOWN only when it is spelled: a `CREATE TABLE` column list; a view's or CTAS's
 * own `(a, b)` list; or a select list every item of which is a plain column reference or
 * `expr AS name`. A `*`, `AS TABLE x`, `AS VALUES`, a `LIKE` copy, `INHERITS`,
 * `PARTITION OF`, `OF type`, a virtual-table module, an unnamed expression and a name the
 * reader cannot read (`${…}`) are UNKNOWN. What the select list reads FROM does not matter
 * when every output name is spelled; it is exactly what makes a `*` unknowable.
 *
 * Relation-creating statements read: `CREATE [OR REPLACE] [TEMP | TEMPORARY | UNLOGGED |
 * GLOBAL | LOCAL | VIRTUAL | …] TABLE` (column list, or `AS query`, or any other form);
 * `CREATE [OR REPLACE] [MATERIALIZED] VIEW` (its column list, else its query's); Postgres
 * `SELECT … INTO [TEMP | TEMPORARY | UNLOGGED] [TABLE] t` (MySQL's `INTO @var | OUTFILE |
 * DUMPFILE` writes no table); `ALTER TABLE t` actions `ADD [COLUMN]`, `RENAME [COLUMN] a TO
 * b`, MySQL `CHANGE [COLUMN] a b` (new column names), and `RENAME TO u` (a new relation `u`
 * whose columns the compiler does not know).
 *
 * Read from SQL TOKENS (`relationTokens`): literals, quoted identifiers, `--` (ending at CR
 * or LF — S456 F1) and nesting `/* *\/` comments, `${…}` parameters and `$tag$…$tag$`
 * bodies are each one token. A dollar-quoted body is OPAQUE — a routine's `SELECT … INTO
 * var` is not table creation (S456 review R3), and DDL a `DO` / function body runs is
 * runtime DDL the compile does not read (the §14.8.10 Limit: seen at the next startup).
 * A statement holding a form whose extent differs by database — a backslash (MySQL string
 * escape) or a `#` (MySQL comment) — and naming `tenant_id` anywhere is returned as one
 * unreadable relation (fail-closed: the reading may have hidden a statement).
 *
 * @param {string} text the SQL text of one `?{}` (statement or expression position)
 * @returns {Array<{name: string|null, key: string|null, kind: "table"|"view"|"select-into"|"alter"|"rename"|"unreadable", modifiers: string[], offset: number, columns: string[]|null, why: string|null}>}
 */
export function programTenantTableDecls(text) {
  const out = [];
  if (typeof text !== "string" || text.length === 0) return out;
  const toks = relationTokens(text);
  let start = 0;
  for (let i = 0; i <= toks.length; i++) {
    if (i < toks.length && !(toks[i].k === "p" && toks[i].t === ";" && toks[i].depth === 0)) continue;
    if (i > start) readRelationStatement(text, toks.slice(start, i), out);
    start = i + 1;
  }
  if (/[\\#]/.test(text) && namesTenantId(text)) {
    out.push({
      name: null, key: null, kind: "unreadable", modifiers: [], offset: 0, columns: null,
      why: "the statement holds a backslash or `#`, whose meaning differs between databases, and names `tenant_id`",
    });
  }
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

/** One token of `relationTokens`. `depth` is the paren depth OUTSIDE a `(` / `)` token. */
// { k: "id" | "str" | "num" | "param" | "dollar" | "p", t?, up?, at, depth }

/** The SQL tokens of a program-body statement (see `programTenantTableDecls`). */
function relationTokens(text) {
  const toks = [];
  const n = text.length;
  let depth = 0;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && text[i + 1] === "-") { i = sqlLineCommentEnd(text, i); continue; }
    if (c === "/" && text[i + 1] === "*") {
      let d = 1;
      let j = i + 2;
      while (j < n && d > 0) {
        if (text[j] === "/" && text[j + 1] === "*") { d++; j += 2; continue; }
        if (text[j] === "*" && text[j + 1] === "/") { d--; j += 2; continue; }
        j++;
      }
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      toks.push({ k: "str", at: i, depth });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const p = readSqlIdentPart(text, i);
      if (p) {
        toks.push({ k: "id", t: p.name, up: p.name.toUpperCase(), quoted: true, at: i, depth });
        i = p.end;
        continue;
      }
      toks.push({ k: "p", t: c, at: i, depth });
      i++;
      continue;
    }
    if (c === "$") {
      if (text[i + 1] === "{") {                       // `${…}` — a bound parameter (a value)
        let d = 0;
        let j = i + 1;
        for (; j < n; j++) {
          if (text[j] === "{") d++;
          else if (text[j] === "}" && --d === 0) break;
        }
        toks.push({ k: "param", at: i, depth });
        i = j + 1;
        continue;
      }
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 66));
      if (m) {                                          // `$tag$ … $tag$` — an opaque body
        const close = text.indexOf(m[0], i + m[0].length);
        toks.push({ k: "dollar", at: i, depth });
        i = close === -1 ? n : close + m[0].length;
        continue;
      }
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i + 1;
      while (j < n && SQL_IDENT_CHAR.test(text[j]) && !(text[j] === "$" && text[j + 1] === "{")) j++;
      const t = text.slice(i, j);
      toks.push({ k: "id", t, up: t.toUpperCase(), quoted: false, at: i, depth });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(text[j])) j++;
      toks.push({ k: "num", at: i, depth });
      i = j;
      continue;
    }
    if (c === "(") { toks.push({ k: "p", t: "(", at: i, depth }); depth++; i++; continue; }
    if (c === ")") { depth = Math.max(0, depth - 1); toks.push({ k: "p", t: ")", at: i, depth }); i++; continue; }
    toks.push({ k: "p", t: c, at: i, depth });
    i++;
  }
  return toks;
}

const isWord = (tok, w) => tok !== undefined && tok.k === "id" && !tok.quoted && tok.up === w;
const isPunct = (tok, p) => tok !== undefined && tok.k === "p" && tok.t === p;

/** A possibly-qualified name at `toks[i]`: `{ name, next }` (name null when unreadable). */
function readRelationName(toks, i) {
  if (toks[i]?.k !== "id") return { name: null, next: i + 1 };
  let name = toks[i].t;
  let j = i + 1;
  while (isPunct(toks[j], ".") && toks[j + 1]?.k === "id") { name = toks[j + 1].t; j += 2; }
  if (isPunct(toks[j], ".")) return { name: null, next: j + 1 };
  return { name, next: j };
}

/** Index of the `)` closing the `(` at `open`, or -1. */
function closingParen(toks, open) {
  for (let j = open + 1; j < toks.length; j++) {
    if (isPunct(toks[j], ")") && toks[j].depth === toks[open].depth) return j;
  }
  return -1;
}

/** Split toks[from..to) at depth-`d` commas. */
function splitAtCommas(toks, from, to, d) {
  const items = [];
  let s = from;
  for (let j = from; j < to; j++) {
    if (isPunct(toks[j], ",") && toks[j].depth === d) { items.push(toks.slice(s, j)); s = j + 1; }
  }
  items.push(toks.slice(s, to));
  return items.filter((it) => it.length > 0);
}

const QUERY_CLAUSE_END = new Set(["FROM", "INTO", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "UNION", "INTERSECT", "EXCEPT", "WINDOW", "FETCH", "FOR", "RETURNING"]);

/**
 * The output names of the select list that starts after `toks[sel]` (a `SELECT`), or null
 * when any item's name cannot be determined. Ends at the first depth-level clause keyword.
 */
function selectListNames(toks, sel) {
  const d = toks[sel].depth;
  let i = sel + 1;
  if (isWord(toks[i], "ALL")) i++;
  if (isWord(toks[i], "DISTINCT")) {
    i++;
    if (isWord(toks[i], "ON") && isPunct(toks[i + 1], "(")) {
      const c = closingParen(toks, i + 1);
      if (c === -1) return null;
      i = c + 1;
    }
  }
  let end = i;
  // (a `)` closing an enclosing paren carries depth d - 1, so it ends the list too)
  while (end < toks.length && toks[end].depth >= d &&
    !(toks[end].depth === d && toks[end].k === "id" && !toks[end].quoted && QUERY_CLAUSE_END.has(toks[end].up))) end++;
  const names = [];
  for (const item of splitAtCommas(toks, i, end, d)) {
    const last = item[item.length - 1];
    if (item.length >= 2 && last.k === "id" && isWord(item[item.length - 2], "AS") && item[item.length - 2].depth === d) {
      names.push(last.t);
      continue;
    }
    // a plain column reference: `c`, `t.c`, `s.t.c`
    const plain = item.every((tok, k) => (k % 2 === 0 ? tok.k === "id" : isPunct(tok, "."))) && item.length % 2 === 1;
    if (plain) { names.push(last.t); continue; }
    return null;   // `*`, `t.*`, an unnamed expression, an implicit alias the reader does not trust
  }
  return names.length > 0 ? names : null;
}

/**
 * The output names of a query at `toks[i]` (after `AS`): its first top-level SELECT's list,
 * through leading parens and a `WITH` list; null for `TABLE x`, `VALUES`, anything else.
 */
function queryNames(toks, i) {
  while (isPunct(toks[i], "(")) i++;
  if (isWord(toks[i], "WITH")) {
    const d = toks[i].depth;
    let j = i + 1;
    while (j < toks.length && !(toks[j].depth === d && toks[j].k === "id" && !toks[j].quoted &&
      ["SELECT", "INSERT", "UPDATE", "DELETE", "VALUES", "TABLE", "MERGE"].includes(toks[j].up))) j++;
    i = j;
  }
  return isWord(toks[i], "SELECT") ? selectListNames(toks, i) : null;
}

/** Read one `;`-separated statement's relation creations into `out`. */
function readRelationStatement(text, toks, out) {
  let i = 0;
  while (isPunct(toks[i], "(")) i++;
  const lead = toks[i];
  if (!lead || lead.k !== "id" || lead.quoted) return;
  const push = (name, kind, modifiers, offset, columns, why) =>
    out.push({ name, key: name === null ? null : name.toLowerCase(), kind, modifiers, offset, columns, why });

  if (lead.up === "CREATE") {
    let j = i + 1;
    const modifiers = [];
    if (isWord(toks[j], "OR") && isWord(toks[j + 1], "REPLACE")) j += 2;
    while (toks[j]?.k === "id" && !toks[j].quoted && !["TABLE", "VIEW"].includes(toks[j].up) && modifiers.length < 4) {
      modifiers.push(toks[j].up);
      j++;
    }
    const isTable = isWord(toks[j], "TABLE");
    const isView = isWord(toks[j], "VIEW");
    if (!isTable && !isView) return;                 // INDEX, TRIGGER, FUNCTION, …: no new relation
    if (isTable && modifiers.some((m) => !CREATE_TABLE_MODIFIER_WORDS.has(m))) return;
    if (isView && modifiers.some((m) => !["MATERIALIZED", "TEMP", "TEMPORARY", "RECURSIVE"].includes(m))) return;
    j++;
    if (isWord(toks[j], "IF") && isWord(toks[j + 1], "NOT") && isWord(toks[j + 2], "EXISTS")) j += 3;
    const at = toks[i].at;
    const { name, next } = readRelationName(toks, j);
    const kind = isView ? "view" : "table";
    if (name === null) return push(null, kind, modifiers, at, null, "its name is not a name the compiler can read");
    j = next;
    let listed = null;
    if (isPunct(toks[j], "(")) {
      const close = closingParen(toks, j);
      if (close === -1) return push(name, kind, modifiers, at, null, "its column list does not close");
      const body = text.slice(toks[j].at + 1, toks[close].at);
      if (findLikeTemplateReference(body)) return push(name, kind, modifiers, at, null, "it copies another table's columns (`LIKE`)");
      listed = isView
        ? splitAtCommas(toks, j + 1, close, toks[j].depth + 1).map((it) => (it.length === 1 && it[0].k === "id" ? it[0].t : null))
        : columnsFromDdlBody(body).map((c) => c.name);
      if (listed.includes(null) || (!isView && listed.length === 0)) return push(name, kind, modifiers, at, null, "its column list is not plain column names");
      j = close + 1;
      if (isWord(toks[j], "INHERITS") || isWord(toks[j], "PARTITION")) return push(name, kind, modifiers, at, null, "it inherits another table's columns");
      if (!isWord(toks[j], "AS")) return push(name, kind, modifiers, at, listed, null);
    }
    if (isWord(toks[j], "AS")) {
      if (listed) return push(name, kind, modifiers, at, listed, null);
      const names = queryNames(toks, j + 1);
      return push(name, kind, modifiers, at, names, names ? null : "its columns come from a query whose output names are not all spelled (a `*`, `TABLE x`, `VALUES`, or an unnamed expression)");
    }
    // SQLite's built-in full-text and r-tree modules declare their columns as the module
    // arguments (`fts5(title, body UNINDEXED, tokenize = 'porter')`): an argument holding
    // `=` is an option, any other one's first name is a column. Any other module's columns
    // are its own business — unknown.
    if (modifiers.includes("VIRTUAL") && isWord(toks[j], "USING") && toks[j + 1]?.k === "id" &&
      ["FTS5", "FTS4", "FTS3", "RTREE", "RTREE_I32"].includes(toks[j + 1].up) && isPunct(toks[j + 2], "(")) {
      const close = closingParen(toks, j + 2);
      if (close !== -1) {
        const cols = [];
        for (const arg of splitAtCommas(toks, j + 3, close, toks[j + 2].depth + 1)) {
          if (arg.some((tok) => isPunct(tok, "="))) continue;
          if (arg[0]?.k !== "id") { cols.length = 0; break; }
          cols.push(arg[0].t);
        }
        if (cols.length > 0) return push(name, kind, modifiers, at, cols, null);
      }
    }
    return push(name, kind, modifiers, at, null, "it is not a plain column list (a virtual-table module whose columns the compiler does not read, `PARTITION OF`, `OF type`)");
  }

  if (lead.up === "ALTER" && isWord(toks[i + 1], "TABLE")) {
    let j = i + 2;
    if (isWord(toks[j], "IF") && isWord(toks[j + 1], "EXISTS")) j += 2;
    if (isWord(toks[j], "ONLY") && toks[j + 1]?.k === "id") j++;
    const { name, next } = readRelationName(toks, j);
    const at = lead.at;
    const added = [];
    let unknown = name === null;
    for (const act of splitAtCommas(toks, next, toks.length, lead.depth)) {
      let k = 0;
      const w = (x) => isWord(act[k], x);
      if (w("ADD")) {
        k++;
        if (["CONSTRAINT", "PRIMARY", "UNIQUE", "FOREIGN", "CHECK", "INDEX", "KEY", "EXCLUDE"].some(w)) continue;
        if (w("COLUMN")) k++;
        if (w("IF") && isWord(act[k + 1], "NOT") && isWord(act[k + 2], "EXISTS")) k += 3;
        if (act[k]?.k === "id") added.push(act[k].t); else unknown = true;
      } else if (w("RENAME")) {
        k++;
        if (w("TO")) {
          const r = readRelationName(act, k + 1);
          push(r.name, "rename", [], at, null, "it renames a table whose columns the compiler does not know");
          continue;
        }
        if (w("CONSTRAINT")) continue;
        if (w("COLUMN")) k++;
        const to = act.findIndex((tok, x) => x > k && isWord(tok, "TO"));
        if (to !== -1 && act[to + 1]?.k === "id") added.push(act[to + 1].t); else unknown = true;
      } else if (w("CHANGE")) {
        k++;
        if (w("COLUMN")) k++;
        if (act[k + 1]?.k === "id") added.push(act[k + 1].t); else unknown = true;
      }
    }
    if (added.length > 0 || unknown) push(name, "alter", [], at, unknown ? null : added, unknown ? "a column it adds or renames is not a name the compiler can read" : null);
    return;
  }

  // Postgres `SELECT … INTO t` — at the top-level SELECT (through a `WITH` list).
  let s = i;
  if (lead.up === "WITH") {
    const d = lead.depth;
    s = i + 1;
    while (s < toks.length && !(toks[s].depth === d && toks[s].k === "id" && !toks[s].quoted &&
      ["SELECT", "INSERT", "UPDATE", "DELETE", "VALUES", "TABLE", "MERGE"].includes(toks[s].up))) s++;
  }
  if (!isWord(toks[s], "SELECT")) return;
  const d = toks[s].depth;
  for (let j = s + 1; j < toks.length; j++) {
    if (toks[j].depth !== d || !isWord(toks[j], "INTO")) continue;
    let k = j + 1;
    const modifiers = [];
    if (["TEMPORARY", "TEMP", "UNLOGGED"].some((m) => isWord(toks[k], m))) { modifiers.push(toks[k].up); k++; }
    if (isPunct(toks[k], "@") || ((isWord(toks[k], "OUTFILE") || isWord(toks[k], "DUMPFILE")) && toks[k + 1]?.k === "str")) return;
    if (isWord(toks[k], "STRICT")) k++;
    if (isWord(toks[k], "TABLE")) k++;
    const { name } = readRelationName(toks, k);
    const names = selectListNames(toks, s);
    push(name, "select-into", modifiers, toks[j].at, name === null ? null : names,
      name === null ? "its name is not a name the compiler can read"
        : names ? null : "its columns come from a select list whose output names are not all spelled (a `*` or an unnamed expression)");
    return;
  }
}
