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

// The slots each ValidationError variant (§55.9) offers: the field display name plus the variant's
// payload fields, by their §55.9 names. Null-prototype: indexed by an error tag, which is data.
export const _SCRML_MESSAGE_SLOTS = Object.assign(Object.create(null), {
  Required:        ["field"],
  NotSome:         ["field"],
  LengthFailed:    ["field", "predicate"],
  PatternMismatch: ["field", "re"],
  MinFailed:       ["field", "threshold"],
  MaxFailed:       ["field", "threshold"],
  GtFailed:        ["field", "expected"],
  LtFailed:        ["field", "expected"],
  GteFailed:       ["field", "expected"],
  LteFailed:       ["field", "expected"],
  EqFailed:        ["field", "expected"],
  NeqFailed:       ["field", "forbidden"],
  OneOfFailed:     ["field", "set"],
  NotInFailed:     ["field", "set"],
  Custom:          ["field", "tag"],
});

// Level-3 shipped English defaults (§55.10), written in the template grammar above.
export const _SCRML_DEFAULT_MESSAGES = Object.assign(Object.create(null), {
  Required:        "{field} is required.",
  NotSome:         "{field} is required.",
  LengthFailed:    "{field} length must satisfy {predicate}.",
  PatternMismatch: "{field} doesn't match the expected format.",
  MinFailed:       "{field} must be at least {threshold}.",
  MaxFailed:       "{field} must be at most {threshold}.",
  GtFailed:        "{field} must be greater than {expected}.",
  LtFailed:        "{field} must be less than {expected}.",
  GteFailed:       "{field} must be greater than or equal to {expected}.",
  LteFailed:       "{field} must be less than or equal to {expected}.",
  EqFailed:        "{field} must equal {expected}.",
  NeqFailed:       "{field} cannot equal {forbidden}.",
  OneOfFailed:     "{field} must be one of: {set}.",
  NotInFailed:     "{field} cannot be any of: {set}.",
  Custom:          "{field} failed validation ({tag}).",
});

function _scrml_message_slot_name_start(ch) {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function _scrml_message_slot_name_part(ch) {
  return _scrml_message_slot_name_start(ch) || (ch >= "0" && ch <= "9");
}

/**
 * Parse a message template against the slot list of its variant.
 *
 * Returns `{ ok: true, parts }` — `parts` alternates literal text (a string) and slots
 * (`{ slot: name }`) — or `{ ok: false, reason, at, slot }`:
 *   reason "malformed"    — a `{` at offset `at` that is neither `{{` nor `{` name `}`
 *   reason "unknown-slot" — `{slot}` at offset `at` is not one of `slots`
 *
 * @param {string} text   the template
 * @param {string[]} slots the slot names its variant offers (`_SCRML_MESSAGE_SLOTS[tag]`)
 */
export function _scrml_message_template_parse(text, slots) {
  const parts = [];
  let literal = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "{") {
      literal += ch;
      i += 1;
      continue;
    }
    if (text[i + 1] === "{") {
      literal += "{";
      i += 2;
      continue;
    }
    let end = i + 1;
    if (end < text.length && _scrml_message_slot_name_start(text[end])) {
      end += 1;
      while (end < text.length && _scrml_message_slot_name_part(text[end])) end += 1;
    }
    if (end === i + 1 || text[end] !== "}") {
      return { ok: false, reason: "malformed", at: i, slot: "" };
    }
    const name = text.slice(i + 1, end);
    if (slots.indexOf(name) < 0) {
      return { ok: false, reason: "unknown-slot", at: i, slot: name };
    }
    if (literal.length > 0) parts.push(literal);
    literal = "";
    parts.push({ slot: name });
    i = end + 1;
  }
  if (literal.length > 0) parts.push(literal);
  return { ok: true, parts };
}

// The text one slot renders for an error (§41.12.1 rule 4). An absent payload value renders "".
function _scrml_message_slot_text(error, fieldName, slot) {
  let value;
  switch (slot) {
    case "field":     value = fieldName; break;
    case "predicate": value = error.predicate; break;
    case "re":        value = error.re; break;
    case "threshold": value = error.threshold; break;
    case "expected":  value = error.expected; break;
    case "forbidden": value = error.forbidden; break;
    case "set":       value = error.set; break;
    // `Custom(tag)`'s payload cannot live on `error.tag` (that is the variant discriminant).
    case "tag":       value = error.tag_string != null ? error.tag_string : error.customTag; break;
    default:          value = null;
  }
  if (value == null) return "";
  if (slot === "predicate" && typeof value === "object" && typeof value.op === "string") {
    return value.op + " " + value.value;
  }
  if (slot === "set" && Array.isArray(value)) {
    return value.map(function (v) { return String(v); }).join(", ");
  }
  return String(value);
}

/**
 * Render parsed template parts for one error.
 *
 * @param {Array<string|{slot: string}>} parts  from `_scrml_message_template_parse`
 * @param {Object} error                        `{ tag, ...payload }` (§55.9)
 * @param {string} fieldName                    the field display name
 */
export function _scrml_message_template_render(parts, error, fieldName) {
  let out = "";
  for (const part of parts) {
    out += typeof part === "string" ? part : _scrml_message_slot_text(error, fieldName, part.slot);
  }
  return out;
}
