// runtime-message-templates.d.ts — type declarations for runtime-message-templates.js (S462; types gate).
// (`export declare` form so the file also transpiles as ordinary TS.)
// The implementation stays JavaScript (it is inlined verbatim into the client runtime's 'messages'
// chunk); this file only describes its exports to the TypeScript checker. Keep in step.

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
