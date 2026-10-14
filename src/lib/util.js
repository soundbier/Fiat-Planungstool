// @ts-check
// Reine Hilfsfunktionen ohne DOM- und Firebase-Abhängigkeit.

/** ISO-Datum `YYYY-MM-DD` */
/** @typedef {string} IsoDate */

export const CODE_RE = /^[A-Za-z0-9]{20,64}$/;
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} s */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
/** @param {number | string} n */
export function pad(n) { return String(n).padStart(2, '0'); }
/** @param {Date} d @returns {IsoDate} */
export function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
/** @param {Date} d */
export function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
/** @param {IsoDate} iso */
function parts(iso) { return /** @type {[number, number, number]} */ (iso.split('-').map(Number)); }
/** @param {IsoDate} iso */
export function fmtDate(iso) {
  const [y, m, d] = parts(iso);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}
/** @param {IsoDate} iso */
export function fmtDateLong(iso) {
  const [y, m, d] = parts(iso);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
/** @param {number} ms */
export function fmtTime(ms) {
  return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
/** @param {IsoDate} iso */
export function monthLabel(iso) {
  const [y, m] = parts(iso);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}
export const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Zahl mit Komma oder Punkt; leer → NaN. @param {unknown} v */
export function parseNum(v) {
  if (v === '' || v == null) return NaN;
  return Number(String(v).trim().replace(',', '.'));
}
/** @param {number} n */
export function round2(n) { return Math.round(n * 100) / 100; }

/** Tage von a nach b (negativ, wenn b vor a liegt). @param {IsoDate} a @param {IsoDate} b */
export function daysBetween(a, b) {
  const t = (/** @type {IsoDate} */ iso) => { const [y, m, d] = parts(iso); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}
/** @param {IsoDate} iso @param {number} n */
export function addDays(iso, n) {
  const [y, m, d] = parts(iso);
  return isoDate(new Date(y, m - 1, d + n));
}
/** Monate addieren; der Tag wird auf das Monatsende begrenzt (31.01. + 1 → 28./29.02.). @param {IsoDate} iso @param {number} n */
export function addMonths(iso, n) {
  const [y, m, d] = parts(iso);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  return isoDate(new Date(y, m - 1 + n, Math.min(d, last)));
}
/** @param {IsoDate} iso */
export function mondayOf(iso) {
  const [y, m, d] = parts(iso);
  return addDays(iso, -((new Date(y, m - 1, d).getDay() + 6) % 7));
}
/** ISO-Kalenderwoche @param {IsoDate} iso */
export function weekNumber(iso) {
  const [y, m, d] = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
/** @param {IsoDate} start */
export function shortRange(start) {
  const f = (/** @type {IsoDate} */ iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}.`; };
  return `${f(start)} – ${f(addDays(start, 6))}`;
}

/** Zufallscode ohne verwechselbare Zeichen (Rejection Sampling gegen Modulo-Bias). */
export function generateCode(len = 24) {
  /** @type {string[]} */
  const out = [];
  const max = 256 - (256 % ALPHABET.length);
  while (out.length < len) {
    const buf = new Uint8Array(len * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < max && out.length < len) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join('');
}

/**
 * Code oder Einladungslink (`#h=CODE&i=TOKEN`, alt `?h=CODE`) auslesen.
 * @param {unknown} text
 * @param {string} [origin]
 * @returns {{ code: string, invite: string | null } | null}
 */
export function parseInvite(text, origin = 'https://localhost') {
  const t = String(text || '').trim();
  if (CODE_RE.test(t)) return { code: t, invite: null };
  try {
    const u = new URL(t, origin);
    const p = new URLSearchParams(u.hash.slice(1) || u.search);
    const code = p.get('h');
    const invite = p.get('i');
    if (code && CODE_RE.test(code)) return { code, invite: invite && CODE_RE.test(invite) ? invite : null };
  } catch {}
  return null;
}
