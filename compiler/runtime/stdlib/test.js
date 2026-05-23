// scrml:test — runtime shim
//
// Hand-written ES module mirroring stdlib/test/index.scrml. Assertion
// helpers for inline ~{} test blocks. Pure functions — no host dependencies.
//
// Each assertion throws a JS Error with a `[scrml:test]` prefix when the
// expectation is violated; the test runner (or ~{} compile-time evaluator)
// surfaces the message.
//
// Surface (must match stdlib/test/index.scrml exports):
//   - assertEqual(actual, expected, message?)
//   - assertNotEqual(actual, expected, message?)
//   - assertTruthy(value, message?)
//   - assertFalsy(value, message?)
//   - assertNull(value, message?)        — scrml `not` is host-null
//   - assertDefined(value, message?)
//   - assertThrows(fn, expectedMessageSubstring?)
//   - assertNoThrow(fn, message?)
//   - assertInRange(value, min, max, message?)
//   - assertContains(container, item, message?)
//   - group(label, fn)

export function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    const msg = message
      ? `${message}: expected ${e}, got ${a}`
      : `Expected ${e}, got ${a}`;
    throw new Error(`[scrml:test] assertEqual failed — ${msg}`);
  }
}

export function assertNotEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    const msg = message
      ? `${message}: expected values to differ, both are ${a}`
      : `Expected values to differ, both are ${a}`;
    throw new Error(`[scrml:test] assertNotEqual failed — ${msg}`);
  }
}

export function assertTruthy(value, message) {
  if (!value) {
    const msg = message || `Expected truthy value, got ${JSON.stringify(value)}`;
    throw new Error(`[scrml:test] assertTruthy failed — ${msg}`);
  }
}

export function assertFalsy(value, message) {
  if (value) {
    const msg = message || `Expected falsy value, got ${JSON.stringify(value)}`;
    throw new Error(`[scrml:test] assertFalsy failed — ${msg}`);
  }
}

export function assertNull(value, message) {
  // scrml "is some" = present (host: not null/undefined); "is not" = absent.
  // assertNull means "is not" — i.e. absent.
  if (value !== null && value !== undefined) {
    const msg = message || `Expected absent value, got ${JSON.stringify(value)}`;
    throw new Error(`[scrml:test] assertNull failed — ${msg}`);
  }
}

export function assertDefined(value, message) {
  if (value === null || value === undefined) {
    const msg = message || `Expected a defined value, got ${JSON.stringify(value)}`;
    throw new Error(`[scrml:test] assertDefined failed — ${msg}`);
  }
}

export function assertThrows(fn, expectedMessageSubstring) {
  let threw = false;
  let caughtMessage = null;
  try {
    fn();
  } catch (e) {
    threw = true;
    caughtMessage = (e && e.message) ? e.message : String(e);
  }
  if (!threw) {
    throw new Error(
      `[scrml:test] assertThrows failed — expected function to throw, but it did not`,
    );
  }
  if (expectedMessageSubstring && !caughtMessage.includes(expectedMessageSubstring)) {
    throw new Error(
      `[scrml:test] assertThrows failed — expected error message to contain "${expectedMessageSubstring}", got: "${caughtMessage}"`,
    );
  }
}

export function assertNoThrow(fn, message) {
  try {
    fn();
  } catch (e) {
    const msg = message || `Expected no throw, but got: ${(e && e.message) || e}`;
    throw new Error(`[scrml:test] assertNoThrow failed — ${msg}`);
  }
}

export function assertInRange(value, min, max, message) {
  if (typeof value !== "number" || value < min || value > max) {
    const msg = message || `Expected ${value} to be between ${min} and ${max}`;
    throw new Error(`[scrml:test] assertInRange failed — ${msg}`);
  }
}

export function assertContains(container, item, message) {
  const has = Array.isArray(container)
    ? container.some((x) => JSON.stringify(x) === JSON.stringify(item))
    : typeof container === "string" && container.includes(item);
  if (!has) {
    const msg = message
      || `Expected ${JSON.stringify(container)} to contain ${JSON.stringify(item)}`;
    throw new Error(`[scrml:test] assertContains failed — ${msg}`);
  }
}

export function group(label, fn) {
  try {
    fn();
  } catch (e) {
    throw new Error(`[scrml:test] group "${label}" failed — ${e.message}`);
  }
}
