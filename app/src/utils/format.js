export function formatDate(value) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function initials(name) {
  if (typeof name !== 'string' || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toLocaleUpperCase('vi-VN');
}

export function stockTone(available, total) {
  const availableNumber = Number(available);
  const totalNumber = Number(total);
  if (availableNumber <= 0) return 'is-empty';
  if (availableNumber / Math.max(totalNumber, 1) <= 0.34) return 'is-low';
  return 'is-ok';
}

export function daysBetween(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.round((to - from) / 86_400_000);
}
