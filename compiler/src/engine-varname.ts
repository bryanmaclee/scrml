/**
 * SPEC §51.0.C — the ONE canonical engine auto-derived variable-name rule.
 *
 * An `<engine for=Type ...>` (and the legacy `<machine name=Name ...>`) auto-declares a
 * reactive cell whose name is derived from the type/machine name. This module is the SINGLE
 * source of truth for that derivation. Every site that needs it imports `autoDeriveEngineVarName`
 * from here:
 *   - symbol-table.ts SYM registration (the cell name the lookup table is keyed on),
 *   - type-system.ts §51.9 projected-var synthesis (`engineNameToProjectedVar` delegates),
 *   - codegen/emit-machines.ts derived-decl emission fallback.
 *
 * Prior revisions implemented this FOUR divergent ways that disagreed on acronym-leading and
 * multi-word names (`URL` → `uRL`/`URL`/`url`/`url`; `MarioState` registered verbatim on the
 * legacy path). That divergence produced a SYM register/read mismatch which silently blocked
 * the §6.1.2 read-side `E-STATE-UNDECLARED` fire. Collapsing to one rule closes it.
 *
 * **Acronym-run rule (SPEC §51.0.C).** Lowercase the leading run of uppercase letters. If that
 * run is immediately followed by a lowercase letter, the run's *final* uppercase letter begins
 * the next CamelCase word and stays uppercase; all earlier letters of the run lowercase. An
 * all-uppercase name lowercases entirely. A name that already begins with a lowercase letter
 * (or a non-letter) is returned unchanged.
 *
 * Behaviour:
 *   - single leading capital            → lowercase it:  `MarioState`→`marioState`,
 *                                          `Health`→`health`, `LoadPhase`→`loadPhase`,
 *                                          `MarioMachine`→`marioMachine`
 *   - whole name all-caps               → lowercase all: `URL`→`url`, `ID`→`id`
 *   - acronym RUN before a CamelCase word → lowercase the run except the letter that begins the
 *                                          next word: `UIState`→`uiState`, `HTTPClient`→`httpClient`
 *   - already-lowercase-leading / non-letter-leading → identity: `myType`→`myType`,
 *                                          `_Internal`→`_Internal`
 *
 * The implementation is a single idempotent regex substitution — the reference form cited in
 * SPEC §51.0.C.
 */
const ENGINE_VARNAME_RE = /^[A-Z]+(?=[A-Z][a-z])|^[A-Z]+$|^[A-Z]/;

export function autoDeriveEngineVarName(typeName: string): string {
  if (typeof typeName !== "string" || typeName.length === 0) return "";
  return typeName.replace(ENGINE_VARNAME_RE, (m) => m.toLowerCase());
}
