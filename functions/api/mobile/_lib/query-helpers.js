import { MobileError } from "./context.js";

export const clean = v => String(v ?? "").trim();
export function mobilePeriod(request, maxDays = 31) {
  const url = new URL(request.url);
  const from = clean(url.searchParams.get("from"));
  const to = clean(url.searchParams.get("to") || from);
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) {
    throw new MobileError("INVALID_PERIOD", "Укажите правильный период.", 400);
  }
  const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
  if (days >= maxDays) {
    throw new MobileError("PERIOD_TOO_LONG", "Выбран слишком длинный период.", 400);
  }
  return { from, to };
}

export function scopeMatches(payload, selectedIds) {
  const actual = payload?.meta?.departmentIds || payload?.departmentIds;
  return Array.isArray(actual)
    && selectedIds.length === actual.length
    && selectedIds.every(id => actual.some(v => String(v).toLowerCase() === String(id).toLowerCase()));
}
export const safeNumber = v => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export function projectionFailure(code, message) {
  throw new MobileError(code, message, 502);
}
