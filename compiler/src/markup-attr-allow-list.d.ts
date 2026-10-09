// markup-attr-allow-list.d.ts — type declarations for markup-attr-allow-list.js (S459; types gate).
// The implementation stays JavaScript (it is inlined verbatim into the client runtime's 'metaemit'
// chunk); this file only describes its exports to the TypeScript checker. Keep in step.

export declare const _SCRML_EMIT_GLOBAL_ATTRS: Set<string>;
export declare const _SCRML_EMIT_HTML_ELEMENT_ATTRS: Record<string, string[]>;
export declare const _SCRML_EMIT_SVG_ATTRS: Set<string>;
export declare const _SCRML_EMIT_MATHML_ATTRS: Set<string>;
export declare const _SCRML_EMIT_NS_HTML: string;
export declare const _SCRML_EMIT_NS_SVG: string;
export declare const _SCRML_EMIT_NS_MATHML: string;
export declare function _scrml_emit_fold_name(name: unknown): string;
export declare function _scrml_emit_reserved_attr_name(lowerName: string): boolean;
export declare function _scrml_emit_attr_name_verdict(ns: string | null | undefined, tag: string, name: unknown): string;
export declare function _scrml_emit_attr_value_verdict(name: unknown, value: unknown, tag: string): string;
export declare function _scrml_emit_child_ns(parentNs: string, parentTag: string, childTag: string): string;
export declare const _SCRML_EMIT_DOCUMENT_NAMED_BY_NAME: Set<string>;
export declare const _SCRML_EMIT_FORM_LISTED_ELEMENTS: Set<string>;
export declare function _scrml_emit_is_form_control(ns: string | null | undefined, tag: string, isCustom: boolean): boolean;
export declare function _scrml_emit_named_value_verdict(
  ns: string | null | undefined,
  tag: string,
  lowerName: string,
  value: unknown,
  hasNameAttr: boolean,
  inForm: boolean,
  isCustom: boolean,
  members: { document: Set<string>; form: Set<string>; documentProto?: object | null; formProto?: object | null },
): string;
