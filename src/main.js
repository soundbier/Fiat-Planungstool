import './style.css';
import qrcode from 'qrcode-generator';
import { ensureAuth, subscribe, subscribeBookings, setBookingsBatch, addItem, updateItem, deleteItem } from './firebase.js';

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
  statsPeriod: 'year',
  entryCar: 'fiat',
  dayDialog: null,
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

/* ---------- Data ---------- */

function startSync() {
  stopSync();
  const onErr = (e) => { console.error(e); state.error = 'Synchronisation fehlgeschlagen: ' + e.message; render(); };
  unsubs.push(subscribeBookings(state.code, (d) => { state.bookings = d; render(); }, onErr));
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

const CARS = [
  { id: 'fiat', name: 'Fiat 500e', short: 'F' },
  { id: 'citroen', name: 'Citroën', short: 'C' }
];
const DRIVERS = { lukas: 'Lukas', marie: 'Marie' };

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

function renderCalendar() {
  const m = state.month;
  const year = m.getFullYear(), month = m.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = isoDate(new Date());
  const weekStart = mondayOf(state.selectedDay);
  const weekEnd = addDays(weekStart, 6);
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="day empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
    const chips = CARS.map((c) => {
      const b = bookingFor(iso, c.id);
      return b ? `<span class="chip ${b.driver}">${c.short} ${esc(DRIVERS[b.driver] || '')}</span>` : '';
    }).join('');
    const inWeek = iso >= weekStart && iso <= weekEnd;
    cells.push(`<button class="day${iso === today ? ' today' : ''}${inWeek ? ' in-week' : ''}" data-action="open-day" data-day="${iso}">
      <span class="day-num">${d}</span>${chips}
    </button>`);
  }
  const title = m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `
    <section class="card cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Vorheriger Monat">‹</button>
        <h2>${title}</h2>
        <button class="icon-btn" data-action="month" data-delta="1" aria-label="Nächster Monat">›</button>
      </div>
      <div class="weekdays">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="grid">${cells.join('')}</div>
      <div class="legend">
        <span><i class="dot lukas"></i>Lukas</span><span><i class="dot marie"></i>Marie</span>
        <span>F = Fiat 500e · C = Citroën</span>
      </div>
    </section>
    <section class="card">
      <h3>Woche ${fmtDate(weekStart)} – ${fmtDate(weekEnd)}</h3>
      <button class="btn block" data-action="copy-week">Woche kopieren → Folgewoche</button>
      <p class="muted small">Tag antippen zum Bearbeiten. Die markierte Woche folgt dem zuletzt geöffneten Tag.</p>
    </section>
    ${state.dayDialog ? renderDayDialog(state.dayDialog) : ''}`;
}

function renderDayDialog(iso) {
  return `
    <div class="overlay" data-action="close-day">
      <form class="dialog" id="day-form" data-day="${iso}">
        <h3>${fmtDate(iso)}</h3>
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
        <button class="btn primary block" type="submit">Speichern</button>
        <button class="btn link block" type="button" data-action="close-day">Abbrechen</button>
      </form>
    </div>`;
}

function updateDayWarning(form) {
  const f = new FormData(form);
  const a = f.get('fiat'), b = f.get('citroen');
  const warn = form.querySelector('#day-warn');
  if (a && a === b) {
    warn.textContent = `⚠️ ${DRIVERS[a]} ist beiden Autos zugewiesen.`;
    warn.hidden = false;
  } else warn.hidden = true;
}

function submitDay(form) {
  const iso = form.dataset.day;
  const f = new FormData(form);
  const me = state.name.toLowerCase();
  const changes = CARS
    .map((c) => ({ date: iso, car: c.id, driver: f.get(c.id) || null }))
    .filter((ch) => (bookingFor(iso, ch.car)?.driver || null) !== ch.driver);
  state.dayDialog = null;
  render();
  if (!changes.length) return;
  setBookingsBatch(state.code, changes, me).then(() => {}, (e) => toast('Fehler: ' + e.message));
  toast('Gespeichert');
}

function copyWeek() {
  const start = mondayOf(state.selectedDay);
  const changes = [];
  for (let i = 0; i < 7; i++) {
    const src = addDays(start, i), dst = addDays(start, i + 7);
    for (const c of CARS) {
      const driver = bookingFor(src, c.id)?.driver || null;
      if ((bookingFor(dst, c.id)?.driver || null) !== driver) changes.push({ date: dst, car: c.id, driver });
    }
  }
  if (!changes.length) return toast('Folgewoche ist bereits identisch');
  if (!confirm(`Belegung von ${fmtDate(start)} – ${fmtDate(addDays(start, 6))} auf die Folgewoche übertragen? Bestehende Einträge dort werden überschrieben.`)) return;
  setBookingsBatch(state.code, changes, state.name.toLowerCase()).catch((e) => toast('Fehler: ' + e.message));
  state.selectedDay = addDays(start, 7);
  toast('Woche kopiert');
  render();
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

function renderEntries() {
  const car = state.entryCar;
  const last = lastOdometer(car);
  const list = sortEntries(state.entries.filter((e) => e.car === 'fiat' || e.car === 'citroen'));
  return `
    <section class="card">
      <h3>Tanken / Laden erfassen</h3>
      <form id="entry-form">
        <div class="seg">
          ${CARS.map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}" ${c.id === car ? 'checked' : ''}><span>${c.id === 'fiat' ? '⚡' : '⛽'} ${c.name}</span></label>`).join('')}
        </div>
        <div class="row">
          <label>Datum<input type="date" name="date" value="${isoDate(new Date())}" required></label>
          <label>Kilometerstand<input name="odometer" inputmode="numeric" pattern="[0-9]*" value="${last >= 0 ? last : ''}" required></label>
        </div>
        <div class="row">
          <label>Menge (<span id="unit">${UNIT[car]}</span>)<input name="amount" inputmode="decimal" required></label>
          <label>Kosten (€)<input name="cost" inputmode="decimal" required></label>
        </div>
        <label class="check" id="full-wrap" ${car === 'citroen' ? '' : 'hidden'}>
          <input type="checkbox" name="full" checked> Vollgetankt
        </label>
        <label>Notiz<input name="note" maxlength="300" placeholder="optional"></label>
        <button class="btn primary block" type="submit">Speichern</button>
      </form>
    </section>
    <section class="card">
      <h3>Einträge</h3>
      ${list.length ? `<ul class="list">${list.map(entryItem).join('')}</ul>` : '<p class="muted">Noch keine Einträge.</p>'}
    </section>`;
}

function entryItem(e) {
  const unit = UNIT[e.car];
  const per = e.amount > 0 ? ` · ${num.format(e.cost / e.amount)} €/${unit}` : '';
  const who = DRIVERS[e.createdBy] || '';
  return `<li class="item">
    <span class="type">${e.car === 'fiat' ? '⚡' : '⛽'}</span>
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
  form.reset();
  toast('Gespeichert');
  render();
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
      <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(bh, m.value > 0 ? 1 : 0)}" rx="4" class="bar-${car}"/>
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
          <h3>${c.id === 'fiat' ? '⚡' : '⛽'} ${c.name}</h3>
          <div class="stat-big">${eur.format(s.totalCost)}<small>Gesamtkosten · ${s.count} Einträge</small></div>
          <ul class="kv">
            <li><span>Gefahrene km</span><span>${num.format(s.km)} km</span></li>
            <li><span>Ø Verbrauch</span><span>${fmt(s.consumption, `${unit}/100 km`)}</span></li>
            <li><span>Ø Kosten</span><span>${s.costPer100 == null ? '–' : `${eur.format(s.costPer100)} /100 km`}</span></li>
            <li><span>Ø Preis</span><span>${s.avgPrice == null ? '–' : `${num.format(s.avgPrice)} €/${unit}`}</span></li>
          </ul>
          ${c.id === 'citroen' ? '<p class="hint">Der Verbrauch ist beim Citroën nur aussagekräftig, wenn jeweils vollgetankt wurde (Volltank-Einträge).</p>' : ''}
          ${s.count === 1 ? '<p class="muted small">Für Verbrauch und km werden mindestens zwei Einträge benötigt.</p>' : ''}
          <h4>Kosten pro Monat</h4>
          ${barChart(s.months, c.id)}
        </section>`;
    }).join('')}`;
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
  // Ungespeicherte Auswahl im Tagesdialog über Re-Renders hinweg erhalten
  const dayForm = document.getElementById('day-form');
  const dayDraft = dayForm && dayForm.dataset.day === state.dayDialog ? Object.fromEntries(new FormData(dayForm)) : null;
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
  if (dayDraft) {
    const form = document.getElementById('day-form');
    for (const [name, value] of Object.entries(dayDraft)) {
      const input = form?.querySelector(`input[name="${name}"][value="${value}"]`);
      if (input) input.checked = true;
    }
    if (form) updateDayWarning(form);
  } else if (state.dayDialog) {
    updateDayWarning(document.getElementById('day-form'));
  }
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
      state.dayDialog = null;
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
    case 'close-day':
      if (ev.target !== el) return; // Klicks im Dialog nicht als Overlay-Klick werten
      state.dayDialog = null;
      break;
    case 'copy-week': copyWeek(); return;
    case 'delete-entry':
      if (!confirm('Eintrag löschen?')) return;
      deleteItem(state.code, 'entries', el.dataset.id).catch((e) => toast('Fehler: ' + e.message));
      return;
    default: return;
  }
  document.activeElement?.blur();
  render();
});

app.addEventListener('change', (ev) => {
  const form = ev.target.form;
  if (form?.id === 'day-form') updateDayWarning(form);
  if (form?.id === 'entry-form' && ev.target.name === 'car') onEntryCarChange(form);
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target;
  document.activeElement?.blur();
  if (form.id === 'day-form') submitDay(form);
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
