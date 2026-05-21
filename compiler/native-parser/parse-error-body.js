// parse-error-body.js — JS-host shadow of parse-error-body.scrml.
// See span.js header for the .scrml<->.js duplication rationale.
// PILLAR 5b classification mirrors parse-error-body.scrml's header.
//
// F8 / v0.6 BRIDGE-LIGHT — the native-parser analogue of the live
// pipeline's error-effect `!{...}` arm shaping (compiler/src/ast-builder.js
// `parseErrorTokens` ~L10194 + the `buildBlock` `case "error-effect"` arm
// ~L11493). A pure calculation over a native `ErrorEffect` block's body
// text.
//
// THE LIVE CONTRACT (the behavioral spec — ast-builder.js):
//   The live BS routes a `!{ ... }` block to `case "error-effect"`. The
//   legacy arm form is `| ::TypeName binding -> handler` (SPEC §19 — the
//   error-effect inline handler; the arrow is `->`). `parseErrorTokens`
//   produces an `ErrorArm[]`; an arm is:
//     { pattern, binding, handler, handlerExpr?, span }
//   where
//     - pattern  — `"::TypeName"` (variant), `".Variant"` (bare-dot,
//                  §14.10/M9), or `"_"` (wildcard);
//     - binding  — the bound identifier (bare ident or `(ident)` tuple
//                  form), or `""` when the arm binds nothing;
//     - handler  — the trimmed handler expression source;
//     - span     — the arm's source span.
//   The leading `|` is OPTIONAL — `parseErrorTokens` also accepts a bare
//   `::Type(binding) -> handler` arm (the §19.4.3 canonical no-pipe form).
//   The arrow may be written `->`, `=>`, or `:>`.
//
// THE NATIVE NODE-CATALOG ADAPTATION (Phase 0 — M5-divergence-ledger):
//   The native parser's `ErrorEffect` block (parse-markup.js — entered by
//   the `!{` sigil, closed by the matching `}`) was SKETCH-DEPTH: it
//   captured the brace extent but not the arm structure. F8 lights it up:
//     - the markup layer captures `block.bodyText` (the verbatim body
//       slice — the same extraction the .InLogicEscape / .InCss / .InSql
//       branches do);
//     - shapeErrorEffectBlock parses `bodyText` into `block.arms` — the
//       live `ErrorEffectNode.arms` payload (an `ErrorArm[]`).
//   The stamped `arms` array IS the live FileAST shape — no native<->live
//   translation layer. Spans on the produced arms are body-LOCAL offsets
//   (relative to the body slice); a host-absolute shift is M5-swap scope
//   (the same posture parse-markup.js's `parseLogicBodyBestEffort` takes
//   for LogicEscape statement spans, and parse-css-body.js / parse-sql-
//   body.js take for their payloads).
//
// The arm `handler` is kept as a STRING at this layer — exactly as the
// live `parseErrorTokens` does (the live builder fills `handlerExpr` in a
// later phase via `_parseHandlerExpr`). The native shaper does NOT delegate
// the handler to parse-expr; the M5 swap-in re-derives `handlerExpr` when
// the native block reaches the live downstream stages.

// =============================================================================
// shapeErrorEffectBlock — calculation (mutates the passed ErrorEffect block
// in place, the same way emitContextBlock stamps `.bodyText`). Given a
// native `ErrorEffect` block with `block.bodyText` set, parse the body into
// `block.arms` — the live `ErrorEffectNode.arms` payload.
// =============================================================================
export function shapeErrorEffectBlock(block) {
    if (block === undefined || block === null || block.kind !== "ErrorEffect") {
        return block;
    }
    const bodyText = typeof block.bodyText === "string" ? block.bodyText : "";
    block.arms = parseErrorArms(bodyText);
    return block;
}

// =============================================================================
// parseErrorArms — calculation (pure). Parse an error-effect body string
// into an ErrorArm[]. A single-pass scan recognizing the legacy
// `| ::Type binding -> handler` arm form and the no-pipe
// `::Type(binding) -> handler` form.
//
// Mirrors the live `tokenizeError` + `parseErrorTokens` two-pass pipeline,
// fused into one character scan — the native parser produces the arm
// structure directly (no intermediate error-token stream).
// =============================================================================
export function parseErrorArms(bodyText) {
    const arms = [];
    const src = typeof bodyText === "string" ? bodyText : "";
    const len = src.length;
    let p = 0;

    while (p < len) {
        p = skipErrorWhitespace(src, p);
        if (p >= len) break;

        const armStart = p;
        // An optional leading `|` introduces the arm.
        if (src.charAt(p) === "|") {
            p = p + 1;
            p = skipErrorWhitespace(src, p);
        }

        // The pattern — `::Name`, `.Variant`, or `_`. Anything else is not
        // an arm start; skip the character and continue (best-effort, the
        // same posture parseErrorTokens takes for unrecognized tokens).
        const pat = scanErrorPattern(src, p);
        if (pat === null) {
            // Not an arm boundary — advance past this character so the
            // scan always makes progress.
            p = (p > armStart) ? p : p + 1;
            continue;
        }
        const pattern = pat.pattern;
        p = pat.end;

        // The binding — a bare identifier or a `(ident)` tuple form, or
        // nothing.
        p = skipErrorWhitespace(src, p);
        let binding = "";
        const bnd = scanErrorBinding(src, p);
        if (bnd !== null) {
            binding = bnd.binding;
            p = bnd.end;
        }

        // The arrow — `->`, `=>`, or `:>`. Tolerated as the live parser
        // tolerates all three.
        p = skipErrorWhitespace(src, p);
        const arrowEnd = scanErrorArrow(src, p);
        if (arrowEnd > p) {
            p = arrowEnd;
        }

        // The handler — the run up to the next arm-starting `|` (at
        // brace/paren depth 0) or end of body.
        p = skipErrorWhitespace(src, p);
        const handlerStart = p;
        const handlerEnd = scanErrorHandler(src, p);
        const handler = src.substring(handlerStart, handlerEnd).trim();
        p = handlerEnd;

        arms.push({
            pattern: pattern,
            binding: binding,
            handler: handler,
            span: makeErrorLocalSpan(armStart, p),
        });
    }

    return arms;
}

// scanErrorPattern — calculation. At `p`, recognize an error-arm pattern:
//   `::Name`   -> { pattern: "::Name", end }
//   `.Variant` -> { pattern: ".Variant", end }  (uppercase-led)
//   `_`        -> { pattern: "_", end }
// Returns null when no pattern begins at `p`.
function scanErrorPattern(src, p) {
    const len = src.length;
    if (p >= len) return null;

    // `::Name` — the `::` variant marker.
    if (src.charAt(p) === ":" && p + 1 < len && src.charAt(p + 1) === ":") {
        let q = p + 2;
        const nameStart = q;
        while (q < len && isErrorIdentChar(src.charAt(q))) {
            q = q + 1;
        }
        if (q > nameStart) {
            return { pattern: "::" + src.substring(nameStart, q), end: q };
        }
        return null;
    }

    // `.Variant` — a bare-dot variant pattern (§14.10 / M9); the name's
    // first character must be uppercase.
    if (src.charAt(p) === "." && p + 1 < len && isErrorIdentStart(src.charAt(p + 1))
        && isUpperAscii(src.charAt(p + 1))) {
        let q = p + 1;
        const nameStart = q;
        while (q < len && isErrorIdentChar(src.charAt(q))) {
            q = q + 1;
        }
        return { pattern: "." + src.substring(nameStart, q), end: q };
    }

    // `_` — the wildcard pattern. A bare `_` not followed by an
    // identifier character (a `_foo` ident is not the wildcard).
    if (src.charAt(p) === "_"
        && !(p + 1 < len && isErrorIdentChar(src.charAt(p + 1)))) {
        return { pattern: "_", end: p + 1 };
    }

    return null;
}

// scanErrorBinding — calculation. At `p`, recognize an arm binding:
//   `(ident)` -> { binding: "ident", end }   (tuple form, §19.4.3)
//   `ident`   -> { binding: "ident", end }   (bare form)
// Returns null when no binding begins at `p`. The arrow characters
// (`-`, `=`, `:`) never start a binding, so an arm with no binding scans
// straight to the arrow.
function scanErrorBinding(src, p) {
    const len = src.length;
    if (p >= len) return null;

    // `(ident)` — the tuple-style binding.
    if (src.charAt(p) === "(") {
        let q = skipErrorWhitespace(src, p + 1);
        const nameStart = q;
        while (q < len && isErrorIdentChar(src.charAt(q))) {
            q = q + 1;
        }
        if (q === nameStart) return null;
        const name = src.substring(nameStart, q);
        q = skipErrorWhitespace(src, q);
        if (q < len && src.charAt(q) === ")") {
            q = q + 1;
        }
        return { binding: name, end: q };
    }

    // A bare identifier.
    if (isErrorIdentStart(src.charAt(p))) {
        let q = p;
        while (q < len && isErrorIdentChar(src.charAt(q))) {
            q = q + 1;
        }
        return { binding: src.substring(p, q), end: q };
    }

    return null;
}

// scanErrorArrow — calculation. At `p`, consume an arm arrow (`->`, `=>`,
// or `:>`) and return the offset one past it; returns `p` unchanged when
// no arrow begins at `p`.
function scanErrorArrow(src, p) {
    const len = src.length;
    if (p + 1 >= len) return p;
    const c0 = src.charAt(p);
    const c1 = src.charAt(p + 1);
    if ((c0 === "-" || c0 === "=" || c0 === ":") && c1 === ">") {
        return p + 2;
    }
    return p;
}

// scanErrorHandler — calculation. From `p`, scan the handler run: every
// character up to the next arm-starting `|` at brace/paren depth 0, or end
// of body. A `|` inside a `{...}` / `(...)` / `[...]` group, or inside a
// string, does NOT end the handler.
function scanErrorHandler(src, p) {
    const len = src.length;
    let q = p;
    let depth = 0;
    while (q < len) {
        const ch = src.charAt(q);
        if (ch === "\"" || ch === "'" || ch === "`") {
            q = skipErrorString(src, q, ch);
            continue;
        }
        if (ch === "{" || ch === "(" || ch === "[") {
            depth = depth + 1;
            q = q + 1;
            continue;
        }
        if (ch === "}" || ch === ")" || ch === "]") {
            if (depth > 0) depth = depth - 1;
            q = q + 1;
            continue;
        }
        // A depth-0 `|` starts the next arm — UNLESS it is part of a `||`
        // logical-or operator (the live parser splits arms on a lone `|`).
        if (ch === "|" && depth === 0) {
            const prev = q > p ? src.charAt(q - 1) : "";
            const next = q + 1 < len ? src.charAt(q + 1) : "";
            if (prev !== "|" && next !== "|") {
                return q;
            }
        }
        q = q + 1;
    }
    return q;
}

// skipErrorString — calculation. From the opening quote at `p`, return the
// offset one past the matching closing `quote`. Backslash escapes are
// honored.
function skipErrorString(src, p, quote) {
    const len = src.length;
    let q = p + 1;
    while (q < len) {
        const ch = src.charAt(q);
        if (ch === "\\") {
            q = q + 2;
            continue;
        }
        if (ch === quote) {
            return q + 1;
        }
        q = q + 1;
    }
    return q;
}

// skipErrorWhitespace — calculation. Return the offset of the first
// non-whitespace character at or after `p`.
function skipErrorWhitespace(src, p) {
    const len = src.length;
    let q = p;
    while (q < len && isErrorWhitespace(src.charAt(q))) {
        q = q + 1;
    }
    return q;
}

// isErrorWhitespace — calculation. The whitespace set (space, tab, CR, LF).
function isErrorWhitespace(ch) {
    return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

// isErrorIdentStart — calculation. An identifier's first character: an
// ASCII letter, `_`, or `$`.
function isErrorIdentStart(ch) {
    if (ch === "" || ch === undefined || ch === null) return false;
    if (ch === "_" || ch === "$") return true;
    return isLetterAscii(ch);
}

// isErrorIdentChar — calculation. An identifier's interior character: an
// ASCII letter, digit, `_`, or `$`.
function isErrorIdentChar(ch) {
    if (ch === "" || ch === undefined || ch === null) return false;
    if (ch === "_" || ch === "$") return true;
    if (isLetterAscii(ch)) return true;
    return ch >= "0" && ch <= "9";
}

// isLetterAscii — calculation. An ASCII letter (either case).
function isLetterAscii(ch) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

// isUpperAscii — calculation. An uppercase ASCII letter.
function isUpperAscii(ch) {
    return ch >= "A" && ch <= "Z";
}

// makeErrorLocalSpan — calculation. A body-LOCAL span (offsets relative to
// the error-effect body slice). The host-absolute shift is M5-swap scope
// — the same posture parse-css-body.js / parse-sql-body.js take.
function makeErrorLocalSpan(start, end) {
    return { start: start, end: end, line: 1, col: 1 };
}
