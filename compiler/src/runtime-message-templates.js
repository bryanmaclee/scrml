// §41.12.1 message templates — ONE reader for the compiler and the runtime ('messages' chunk).
// This file is inlined into the client runtime, so its documentation lives in
// runtime-message-templates.d.ts. Change the grammar or the slot table here and nowhere else.

// Slots per ValidationError variant: field + the §55.9 payload names. Null-prototype (keyed by data).
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

// Level-3 shipped English defaults (§55.10).
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

// Parse -> { ok: true, parts } | { ok: false, reason: "malformed" | "unknown-slot", at, slot }.
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

// One slot's text (§41.12.1 rule 4); an absent payload value renders "".
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
    // Custom(tag): `error.tag` is the discriminant, so the payload lives elsewhere.
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

// Render parsed parts for one error ({ tag, ...payload }) and a field display name.
export function _scrml_message_template_render(parts, error, fieldName) {
  let out = "";
  for (const part of parts) {
    out += typeof part === "string" ? part : _scrml_message_slot_text(error, fieldName, part.slot);
  }
  return out;
}
