import './style.css';
import qrcode from 'qrcode-generator';
import { ensureAuth, subscribeEntries, subscribeBookings, setBookingsBatch, addItem, deleteItem } from './firebase.js';

const PEOPLE = ['Lukas', 'Marie'];
const DRIVERS = Object.fromEntries(PEOPLE.map((p) => [p.toLowerCase(), p]));
const CARS = [
  { id: 'fiat', name: 'Fiat 500e', short: 'F' },
  { id: 'citroen', name: 'Citroën', short: 'C' }
];
const LS_CODE = 'autoplaner.household';
const LS_NAME = 'autoplaner.name';
const LS_PREFS = 'autoplaner.prefs';
const SWATCHES = ['#2c5d8f', '#a8324a', '#1f7a6d', '#7a4bb0', '#c2581b', '#3b7d2a', '#b0477f', '#4a4a48'];
const DEFAULT_PREFS = { theme: 'system', scheme: 'warm', size: 'normal', startTab: 'calendar', colors: { lukas: '#2c5d8f', marie: '#a8324a' } };
const CODE_RE = /^[A-Za-z0-9]{20,64}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const app = document.getElementById('app');

const state = {
  code: null,
  name: null,
  tab: 'calendar',
  bookings: [],
  entries: [],
  month: firstOfMonth(new Date()),
  selectedDay: isoDate(new Date()),
  statsPeriod: 'year',
  entryCar: 'fiat',
  dayDialog: null,
  copyWeek: null,
  entrySheet: false,
  setupStep: null,
  newCode: null,
  error: null
};
let unsubs = [];

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PREFS)) || {};
    return { ...DEFAULT_PREFS, ...p, colors: { ...DEFAULT_PREFS.colors, ...p.colors } };
  } catch { return { ...DEFAULT_PREFS, colors: { ...DEFAULT_PREFS.colors } }; }
}
const prefs = loadPrefs();
function applyPrefs() {
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  if (prefs.scheme === 'warm') delete root.dataset.scheme; else root.dataset.scheme = prefs.scheme;
  if (prefs.size === 'normal') delete root.dataset.size; else root.dataset.size = prefs.size;
  for (const [k, v] of Object.entries(prefs.colors)) root.style.setProperty(`--${k}`, v);
}
function setPref(key, value) {
  if (key.startsWith('color-')) prefs.colors[key.slice(6)] = value;
  else prefs[key] = value;
  try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch {}
  applyPrefs();
}
applyPrefs();
if (['calendar', 'entries', 'stats'].includes(prefs.startTab)) state.tab = prefs.startTab;

/* ---------- Helpers ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
function parseNum(v) {
  if (v === '' || v == null) return NaN;
  return Number(String(v).replace(',', '.'));
}

function generateCode(len = 24) {
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

function shareLink(code) {
  return `${location.origin}/?h=${encodeURIComponent(code)}`;
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

function toast(msg, action) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (action ? ' has-action' : '');
  el.setAttribute('role', 'status');
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
  setTimeout(() => el.remove(), action ? 5000 : 2200);
}

async function copyText(text) {
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

async function shareHousehold() {
  const url = shareLink(state.code);
  if (navigator.share) {
    try { await navigator.share({ title: 'Autoplaner', text: 'Tritt unserem Autoplaner-Haushalt bei:', url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(url);
}

/* ---------- Data ---------- */

let offlineTimer = null;
function startSync() {
  stopSync();
  const onErr = (e) => { console.error(e); state.error = 'Synchronisation fehlgeschlagen: ' + e.message; render(); };
  const meta = { bookings: null, entries: null };
  const onMeta = (key, m) => {
    meta[key] = m;
    const offline = Object.values(meta).some((x) => x && (x.fromCache || x.hasPendingWrites));
    clearTimeout(offlineTimer);
    if (!offline) { if (state.offline) { state.offline = false; render(); } return; }
    offlineTimer = setTimeout(() => { state.offline = true; render(); }, 5000);
  };
  unsubs.push(subscribeBookings(state.code, (d, m) => { state.bookings = d; onMeta('bookings', m); render(); }, onErr));
  unsubs.push(subscribeEntries(state.code, (d, m) => { state.entries = d; onMeta('entries', m); render(); }, onErr));
}
function stopSync() {
  clearTimeout(offlineTimer);
  state.offline = false;
  unsubs.forEach((u) => u());
  unsubs = [];
  state.bookings = [];
  state.entries = [];
}

function setHousehold(code) {
  state.code = code;
  localStorage.setItem(LS_CODE, code);
  startSync();
}
function leaveHousehold() {
  stopSync();
  localStorage.removeItem(LS_CODE);
  localStorage.removeItem(LS_NAME);
  state.code = null;
  state.name = null;
  state.setupStep = 'start';
  render();
}

/* ---------- Setup screens ---------- */

function renderSetup() {
  const step = state.setupStep;
  let body = '';
  const steps = step === 'name' ? 2 : 1;
  const dots = `<div class="setup-steps" aria-hidden="true"><span class="on"></span><span class="${steps > 1 ? 'on' : ''}"></span></div>`;
  if (step === 'start') {
    body = `
      <div class="setup-hero">
        <img class="setup-logo" src="/icon.svg" alt="" width="88" height="88">
        <h1>Autoplaner</h1>
        <p class="muted">Wer fährt wann welches Auto – und was es kostet.</p>
      </div>
      <div class="setup-card">
        <button class="btn primary block lg" data-action="create">Neuen Haushalt erstellen</button>
        <button class="btn block lg" data-action="goto-join">Bestehendem Haushalt beitreten</button>
      </div>
      <p class="muted small setup-foot">Kein Konto nötig – der Zugang erfolgt über einen geheimen Haushaltscode.</p>`;
  } else if (step === 'created') {
    const link = shareLink(state.newCode);
    body = `
      ${dots}
      <div class="setup-hero compact">
        <h1>Haushalt erstellt</h1>
        <p class="muted">Teile den QR-Code oder Link mit der zweiten Person.</p>
      </div>
      <div class="setup-card">
        <div class="qr">${qrSvg(link)}</div>
        <div class="code-box">${esc(state.newCode)}</div>
        <div class="btn-row">
          <button class="btn" data-action="copy" data-text="${esc(state.newCode)}">Code kopieren</button>
          <button class="btn" data-action="copy" data-text="${esc(link)}">Link kopieren</button>
        </div>
        <p class="muted small">Wer den Code hat, hat Zugriff – nur vertrauenswürdig teilen.</p>
      </div>
      <button class="btn primary block lg" data-action="confirm-created">Weiter</button>`;
  } else if (step === 'join') {
    body = `
      ${dots}
      <div class="setup-hero compact">
        <h1>Haushalt beitreten</h1>
        <p class="muted">Füge den Code ein, den du erhalten hast – oder scanne den QR-Code mit der Kamera.</p>
      </div>
      <form id="join-form" class="setup-card">
        <label>Haushaltscode
          <input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="Code einfügen">
        </label>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
        <button class="btn primary block lg" type="submit">Beitreten</button>
      </form>
      <button class="btn link block" data-action="back-start">Zurück</button>`;
  } else if (step === 'name') {
    body = `
      ${dots}
      <div class="setup-hero compact">
        <h1>Wer bist du?</h1>
        <p class="muted">Lässt sich später in den Einstellungen ändern.</p>
      </div>
      <div class="person-grid">
        ${PEOPLE.map((p) => `<button class="person-tile ${p.toLowerCase()}" data-action="set-name" data-name="${p}">
          <span class="avatar">${esc(p[0])}</span><span>${esc(p)}</span></button>`).join('')}
      </div>`;
  }
  app.innerHTML = `<main class="setup">${body}</main>`;
}

/* ---------- Calendar ---------- */

function bookingFor(iso, car) {
  return state.bookings.find((b) => b.date === iso && b.car === car) || null;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return addDays(iso, -((dt.getDay() + 6) % 7));
}

function weekNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
}

function shortRange(start) {
  const end = addDays(start, 6);
  const f = (iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}.`; };
  return `${f(start)} – ${f(end)}`;
}

function driverChip(iso, car) {
  const b = bookingFor(iso, car);
  return b
    ? `<span class="pill ${b.driver}">${esc(DRIVERS[b.driver] || '')}</span>`
    : '<span class="pill free">frei</span>';
}

function renderOverview() {
  const today = isoDate(new Date());
  const days = [[today, 'Heute'], [addDays(today, 1), 'Morgen']];
  return `
    <section class="overview">
      ${days.map(([iso, label]) => `
        <button class="card ov-day" data-action="open-day" data-day="${iso}">
          <span class="ov-label">${label}</span>
          ${CARS.map((c) => `<span class="ov-row"><span class="ov-car">${c.name}</span>${driverChip(iso, c.id)}</span>`).join('')}
        </button>`).join('')}
    </section>`;
}

function renderCalendar() {
  const m = state.month;
  const year = m.getFullYear(), month = m.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = isoDate(new Date());
  const weekStart = state.copyWeek || mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="day empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
    const chips = CARS.map((c) => {
      const b = bookingFor(iso, c.id);
      return b ? `<span class="chip ${b.driver}">${c.short} ${esc(DRIVERS[b.driver] || '')}</span>` : '';
    }).join('');
    const inWeek = iso >= weekStart && iso <= weekEnd;
    cells.push(`<button class="day${iso === today ? ' today' : ''}${iso < today ? ' past' : ''}${inWeek ? ' in-week' : ''}" data-action="open-day" data-day="${iso}">
      <span class="day-num">${d}</span>${chips}
    </button>`);
  }
  const title = m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `
    ${renderOverview()}
    <section class="card cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Vorheriger Monat">‹</button>
        <h2>${title}</h2>
        ${isCurrentMonth ? '' : '<button class="btn-text" data-action="month-today">Heute</button>'}
        <button class="icon-btn" data-action="month" data-delta="1" aria-label="Nächster Monat">›</button>
      </div>
      <div class="weekdays">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="grid">${cells.join('')}</div>
      <div class="legend">
        ${PEOPLE.map((p) => `<span><i class="dot ${p.toLowerCase()}"></i>${p}</span>`).join('')}
        <span>F Fiat · C Citroën</span>
      </div>
    </section>
    <section class="card">
      <h3>Woche übertragen</h3>
      <div class="week-pick">
        <button class="icon-btn" data-action="week" data-delta="-7" aria-label="Vorherige Woche">‹</button>
        <div class="week-label"><strong>KW ${weekNumber(weekStart)}</strong><span class="muted">${shortRange(weekStart)}</span></div>
        <button class="icon-btn" data-action="week" data-delta="7" aria-label="Nächste Woche">›</button>
      </div>
      <button class="btn block" data-action="copy-week">Nach KW ${weekNumber(addDays(weekStart, 7))} kopieren</button>
    </section>
    ${state.dayDialog ? renderDayDialog(state.dayDialog) : ''}`;
}

function renderDayDialog(iso) {
  return `
    <div class="overlay" data-action="close-day">
      <form class="dialog" id="day-form" data-day="${iso}">
        <div class="sheet-head">
          <button class="icon-btn" type="button" data-action="day-step" data-delta="-1" aria-label="Vorheriger Tag">‹</button>
          <h3>${fmtDate(iso)}</h3>
          <button class="icon-btn" type="button" data-action="day-step" data-delta="1" aria-label="Nächster Tag">›</button>
        </div>
        ${CARS.map((c) => {
          const cur = bookingFor(iso, c.id)?.driver || '';
          return `<fieldset>
            <legend>${c.name}</legend>
            <div class="seg">
              ${[['lukas', 'Lukas'], ['marie', 'Marie'], ['', 'frei']].map(([v, l]) => `
                <label class="seg-opt ${v}"><input type="radio" name="${c.id}" value="${v}" ${cur === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
            </div>
          </fieldset>`;
        }).join('')}
        <p class="warn" id="day-warn" hidden></p>
        <p class="muted small center">Änderungen werden sofort gespeichert.</p>
        <button class="btn primary block" type="button" data-action="close-day">Fertig</button>
      </form>
    </div>`;
}

function updateDayWarning(form) {
  const f = new FormData(form);
  const a = f.get('fiat'), b = f.get('citroen');
  const warn = form.querySelector('#day-warn');
  if (a && a === b) {
    warn.textContent = `${DRIVERS[a]} ist für beide Autos eingetragen.`;
    warn.hidden = false;
  } else warn.hidden = true;
}

function saveDayCar(form, car) {
  const iso = form.dataset.day;
  const driver = new FormData(form).get(car) || null;
  if ((bookingFor(iso, car)?.driver || null) === driver) return;
  setBookingsBatch(state.code, [{ date: iso, car, driver }], state.name.toLowerCase())
    .catch((e) => toast('Fehler: ' + e.message));
}

function copyWeek() {
  const start = state.copyWeek || mondayOf(isoDate(new Date()));
  const changes = [];
  for (let i = 0; i < 7; i++) {
    const src = addDays(start, i), dst = addDays(start, i + 7);
    for (const c of CARS) {
      const driver = bookingFor(src, c.id)?.driver || null;
      if ((bookingFor(dst, c.id)?.driver || null) !== driver) changes.push({ date: dst, car: c.id, driver });
    }
  }
  if (!changes.length) return toast('Folgewoche ist bereits identisch');
  const undo = changes.map((ch) => ({ ...ch, driver: bookingFor(ch.date, ch.car)?.driver || null }));
  const me = state.name.toLowerCase();
  setBookingsBatch(state.code, changes, me).catch((e) => toast('Fehler: ' + e.message));
  state.copyWeek = addDays(start, 7);
  render();
  toast(`Nach KW ${weekNumber(state.copyWeek)} kopiert`, {
    label: 'Rückgängig',
    run: () => setBookingsBatch(state.code, undo, me).catch((e) => toast('Fehler: ' + e.message))
  });
}

function resetWeek() {
  const start = mondayOf(isoDate(new Date()));
  const undo = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    for (const c of CARS) {
      const driver = bookingFor(date, c.id)?.driver;
      if (driver) undo.push({ date, car: c.id, driver });
    }
  }
  if (!undo.length) return toast('Aktuelle Woche ist bereits leer');
  if (!confirm(`Alle Einträge der KW ${weekNumber(start)} (${shortRange(start)}) löschen?`)) return;
  const me = state.name.toLowerCase();
  setBookingsBatch(state.code, undo.map((u) => ({ ...u, driver: null })), me).catch((e) => toast('Fehler: ' + e.message));
  toast(`KW ${weekNumber(start)} zurückgesetzt`, {
    label: 'Rückgängig',
    run: () => setBookingsBatch(state.code, undo, me).catch((e) => toast('Fehler: ' + e.message))
  });
}

function exportCsv() {
  const rows = [['Datum', 'Auto', 'Kilometerstand', 'Menge', 'Einheit', 'Kosten EUR', 'Vollgetankt', 'Erfasst von', 'Notiz']];
  for (const e of sortEntries(state.entries)) {
    rows.push([e.date, carName(e.car), e.odometer, String(e.amount).replace('.', ','), UNIT[e.car] || '',
      String(e.cost).replace('.', ','), e.car === 'citroen' ? (e.full ? 'ja' : 'nein') : '', DRIVERS[e.createdBy] || '', e.note || '']);
  }
  if (rows.length === 1) return toast('Keine Einträge zum Exportieren');
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `autoplaner-${isoDate(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Fuel / Charge ---------- */

const UNIT = { fiat: 'kWh', citroen: 'L' };

function carName(id) { return CARS.find((c) => c.id === id)?.name || id; }

function lastOdometer(car) {
  return state.entries
    .filter((e) => e.car === car && Number.isFinite(e.odometer))
    .reduce((max, e) => Math.max(max, e.odometer), -1);
}

function sortEntries(list) {
  return [...list].sort((a, b) =>
    b.date.localeCompare(a.date) || (b.odometer - a.odometer) ||
    ((b.createdAt?.toMillis?.() ?? Infinity) - (a.createdAt?.toMillis?.() ?? Infinity)));
}

function monthLabel(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function renderEntries() {
  const list = sortEntries(state.entries.filter((e) => e.car === 'fiat' || e.car === 'citroen'));
  const groups = [];
  for (const e of list) {
    const key = e.date.slice(0, 7);
    if (groups[groups.length - 1]?.key !== key) groups.push({ key, items: [], total: 0 });
    const g = groups[groups.length - 1];
    g.items.push(e);
    g.total += e.cost;
  }
  return `
    <button class="btn primary block add-btn" data-action="open-entry">${icon('plus')}<span>Tanken / Laden erfassen</span></button>
    ${groups.length ? groups.map((g) => `
      <section class="card">
        <div class="group-head"><h3>${monthLabel(g.key + '-01')}</h3><span class="muted">${eur.format(g.total)}</span></div>
        <ul class="list">${g.items.map(entryItem).join('')}</ul>
      </section>`).join('') : `
      <section class="card empty-state">
        <p><strong>Noch keine Einträge</strong></p>
        <p class="muted">Nach dem Tanken oder Laden einfach Kilometerstand, Menge und Preis erfassen – die Auswertung rechnet den Rest.</p>
      </section>`}
    ${state.entrySheet ? renderEntrySheet() : ''}`;
}

function renderEntrySheet() {
  const car = state.entryCar;
  const last = lastOdometer(car);
  return `
    <div class="overlay" data-action="close-entry">
      <form class="dialog" id="entry-form">
        <div class="sheet-head">
          <h3>Neuer Eintrag</h3>
          <button class="icon-btn" type="button" data-action="close-entry" aria-label="Schließen">✕</button>
        </div>
        <div class="seg">
          ${CARS.map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}" ${c.id === car ? 'checked' : ''}><span>${c.name}</span></label>`).join('')}
        </div>
        <div class="row">
          <label><span>Datum</span><input type="date" name="date" value="${isoDate(new Date())}" required></label>
          <label><span>Kilometerstand</span><input name="odometer" inputmode="numeric" pattern="[0-9]*" value="${last >= 0 ? last : ''}" required></label>
        </div>
        <div class="row">
          <label><span>Menge in <b id="unit">${UNIT[car]}</b></span><input name="amount" inputmode="decimal" placeholder="0,0" required></label>
          <label><span>Kosten in €</span><input name="cost" inputmode="decimal" placeholder="0,00" required></label>
        </div>
        <p class="preview muted small" id="entry-preview">&nbsp;</p>
        <label class="check" id="full-wrap" ${car === 'citroen' ? '' : 'hidden'}>
          <input type="checkbox" name="full" checked> Vollgetankt
        </label>
        <label><span>Notiz</span><input name="note" maxlength="300" placeholder="optional"></label>
        <button class="btn primary block" type="submit">Speichern</button>
      </form>
    </div>`;
}

function updateEntryPreview(form) {
  const f = new FormData(form);
  const car = f.get('car');
  const amount = parseNum(f.get('amount'));
  const cost = parseNum(f.get('cost'));
  const odo = Number(f.get('odometer'));
  const last = lastOdometer(car);
  const parts = [];
  if (amount > 0 && cost >= 0) parts.push(`${num.format(cost / amount)} €/${UNIT[car]}`);
  if (last >= 0 && Number.isInteger(odo) && odo > last) parts.push(`+${num.format(odo - last)} km seit letztem Eintrag`);
  if (last >= 0 && Number.isInteger(odo) && odo < last) parts.push(`Kilometerstand unter letztem Wert (${num.format(last)})`);
  form.querySelector('#entry-preview').innerHTML = parts.length ? esc(parts.join(' · ')) : '&nbsp;';
}

function entryItem(e) {
  const unit = UNIT[e.car];
  const per = e.amount > 0 ? ` · ${num.format(e.cost / e.amount)} €/${unit}` : '';
  const who = DRIVERS[e.createdBy] || '';
  return `<li class="item">
    <span class="car-tag ${e.car}">${CARS.find((c) => c.id === e.car)?.short || ''}</span>
    <div class="grow">
      <strong>${eur.format(e.cost)}</strong> <span class="muted">${num.format(e.amount)} ${unit}${per}</span>
      <div class="note">${esc(carName(e.car))} · ${fmtDate(e.date)} · ${num.format(e.odometer)} km${e.car === 'citroen' ? (e.full ? ' · voll' : ' · teilweise') : ''}${who ? ` · <i class="dot ${e.createdBy}"></i>${who}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</div>
    </div>
    <button class="icon-btn small danger" data-action="delete-entry" data-id="${e.id}" aria-label="Löschen">✕</button>
  </li>`;
}

function onEntryCarChange(form) {
  const car = new FormData(form).get('car');
  state.entryCar = car;
  form.querySelector('#unit').textContent = UNIT[car];
  form.querySelector('#full-wrap').hidden = car !== 'citroen';
  const last = lastOdometer(car);
  form.elements.odometer.value = last >= 0 ? last : '';
  updateEntryPreview(form);
}

function submitEntry(form) {
  const f = new FormData(form);
  const car = f.get('car');
  const date = String(f.get('date') || '');
  const amount = parseNum(f.get('amount'));
  const cost = parseNum(f.get('cost'));
  const odometer = Number(String(f.get('odometer') || '').trim());
  if (!UNIT[car]) return toast('Bitte Auto wählen');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Ungültiges Datum');
  if (!(Number.isInteger(odometer) && odometer >= 0 && odometer < 10000000)) return toast('Ungültiger Kilometerstand');
  if (!(amount > 0 && amount < 10000)) return toast('Ungültige Menge');
  if (!(cost >= 0 && cost < 100000)) return toast('Ungültige Kosten');
  const last = lastOdometer(car);
  if (odometer < last && !confirm(`Kilometerstand ${num.format(odometer)} ist kleiner als der letzte (${num.format(last)}). Trotzdem speichern?`)) return;
  const data = {
    car,
    date,
    odometer,
    amount: Math.round(amount * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    full: car === 'citroen' ? f.get('full') === 'on' : false,
    note: String(f.get('note') || '').trim().slice(0, 300),
    createdBy: state.name.toLowerCase()
  };
  addItem(state.code, 'entries', data).catch((e) => toast('Fehler: ' + e.message));
  state.entrySheet = false;
  render();
  toast('Gespeichert');
}

/* ---------- Stats ---------- */

const PERIODS = [
  { id: '30', label: '30 Tage' },
  { id: 'year', label: 'Jahr' },
  { id: 'all', label: 'Alles' }
];

function periodStart() {
  const now = new Date();
  if (state.statsPeriod === '30') return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
  if (state.statsPeriod === 'year') return `${now.getFullYear()}-01-01`;
  return '0000-00-00';
}

function carStats(car, from) {
  const list = state.entries
    .filter((e) => e.car === car && e.date >= from)
    .sort((a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date));
  const totalCost = list.reduce((s, e) => s + e.cost, 0);
  const totalAmount = list.reduce((s, e) => s + e.amount, 0);
  const km = list.length > 1 ? list[list.length - 1].odometer - list[0].odometer : 0;
  const rest = list.slice(1);
  const restAmount = rest.reduce((s, e) => s + e.amount, 0);
  const restCost = rest.reduce((s, e) => s + e.cost, 0);
  return {
    count: list.length,
    km,
    consumption: km > 0 ? restAmount / km * 100 : null,
    costPer100: km > 0 ? restCost / km * 100 : null,
    avgPrice: totalAmount > 0 ? totalCost / totalAmount : null,
    totalCost,
    months: monthlyCosts(list)
  };
}

function monthlyCosts(list) {
  if (!list.length) return [];
  const dates = list.map((e) => e.date).sort();
  let [y, m] = dates[0].split('-').map(Number);
  const [ey, em] = dates[dates.length - 1].split('-').map(Number);
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${pad(m)}`;
    out.push({
      key,
      label: new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }),
      value: list.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.cost, 0)
    });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

function barChart(months, car) {
  if (!months.length) return '<p class="muted">Keine Daten.</p>';
  const barW = 28, gap = 10, h = 140, top = 18, bottom = 22;
  const max = Math.max(1, ...months.map((m) => m.value));
  const width = months.length * (barW + gap) + gap;
  const bars = months.map((m, i) => {
    const bh = (m.value / max) * (h - top - bottom);
    const x = gap + i * (barW + gap);
    const y = h - bottom - bh;
    return `<g>
      <title>${esc(m.label)}: ${eur.format(m.value)}</title>
      <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(bh, m.value > 0 ? 1 : 0)}" rx="2" class="bar-${car}"/>
      ${m.value > 0 ? `<text x="${x + barW / 2}" y="${y - 4}" class="bar-val">${Math.round(m.value)}</text>` : ''}
      <text x="${x + barW / 2}" y="${h - 6}" class="bar-lbl">${esc(m.label)}</text>
    </g>`;
  }).join('');
  return `<div class="chart-scroll"><svg class="chart" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Kosten pro Monat">
    <line x1="0" y1="${h - bottom}" x2="${width}" y2="${h - bottom}" class="axis"/>${bars}</svg></div>`;
}

function renderStats() {
  const from = periodStart();
  return `
    <section class="card">
      <div class="seg">
        ${PERIODS.map((p) => `<button class="seg-opt btn-seg ${p.id === state.statsPeriod ? 'active' : ''}" data-action="period" data-period="${p.id}">${p.label}</button>`).join('')}
      </div>
    </section>
    ${CARS.map((c) => {
      const s = carStats(c.id, from);
      const unit = UNIT[c.id];
      const fmt = (v, suffix) => (v == null ? '–' : `${num.format(v)} ${suffix}`);
      return `
        <section class="card car-card ${c.id}">
          <h3>${c.name}</h3>
          <div class="stat-big">${eur.format(s.totalCost)}<small>Gesamtkosten · ${s.count} Einträge</small></div>
          <ul class="kv">
            <li><span>Gefahrene km</span><span>${num.format(s.km)} km</span></li>
            <li><span>Ø Verbrauch</span><span>${fmt(s.consumption, `${unit}/100 km`)}</span></li>
            <li><span>Ø Kosten</span><span>${s.costPer100 == null ? '–' : `${eur.format(s.costPer100)} /100 km`}</span></li>
            <li><span>Ø Preis</span><span>${s.avgPrice == null ? '–' : `${num.format(s.avgPrice)} €/${unit}`}</span></li>
          </ul>
          ${c.id === 'citroen' ? '<p class="hint">Verbrauch stimmt nur, wenn jedes Mal vollgetankt wurde.</p>' : ''}
          ${s.count === 1 ? '<p class="muted small">Verbrauch und km ab zwei Einträgen.</p>' : ''}
          <h4>Kosten pro Monat</h4>
          ${barChart(s.months, c.id)}
        </section>`;
    }).join('')}`;
}

/* ---------- Settings ---------- */

function segPref(key, options, cur) {
  return `<div class="seg">${options.map(([v, l]) => `
    <button class="seg-opt btn-seg ${v === cur ? 'active' : ''}" data-action="pref" data-key="${key}" data-value="${v}">${l}</button>`).join('')}</div>`;
}

function renderSettings() {
  const link = shareLink(state.code);
  const week = mondayOf(isoDate(new Date()));
  return `
    <section class="card">
      <h3>Du bist</h3>
      <div class="seg">${PEOPLE.map((p) => `
        <button class="seg-opt btn-seg ${p.toLowerCase()} ${p === state.name ? 'active' : ''}" data-action="set-name" data-name="${p}">${p}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h3>Darstellung</h3>
      <p class="set-label">Modus</p>
      ${segPref('theme', [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']], prefs.theme)}
      <p class="set-label">Farbschema</p>
      ${segPref('scheme', [['warm', 'Warm'], ['cool', 'Kühl'], ['green', 'Grün'], ['contrast', 'Kontrast']], prefs.scheme)}
      ${PEOPLE.map((p) => { const k = p.toLowerCase(); return `
      <p class="set-label">Farbe ${p}</p>
      <div class="swatches">${SWATCHES.map((c) => `
        <button class="swatch ${prefs.colors[k] === c ? 'active' : ''}" style="background:${c}" data-action="pref" data-key="color-${k}" data-value="${c}" aria-label="Farbe ${c}"></button>`).join('')}</div>`; }).join('')}
      <p class="set-label">Schriftgröße</p>
      ${segPref('size', [['normal', 'Normal'], ['large', 'Groß']], prefs.size)}
      <p class="set-label">Start-Ansicht</p>
      ${segPref('startTab', TABS.slice(0, 3).map((t) => [t.id, t.short]), prefs.startTab)}
      <button class="btn link block" data-action="reset-prefs">Darstellung zurücksetzen</button>
    </section>
    <section class="card">
      <h3>Kalender</h3>
      <button class="btn danger block" data-action="reset-week">Aktuelle Woche zurücksetzen</button>
      <p class="muted small">Löscht alle Einteilungen der KW ${weekNumber(week)} (${shortRange(week)}) für beide Autos.</p>
    </section>
    <section class="card">
      <h3>Daten</h3>
      <button class="btn block" data-action="export-csv">Tank-/Ladeeinträge als CSV exportieren</button>
      <p class="muted small">${state.entries.length} Einträge · ${state.bookings.length} Kalender-Einteilungen</p>
    </section>
    <section class="card">
      <h3>Haushalt</h3>
      <div class="code-box">${esc(state.code)}</div>
      <button class="btn block" data-action="copy" data-text="${esc(state.code)}">Code kopieren</button>
      <button class="btn block" data-action="share">Einladungslink teilen</button>
      <div class="qr">${qrSvg(link)}</div>
    </section>
    <section class="card">
      <h3>Anderem Haushalt beitreten</h3>
      <form id="switch-form">
        <label>Haushaltscode<input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
        <button class="btn block" type="submit">Wechseln</button>
      </form>
    </section>
    <section class="card">
      <button class="btn danger block" data-action="leave">Haushalt verlassen</button>
      <p class="muted small">Die Daten bleiben im Haushalt erhalten. Ohne Code ist kein erneuter Zugriff möglich.</p>
    </section>`;
}

/* ---------- Main render ---------- */

const TABS = [
  { id: 'calendar', label: 'Kalender', short: 'Kalender', icon: 'calendar' },
  { id: 'entries', label: 'Tanken & Laden', short: 'Tanken', icon: 'fuel' },
  { id: 'stats', label: 'Auswertung', short: 'Auswertung', icon: 'chart' },
  { id: 'settings', label: 'Einstellungen', short: 'Einstellungen', icon: 'gear' }
];

const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M4 11h11"/><path d="M15 8h2a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'
};
function icon(name) {
  return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function render() {
  if (state.setupStep) return renderSetup();
  const scroll = window.scrollY;
  const views = { calendar: renderCalendar, entries: renderEntries, stats: renderStats, settings: renderSettings };
  const active = document.activeElement;
  const focusName = active && active.form && active.name && active.type !== 'radio' ? { form: active.form.id, name: active.name, value: active.value } : null;
  if (focusName) return; // Nicht neu rendern, während der Nutzer tippt
  // Ungespeicherte Formulareingaben (Eintragsformular) über Re-Renders hinweg erhalten
  const drafts = ['entry-form'].map((id) => {
    const form = document.getElementById(id);
    if (!form) return null;
    return { id, fields: [...form.elements].filter((el) => el.name).map((el) => ({ name: el.name, value: el.value, checked: el.checked, type: el.type })) };
  }).filter(Boolean);
  app.innerHTML = `
    <header class="topbar">
      <span>${esc(TABS.find((t) => t.id === state.tab).label)}</span>
      <span class="me ${state.name.toLowerCase()}">${esc(state.name)}</span>
    </header>
    ${state.error ? `<div class="banner">${esc(state.error)}</div>` : ''}
    ${state.offline && !state.error ? `<div class="banner">Keine Verbindung zum Server – Änderungen sind nur auf diesem Gerät gespeichert.</div>` : ''}
    <main class="content">${views[state.tab]()}</main>
    <nav class="tabbar">
      ${TABS.map((t) => `<button class="tab ${t.id === state.tab ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
        ${icon(t.icon)}<span>${t.short}</span></button>`).join('')}
    </nav>`;
  for (const draft of drafts) {
    const form = document.getElementById(draft.id);
    if (!form) continue;
    for (const f of draft.fields) {
      const els = [...form.elements].filter((el) => el.name === f.name);
      if (f.type === 'radio') { const r = els.find((el) => el.value === f.value); if (r && f.checked) r.checked = true; }
      else if (f.type === 'checkbox') els.forEach((el) => { el.checked = f.checked; });
      else els.forEach((el) => { el.value = f.value; });
    }
  }
  const dayForm = document.getElementById('day-form');
  if (dayForm) updateDayWarning(dayForm);
  const entryForm = document.getElementById('entry-form');
  if (entryForm) {
    const car = new FormData(entryForm).get('car');
    entryForm.querySelector('#unit').textContent = UNIT[car];
    entryForm.querySelector('#full-wrap').hidden = car !== 'citroen';
    updateEntryPreview(entryForm);
  }
  window.scrollTo(0, scroll);
}

/* ---------- Events ---------- */

app.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action } = el.dataset;
  switch (action) {
    case 'create':
      state.newCode = generateCode(24);
      state.setupStep = 'created';
      break;
    case 'confirm-created':
      setHousehold(state.newCode);
      state.newCode = null;
      state.setupStep = 'name';
      break;
    case 'goto-join': state.error = null; state.setupStep = 'join'; break;
    case 'back-start': state.error = null; state.setupStep = 'start'; break;
    case 'set-name':
      state.name = el.dataset.name;
      localStorage.setItem(LS_NAME, state.name);
      state.setupStep = null;
      break;
    case 'copy': copyText(el.dataset.text); return;
    case 'share': shareHousehold(); return;
    case 'leave':
      if (confirm('Haushalt wirklich verlassen? Notiere dir vorher den Code, falls du später zurückkehren willst.')) leaveHousehold();
      return;
    case 'tab':
      state.tab = el.dataset.tab;
      state.dayDialog = null;
      state.entrySheet = false;
      document.activeElement?.blur();
      app.innerHTML = '';
      render();
      window.scrollTo(0, 0);
      return;
    case 'month':
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + Number(el.dataset.delta), 1);
      break;
    case 'period': state.statsPeriod = el.dataset.period; break;
    case 'open-day': state.selectedDay = el.dataset.day; state.dayDialog = el.dataset.day; break;
    case 'day-step':
      state.dayDialog = addDays(state.dayDialog, Number(el.dataset.delta));
      state.selectedDay = state.dayDialog;
      break;
    case 'month-today': state.month = firstOfMonth(new Date()); break;
    case 'week':
      state.copyWeek = addDays(state.copyWeek || mondayOf(isoDate(new Date())), Number(el.dataset.delta));
      break;
    case 'open-entry': state.entrySheet = true; break;
    case 'close-entry':
      if (ev.target !== el && !el.matches('button')) return;
      state.entrySheet = false;
      break;
    case 'close-day':
      if (ev.target !== el && !el.matches('button')) return; // Klicks im Dialog nicht als Overlay-Klick werten
      state.dayDialog = null;
      break;
    case 'copy-week': copyWeek(); return;
    case 'reset-week': resetWeek(); return;
    case 'export-csv': exportCsv(); return;
    case 'pref': setPref(el.dataset.key, el.dataset.value); break;
    case 'reset-prefs':
      Object.assign(prefs, DEFAULT_PREFS, { colors: { ...DEFAULT_PREFS.colors } });
      setPref('theme', prefs.theme);
      toast('Darstellung zurückgesetzt');
      break;
    case 'delete-entry': {
      const entry = state.entries.find((e) => e.id === el.dataset.id);
      if (!entry) return;
      deleteItem(state.code, 'entries', entry.id).catch((e) => toast('Fehler: ' + e.message));
      toast('Eintrag gelöscht', {
        label: 'Rückgängig',
        run: () => {
          const { id, createdAt, ...data } = entry;
          addItem(state.code, 'entries', data).catch((e) => toast('Fehler: ' + e.message));
        }
      });
      return;
    }
    default: return;
  }
  document.activeElement?.blur();
  render();
});

app.addEventListener('change', (ev) => {
  const form = ev.target.form;
  if (form?.id === 'day-form') { updateDayWarning(form); saveDayCar(form, ev.target.name); }
  if (form?.id === 'entry-form' && ev.target.name === 'car') onEntryCarChange(form);
});

app.addEventListener('input', (ev) => {
  const form = ev.target.form;
  if (form?.id === 'entry-form') updateEntryPreview(form);
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target;
  document.activeElement?.blur();
  if (form.id === 'day-form') return;
  if (form.id === 'entry-form') submitEntry(form);
  else if (form.id === 'join-form' || form.id === 'switch-form') {
    const code = String(new FormData(form).get('code') || '').trim();
    if (!CODE_RE.test(code)) {
      if (form.id === 'join-form') { state.error = 'Ungültiger Code (mind. 20 Zeichen, nur Buchstaben und Ziffern).'; render(); }
      else toast('Ungültiger Code');
      return;
    }
    state.error = null;
    setHousehold(code);
    if (form.id === 'join-form') state.setupStep = 'name';
    else { toast('Haushalt gewechselt'); state.tab = 'calendar'; }
    render();
  }
});

// Ausstehende Renderings nachholen, wenn ein Eingabefeld verlassen wird
app.addEventListener('focusout', () => setTimeout(() => {
  if (!app.contains(document.activeElement) || !document.activeElement.form) render();
}, 0));

/* ---------- Boot ---------- */

async function boot() {
  const params = new URLSearchParams(location.search);
  const linkCode = params.get('h');
  if (linkCode) history.replaceState(null, '', location.pathname);

  try {
    await ensureAuth();
  } catch (e) {
    app.innerHTML = `<main class="setup"><h1>Verbindung fehlgeschlagen</h1><p class="error">${esc(e.message)}</p>
      <button class="btn primary block" onclick="location.reload()">Erneut versuchen</button></main>`;
    return;
  }

  const storedCode = localStorage.getItem(LS_CODE);
  const storedName = localStorage.getItem(LS_NAME);

  if (linkCode && CODE_RE.test(linkCode) && linkCode !== storedCode) {
    if (!storedCode || confirm('Diesem Haushalt beitreten? Der aktuelle Haushalt wird verlassen.')) {
      setHousehold(linkCode);
      state.name = PEOPLE.includes(storedName) ? storedName : null;
      state.setupStep = state.name ? null : 'name';
      return render();
    }
  }

  if (storedCode && CODE_RE.test(storedCode)) {
    setHousehold(storedCode);
    if (PEOPLE.includes(storedName)) state.name = storedName;
    else state.setupStep = 'name';
  } else {
    state.setupStep = 'start';
  }
  render();
}

boot();
