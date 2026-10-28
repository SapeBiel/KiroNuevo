export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

export function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Formatea enteros con punto de millares (es-ES no agrupa los números de 4 cifras). */
export function formatInt(value) {
  const n = Math.round(value);
  const sign = n < 0 ? '-' : '';
  return sign + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatMoney(value) {
  return `${formatInt(value)} €`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDistanceMeters(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters)} m`;
}

export function pad(value, length = 4) {
  return String(value).padStart(length, '0');
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Combina "defaults" con "saved" manteniendo la estructura de defaults. */
export function mergeDefaults(defaults, saved) {
  if (Array.isArray(defaults)) return Array.isArray(saved) ? saved : defaults;
  if (defaults && typeof defaults === 'object') {
    const result = {};
    const source = saved && typeof saved === 'object' ? saved : {};
    for (const key of Object.keys(defaults)) result[key] = mergeDefaults(defaults[key], source[key]);
    for (const key of Object.keys(source)) if (!(key in result)) result[key] = source[key];
    return result;
  }
  return typeof saved === typeof defaults && (typeof saved !== 'number' || Number.isFinite(saved)) ? saved : defaults;
}
