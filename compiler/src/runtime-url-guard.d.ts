// runtime-url-guard.d.ts — type declarations for runtime-url-guard.js (S457; types gate).
// (`export declare` form so the file also transpiles as ordinary TS.)
// The implementation stays JavaScript (it is inlined verbatim into the client runtime and the
// server bundle); this file only describes its exports to the TypeScript checker. Keep in step.

export type UrlSchemeReading =
  | { kind: "scheme"; scheme: string; rest: string }
  | { kind: "relative" }
  | { kind: "none" }
  | { kind: "unprovable"; reason: string };

export declare const _SCRML_URL_VALUED_ATTRS: Set<string>;
export declare const _SCRML_URL_ATTR_ELEMENTS: Record<string, string[]>;
export declare function _scrml_is_url_attr(tag: string | null | undefined, name: string): boolean;
export declare const _SCRML_SAFE_URL_SCHEMES: Set<string>;
export declare const _SCRML_SAFE_DATA_IMAGE_TYPES: Set<string>;
export declare const _SCRML_IMAGE_SOURCE_ATTRS: Set<string>;
export declare function _scrml_read_url_scheme(text: unknown, decodesEscapes: boolean): UrlSchemeReading;
export declare function _scrml_data_url_is_raster_image(rest: string): boolean;
export declare function _scrml_url_scheme_admitted(lowerName: string, scheme: string, rest: string): boolean;
export declare function _scrml_url_value_admitted(name: string, value: unknown): boolean;
export declare function _scrml_safe_url(el: unknown, name: string, value: unknown): string;
