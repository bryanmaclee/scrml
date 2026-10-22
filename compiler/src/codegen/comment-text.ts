/**
 * S469 (review of 065fd2035, HIGH-2) — text that goes INTO a generated JavaScript comment.
 *
 * Codegen writes debugging comments that quote source (`// template-attr data-v="…"`,
 * `// class:x=…`, `// <channel name="…">`). Source text may hold a LINE TERMINATOR — LF, CR,
 * LINE SEPARATOR (0x2028) and PARAGRAPH SEPARATOR (0x2029) all end a line for JavaScript — which
 * ends a `//` comment, so the rest of the quoted text ran as CODE (a wrong password logged in
 * through a quoted attribute value). A star-slash ends a block comment the same way. Every
 * comment that quotes source goes through here: each line terminator becomes a visible escape
 * (backslash-n, backslash-r, backslash-u2028, backslash-u2029) and a star-slash becomes `* /`.
 * The result can never leave the comment it is written into.
 */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

export function commentText(v: unknown): string {
  return String(v ?? "")
    .split("\r").join("\\r")
    .split("\n").join("\\n")
    .split(LS).join("\\u2028")
    .split(PS).join("\\u2029")
    .split("*/").join("* /");
}
