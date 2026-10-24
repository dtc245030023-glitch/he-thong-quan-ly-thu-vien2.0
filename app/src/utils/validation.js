/**
 * Small, dependency-free validation helpers.
 * Inputs are never trusted: every route validates again on the server.
 */

export function cleanText(value, maxLength = 255) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength + 1);
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function parseInteger(value) {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

export function isValidEmail(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function isValidPhone(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 30) return false;
  if (!/^[0-9+().\s-]+$/.test(value)) return false;
  const digitCount = (value.match(/\d/g) || []).length;
  return digitCount >= 8 && digitCount <= 15;
}

export function normalizeIsbn(value) {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '';
}

export function isValidIsbn(value) {
  const normalized = normalizeIsbn(value);
  return /^(\d{9}[\dX]|\d{13})$/.test(normalized);
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function compareIsoDates(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
