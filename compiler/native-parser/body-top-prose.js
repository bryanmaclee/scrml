// body-top-prose.js — the S441 "prose must be DECLARED" body-top segmenter.
//
// SPEC §40.8 (S441 bullet) + §4.18.1 (S441 amendment): a `<program>` /
// `<page>` / `<channel>` body is a CODE-DEFAULT body. A bare run directly in
// it is a statement sequence (logic), and displayed text is DECLARED — by a
// markup element (its own free-text body) or by a `"..."` display-text
// literal (§4.18.3) standing as its own statement.
//
// This module is the ONE place both front ends (the live `liftBareDeclarations`
// in compiler/src/ast-builder.js and the native `liftBareBlocks` in
// parse-markup.js) find the display-text literals inside a body-top run, so the
// two pipelines cannot disagree on what is a literal and what is code. It is
// pure (no imports, no mutation of its input) and knows nothing about either
// front end's block shape: the caller flattens a body's direct children into
// ITEMS and maps the result back.
//
//   item kinds:
//     { type: "text",   raw }  a bare text run (the unit this module scans)
//     { type: "interp" }       a `${...}` logic escape the author wrote
//     { type: "neutral", raw } a comment — changes nothing but the line state;
//                              met inside an open literal it is literal text
//     { type: "break" }        anything else (a markup element, a sigil
//                              block, ...) — a statement boundary
//
// A display-text literal is a `"` that STARTS A STATEMENT — at bracket depth 0,
// with only whitespace since the last line break (or since the preceding
// markup element), and with no pending binary operator before it (so
// `const s =⏎ "x"` stays code) — and whose closing `"` is followed by nothing
// but whitespace, `;`, or a `//` comment up to the end of the line (so
// `"a" + b` and `"x".length` stay code). A literal whose text run ends before
// its closing `"` continues through the following `${...}` items (the
// §4.18.4 interpolation) into the next text run. A `"` anywhere else is an
// ordinary code string.
//
// Output, per text item: an ordered list of segments covering the raw string
// exactly once, in order:
//     { kind: "code",    start, end }
//     { kind: "literal", start, end, value, opens, closes }
// `start`/`end` are offsets into that item's raw. For a literal segment the
// range includes the delimiting quote(s) present in this item; `value` is the
// decoded, HTML-escaped text content of that piece (§4.18.3 escapes, §4.18.6
// auto-escape); `opens`/`closes` say whether this piece holds the opening /
// closing quote. Per interp item: whether it sits inside a literal (it renders
// as an interpolation) or not (it is a logic block, evaluated). Plus
// `unterminated`: literals whose closing quote never arrived before a `break`
// item or the end of the body — `{ itemIndex, offset }` of the opening quote
// (E-CTX-001, §4.18.3).

// Characters that, as the last significant character before a line break,
// mean the next line continues the same expression — so a `"` opening that
// line is an operand, not a display-text statement.
const CONTINUATION_CHARS = new Set([
    "=", "+", "-", "*", "/", "%", ",", ":", "?", "&", "|", "!", "<", ">", "~", ".", "^",
    "(", "[", "{",
]);

// htmlEscapeText — calculation. §4.18.6: `&`, `<`, `>` in literal text.
export function htmlEscapeText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// decodeLiteralText — calculation. §4.18.3 escapes: `\"` -> `"`, `\\` -> `\`,
// `\${` -> `${`. Any other backslash sequence is kept verbatim.
export function decodeLiteralText(s) {
    let out = "";
    let i = 0;
    while (i < s.length) {
        const c = s.charAt(i);
        if (c === "\\" && i + 1 < s.length) {
            const n = s.charAt(i + 1);
            if (n === "\"" || n === "\\") { out += n; i += 2; continue; }
            if (n === "$" && s.charAt(i + 2) === "{") { out += "${"; i += 3; continue; }
        }
        out += c;
        i += 1;
    }
    return out;
}

// scanLiteralClose — calculation. From `from` (just past an opening quote, or
// the start of a continuation run), find the closing unescaped `"`. Returns
// the index of the closing quote, or -1.
function scanLiteralClose(raw, from) {
    let i = from;
    while (i < raw.length) {
        const c = raw.charAt(i);
        if (c === "\\") { i += 2; continue; }
        if (c === "\"") return i;
        i += 1;
    }
    return -1;
}

// Words that, as the last token before a line break, mean the next line is
// their operand (`@a and⏎ "d"`, `typeof⏎ "x"`) — S441 review #9.
const CONTINUATION_WORDS = new Set(["and", "or", "in", "of", "instanceof", "is", "typeof", "new", "void", "delete"]);

// Characters that, OPENING the next non-blank line, continue the expression
// the literal ended (`"a"⏎ + "b"`, `"abc"⏎ .toUpperCase()`) — S441 review #9/#10.
const LEADING_CONTINUATION_CHARS = new Set(["+", "-", "*", "/", "%", ".", "?", "&", "|", "^", ",", "="]);

// restOfLineIsStatementEnd — predicate. After a closing quote at `at`, the rest
// of the line is only whitespace, an optional `;`, and an optional `//` comment
// — and (unless a `;` ended it) the next non-blank line does not open with an
// operator / `.` / a word operator that would continue the expression.
function restOfLineIsStatementEnd(raw, at) {
    let i = at;
    let sawSemi = false;
    while (i < raw.length) {
        const c = raw.charAt(i);
        if (c === "\n") break;
        if (c === ";") { sawSemi = true; i += 1; continue; }
        if (c === " " || c === "\t" || c === "\r") { i += 1; continue; }
        if (c === "/" && raw.charAt(i + 1) === "/") {
            while (i < raw.length && raw.charAt(i) !== "\n") i += 1;
            break;
        }
        return false;
    }
    if (sawSemi) return true;
    // Look at the next non-blank line.
    let j = i;
    while (j < raw.length && (raw.charAt(j) === "\n" || raw.charAt(j) === " " || raw.charAt(j) === "\t" || raw.charAt(j) === "\r")) j += 1;
    if (j >= raw.length) return true;
    const n = raw.charAt(j);
    if (n === "/" && (raw.charAt(j + 1) === "/" || raw.charAt(j + 1) === "*")) return true;
    if (LEADING_CONTINUATION_CHARS.has(n)) return false;
    const w = /^[A-Za-z_$]+/.exec(raw.slice(j));
    if (w && (w[0] === "and" || w[0] === "or") && !/^[A-Za-z0-9_$]/.test(raw.charAt(j + w[0].length))) return false;
    return true;
}

// segmentBodyTopItems — calculation (pure). See the header.
export function segmentBodyTopItems(items) {
    const segments = [];
    const interpInLiteral = [];
    const unterminated = [];

    // Code-scan state, carried across items of the same body.
    let depth = 0;            // ( [ { nesting in code
    let lastSig = "";         // last significant code char ("" = statement start)
    let lastWord = "";        // the word token lastSig ended (for CONTINUATION_WORDS)
    let lineClean = true;     // only whitespace since the last line break / break item
    let inTemplate = false;   // inside a code backtick template across items
    let inBlockComment = false;
    // Literal state.
    let inLiteral = false;
    let literalOpenAt = null; // { itemIndex, offset }

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const type = item === null || item === undefined ? "break" : item.type;
        if (type === "interp") {
            segments.push(null);
            interpInLiteral.push(inLiteral);
            if (inLiteral === false) {
                // An evaluated `${...}` logic block is itself a statement.
                lastSig = "";
                lineClean = false;
            }
            continue;
        }
        interpInLiteral.push(false);
        if (type === "neutral" && inLiteral === false) {
            segments.push(null);
            lineClean = true;
            continue;
        }
        // A comment item met INSIDE an open literal is literal text the
        // splitter mistook for a comment (`"see http://x.y"`): scan it as
        // text. The caller converts such an item to text when it gets
        // segments back for it.
        if (type !== "text" && type !== "neutral") {
            segments.push(null);
            if (inLiteral) {
                unterminated.push(literalOpenAt);
                inLiteral = false;
                literalOpenAt = null;
            }
            depth = 0;
            lastSig = "";
            lineClean = true;
            inTemplate = false;
            inBlockComment = false;
            continue;
        }

        const raw = typeof item.raw === "string" ? item.raw : "";
        const segs = [];
        let segStart = 0;       // start of the current code segment
        let i = 0;

        // A literal continued from a previous item (after a `${...}`).
        if (inLiteral) {
            const close = scanLiteralClose(raw, 0);
            if (close === -1) {
                segs.push({
                    kind: "literal", start: 0, end: raw.length,
                    value: htmlEscapeText(decodeLiteralText(raw)), opens: false, closes: false,
                });
                segments.push(segs);
                continue;
            }
            segs.push({
                kind: "literal", start: 0, end: close + 1,
                value: htmlEscapeText(decodeLiteralText(raw.slice(0, close))), opens: false, closes: true,
            });
            inLiteral = false;
            literalOpenAt = null;
            lastSig = "";
            lineClean = false;
            i = close + 1;
            segStart = i;
        }

        while (i < raw.length) {
            const c = raw.charAt(i);
            if (inBlockComment) {
                if (c === "*" && raw.charAt(i + 1) === "/") { inBlockComment = false; i += 2; continue; }
                if (c === "\n") lineClean = true;
                i += 1;
                continue;
            }
            if (inTemplate) {
                if (c === "\\") { i += 2; continue; }
                if (c === "`") { inTemplate = false; lastSig = "`"; }
                i += 1;
                continue;
            }
            if (c === "\n") { lineClean = true; i += 1; continue; }
            if (c === " " || c === "\t" || c === "\r") { i += 1; continue; }
            if (c === "/" && raw.charAt(i + 1) === "/") {
                while (i < raw.length && raw.charAt(i) !== "\n") i += 1;
                continue;
            }
            if (c === "/" && raw.charAt(i + 1) === "*") { inBlockComment = true; i += 2; continue; }
            if (c === "`") { inTemplate = true; lineClean = false; i += 1; continue; }
            if (c === "'") {
                // A single-quoted string ends at its quote or the line end.
                let j = i + 1;
                while (j < raw.length && raw.charAt(j) !== "'" && raw.charAt(j) !== "\n") {
                    if (raw.charAt(j) === "\\") j += 1;
                    j += 1;
                }
                i = raw.charAt(j) === "'" ? j + 1 : j;
                lastSig = "'";
                lineClean = false;
                continue;
            }
            if (c === "\"") {
                const statementStart = depth === 0 && lineClean
                    && (lastSig === "" || CONTINUATION_CHARS.has(lastSig) === false)
                    && CONTINUATION_WORDS.has(lastWord) === false;
                if (statementStart) {
                    const close = scanLiteralClose(raw, i + 1);
                    if (close === -1) {
                        // Runs off the end of this text run — an interpolated
                        // literal continues through the following `${...}`.
                        if (segStart < i) segs.push({ kind: "code", start: segStart, end: i });
                        segs.push({
                            kind: "literal", start: i, end: raw.length,
                            value: htmlEscapeText(decodeLiteralText(raw.slice(i + 1))), opens: true, closes: false,
                        });
                        inLiteral = true;
                        literalOpenAt = { itemIndex: idx, offset: i };
                        i = raw.length;
                        segStart = raw.length;
                        break;
                    }
                    if (restOfLineIsStatementEnd(raw, close + 1)) {
                        if (segStart < i) segs.push({ kind: "code", start: segStart, end: i });
                        segs.push({
                            kind: "literal", start: i, end: close + 1,
                            value: htmlEscapeText(decodeLiteralText(raw.slice(i + 1, close))), opens: true, closes: true,
                        });
                        i = close + 1;
                        segStart = i;
                        lastSig = "";
                        lineClean = false;
                        continue;
                    }
                    // `"a" + b` / `"x".length` — an ordinary code string.
                    i = close + 1;
                    lastSig = "\"";
                    lineClean = false;
                    continue;
                }
                // A code string.
                const close = scanLiteralClose(raw, i + 1);
                i = close === -1 ? raw.length : close + 1;
                lastSig = "\"";
                lineClean = false;
                continue;
            }
            if (/[A-Za-z_$]/.test(c) && (i === 0 || /[A-Za-z0-9_$@]/.test(raw.charAt(i - 1)) === false)) {
                // A whole word token: remember it for CONTINUATION_WORDS.
                let j = i;
                while (j < raw.length && /[A-Za-z0-9_$]/.test(raw.charAt(j))) j += 1;
                lastWord = raw.slice(i, j);
                lastSig = raw.charAt(j - 1);
                lineClean = false;
                i = j;
                continue;
            }
            if (c === "(" || c === "[" || c === "{") depth += 1;
            if ((c === ")" || c === "]" || c === "}") && depth > 0) depth -= 1;
            // A closing `}` ends a statement (`fn f() { }⏎ "x"`).
            lastSig = c === "}" || c === ";" ? "" : c;
            lastWord = "";
            lineClean = false;
            i += 1;
        }
        if (segStart < raw.length) segs.push({ kind: "code", start: segStart, end: raw.length });
        segments.push(segs);
    }
    if (inLiteral && literalOpenAt !== null) unterminated.push(literalOpenAt);
    return { segments, interpInLiteral, unterminated };
}

// ---------------------------------------------------------------------------
// Scanner-level helpers (S441). Both block scanners — the live
// block-splitter and the native markup trampoline — run BEFORE the segmenter
// above and would otherwise cut a body-top literal apart at a `<` (a tag
// opener) or a `//` (a comment). They use these two predicates, shared so
// the two scanners agree, to recognize a statement-start `"` and find its
// closing quote, and then treat everything up to it as text (a `${…}`
// interpolation inside still opens a logic context).

// bodyTopQuoteStartsStatement — predicate. Does the `"` at `at` start a
// statement? `bound` is the start of the current text run (the offset just
// after the preceding element / block, or `at` itself when no run is open).
// Only whitespace may sit between the quote and the preceding line break (or
// `bound`), and the last significant character before that break must not be
// an operator that continues an expression.
export function bodyTopQuoteStartsStatement(source, at, bound) {
    let k = at - 1;
    while (k >= bound && (source[k] === " " || source[k] === "\t" || source[k] === "\r")) k -= 1;
    if (k < bound) return true;
    if (source[k] !== "\n") return false;
    while (k >= bound && (source[k] === " " || source[k] === "\t" || source[k] === "\r" || source[k] === "\n")) k -= 1;
    if (k < bound) return true;
    return CONTINUATION_CHARS.has(source[k]) === false;
}

// skipInterpolation — calculation. `at` is the `$` of a `${`; return the
// offset just past its matching `}` (quote-aware), or `source.length`.
function skipInterpolation(source, at) {
    let i = at + 2;
    let depth = 1;
    let q = null;
    while (i < source.length) {
        const c = source[i];
        if (q !== null) {
            if (c === "\\") { i += 2; continue; }
            if (c === q) q = null;
            i += 1;
            continue;
        }
        if (c === "\"" || c === "'" || c === "`") { q = c; i += 1; continue; }
        if (c === "{") depth += 1;
        if (c === "}") {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
        i += 1;
    }
    return source.length;
}

// scanBodyTopLiteralClose — calculation. The offset of the closing `"` of a
// body-top literal opened at `at`, skipping `\`-escapes and `${…}`
// interpolations; -1 at EOF or when a LINE opens with `<`. A literal may span
// lines and may carry inline markup-looking text (`"a <b>x</b> c"`), but a
// line that starts with a tag is the next element — so a missing closing `"`
// cannot swallow the markup after it (the segmenter then reports the
// unterminated literal, E-CTX-001).
export function scanBodyTopLiteralClose(source, at) {
    let j = at + 1;
    while (j < source.length) {
        const c = source[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "$" && source[j + 1] === "{") { j = skipInterpolation(source, j); continue; }
        if (c === "\"") return j;
        if (c === "\n") {
            let k = j + 1;
            while (k < source.length && (source[k] === " " || source[k] === "\t" || source[k] === "\r")) k += 1;
            if (source[k] === "<") return -1;
        }
        j += 1;
    }
    return -1;
}

// scanBodyTopTemplateClose — calculation (S441 review #8). The offset of the
// closing backtick of a CODE template literal opened at `at` at a body-top
// (`const msg = \`total is ${@total} units\``), skipping `\`-escapes and
// `${…}` interpolations; -1 at EOF or when a LINE opens with `<` (a missing
// closing backtick cannot swallow the next element). Both block scanners keep
// the whole template — `${…}` included — as ONE text run, so the lift hands it
// to the logic parser intact instead of cutting it at `${` (which left the
// tail ` units\`` to be lifted as code: a runtime ReferenceError).
export function scanBodyTopTemplateClose(source, at) {
    let j = at + 1;
    while (j < source.length) {
        const c = source[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "$" && source[j + 1] === "{") { j = skipInterpolation(source, j); continue; }
        if (c === "`") return j;
        if (c === "\n") {
            let k = j + 1;
            while (k < source.length && (source[k] === " " || source[k] === "\t" || source[k] === "\r")) k += 1;
            if (source[k] === "<") return -1;
        }
        j += 1;
    }
    return -1;
}

// uncoveredSegments — calculation (S441 round 4, the COVERAGE invariant). In
// `source[start, end)`, every non-whitespace, non-comment character must lie in
// one of `ranges` (`[a, b)` absolute — parsed statements and diagnostics).
// Returns the uncovered stretches, split per line and trimmed:
// `{ start, end }` absolute. Comments (`//` to end of line, `/* … */`) in an
// uncovered stretch are not content.
export function uncoveredSegments(source, start, end, ranges) {
    const len = Math.max(0, end - start);
    const covered = new Uint8Array(len);
    for (const r of ranges) {
        const a = Math.max(start, r[0]);
        const b = Math.min(end, r[1]);
        for (let i = a; i < b; i++) covered[i - start] = 1;
    }
    const out = [];
    let i = 0;
    let inBlock = false;
    let segStart = -1;
    let segEnd = -1;
    const flush = () => {
        if (segStart >= 0) out.push({ start: start + segStart, end: start + segEnd });
        segStart = -1;
        segEnd = -1;
    };
    while (i < len) {
        const c = source[start + i];
        if (covered[i]) { flush(); i += 1; continue; }
        if (inBlock) {
            if (c === "*" && source[start + i + 1] === "/") { inBlock = false; i += 2; continue; }
            if (c === "\n") flush();
            i += 1;
            continue;
        }
        if (c === "/" && source[start + i + 1] === "/") {
            while (i < len && source[start + i] !== "\n") i += 1;
            continue;
        }
        if (c === "/" && source[start + i + 1] === "*") { inBlock = true; i += 2; continue; }
        if (c === "\n") { flush(); i += 1; continue; }
        if (c === " " || c === "\t" || c === "\r") { i += 1; continue; }
        if (segStart < 0) segStart = i;
        segEnd = i + 1;
        i += 1;
    }
    flush();
    return out;
}
