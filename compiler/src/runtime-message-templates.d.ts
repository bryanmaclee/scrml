// runtime-message-templates.d.ts — type declarations for runtime-message-templates.js (S462; types gate).
// (`export declare` form so the file also transpiles as ordinary TS.)
// The implementation stays JavaScript (it is inlined verbatim into the client runtime's 'messages'
// chunk); this file only describes its exports to the TypeScript checker. Keep in step.
//
// The module's documentation lives HERE, not in the .js, so it does not ship in every client runtime
// that carries the 'messages' chunk (S462 FIX1 F4):
//
// SPEC §41.12.1 — message templates for the §55.10 error-message chain (S462).
//
// ONE source for both readers of a message template:
//   - the COMPILER reads it as an ES module: `type-system.ts` (`checkRegisterMessagesCalls`) parses
//     every LITERAL `registerMessages` template with `_scrml_message_template_parse` and refuses an
//     unknown slot (E-MESSAGE-SLOT-UNKNOWN) or a malformed template (E-MESSAGE-TEMPLATE-MALFORMED);
//   - the RUNTIME inlines this file's source verbatim (`export ` stripped, runtime-template.js chunk
//     'messages') and parses every template `registerMessages` receives with the same function, so a
//     template the compiler could not see (a variable, a back-tick string with `${}`) is judged by the
//     same grammar and the same slot table — and refused, never half-rendered, when it fails.
// The Level-3 shipped defaults are templates in this grammar too (`_SCRML_DEFAULT_MESSAGES`).
// Do not write a second slot table or a second template reader anywhere: change this file.
//
// Grammar (§41.12.1):
//     template := ( text | "{{" | slot )*
//     slot     := "{" name "}"          name := [A-Za-z_][A-Za-z0-9_]*
//     text     := any character other than "{"
// Only `{` is special. `{{` is a literal `{`; a `}` outside a slot is ordinary text.
//
// This file is inlined into a classic browser script and into the server bundle, so it holds plain
// function and `const` declarations only — no imports, no TypeScript, and every top-level name carries
// the `_scrml_` / `_SCRML_` prefix the runtime reserves.
//
// parse(text, slots) returns `{ ok: true, parts }` — `parts` alternates literal text (a string) and
// slots (`{ slot: name }`) — or `{ ok: false, reason, at, slot }`: "malformed" for a `{` at offset `at`
// that is neither `{{` nor `{` name `}`; "unknown-slot" for a `{slot}` not in `slots`.
// render(parts, error, fieldName) returns the message TEXT (the HTML sink escapes it, §55.8).

export type MessageTemplatePart = string | { slot: string };

export type MessageTemplateParse =
  | { ok: true; parts: MessageTemplatePart[] }
  | { ok: false; reason: "malformed" | "unknown-slot"; at: number; slot: string };

export declare const _SCRML_MESSAGE_SLOTS: Record<string, string[]>;
export declare const _SCRML_DEFAULT_MESSAGES: Record<string, string>;
export declare function _scrml_message_template_parse(text: string, slots: string[]): MessageTemplateParse;
export declare function _scrml_message_template_render(
  parts: MessageTemplatePart[],
  error: Record<string, unknown>,
  fieldName: string,
): string;
