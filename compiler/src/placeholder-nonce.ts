/**
 * Unforgeable compiler placeholders — SPEC §47.1.1 / §2.2.1 (S457).
 *
 * The expression parser rewrites scrml operators it cannot hand to acorn
 * directly (`x is some`, `match`, `[:]`, `~`, `.Variant`, `render name()`,
 * `<#id>`, an expression-position `?{}` / `!{}`) into placeholder calls and
 * identifiers, and later stages recognise those placeholders BY NAME and lower
 * them. Some placeholders carry CODE inside string arguments
 * (`__scrml_match__(subject, "<arm source>")`, the `!{}` handler text). If an
 * author could spell a placeholder, the recognisers would lower the author's
 * strings as code, around every check that reads strings as values (S457
 * review: `_scrml_sql.unsafe` and `_scrml_reactive_set` reached through match
 * arms and `!{}` handler text).
 *
 * THE BOUNDARY. Every placeholder name carries a TOKEN drawn from a
 * cryptographic random source FRESH FOR EACH COMPILATION, and every recogniser
 * matches only the current compilation's token. An author cannot know the
 * token of the compilation that reads their source — it does not exist until
 * that compile starts — so an author-typed `__scrml_match__(…)`, or one carrying
 * a token seen in some earlier compile's output, is an ordinary unknown
 * identifier: lowered by nothing, refused by the §47.1.1 reservation where it
 * looks, and by the §2.2.1 emit gate wherever it reaches an artifact.
 *
 * PER COMPILATION, CARRIED IN CONTEXT (S457 review round 5). A per-PROCESS
 * token leaked: an error-path artifact of one compile carried it (scrml serve
 * returned it in JSON), and a later compile in the same process (serve, watch,
 * dev) accepted a payload spelled with it. The token is therefore created by
 * `withCompilationPlaceholderToken` at the top of every `compileScrml` and held
 * in an AsyncLocalStorage context for the duration of that compilation — not a
 * module global swapped per call — so two compilations interleaved in one
 * process (an async host, the LSP) each read their own token. Code that runs
 * outside any compilation (a unit test calling the parser directly, the LSP's
 * stage calls) reads a process-level FALLBACK token, which no compilation
 * recognises.
 *
 * THE TOKEN NEVER LEAVES THE COMPILER. `compileScrml` scrubs it from every
 * output it returns or writes (artifacts — including the error-path artifacts
 * still written today, g-impl1-artifacts-written-on-error-s451 — diagnostics,
 * and console text) via `scrubPlaceholderToken`, and the emit gate prints a
 * placeholder without it.
 *
 * WHY RANDOM, NOT DERIVED. §40.9.8 / §47.5 require deterministic OUTPUT. A
 * placeholder never reaches a successful compile's output (each is lowered, or
 * the gate refuses the artifact) and the token is scrubbed from everything
 * else, so a random token changes no written byte. A token derived from the
 * inputs would be computable by their author (the compiler's constants are
 * public); a structurally impossible character is defeated by JS identifier
 * escapes (`\u{…}`).
 *
 * @module placeholder-nonce
 */
import { randomBytes } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";

let _tokenObserver: ((token: string) => void) | null = null;

/**
 * TEST HOOK — observe every token created (the leak tests need to know a
 * compilation's token to prove it never appears in that compilation's output
 * and is useless to the next one). Never set by the compiler itself.
 */
export function setPlaceholderTokenObserverForTest(fn: ((token: string) => void) | null): void {
  _tokenObserver = fn;
}

/** A fresh token: `k` + 16 hex digits (64 bits). */
export function newPlaceholderToken(): string {
  const t = "k" + randomBytes(8).toString("hex");
  if (_tokenObserver) _tokenObserver(t);
  return t;
}

const _compilationToken = new AsyncLocalStorage<string>();

/** Outside any compilation (direct stage calls): a process-level token no compilation recognises. */
const FALLBACK_TOKEN = newPlaceholderToken();

/** The current compilation's token (or the out-of-compilation fallback). */
export function currentPlaceholderToken(): string {
  return _compilationToken.getStore() ?? FALLBACK_TOKEN;
}

/** Run `fn` as one compilation with its own fresh token. */
export function withCompilationPlaceholderToken<T>(fn: () => T, token: string = newPlaceholderToken()): T {
  return _compilationToken.run(token, fn);
}

/**
 * Remove the current compilation's token from `text`, leaving each placeholder
 * in its stable public spelling (`__scrml_match_<token>__` → `__scrml_match__`).
 */
export function scrubPlaceholderToken(text: string, token: string = currentPlaceholderToken()): string {
  if (typeof text !== "string" || text.indexOf(token) === -1) return text;
  return text.split(`_${token}`).join("").split(token).join("");
}

/** `__scrml_<base>_<token>__` — a fixed placeholder name. */
export function placeholderName(base: string): string {
  return `__scrml_${base}_${currentPlaceholderToken()}__`;
}

/** `__scrml_<base>_<token>_` — the prefix of a parameterised placeholder `<prefix><Name>__`. */
export function placeholderPrefix(base: string): string {
  return `__scrml_${base}_${currentPlaceholderToken()}_`;
}

/** If `name` is `<prefix><X>__` for this base (current token), return X; otherwise null. */
export function placeholderParam(name: unknown, base: string): string | null {
  if (typeof name !== "string") return null;
  const p = placeholderPrefix(base);
  if (!name.startsWith(p) || !name.endsWith("__") || name.length <= p.length + 2) return null;
  return name.slice(p.length, -2);
}

/** Is `name` a placeholder of the CURRENT compilation (carries its token)? */
export function isCompilerPlaceholderName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const bare = name.startsWith("@") ? name.slice(1) : name;
  return bare.startsWith("__scrml_") && bare.includes(`_${currentPlaceholderToken()}`);
}

// The fixed placeholders (accessors: the name depends on the compilation).
export const PH_IS_SOME = (): string => placeholderName("is_some");
export const PH_IS_NOT = (): string => placeholderName("is_not");
export const PH_IS_NOT_NOT = (): string => placeholderName("is_not_not");
export const PH_IS_VARIANT = (): string => placeholderName("is_variant");
export const PH_MATCH = (): string => placeholderName("match");
export const PH_MAP_LIT = (): string => placeholderName("map_lit");
export const PH_TILDE = (): string => placeholderName("tilde");
export const PH_SQL_PLACEHOLDER = (): string => placeholderName("sql_placeholder");
export const PH_SQL_REF = (): string => placeholderName("sql_ref");
export const PH_GUARD = (): string => placeholderName("guard");

// The parameterised placeholders (`<prefix><Name>__`).
export const PHP_BARE_VARIANT = (): string => placeholderPrefix("bare_variant");
export const PHP_RENDER = (): string => placeholderPrefix("render");
export const PHP_INPUT = (): string => placeholderPrefix("input");
export const PHP_WORKER = (): string => placeholderPrefix("worker");
export const PHP_MV = (): string => placeholderPrefix("mv");
