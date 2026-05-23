// scrml:format — runtime shim
//
// Hand-written ES module mirroring stdlib/format/index.scrml. All functions
// are pure (no side effects, no server context required) — safe in both
// server-classified function bodies and client-side reactive code.
//
// Surface (must match stdlib/format/index.scrml exports):
//   - formatCurrency(amount, currency, locale?)
//   - formatNumber(n, decimals?, locale?)
//   - pluralize(count, singular, plural?)
//   - truncate(str, maxLength, suffix?)
//   - slug(str)
//   - capitalize(str)
//   - titleCase(str)
//   - toWords(str)
//   - padLeft(str, length, char?)
//   - padRight(str, length, char?)
//   - formatBytes(bytes, decimals?)
//   - formatPercent(value, decimals?)
//   - compactNumber(n, locale?)
//   - formatList(items, type?, locale?)
//   - formatRange(start, end, currency?, locale?)
//   - formatNumberAdvanced(n, options?, locale?)

export function formatCurrency(amount, currency, locale) {
  return new Intl.NumberFormat(locale || "en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

export function formatNumber(n, decimals, locale) {
  const opts = {};
  if (decimals !== null && decimals !== undefined) {
    opts.minimumFractionDigits = decimals;
    opts.maximumFractionDigits = decimals;
  }
  return new Intl.NumberFormat(locale || "en-US", opts).format(n);
}

export function pluralize(count, singular, plural) {
  const word = count === 1 ? singular : plural || singular + "s";
  return `${count} ${word}`;
}

export function truncate(str, maxLength, suffix) {
  if (!str) return str;
  const sfx = suffix !== null && suffix !== undefined ? suffix : "...";
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - sfx.length) + sfx;
}

export function slug(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function titleCase(str) {
  if (!str) return str;
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function toWords(str) {
  if (!str) return str;
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim();
}

export function padLeft(str, length, char) {
  return String(str).padStart(length, char || " ");
}

export function padRight(str, length, char) {
  return String(str).padEnd(length, char || " ");
}

export function formatBytes(bytes, decimals) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals !== null && decimals !== undefined ? decimals : 1;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  const formatted = dm === 0 ? Math.round(value) : parseFloat(value.toFixed(dm));
  return `${formatted} ${sizes[i]}`;
}

export function formatPercent(value, decimals) {
  const dm = decimals !== null && decimals !== undefined ? decimals : 0;
  return `${(value * 100).toFixed(dm)}%`;
}

export function compactNumber(n, locale) {
  return new Intl.NumberFormat(locale || "en-US", { notation: "compact" }).format(n);
}

export function formatList(items, type, locale) {
  const t = type || "conjunction";
  return new Intl.ListFormat(locale || "en-US", { style: "long", type: t }).format(items);
}

export function formatRange(start, end, currency, locale) {
  const opts = currency ? { style: "currency", currency } : {};
  return new Intl.NumberFormat(locale || "en-US", opts).formatRange(start, end);
}

export function formatNumberAdvanced(n, options, locale) {
  return new Intl.NumberFormat(locale || "en-US", options || {}).format(n);
}
