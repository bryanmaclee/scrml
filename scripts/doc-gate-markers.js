/**
 * scripts/doc-gate-markers.js
 *
 * The marker grammar shared by the two public-docs gates (`scripts/claim-gate.js`,
 * which compiles ```scrml fences, and `scripts/snippet-gate.js`, which compiles the
 * `.scrml` files that fences cite). One parser, so the two gates cannot disagree about
 * what a document said. Contributor guide: `docs/DIALECT.md`.
 *
 * WHY (S469, owner ruling "Ruled dialect, bootstrap-gated"): public docs are being
 * rewritten, doc by doc, into today's RULED scrml, which impl#1 does not parse. A
 * migrated document must be checked by the BOOTSTRAP (`scripts/scrml-boot.ts`); a
 * document not yet migrated must keep being checked by impl#1, so nothing silently
 * stops being gated. The document says which it is.
 *
 * ── DOCUMENT OPT-IN ────────────────────────────────────────────────────────────
 *   A document is RULED (compiled by the bootstrap) when it carries either
 *     - an HTML comment on its own line, outside any fence:   <!-- dialect: ruled -->
 *     - or a front-matter key (a `---` block at line 1):     dialect: ruled
 *   Anything else is IMPL1 (compiled by impl#1, the pre-migration behaviour).
 *   `dialect:` with any value other than `ruled` / `impl1` is an ERROR (a typo must not
 *   silently fall back to impl#1). Two different dialect declarations are an ERROR.
 *
 * ── PER-BLOCK MARKERS ──────────────────────────────────────────────────────────
 *   Written as HTML comments on the line(s) directly above the ```scrml fence (blank
 *   lines and other markers may sit between; any other line ends the run). They are
 *   invisible in rendered markdown, so a reader never sees gate plumbing.
 *
 *     <!-- gate: skip — <reason> -->        do not compile this block (an illustrative
 *                                           fragment). Either dialect.
 *     <!-- gate: spec-ahead — <reason> -->  RULED documents only. The block is in the ruled
 *                                           dialect but the bootstrap cannot compile it yet;
 *                                           <reason> names what is missing. It is still
 *                                           compiled: a failure is expected and counted
 *                                           separately; a CLEAN compile is reported as
 *                                           "remove the marker".
 *     <!-- snippet: path[#Lx-Ly] -->        (owned by scripts/snippet-drift.js) the block is
 *                                           a copy of a gated file. claim-gate does not
 *                                           compile it — snippet-gate compiles the file.
 *
 *   The separator after the kind may be `—`, `–`, `-`, `--` or `:`. The REASON IS
 *   MANDATORY: `<!-- gate: skip -->` is an error, not a skip. An unknown kind
 *   (`<!-- gate: skipp — … -->`) is an error. Two gate markers on one block is an error.
 *   A gate marker that is not followed by a ```scrml fence is an error (it gates nothing).
 *
 *   LEGACY: a block whose first non-blank line is `// gate: skip` (the S101 marker) is
 *   still honoured in IMPL1 documents, so unmigrated docs keep their state. In a RULED
 *   document it is an error — migrate it to the HTML marker with a reason.
 *
 *   PINNED CODES (round 2): `<!-- gate: spec-ahead [E-PARSE-ARM, E-SCOPE-001] — <reason> -->`
 *   pins the bootstrap's expected Error codes. A pinned spec-ahead block whose distinct
 *   error codes are not exactly the pinned set FAILS, so a typo or a new kind of error is
 *   not hidden behind "expected to fail". Pins are only allowed on spec-ahead.
 *
 * ── FENCES ─────────────────────────────────────────────────────────────────────
 *   A fence opens with a run of 3+ backticks or 3+ tildes and closes only on a run of the
 *   SAME character at least as long (CommonMark), so a ````-fenced example that contains
 *   ```scrml text does not open a gated block, and a 3-backtick line cannot close a
 *   4-backtick fence. A block is GATED when its info string's first word is `scrml`
 *   (case-insensitive; extra words such as `title=…` are allowed), with either fence
 *   character. An info string that STARTS with `scrml` but whose first word is something
 *   else (`scrml-old`, `scrmlx`) is an ERROR, and so is a scrml fence inside a blockquote
 *   (`> ```scrml`) — the gates cannot check either, and must not skip them silently.
 */

export const DIALECTS = /** @type {const} */ (["ruled", "impl1"]);

const DIALECT_COMMENT_RE = /^\s*<!--\s*dialect\s*:\s*([^\s>]*)\s*-->\s*$/;
const FRONT_MATTER_DIALECT_RE = /^\s*dialect\s*:\s*["']?([^"'\s#]*)["']?\s*(?:#.*)?$/;
const GATE_ANY_RE = /^\s*<!--\s*gate\s*:(.*?)-->\s*$/;
// The kind, not followed by a word character or `-` (so `skip-me` / `spec-ahead-ish` are
// unknown kinds). The rest — an optional `[CODE, …]` pin list, a separator, the reason —
// is parsed by parseGateMarker, which rejects every malformed pin instead of ignoring it.
const GATE_KIND_RE = /^\s*(skip|spec-ahead)(?![\w-])/;
const SEPARATOR_RE = /^(?:—|–|--|-|:)/;
const CODE_RE = /^[EWI]-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const CODE_LIKE_RE = /^[EWI]-[A-Z0-9]/;
const SNIPPET_RE = /^\s*<!--\s*snippet:\s*(\S+?)(?:#L(\d+)-L(\d+))?\s*-->\s*$/;
// Container prefixes (round 3, F1): a list-item marker — `-`, `*`, `+`, `1.`, `1)` — followed
// by 1–4 spaces, at most 3 spaces in. Nestable (`- 1. ```scrml`).
const LIST_MARKER_RE = /^( {0,3})([-*+]|\d{1,9}[.)])( {1,4})(?=\S)/;
// A fence opener, relative to its container: at most 3 spaces of indent (F2).
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const INDENTED_FENCE_RE = /^ {4,}(`{3,}|~{3,})(.*)$/;
const BLOCKQUOTE_RE = /^ {0,3}>/;
const LEGACY_SKIP_RE = /^\s*\/\/\s*gate:\s*skip\b\s*(?:(?:—|–|--|-|:)\s*)?(.*)$/;

/**
 * Parse the inside of `<!-- gate: … -->`. Returns { marker } or { error }.
 * Malformed pins are errors, never "unpinned" (round 3, F3): an unclosed `[`, a second
 * bracket group, codes without brackets, or a pin list after the separator.
 */
export function parseGateMarker(inner) {
  const km = GATE_KIND_RE.exec(inner);
  if (!km) return { error: "unknown" };
  const kind = /** @type {"skip"|"spec-ahead"} */ (km[1]);
  let rest = inner.slice(km[0].length).trimStart();
  let codes = null;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close < 0) return { error: "an unclosed `[` pin list — write `[E-CODE, …]`" };
    const list = rest.slice(1, close);
    if (kind !== "spec-ahead") return { error: "a `[CODES]` pin is only allowed on `gate: spec-ahead`" };
    codes = list.split(",").map((c) => c.trim()).filter(Boolean);
    if (codes.length === 0 || codes.some((c) => !CODE_RE.test(c))) {
      return { error: `bad pinned code list \`[${list}]\` — write diagnostic codes, e.g. \`[E-PARSE-TAG, E-BOOTSTRAP-UNSUPPORTED]\`` };
    }
    rest = rest.slice(close + 1).trimStart();
    if (rest.startsWith("[")) return { error: "a second `[…]` group — put every pinned code in one list" };
  }
  const sep = SEPARATOR_RE.exec(rest);
  if (sep) rest = rest.slice(sep[0].length).trimStart();
  else if (CODE_LIKE_RE.test(rest)) return { error: "diagnostic codes outside brackets — a pin is `[E-CODE, …]`, before the separator" };
  if (rest.startsWith("[") || (sep && CODE_LIKE_RE.test(rest) && /^[EWI]-[A-Z0-9-]+\s*[,\]]/.test(rest))) {
    return { error: "a pin list after the separator — write `gate: spec-ahead [E-CODE, …] — <reason>`" };
  }
  return { marker: { kind, codes, reason: rest.trim() } };
}

/**
 * @typedef {{ kind: "skip" | "spec-ahead", reason: string, line: number, codes: string[] | null }} GateMarker
 * @typedef {{ path: string, from: number|null, to: number|null, line: number, raw: string }} SnippetMarker
 * @typedef {{
 *   fenceLine: number,       // 1-based line of the ```scrml opener
 *   startLine: number,       // 1-based line of the first content line
 *   body: string,
 *   bodyLines: string[],
 *   gate: GateMarker | null,
 *   snippet: SnippetMarker | null,
 *   legacySkip: { reason: string } | null,
 * }} DocBlock
 * @typedef {{ line: number, message: string }} MarkerError
 */

/**
 * Classify a fence opener's info string: "scrml" (gated), "bad" (looks like scrml but is not
 * gateable — an error), or "other".
 */
function fenceKind(info) {
  const t = info.trim();
  if (t === "") return "other";
  const first = t.split(/\s+/)[0].toLowerCase();
  if (first === "scrml") return "scrml";
  if (t.toLowerCase().startsWith("scrml")) return "bad";
  return "other";
}

/**
 * Parse a markdown document into its dialect, its scrml blocks with their markers,
 * and every marker ERROR (each one fails the gate that reads it). `danglingSnippets`
 * lists `<!-- snippet: … -->` markers that no scrml fence follows (snippet-drift's check).
 * @param {string} text
 * @returns {{ dialect: "ruled" | "impl1", dialectLine: number | null, blocks: DocBlock[], errors: MarkerError[], danglingSnippets: Array<{ line: number, raw: string }> }}
 */
export function parseDocMarkers(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  /** @type {MarkerError[]} */
  const errors = [];
  /** @type {DocBlock[]} */
  const blocks = [];
  /** @type {Array<{ value: string, line: number }>} */
  const dialects = [];
  /** @type {Array<{ line: number, raw: string }>} */
  const danglingSnippets = [];

  // Front matter: a `---` block starting at line 1.
  let i = 0;
  if (lines[0] !== undefined && lines[0].trim() === "---") {
    let j = 1;
    const found = [];
    while (j < lines.length && lines[j].trim() !== "---") {
      const m = FRONT_MATTER_DIALECT_RE.exec(lines[j]);
      if (m) found.push({ value: m[1], line: j + 1 });
      j++;
    }
    if (j < lines.length) {
      i = j + 1; // an unclosed `---` is not front matter
      dialects.push(...found);
    }
  }

  /** @type {GateMarker[]} */
  let pendingGates = [];
  /** @type {SnippetMarker | null} */
  let pendingSnippet = null;
  const dangle = () => {
    for (const g of pendingGates) {
      errors.push({ line: g.line, message: `\`gate: ${g.kind}\` marker is not followed by a \`\`\`scrml fence — it gates nothing` });
    }
    pendingGates = [];
    if (pendingSnippet) danglingSnippets.push({ line: pendingSnippet.line, raw: pendingSnippet.raw });
    pendingSnippet = null;
  };

  // List-item containers (F1). `listCols` holds the content column of each open list item.
  /** @type {number[]} */
  const listCols = [];
  const indentOf = (l) => /^ */.exec(l)[0].length;
  /** Strip this line's container prefix: returns its container column and the rest. */
  const container = (l) => {
    const col0 = listCols.length ? listCols[listCols.length - 1] : 0;
    if (l.trim() === "") return { col: col0, rest: "" };
    const ind = indentOf(l);
    while (listCols.length && ind < listCols[listCols.length - 1]) listCols.pop();
    let col = listCols.length ? listCols[listCols.length - 1] : 0;
    let rest = l.slice(Math.min(ind, col));
    for (;;) {
      const lm = LIST_MARKER_RE.exec(rest);
      if (!lm) break;
      const w = lm[0].length;
      col += w;
      listCols.push(col);
      rest = rest.slice(w);
    }
    return { col, rest };
  };

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const { col, rest: line } = container(raw);

    const dm = DIALECT_COMMENT_RE.exec(line);
    if (dm) {
      dialects.push({ value: dm[1], line: i + 1 });
      continue;
    }

    const gm = GATE_ANY_RE.exec(line);
    if (gm) {
      const pg = parseGateMarker(gm[1]);
      if (pg.error === "unknown") {
        errors.push({
          line: i + 1,
          message: `unknown gate marker \`${line.trim()}\` — the kinds are \`gate: skip — <reason>\` and \`gate: spec-ahead [CODES] — <reason>\``,
        });
        continue;
      }
      if (pg.error) {
        errors.push({ line: i + 1, message: `malformed gate marker \`${line.trim()}\`: ${pg.error}` });
        continue;
      }
      const { kind, codes, reason } = pg.marker;
      if (reason === "") {
        errors.push({
          line: i + 1,
          message: `\`gate: ${kind}\` marker has no reason — write \`<!-- gate: ${kind} — <why> -->\`; the reason is mandatory`,
        });
        continue;
      }
      pendingGates.push({ kind, reason, line: i + 1, codes });
      continue;
    }

    const sm = SNIPPET_RE.exec(line);
    if (sm) {
      if (pendingSnippet) danglingSnippets.push({ line: pendingSnippet.line, raw: pendingSnippet.raw });
      pendingSnippet = { path: sm[1], from: sm[2] ? Number(sm[2]) : null, to: sm[3] ? Number(sm[3]) : null, line: i + 1, raw: line.trim() };
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      // A blockquote: its own fences are consumed here, so their bodies cannot desync the
      // parser; a scrml fence inside one is an error (the gates do not read quotes).
      const q = (l) => l.replace(/^ {0,3}(?:> ?)+/, "");
      const qm = FENCE_OPEN_RE.exec(q(line));
      if (qm) {
        if (fenceKind(qm[3]) !== "other") {
          errors.push({ line: i + 1, message: "a scrml fence inside a blockquote is not gated — move it out of the `>` quote (or make it a plain fence)" });
        }
        const closeQ = new RegExp(`^ {0,3}${qm[2][0] === "`" ? "`" : "~"}{${qm[2].length},}\\s*$`);
        while (i + 1 < lines.length && BLOCKQUOTE_RE.test(lines[i + 1])) {
          i++;
          if (closeQ.test(q(lines[i]))) break;
        }
      }
      dangle();
      continue;
    }

    const im = INDENTED_FENCE_RE.exec(line);
    if (im && fenceKind(im[2]) !== "other") {
      errors.push({ line: i + 1, message: "a scrml fence indented 4+ spaces past its container is an indented code block, not a gated fence — indent it at most 3 spaces" });
      dangle();
      continue;
    }

    const fm = FENCE_OPEN_RE.exec(line);
    if (fm && !(fm[2][0] === "`" && fm[3].includes("`"))) {
      const ch = fm[2][0];
      const len = fm[2].length;
      const kind = fenceKind(fm[3]);
      const strip = col + fm[1].length; // content lines lose up to this many leading spaces
      const closeRe = new RegExp(`^ {0,3}${ch === "`" ? "`" : "~"}{${len},}\\s*$`);
      const fenceLine = i + 1;
      const body = [];
      let closed = false;
      while (i + 1 < lines.length) {
        const l = lines[i + 1];
        // A non-blank line indented less than the container ends the list item, and the fence.
        if (col > 0 && l.trim() !== "" && indentOf(l) < col) break;
        i++;
        if (closeRe.test(l.slice(Math.min(indentOf(l), col)))) { closed = true; break; }
        body.push(l.slice(Math.min(indentOf(l), strip)));
      }
      if (!closed && i + 1 >= lines.length && kind === "scrml") {
        errors.push({ line: fenceLine, message: "unclosed scrml fence — it runs to the end of the document" });
      }
      if (kind === "bad") {
        errors.push({ line: fenceLine, message: `fence info string \`${fm[3].trim()}\` starts with \`scrml\` but is not \`scrml\` — the gates cannot check it; write \`scrml\` (or a different language)` });
      }
      if (kind === "scrml") {
        if (pendingGates.length > 1) {
          errors.push({ line: pendingGates[1].line, message: `two gate markers on one block (lines ${pendingGates.map((g) => g.line).join(", ")}) — keep one` });
        }
        const first = body.find((l) => l.trim().length > 0) ?? "";
        const lm = LEGACY_SKIP_RE.exec(first);
        blocks.push({
          fenceLine,
          startLine: fenceLine + 1,
          body: body.join("\n"),
          bodyLines: body,
          gate: pendingGates[0] ?? null,
          snippet: pendingSnippet,
          legacySkip: lm ? { reason: lm[1].trim() } : null,
        });
        pendingGates = [];
        pendingSnippet = null;
      } else {
        dangle();
      }
      continue;
    }

    if (line.trim() !== "") dangle();
  }
  dangle();

  // Resolve the dialect.
  let dialect = /** @type {"ruled"|"impl1"} */ ("impl1");
  let dialectLine = null;
  for (const d of dialects) {
    if (!DIALECTS.includes(/** @type {any} */ (d.value))) {
      errors.push({ line: d.line, message: `unknown dialect \`${d.value}\` — write \`dialect: ruled\` (or remove it for impl1)` });
    }
  }
  const valid = dialects.filter((d) => DIALECTS.includes(/** @type {any} */ (d.value)));
  if (valid.length > 0) {
    dialect = /** @type {any} */ (valid[0].value);
    dialectLine = valid[0].line;
    const other = valid.find((d) => d.value !== valid[0].value);
    if (other) errors.push({ line: other.line, message: `conflicting dialect declarations (\`${valid[0].value}\` at line ${valid[0].line}, \`${other.value}\` here)` });
  }

  // Dialect-dependent marker rules.
  for (const b of blocks) {
    if (b.gate?.kind === "spec-ahead" && dialect !== "ruled") {
      errors.push({
        line: b.gate.line,
        message: "`gate: spec-ahead` is only meaningful in a document marked `<!-- dialect: ruled -->` (it means: ruled scrml the bootstrap cannot compile yet)",
      });
    }
    if (b.legacySkip && dialect === "ruled") {
      errors.push({
        line: b.startLine,
        message: "legacy `// gate: skip` line in a ruled document — use `<!-- gate: skip — <reason> -->` above the fence instead (readers should not see gate plumbing)",
      });
    }
  }

  return { dialect, dialectLine, blocks, errors, danglingSnippets };
}

/** True when a line is a gate marker (any kind, valid or not) — snippet-drift lets these sit between its marker and the fence. */
export function isGateMarkerLine(line) {
  return GATE_ANY_RE.test(line);
}

/**
 * The DIALECT of each cited snippet file, derived from the documents that cite it
 * (S469). A `.scrml` file a ruled document cites with `<!-- snippet: … -->` is compiled
 * by the BOOTSTRAP in scripts/snippet-gate.js; every other file stays impl#1. The
 * document is the single opt-in: a migrated tutorial migrates its snippet files with it,
 * and the file itself carries no plumbing a reader would see in the copy.
 *
 * A `gate: spec-ahead` marker on ANY citing block marks the FILE spec-ahead (an excerpt
 * of a spec-ahead file need not repeat it). A `gate: skip` on a snippet-marked block is
 * an error: the file is compiled whole regardless, so the skip would be a lie.
 * A file cited by both a ruled and an impl1 document is an error: it cannot be both.
 *
 * Marker errors are returned only for documents that cite a snippet or are ruled — the
 * documents whose markers change what snippet-gate compiles.
 *
 * @param {(rel: string) => string} readDoc  reads a repo-relative document
 * @param {string[]} docs                    repo-relative documents to scan
 * @returns {{ byFile: Map<string, { dialect: "ruled"|"impl1", specAhead: { reason: string, doc: string, line: number } | null, citedBy: Array<{ doc: string, line: number, dialect: string }> }>, errors: Array<{ doc: string, line: number, message: string }> }}
 */
export function collectSnippetDialects(readDoc, docs) {
  const byFile = new Map();
  const errors = [];
  for (const doc of docs) {
    const text = readDoc(doc);
    if (!text.includes("snippet:") && !text.includes("dialect")) continue;
    const parsed = parseDocMarkers(text);
    const cites = parsed.blocks.filter((b) => b.snippet);
    if (cites.length === 0 && parsed.dialect !== "ruled") continue;
    for (const e of parsed.errors) errors.push({ doc, line: e.line, message: e.message });
    for (const b of cites) {
      const path = b.snippet.path;
      let entry = byFile.get(path);
      if (!entry) {
        entry = { dialect: parsed.dialect, specAhead: null, citedBy: [] };
        byFile.set(path, entry);
      }
      entry.citedBy.push({ doc, line: b.snippet.line, dialect: parsed.dialect });
      if (entry.dialect !== parsed.dialect) {
        const other = entry.citedBy.find((c) => c.dialect !== parsed.dialect);
        errors.push({
          doc,
          line: b.snippet.line,
          message: `${path} is cited by a ${parsed.dialect} document here and by a ${other.dialect} document (${other.doc}:${other.line}) — one file cannot be both dialects; migrate both documents or split the file`,
        });
      }
      if (b.gate?.kind === "skip") {
        errors.push({
          doc,
          line: b.gate.line,
          message: `\`gate: skip\` on a snippet-marked block — ${path} is compiled whole by snippet-gate regardless; remove the skip (in a ruled document, use \`gate: spec-ahead\` if the bootstrap cannot compile it yet)`,
        });
      }
      if (b.gate?.kind === "spec-ahead" && parsed.dialect === "ruled" && entry.specAhead === null) {
        entry.specAhead = { reason: b.gate.reason, doc, line: b.gate.line, codes: b.gate.codes };
      }
    }
  }
  return { byFile, errors };
}
