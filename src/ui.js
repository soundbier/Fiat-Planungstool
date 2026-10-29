import { carOf, cc, pc, personName } from './state.js';
import { esc } from './lib/util.js';

export const app = document.getElementById('app');

export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function errText(e) {
  if (e?.code === 'permission-denied') return 'Kein Zugriff. Der Haushalt ist gesperrt, die Einladung ist abgelaufen oder benutzt, oder dieses Gerät wurde entfernt.';
  return e?.message || String(e);
}

/** @type {any} */
let qrcode = null;
function qrTag(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
/** QR-Code als SVG; die Bibliothek wird beim ersten Mal nachgeladen und füllt dann die Platzhalter. */
export function qrSvg(text) {
  if (qrcode) return qrTag(text);
  import('qrcode-generator').then((m) => {
    qrcode = m.default;
    document.querySelectorAll('[data-qr]').forEach((el) => { el.innerHTML = qrTag(/** @type {HTMLElement} */ (el).dataset.qr); });
  }, (e) => console.warn('QR-Code', e));
  return `<span data-qr="${esc(text)}" role="img" aria-label="QR-Code wird geladen"></span>`;
}

export function toast(msg, action) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (action ? ' has-action' : '') + (action?.sticky ? ' sticky' : '');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => { el.remove(); action.run(); });
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  if (!action?.sticky) setTimeout(() => el.remove(), action ? 5000 : 2200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Kopiert');
}

/* ---------- Icons ---------- */
// Lucide (https://lucide.dev), ISC-Lizenz. Pfade unverändert aus lucide-static übernommen.
export const ICONS = {
  'calendar-days': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  'circle-plus': '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  'chart-column': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  'cloud-off': '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'share': '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  'smartphone': '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'trending-down': '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'receipt': '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  'fuel': '<line x1="3" x2="15" y1="22" y2="22"/><line x1="4" x2="14" y1="9" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>'
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

/* ---------- Identität: Personen (Kreis mit Initiale) und Autos (Quadrat mit Kürzel) ---------- */

export function initialOf(id) {
  return (personName(id) || '?').trim().charAt(0).toUpperCase();
}

/** @param {string} id @param {'' | 'xs' | 'sm' | 'md' | 'lg'} [size] */
export function avatar(id, size = '') {
  return `<span class="avatar${size ? ` avatar-${size}` : ''}"${pc(id)} aria-hidden="true">${size === 'xs' ? '' : esc(initialOf(id))}</span>`;
}

/** @param {string} id @param {'' | 'sm' | 'lg'} [size] */
export function carBadge(id, size = '') {
  return `<span class="car${size ? ` car-${size}` : ''}"${cc(id)} aria-hidden="true">${esc(carOf(id)?.short || '?')}</span>`;
}

/** Person als Kürzel + Name */
export function person(id) {
  return `<span class="person">${avatar(id, 'sm')}<span>${esc(personName(id))}</span></span>`;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** Wochentag-Kürzel, z. B. „Do“ @param {string} iso */
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}
/** Kurzes Datum, z. B. „Do 29.10.“ @param {string} iso */
export function shortDay(iso) {
  const [, m, d] = iso.split('-');
  return `${weekdayOf(iso)} ${d}.${m}.`;
}
/** Datum ohne Wochentag, z. B. „29.10.2026“ @param {string} iso */
export function dateNum(iso) {
  return iso.split('-').reverse().join('.');
}

/** Liste „Bezeichnung … Wert“; leere Zeilen (false/null) werden übersprungen */
export function kv(rows) {
  return `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

/* ---------- Barrierefreiheit ---------- */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Fokussierbare Elemente in `root` (ohne ausgeblendete). @param {ParentNode} root @returns {HTMLElement[]} */
export function focusables(root) {
  return /** @type {HTMLElement[]} */ ([...root.querySelectorAll(FOCUSABLE)]).filter((el) => !el.closest('[hidden]'));
}

/**
 * Selektor, mit dem sich das Element nach einem Re-Render wiederfinden lässt.
 * @param {Element | null} el
 * @returns {string | null}
 */
export function focusSelector(el) {
  if (!(el instanceof HTMLElement) || !app.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attrs = [...el.attributes].filter((a) => a.name.startsWith('data-'));
  if (attrs.length) return el.tagName.toLowerCase() + attrs.map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  const f = /** @type {HTMLInputElement} */ (el);
  if (f.name && f.form?.id) {
    return `#${CSS.escape(f.form.id)} [name="${CSS.escape(f.name)}"]` + (f.type === 'radio' ? `[value="${CSS.escape(f.value)}"]` : '');
  }
  return null;
}

/** @param {string | null} sel */
export function focusBySelector(sel) {
  const el = sel ? /** @type {HTMLElement | null} */ (app.querySelector(sel)) : null;
  if (el) el.focus({ preventScroll: true });
  return !!el;
}

export function blurActive() {
  /** @type {HTMLElement | null} */ (document.activeElement)?.blur();
}
