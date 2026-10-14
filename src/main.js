import './style.css';
import qrcode from 'qrcode-generator';
import { ensureAuth, subscribe, addItem, updateItem, deleteItem } from './firebase.js';

const PEOPLE = ['Lukas', 'Marie'];
const LS_CODE = 'autoplaner.household';
const LS_NAME = 'autoplaner.name';
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
  statsYear: new Date().getFullYear(),
  editBooking: null,
  editEntry: null,
  setupStep: null,
  newCode: null,
  error: null
};
let unsubs = [];

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

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
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

function overlaps(a, b) {
  const aStart = `${a.date}T${a.startTime}`, aEnd = `${a.endDate}T${a.endTime}`;
  const bStart = `${b.date}T${b.startTime}`, bEnd = `${b.endDate}T${b.endTime}`;
  return aStart < bEnd && bStart < aEnd;
}

/* ---------- Data ---------- */

function startSync() {
  stopSync();
  const onErr = (e) => { console.error(e); state.error = 'Synchronisation fehlgeschlagen: ' + e.message; render(); };
  unsubs.push(subscribe(state.code, 'bookings', (d) => { state.bookings = d; render(); }, onErr));
  unsubs.push(subscribe(state.code, 'entries', (d) => { state.entries = d; render(); }, onErr));
}
function stopSync() {
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
  if (step === 'start') {
    body = `
      <h1>Autoplaner</h1>
      <p class="muted">Plant gemeinsam euer Auto – ohne Account.</p>
      <button class="btn primary block" data-action="create">Neuen Haushalt erstellen</button>
      <button class="btn block" data-action="goto-join">Haushalt beitreten</button>`;
  } else if (step === 'created') {
    const link = shareLink(state.newCode);
    body = `
      <h1>Haushalt erstellt</h1>
      <p class="muted">Teile diesen Code oder QR-Code mit deinem Partner. Wer den Code kennt, hat Zugriff.</p>
      <div class="code-box">${esc(state.newCode)}</div>
      <button class="btn block" data-action="copy" data-text="${esc(state.newCode)}">Code kopieren</button>
      <button class="btn block" data-action="copy" data-text="${esc(link)}">Link kopieren</button>
      <div class="qr">${qrSvg(link)}</div>
      <button class="btn primary block" data-action="confirm-created">Weiter</button>`;
  } else if (step === 'join') {
    body = `
      <h1>Haushalt beitreten</h1>
      <form id="join-form">
        <label>Haushaltscode
          <input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="Code einfügen">
        </label>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
        <button class="btn primary block" type="submit">Beitreten</button>
      </form>
      <button class="btn link block" data-action="back-start">Zurück</button>`;
  } else if (step === 'name') {
    body = `
      <h1>Wer bist du?</h1>
      ${PEOPLE.map((p) => `<button class="btn block person ${p.toLowerCase()}" data-action="set-name" data-name="${p}">${p}</button>`).join('')}`;
  }
  app.innerHTML = `<main class="setup">${body}</main>`;
}

/* ---------- Calendar ---------- */

function bookingsOn(iso) {
  return state.bookings
    .filter((b) => b.date <= iso && (b.endDate || b.date) >= iso)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

function renderCalendar() {
  const m = state.month;
  const year = m.getFullYear(), month = m.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = isoDate(new Date());
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="day empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
    const people = [...new Set(bookingsOn(iso).map((b) => b.person))];
    cells.push(`<button class="day${iso === today ? ' today' : ''}${iso === state.selectedDay ? ' selected' : ''}" data-action="select-day" data-day="${iso}">
      <span>${d}</span>
      <span class="dots">${people.map((p) => `<i class="dot ${p.toLowerCase()}"></i>`).join('')}</span>
    </button>`);
  }
  const list = bookingsOn(state.selectedDay);
  const title = m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `
    <section class="card">
      <div class="cal-head">
        <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Vorheriger Monat">‹</button>
        <h2>${title}</h2>
        <button class="icon-btn" data-action="month" data-delta="1" aria-label="Nächster Monat">›</button>
      </div>
      <div class="weekdays">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="grid">${cells.join('')}</div>
      <div class="legend">${PEOPLE.map((p) => `<span><i class="dot ${p.toLowerCase()}"></i>${p}</span>`).join('')}</div>
    </section>
    <section class="card">
      <h3>${fmtDate(state.selectedDay)}</h3>
      ${list.length ? `<ul class="list">${list.map(bookingItem).join('')}</ul>` : '<p class="muted">Keine Buchungen.</p>'}
    </section>
    ${bookingForm()}`;
}

function bookingItem(b) {
  const range = b.date === b.endDate
    ? `${b.startTime}–${b.endTime}`
    : `${fmtDate(b.date)} ${b.startTime} – ${fmtDate(b.endDate)} ${b.endTime}`;
  return `<li class="item">
    <i class="dot ${b.person.toLowerCase()}"></i>
    <div class="grow"><strong>${esc(b.person)}</strong> <span class="muted">${esc(range)}</span>
      ${b.note ? `<div class="note">${esc(b.note)}</div>` : ''}</div>
    <button class="icon-btn small" data-action="edit-booking" data-id="${b.id}" aria-label="Bearbeiten">✎</button>
    <button class="icon-btn small danger" data-action="delete-booking" data-id="${b.id}" aria-label="Löschen">✕</button>
  </li>`;
}

function bookingForm() {
  const b = state.editBooking || {
    person: state.name, date: state.selectedDay, endDate: state.selectedDay,
    startTime: '08:00', endTime: '18:00', note: ''
  };
  return `
    <section class="card">
      <h3>${state.editBooking ? 'Buchung bearbeiten' : 'Auto buchen'}</h3>
      <form id="booking-form">
        ${personSelect(b.person)}
        <div class="row">
          <label>Von<input type="date" name="date" value="${b.date}" required></label>
          <label>Uhrzeit<input type="time" name="startTime" value="${b.startTime}" required></label>
        </div>
        <div class="row">
          <label>Bis<input type="date" name="endDate" value="${b.endDate}" required></label>
          <label>Uhrzeit<input type="time" name="endTime" value="${b.endTime}" required></label>
        </div>
        <label>Notiz<input name="note" maxlength="300" value="${esc(b.note)}" placeholder="z. B. Einkaufen, Arbeit"></label>
        <button class="btn primary block" type="submit">${state.editBooking ? 'Speichern' : 'Buchen'}</button>
        ${state.editBooking ? '<button class="btn link block" type="button" data-action="cancel-booking">Abbrechen</button>' : ''}
      </form>
    </section>`;
}

function personSelect(selected) {
  return `<div class="seg" role="radiogroup">${PEOPLE.map((p) => `
    <label class="seg-opt ${p.toLowerCase()}"><input type="radio" name="person" value="${p}" ${p === selected ? 'checked' : ''}><span>${p}</span></label>`).join('')}</div>`;
}

async function submitBooking(form) {
  const f = new FormData(form);
  const data = {
    person: f.get('person'),
    date: f.get('date'),
    endDate: f.get('endDate'),
    startTime: f.get('startTime'),
    endTime: f.get('endTime'),
    note: String(f.get('note') || '').trim().slice(0, 300)
  };
  if (!PEOPLE.includes(data.person)) return toast('Bitte Person wählen');
  if (`${data.endDate}T${data.endTime}` <= `${data.date}T${data.startTime}`) return toast('Ende muss nach dem Beginn liegen');
  const editId = state.editBooking?.id;
  const conflict = state.bookings.find((b) => b.id !== editId && b.person !== data.person && overlaps(b, data));
  if (conflict && !confirm(`Überschneidung mit ${conflict.person} (${fmtDate(conflict.date)} ${conflict.startTime}). Trotzdem speichern?`)) return;
  const op = editId ? updateItem(state.code, 'bookings', editId, data) : addItem(state.code, 'bookings', data);
  state.editBooking = null;
  state.selectedDay = data.date;
  render();
  toast('Gespeichert');
  op.catch((e) => toast('Fehler: ' + e.message));
}

/* ---------- Fuel / Charge ---------- */

function renderEntries() {
  const e = state.editEntry || { person: state.name, type: 'fuel', date: isoDate(new Date()), amount: '', cost: '', odometer: null, note: '' };
  const list = [...state.entries].sort((a, b) => b.date.localeCompare(a.date));
  return `
    <section class="card">
      <h3>${state.editEntry ? 'Eintrag bearbeiten' : 'Tanken / Laden erfassen'}</h3>
      <form id="entry-form">
        ${personSelect(e.person)}
        <div class="seg">
          <label class="seg-opt"><input type="radio" name="type" value="fuel" ${e.type === 'fuel' ? 'checked' : ''}><span>⛽ Tanken</span></label>
          <label class="seg-opt"><input type="radio" name="type" value="charge" ${e.type === 'charge' ? 'checked' : ''}><span>⚡ Laden</span></label>
        </div>
        <label>Datum<input type="date" name="date" value="${e.date}" required></label>
        <div class="row">
          <label>Menge (L / kWh)<input name="amount" inputmode="decimal" value="${e.amount === '' ? '' : String(e.amount).replace('.', ',')}" required></label>
          <label>Kosten (€)<input name="cost" inputmode="decimal" value="${e.cost === '' ? '' : String(e.cost).replace('.', ',')}" required></label>
        </div>
        <label>Kilometerstand (optional)<input name="odometer" inputmode="numeric" pattern="[0-9]*" value="${e.odometer ?? ''}"></label>
        <label>Notiz<input name="note" maxlength="300" value="${esc(e.note)}"></label>
        <button class="btn primary block" type="submit">Speichern</button>
        ${state.editEntry ? '<button class="btn link block" type="button" data-action="cancel-entry">Abbrechen</button>' : ''}
      </form>
    </section>
    <section class="card">
      <h3>Verlauf</h3>
      ${list.length ? `<ul class="list">${list.map(entryItem).join('')}</ul>` : '<p class="muted">Noch keine Einträge.</p>'}
    </section>`;
}

function entryItem(e) {
  const unit = e.type === 'fuel' ? 'L' : 'kWh';
  const per = e.amount > 0 ? `${num.format(e.cost / e.amount)} €/${unit}` : '';
  return `<li class="item">
    <span class="type">${e.type === 'fuel' ? '⛽' : '⚡'}</span>
    <div class="grow">
      <strong>${eur.format(e.cost)}</strong> <span class="muted">${num.format(e.amount)} ${unit} · ${per}</span>
      <div class="note"><i class="dot ${e.person.toLowerCase()}"></i>${esc(e.person)} · ${fmtDate(e.date)}${e.odometer != null ? ` · ${num.format(e.odometer)} km` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</div>
    </div>
    <button class="icon-btn small" data-action="edit-entry" data-id="${e.id}" aria-label="Bearbeiten">✎</button>
    <button class="icon-btn small danger" data-action="delete-entry" data-id="${e.id}" aria-label="Löschen">✕</button>
  </li>`;
}

async function submitEntry(form) {
  const f = new FormData(form);
  const amount = parseNum(f.get('amount'));
  const cost = parseNum(f.get('cost'));
  const odoRaw = String(f.get('odometer') || '').trim();
  const odometer = odoRaw === '' ? null : Number(odoRaw);
  if (!(amount > 0 && amount < 10000)) return toast('Ungültige Menge');
  if (!(cost >= 0 && cost < 100000)) return toast('Ungültige Kosten');
  if (odometer !== null && !(Number.isInteger(odometer) && odometer >= 0 && odometer < 10000000)) return toast('Ungültiger Kilometerstand');
  const data = {
    person: f.get('person'),
    type: f.get('type'),
    date: f.get('date'),
    amount: Math.round(amount * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    odometer,
    note: String(f.get('note') || '').trim().slice(0, 300)
  };
  if (!PEOPLE.includes(data.person) || !['fuel', 'charge'].includes(data.type)) return toast('Bitte Auswahl prüfen');
  const editId = state.editEntry?.id;
  const op = editId ? updateItem(state.code, 'entries', editId, data) : addItem(state.code, 'entries', data);
  state.editEntry = null;
  render();
  toast('Gespeichert');
  op.catch((e) => toast('Fehler: ' + e.message));
}

/* ---------- Stats ---------- */

function renderStats() {
  const y = String(state.statsYear);
  const entries = state.entries.filter((e) => e.date.startsWith(y));
  const bookings = state.bookings.filter((b) => b.date.startsWith(y));
  const total = entries.reduce((s, e) => s + e.cost, 0);

  const perPerson = PEOPLE.map((p) => {
    const es = entries.filter((e) => e.person === p);
    const cost = es.reduce((s, e) => s + e.cost, 0);
    const liters = es.filter((e) => e.type === 'fuel').reduce((s, e) => s + e.amount, 0);
    const kwh = es.filter((e) => e.type === 'charge').reduce((s, e) => s + e.amount, 0);
    const days = new Set();
    bookings.filter((b) => b.person === p).forEach((b) => {
      for (let d = new Date(b.date + 'T00:00'); isoDate(d) <= b.endDate; d.setDate(d.getDate() + 1)) days.add(isoDate(d));
    });
    return { p, cost, liters, kwh, count: es.length, bookingDays: days.size, share: total ? cost / total : 0 };
  });

  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${y}-${pad(i + 1)}`;
    const row = { label: new Date(state.statsYear, i, 1).toLocaleDateString('de-DE', { month: 'short' }) };
    PEOPLE.forEach((p) => { row[p] = entries.filter((e) => e.person === p && e.date.startsWith(key)).reduce((s, e) => s + e.cost, 0); });
    return row;
  });
  const maxMonth = Math.max(1, ...months.map((m) => PEOPLE.reduce((s, p) => s + m[p], 0)));

  const half = total / PEOPLE.length;
  const [a, b] = perPerson;
  const diff = a.cost - half;
  const balance = Math.abs(diff) < 0.005
    ? 'Ausgeglichen.'
    : `${diff < 0 ? a.p : b.p} schuldet ${diff < 0 ? b.p : a.p} ${eur.format(Math.abs(diff))} (bei 50/50-Teilung).`;

  const odo = state.entries.filter((e) => e.odometer != null && e.date.startsWith(y)).map((e) => e.odometer);
  const km = odo.length > 1 ? Math.max(...odo) - Math.min(...odo) : 0;

  return `
    <section class="card">
      <div class="cal-head">
        <button class="icon-btn" data-action="year" data-delta="-1" aria-label="Vorheriges Jahr">‹</button>
        <h2>${y}</h2>
        <button class="icon-btn" data-action="year" data-delta="1" aria-label="Nächstes Jahr">›</button>
      </div>
      <div class="stat-big">${eur.format(total)}<small>Gesamtkosten</small></div>
      ${km ? `<p class="muted center">${num.format(km)} km gefahren · ${eur.format(total / km * 100)} / 100 km</p>` : ''}
    </section>
    <div class="stats-grid">
      ${perPerson.map((s) => `
        <section class="card person-card ${s.p.toLowerCase()}">
          <h3>${s.p}</h3>
          <div class="stat">${eur.format(s.cost)}</div>
          <div class="muted">${Math.round(s.share * 100)} % der Kosten</div>
          <ul class="kv">
            <li><span>Getankt</span><span>${num.format(s.liters)} L</span></li>
            <li><span>Geladen</span><span>${num.format(s.kwh)} kWh</span></li>
            <li><span>Einträge</span><span>${s.count}</span></li>
            <li><span>Nutzungstage</span><span>${s.bookingDays}</span></li>
          </ul>
        </section>`).join('')}
    </div>
    <section class="card">
      <h3>Ausgleich</h3>
      <p>${balance}</p>
    </section>
    <section class="card">
      <h3>Kosten pro Monat</h3>
      <div class="bars">
        ${months.map((m) => `
          <div class="bar-col" title="${m.label}: ${eur.format(PEOPLE.reduce((s, p) => s + m[p], 0))}">
            <div class="bar-stack">
              ${PEOPLE.map((p) => `<div class="bar ${p.toLowerCase()}" style="height:${(m[p] / maxMonth) * 100}%"></div>`).join('')}
            </div>
            <span>${m.label}</span>
          </div>`).join('')}
      </div>
      <div class="legend">${PEOPLE.map((p) => `<span><i class="dot ${p.toLowerCase()}"></i>${p}</span>`).join('')}</div>
    </section>`;
}

/* ---------- Settings ---------- */

function renderSettings() {
  const link = shareLink(state.code);
  return `
    <section class="card">
      <h3>Du bist</h3>
      <div class="seg">${PEOPLE.map((p) => `
        <button class="seg-opt btn-seg ${p.toLowerCase()} ${p === state.name ? 'active' : ''}" data-action="set-name" data-name="${p}">${p}</button>`).join('')}</div>
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
  { id: 'calendar', label: 'Kalender', icon: '📅' },
  { id: 'entries', label: 'Tanken/Laden', icon: '⛽' },
  { id: 'stats', label: 'Auswertung', icon: '📊' },
  { id: 'settings', label: 'Einstellungen', icon: '⚙️' }
];

function render() {
  if (state.setupStep) return renderSetup();
  const scroll = window.scrollY;
  const views = { calendar: renderCalendar, entries: renderEntries, stats: renderStats, settings: renderSettings };
  const active = document.activeElement;
  const focusName = active && active.form && active.name && active.type !== 'radio' ? { form: active.form.id, name: active.name, value: active.value } : null;
  if (focusName) return; // Nicht neu rendern, während der Nutzer tippt
  app.innerHTML = `
    <header class="topbar">
      <span>Autoplaner</span>
      <span class="me ${state.name.toLowerCase()}">${esc(state.name)}</span>
    </header>
    ${state.error ? `<div class="banner">${esc(state.error)}</div>` : ''}
    <main class="content">${views[state.tab]()}</main>
    <nav class="tabbar">
      ${TABS.map((t) => `<button class="tab ${t.id === state.tab ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
        <span class="tab-icon">${t.icon}</span><span>${t.label}</span></button>`).join('')}
    </nav>`;
  window.scrollTo(0, scroll);
}

/* ---------- Events ---------- */

app.addEventListener('click', async (ev) => {
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
      state.editBooking = null;
      state.editEntry = null;
      document.activeElement?.blur();
      app.innerHTML = '';
      render();
      window.scrollTo(0, 0);
      return;
    case 'month':
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + Number(el.dataset.delta), 1);
      break;
    case 'year': state.statsYear += Number(el.dataset.delta); break;
    case 'select-day': state.selectedDay = el.dataset.day; state.editBooking = null; break;
    case 'edit-booking':
      state.editBooking = state.bookings.find((b) => b.id === el.dataset.id) || null;
      break;
    case 'cancel-booking': state.editBooking = null; break;
    case 'delete-booking':
      if (!confirm('Buchung löschen?')) return;
      deleteItem(state.code, 'bookings', el.dataset.id).catch((e) => toast('Fehler: ' + e.message));
      return;
    case 'edit-entry':
      state.editEntry = state.entries.find((e) => e.id === el.dataset.id) || null;
      document.activeElement?.blur();
      render();
      window.scrollTo(0, 0);
      return;
    case 'cancel-entry': state.editEntry = null; break;
    case 'delete-entry':
      if (!confirm('Eintrag löschen?')) return;
      deleteItem(state.code, 'entries', el.dataset.id).catch((e) => toast('Fehler: ' + e.message));
      return;
    default: return;
  }
  document.activeElement?.blur();
  render();
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target;
  document.activeElement?.blur();
  if (form.id === 'booking-form') submitBooking(form);
  else if (form.id === 'entry-form') submitEntry(form);
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
