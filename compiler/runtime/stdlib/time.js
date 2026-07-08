// scrml:time — runtime shim
//
// Hand-written ES module mirroring stdlib/time/index.scrml. All functions
// are pure / Intl-based — safe in both server and client contexts.
//
// Surface (must match stdlib/time/index.scrml exports):
//   - now()                                  → number (Date.now(), non-deterministic; E-FN-004 in `fn`)
//   - formatDate(timestamp, options?, locale?)
//   - formatTime(timestamp, options?, locale?)
//   - formatDateTime(timestamp, options?, locale?)
//   - formatRelative(timestamp, now?)
//   - formatDuration(ms)
//   - parseDate(str)                          → Date | null
//   - isValidDate(value)                      → boolean
//   - startOf(timestamp, unit)                → Date
//   - addTime(timestamp, amount, unit)        → Date
//   - diffTime(a, b, unit)                    → number
//   - debounce(fn, delay)                     → function with cancel/flush
//   - throttle(fn, limit)                     → function
//   - sleep(ms)                               → Promise
//   - formatInTimezone(timestamp, tz, options?, locale?)
//   - nowInTimezone(tz, options?, locale?)
//   - toTimezoneParts(timestamp, tz)
//   - tzOffset(tz, timestamp?)                → number (minutes)
//   - formatISO(timestamp)                    → string
//   - parseISO(str)                           → Date | null

import { floor } from "./math.js";

// Current wall-clock time (Unix ms). NON-DETERMINISTIC — the sanctioned,
// centralized wall-clock touch (the one place Date.now() is read). The
// compiler rejects calling it from a pure `fn` body (E-FN-004, §48.3.4).
export function now() {
  return Date.now();
}

export function formatDate(timestamp, options, locale) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const defaults = { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(locale || "en-US", options || defaults).format(date);
}

export function formatTime(timestamp, options, locale) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const defaults = { hour: "numeric", minute: "2-digit", hour12: true };
  return new Intl.DateTimeFormat(locale || "en-US", options || defaults).format(date);
}

export function formatDateTime(timestamp, options, locale) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const defaults = {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  };
  return new Intl.DateTimeFormat(locale || "en-US", options || defaults).format(date);
}

export function formatRelative(timestamp, now) {
  const base = now || Date.now();
  const ts = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  const diff = base - ts;
  const seconds = floor(diff / 1000);

  if (seconds < 60) return "just now";
  const minutes = floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  return formatDate(timestamp);
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (minutes < 60) {
    return remainingSecs > 0 ? `${minutes}m ${remainingSecs}s` : `${minutes}m`;
  }
  const hours = floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function isValidDate(value) {
  if (value === null || value === undefined) return false;
  if (value instanceof Date) return !isNaN(value.getTime());
  if (value === "") return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

export function startOf(timestamp, unit) {
  const d = new Date(timestamp instanceof Date ? timestamp.getTime() : timestamp);
  if (unit === "day") {
    d.setHours(0, 0, 0, 0);
  } else if (unit === "month") {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  } else if (unit === "year") {
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
  } else if (unit === "hour") {
    d.setMinutes(0, 0, 0);
  } else if (unit === "week") {
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

export function addTime(timestamp, amount, unit) {
  const d = new Date(timestamp instanceof Date ? timestamp.getTime() : timestamp);
  const u = unit.replace(/s$/, ""); // normalize "days" → "day"
  if (u === "millisecond") d.setMilliseconds(d.getMilliseconds() + amount);
  else if (u === "second") d.setSeconds(d.getSeconds() + amount);
  else if (u === "minute") d.setMinutes(d.getMinutes() + amount);
  else if (u === "hour") d.setHours(d.getHours() + amount);
  else if (u === "day") d.setDate(d.getDate() + amount);
  else if (u === "week") d.setDate(d.getDate() + amount * 7);
  else if (u === "month") d.setMonth(d.getMonth() + amount);
  else if (u === "year") d.setFullYear(d.getFullYear() + amount);
  return d;
}

export function diffTime(a, b, unit) {
  const ta = a instanceof Date ? a.getTime() : a;
  const tb = b instanceof Date ? b.getTime() : b;
  const diffMs = ta - tb;
  const u = unit.replace(/s$/, "");
  if (u === "millisecond") return diffMs;
  if (u === "second") return floor(diffMs / 1000);
  if (u === "minute") return floor(diffMs / 60000);
  if (u === "hour") return floor(diffMs / 3600000);
  if (u === "day") return floor(diffMs / 86400000);
  if (u === "week") return floor(diffMs / 604800000);
  if (u === "month") return floor(diffMs / 2592000000);
  if (u === "year") return floor(diffMs / 31536000000);
  return diffMs;
}

export function debounce(fn, delay) {
  let timer = null;
  function debounced(...args) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delay);
  }
  debounced.cancel = function () {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  debounced.flush = function (...args) {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      fn.apply(this, args);
    }
  };
  return debounced;
}

export function throttle(fn, limit) {
  let inThrottle = false;
  let lastArgs = null;
  let timer = null;
  function throttled(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      timer = setTimeout(() => {
        inThrottle = false;
        timer = null;
        if (lastArgs !== null) {
          fn.apply(this, lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      lastArgs = args;
    }
  }
  throttled.cancel = function () {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    inThrottle = false;
    lastArgs = null;
  };
  throttled.flush = function () {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      inThrottle = false;
      if (lastArgs !== null) {
        fn.apply(this, lastArgs);
        lastArgs = null;
      }
    }
  };
  return throttled;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatInTimezone(timestamp, tz, options, locale) {
  const date = typeof timestamp === "number" ? new Date(timestamp) : timestamp;
  // Intl rejects mixing dateStyle/timeStyle with explicit field-level options.
  const usingStyles =
    options &&
    ((options.dateStyle !== null && options.dateStyle !== undefined) ||
      (options.timeStyle !== null && options.timeStyle !== undefined));
  const defaults = usingStyles
    ? {}
    : { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  const opts = Object.assign(defaults, options || {}, { timeZone: tz });
  return new Intl.DateTimeFormat(locale || "en-US", opts).format(date);
}

export function nowInTimezone(tz, options, locale) {
  return formatInTimezone(Date.now(), tz, options, locale);
}

export function toTimezoneParts(timestamp, tz) {
  const date = typeof timestamp === "number" ? new Date(timestamp) : timestamp;
  const fmt = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false,
    timeZone: tz,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10) % 24, // Intl emits "24" for midnight in some locales
    minute: parseInt(parts.minute, 10),
    second: parts.second ? parseInt(parts.second, 10) : 0,
    weekday: parts.weekday,
  };
}

export function tzOffset(tz, timestamp) {
  const ts =
    timestamp === null || timestamp === undefined
      ? Date.now()
      : typeof timestamp === "number"
      ? timestamp
      : timestamp.getTime();
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
  const parts = fmt.formatToParts(new Date(ts));
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  if (!tzPart) return 0;
  // Format like "GMT+9", "GMT-5", "GMT+5:30", "GMT" (= UTC).
  const m = /GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/.exec(tzPart.value);
  if (!m || !m[1]) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  const hours = parseInt(m[2], 10);
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins);
}

export function formatISO(timestamp) {
  const date = typeof timestamp === "number" ? new Date(timestamp) : timestamp;
  return date.toISOString();
}

export function parseISO(str) {
  if (typeof str !== "string") return null;
  if (!/^\d{4}-\d{2}(-\d{2})?(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(str)) {
    return null;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
