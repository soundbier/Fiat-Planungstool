import qrcode from 'qrcode-generator';

export const app = document.getElementById('app');

export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function errText(e) {
  if (e?.code === 'permission-denied') return 'Kein Zugriff. Der Haushalt ist gesperrt, die Einladung ist abgelaufen/benutzt oder dieses Gerät wurde entfernt.';
  return e?.message || String(e);
}

export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export function toast(msg, action) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (action ? ' has-action' : '');
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

export const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M4 11h11"/><path d="M15 8h2a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'
};

export function icon(name) {
  return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
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
