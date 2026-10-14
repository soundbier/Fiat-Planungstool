import './style.css';
import qrcode from 'qrcode-generator';
import {
  auth, ensureAuth, subscribeEntries, subscribeBookings, setBookingsBatch, addItem, deleteItem, updateItem,
  subscribeReminders, subscribeSetup, saveSetup, importData,
  isMember, joinHousehold, createHousehold, setLocked, subscribeConfig, subscribeMembers, removeMember,
  createInvite, revokeInvites, rotateHousehold
} from './firebase.js';

// Standard-Stammdaten, solange im Haushalt kein meta/setup gespeichert ist
const DEFAULT_SETUP = {
  people: [{ id: 'lukas', name: 'Lukas' }, { id: 'marie', name: 'Marie' }],
  cars: [
    { id: 'fiat', name: 'Fiat 500e', short: 'F', kind: 'electric' },
    { id: 'citroen', name: 'Citroën', short: 'C', kind: 'fuel' }
  ]
};
const ID_RE = /^[a-z0-9]{1,20}$/;
const MAX_ITEMS = 10;
const CAR_COLORS = ['#1f7a6d', '#c2581b', '#7a4bb0', '#3b7d2a', '#b0477f', '#2c5d8f', '#8a6d1d', '#4a4a48'];
const TYPES = [
  { id: 'fuel', label: 'Tanken / Laden' },
  { id: 'service', label: 'Werkstatt / Service' },
  { id: 'parking', label: 'Parken' },
  { id: 'toll', label: 'Maut / Vignette' },
  { id: 'insurance', label: 'Versicherung' },
  { id: 'tax', label: 'Kfz-Steuer' },
  { id: 'other', label: 'Sonstiges' }
];
const REMINDER_PRESETS = [
  ['HU / TÜV', 24], ['Inspektion / Service', 12], ['Reifenwechsel', 6], ['Versicherung', 12],
  ['Kfz-Steuer', 12], ['Ölwechsel', 12], ['Bremsflüssigkeit', 24], ['Vignette', 12]
];
const LS_CODE = 'autoplaner.household';
const LS_NAME = 'autoplaner.name';
const LS_PREFS = 'autoplaner.prefs';
const LS_MEMBER = 'autoplaner.member';
const SWATCHES = ['#2c5d8f', '#a8324a', '#1f7a6d', '#7a4bb0', '#c2581b', '#3b7d2a', '#b0477f', '#4a4a48'];
const DEFAULT_PREFS = { theme: 'system', scheme: 'warm', size: 'normal', startTab: 'calendar', colors: {} };
const CODE_RE = /^[A-Za-z0-9]{20,64}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const app = document.getElementById('app');

const state = {
  code: null,
  name: null,
  tab: 'calendar',
  bookings: [],
  entries: [],
  reminders: [],
  setup: structuredClone(DEFAULT_SETUP),
  setupLoaded: false,
  members: [],
  config: { locked: false },
  invite: null,
  showCode: false,
  busy: false,
  month: firstOfMonth(new Date()),
  selectedDay: isoDate(new Date()),
  statsPeriod: 'year',
  entryCar: null,
  entryType: 'fuel',
  reminderSheet: null,
  dayDialog: null,
  copyWeek: null,
  entrySheet: false,
  setupStep: null,
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
  applyColors();
}
// Personen-/Autofarben als CSS-Variablen (--p-<id>, --car-<id>); IDs sind durch ID_RE CSS-sicher.
function applyColors() {
  const st = document.documentElement.style;
  people().forEach((p, i) => st.setProperty(`--p-${p.id}`, prefs.colors[p.id] || SWATCHES[i % SWATCHES.length]));
  cars().forEach((c, i) => st.setProperty(`--car-${c.id}`, CAR_COLORS[i % CAR_COLORS.length]));
}
function setPref(key, value) {
  if (key.startsWith('color-')) prefs.colors[key.slice(6)] = value;
  else prefs[key] = value;
  try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch {}
  applyPrefs();
}
applyPrefs();
if (['calendar', 'entries', 'reminders', 'stats'].includes(prefs.startTab)) state.tab = prefs.startTab;

/* ---------- Helpers ---------- */

function people() { return state.setup.people; }
function cars() { return state.setup.cars; }
function personName(id) { return people().find((p) => p.id === id)?.name || id || ''; }
function carOf(id) { return cars().find((c) => c.id === id) || null; }
function carName(id) { return carOf(id)?.name || id; }
function unit(car) { return carOf(car)?.kind === 'electric' ? 'kWh' : 'L'; }
function isCombustion(car) { return carOf(car)?.kind !== 'electric'; }
function entryType(e) { return e.type || 'fuel'; }
function typeLabel(type, car) {
  if (type === 'fuel') return car ? (isCombustion(car) ? 'Tanken' : 'Laden') : 'Tanken / Laden';
  return TYPES.find((t) => t.id === type)?.label || type;
}
const pc = (id) => (ID_RE.test(id) ? ` style="--pc:var(--p-${id})"` : '');
const cc = (id) => (ID_RE.test(id) ? ` style="--cc:var(--car-${id})"` : '');
function payerOf(e) { return e.paidBy || e.createdBy; }

function slugId(name, taken) {
  const base = String(name).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 16) || 'x';
  let id = base, i = 2;
  while (taken.includes(id)) id = base + i++;
  return id;
}

// Gespeicherte Stammdaten prüfen (Rules validieren die Listen nur grob)
function sanitizeSetup(s) {
  const seen = new Set();
  const ok = (x) => x && ID_RE.test(x.id) && typeof x.name === 'string' && x.name.trim() && !seen.has(x.id) && seen.add(x.id);
  const ps = (Array.isArray(s?.people) ? s.people : []).filter(ok)
    .map((p) => ({ id: p.id, name: p.name.trim().slice(0, 20) }));
  seen.clear();
  const cs = (Array.isArray(s?.cars) ? s.cars : []).filter(ok).map((c) => ({
    id: c.id, name: c.name.trim().slice(0, 30),
    short: String(c.short || c.name.trim()[0]).slice(0, 2), kind: c.kind === 'electric' ? 'electric' : 'fuel'
  }));
  return ps.length && cs.length ? { people: ps.slice(0, MAX_ITEMS), cars: cs.slice(0, MAX_ITEMS) } : structuredClone(DEFAULT_SETUP);
}

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
  return Number(String(v).trim().replace(',', '.'));
}
function round2(n) { return Math.round(n * 100) / 100; }
function daysBetween(a, b) {
  const t = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  return isoDate(new Date(y, m - 1 + n, Math.min(d, last)));
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

// Fragment statt Query: wird nie an den Server geschickt (keine Logs, kein Referrer).
function inviteLink(code, token) {
  return `${location.origin}/#h=${encodeURIComponent(code)}&i=${encodeURIComponent(token)}`;
}

function parseInvite(text) {
  const t = String(text || '').trim();
  if (CODE_RE.test(t)) return { code: t, invite: null };
  try {
    const u = new URL(t, location.origin);
    const p = new URLSearchParams(u.hash.slice(1) || u.search);
    const code = p.get('h');
    const invite = p.get('i');
    if (code && CODE_RE.test(code)) return { code, invite: invite && CODE_RE.test(invite) ? invite : null };
  } catch {}
  return null;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Gerät';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

const INVITE_HOURS = 24;
async function newInvite() {
  const token = generateCode(24);
  await createInvite(state.code, token, INVITE_HOURS);
  state.invite = { link: inviteLink(state.code, token), expires: Date.now() + INVITE_HOURS * 3600 * 1000 };
  return state.invite;
}

function fmtTime(ms) {
  return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function errText(e) {
  if (e?.code === 'permission-denied') return 'Kein Zugriff. Der Haushalt ist gesperrt, die Einladung ist abgelaufen/benutzt oder dieses Gerät wurde entfernt.';
  return e?.message || String(e);
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
  let url;
  try { url = (await newInvite()).link; } catch (e) { toast('Fehler: ' + errText(e)); return; }
  render();
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
  const onErr = (e) => {
    console.error(e);
    if (e.code === 'permission-denied') localStorage.removeItem(LS_MEMBER);
    state.error = 'Synchronisation fehlgeschlagen: ' + errText(e);
    render();
  };
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
  const quiet = (e) => console.warn(e);
  unsubs.push(subscribeReminders(state.code, (d) => { state.reminders = d; render(); }, quiet));
  unsubs.push(subscribeSetup(state.code, (s) => {
    state.setup = sanitizeSetup(s);
    state.setupLoaded = true;
    applyColors();
    render();
  }, quiet));
  unsubs.push(subscribeConfig(state.code, (c) => { state.config = c; render(); }, quiet));
  unsubs.push(subscribeMembers(state.code, (m) => { state.members = m; render(); }, quiet));
}
function stopSync() {
  clearTimeout(offlineTimer);
  state.offline = false;
  unsubs.forEach((u) => u());
  unsubs = [];
  state.bookings = [];
  state.entries = [];
  state.reminders = [];
  state.setup = structuredClone(DEFAULT_SETUP);
  state.setupLoaded = false;
  state.members = [];
  state.config = { locked: false };
  state.invite = null;
  state.showCode = false;
}

function setHousehold(code) {
  stopSync();
  state.error = null;
  state.code = code;
  localStorage.setItem(LS_CODE, code);
  startSync();
}
// Stellt sicher, dass dieses Gerät Mitglied ist (Beitritt ggf. mit Einladung), dann Sync starten.
async function enterHousehold(code, invite) {
  const uid = auth.currentUser.uid;
  if (localStorage.getItem(LS_MEMBER) !== `${code}:${uid}`) {
    let member = false;
    try { member = await isMember(code, uid); }
    catch (e) { if (e.code !== 'unavailable') throw e; member = !invite; }
    if (!member) await joinHousehold(code, uid, deviceLabel(), invite);
    localStorage.setItem(LS_MEMBER, `${code}:${uid}`);
  }
  setHousehold(code);
}

async function createNewHousehold() {
  const code = generateCode(24);
  await createHousehold(code, auth.currentUser.uid, deviceLabel(), true);
  localStorage.setItem(LS_MEMBER, `${code}:${auth.currentUser.uid}`);
  setHousehold(code);
  await newInvite();
}

async function rotateCode() {
  const newCode = generateCode(24);
  await rotateHousehold(state.code, newCode, auth.currentUser.uid, deviceLabel());
  localStorage.setItem(LS_MEMBER, `${newCode}:${auth.currentUser.uid}`);
  setHousehold(newCode);
}

// Asynchrone Aktion mit Sperre gegen Doppelklicks
async function run(fn, okMsg) {
  if (state.busy) return;
  state.busy = true;
  render();
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { console.error(e); toast('Fehler: ' + errText(e)); }
  finally { state.busy = false; render(); }
}

function leaveHousehold() {
  if (state.code && auth.currentUser) removeMember(state.code, auth.currentUser.uid).catch(() => {});
  stopSync();
  localStorage.removeItem(LS_MEMBER);
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
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
      <p class="muted small setup-foot">Kein Konto nötig – der Zugang erfolgt über eine persönliche Einladung.</p>`;
  } else if (step === 'created') {
    body = `
      ${dots}
      <div class="setup-hero compact">
        <h1>Haushalt erstellt</h1>
        <p class="muted">Lass die zweite Person den QR-Code scannen oder schick ihr den Link.</p>
      </div>
      <div class="setup-card">
        ${inviteBox()}
      </div>
      <button class="btn primary block lg" data-action="confirm-created">Weiter</button>`;
  } else if (step === 'join') {
    body = `
      ${dots}
      <div class="setup-hero compact">
        <h1>Haushalt beitreten</h1>
        <p class="muted">Füge den Einladungslink ein, den du erhalten hast – oder scanne den QR-Code mit der Kamera.</p>
      </div>
      <form id="join-form" class="setup-card">
        <label>Einladungslink oder Code
          <input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="Link einfügen">
        </label>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
        <button class="btn primary block lg" type="submit" ${state.busy ? 'disabled' : ''}>Beitreten</button>
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
        ${people().map((p) => `<button class="person-tile pc"${pc(p.id)} data-action="set-name" data-name="${p.id}">
          <span class="avatar">${esc(p.name[0])}</span><span>${esc(p.name)}</span></button>`).join('')}
      </div>`;
  }
  app.innerHTML = `<main class="setup">${body}</main>`;
}

function inviteBox() {
  const inv = state.invite;
  if (!inv) return '';
  return `
    <div class="qr">${qrSvg(inv.link)}</div>
    <div class="btn-row">
      <button class="btn" data-action="copy" data-text="${esc(inv.link)}">Link kopieren</button>
      ${navigator.share ? `<button class="btn" data-action="share-invite">Teilen</button>` : ''}
    </div>
    <p class="muted small">Einmalig nutzbar, gültig bis ${esc(fmtTime(inv.expires))}. Nur persönlich an vertraute Personen weitergeben – nicht in Gruppen posten.</p>`;
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
    ? `<span class="pill pc"${pc(b.driver)}>${esc(personName(b.driver))}</span>`
    : '<span class="pill free">frei</span>';
}

function renderOverview() {
  const today = isoDate(new Date());
  const days = [[today, 'Heute'], [addDays(today, 1), 'Morgen']];
  const due = dueReminders();
  return `
    <section class="overview">
      ${days.map(([iso, label]) => `
        <button class="card ov-day" data-action="open-day" data-day="${iso}">
          <span class="ov-label">${label}</span>
          ${cars().map((c) => `<span class="ov-row"><span class="ov-car">${esc(c.name)}</span>${driverChip(iso, c.id)}</span>`).join('')}
        </button>`).join('')}
    </section>
    ${due.length ? `<section class="card">
      <div class="ov-due" role="link" tabindex="0" data-action="tab" data-tab="reminders">
        <h3>Fristen</h3>
        <ul class="list">${due.slice(0, 3).map((r) => `<li class="item">
          <span class="car-tag cc"${cc(r.car)}>${esc(carOf(r.car)?.short || '?')}</span>
          <span class="grow">${esc(r.title)}</span>${dueLabel(r)}</li>`).join('')}</ul>
      </div>
    </section>` : ''}`;
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
    const chips = cars().map((c) => {
      const b = bookingFor(iso, c.id);
      return b ? `<span class="chip pc"${pc(b.driver)}>${esc(c.short)} ${esc(personName(b.driver))}</span>` : '';
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
        ${people().map((p) => `<span><i class="dot pc"${pc(p.id)}></i>${esc(p.name)}</span>`).join('')}
        <span>${cars().map((c) => `${esc(c.short)} ${esc(c.name)}`).join(' · ')}</span>
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
        ${cars().map((c) => {
          const cur = bookingFor(iso, c.id)?.driver || '';
          const opts = [...people().map((p) => [p.id, p.name]), ['', 'frei']];
          if (cur && !people().some((p) => p.id === cur)) opts.unshift([cur, cur]);
          return `<fieldset>
            <legend>${esc(c.name)}</legend>
            <div class="seg">
              ${opts.map(([v, l]) => `
                <label class="seg-opt${v ? ' pc' : ''}"${v ? pc(v) : ''}><input type="radio" name="${c.id}" value="${v}" ${cur === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
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
  const drivers = cars().map((c) => f.get(c.id)).filter(Boolean);
  const dup = drivers.find((d, i) => drivers.indexOf(d) !== i);
  const warn = form.querySelector('#day-warn');
  if (dup) {
    warn.textContent = `${personName(dup)} ist für mehrere Autos eingetragen.`;
    warn.hidden = false;
  } else warn.hidden = true;
}

function saveDayCar(form, car) {
  const iso = form.dataset.day;
  const driver = new FormData(form).get(car) || null;
  if ((bookingFor(iso, car)?.driver || null) === driver) return;
  setBookingsBatch(state.code, [{ date: iso, car, driver }], state.name)
    .catch((e) => toast('Fehler: ' + e.message));
}

function copyWeek() {
  const start = state.copyWeek || mondayOf(isoDate(new Date()));
  const changes = [];
  for (let i = 0; i < 7; i++) {
    const src = addDays(start, i), dst = addDays(start, i + 7);
    for (const c of cars()) {
      const driver = bookingFor(src, c.id)?.driver || null;
      if ((bookingFor(dst, c.id)?.driver || null) !== driver) changes.push({ date: dst, car: c.id, driver });
    }
  }
  if (!changes.length) return toast('Folgewoche ist bereits identisch');
  const undo = changes.map((ch) => ({ ...ch, driver: bookingFor(ch.date, ch.car)?.driver || null }));
  const me = state.name;
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
    for (const c of cars()) {
      const driver = bookingFor(date, c.id)?.driver;
      if (driver) undo.push({ date, car: c.id, driver });
    }
  }
  if (!undo.length) return toast('Aktuelle Woche ist bereits leer');
  if (!confirm(`Alle Einträge der KW ${weekNumber(start)} (${shortRange(start)}) löschen?`)) return;
  const me = state.name;
  setBookingsBatch(state.code, undo.map((u) => ({ ...u, driver: null })), me).catch((e) => toast('Fehler: ' + e.message));
  toast(`KW ${weekNumber(start)} zurückgesetzt`, {
    label: 'Rückgängig',
    run: () => setBookingsBatch(state.code, undo, me).catch((e) => toast('Fehler: ' + e.message))
  });
}

/* ---------- Export / Import ---------- */

const CSV_HEAD = ['Datum', 'Auto', 'Art', 'Kilometerstand', 'Menge', 'Einheit', 'Kosten EUR', 'Vollgetankt', 'Bezahlt von', 'Erfasst von', 'Notiz'];

function exportCsv() {
  const de = (n) => (n == null ? '' : String(n).replace('.', ','));
  const rows = [CSV_HEAD];
  for (const e of sortEntries(state.entries)) {
    const fuel = entryType(e) === 'fuel';
    rows.push([e.date, carName(e.car), typeLabel(entryType(e)), e.odometer ?? '', fuel ? de(e.amount) : '', fuel ? unit(e.car) : '',
      de(e.cost), fuel && isCombustion(e.car) ? (e.full ? 'ja' : 'nein') : '', personName(payerOf(e)), personName(e.createdBy), e.note || '']);
  }
  if (rows.length === 1) return toast('Keine Einträge zum Exportieren');
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(`autoplaner-${isoDate(new Date())}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

function exportJson() {
  const strip = ({ id, createdAt, ...rest }) => rest;
  const data = {
    app: 'autoplaner',
    version: 2,
    exportedAt: new Date().toISOString(),
    setup: state.setup,
    bookings: state.bookings.map((b) => ({ date: b.date, car: b.car, driver: b.driver })),
    entries: state.entries.map(strip),
    reminders: state.reminders.map(strip)
  };
  download(`autoplaner-backup-${isoDate(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

function findCar(v) {
  const t = String(v || '').trim().toLowerCase();
  return cars().find((c) => c.id === t || c.name.toLowerCase() === t)?.id || null;
}
function findPerson(v) {
  const t = String(v || '').trim().toLowerCase();
  return people().find((p) => p.id === t || p.name.toLowerCase() === t)?.id || null;
}
function findType(v) {
  const t = String(v || '').trim().toLowerCase();
  if (!t || ['tanken', 'laden'].includes(t)) return 'fuel';
  return TYPES.find((x) => x.id === t || x.label.toLowerCase() === t)?.id || null;
}
function csvDate(v) {
  const t = String(v || '').trim();
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : t;
}

function entriesFromCsv(text) {
  const rows = parseCsv(text);
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  const col = (row, name) => { const i = head.indexOf(name.toLowerCase()); return i < 0 ? '' : row[i]; };
  if (!head.includes('datum') || !head.includes('auto')) throw new Error('CSV-Spalten „Datum“ und „Auto“ fehlen.');
  const entries = [];
  let skipped = 0;
  for (const r of rows) {
    const res = validateEntry({
      car: findCar(col(r, 'Auto')),
      type: findType(col(r, 'Art')),
      date: csvDate(col(r, 'Datum')),
      odometer: col(r, 'Kilometerstand'),
      amount: col(r, 'Menge'),
      cost: col(r, 'Kosten EUR') || col(r, 'Kosten'),
      full: /^(ja|1|true|x)$/i.test(String(col(r, 'Vollgetankt')).trim()),
      note: col(r, 'Notiz'),
      createdBy: findPerson(col(r, 'Erfasst von')),
      paidBy: findPerson(col(r, 'Bezahlt von'))
    });
    if (res.data) entries.push(res.data); else skipped++;
  }
  return { entries, bookings: [], reminders: [], skipped };
}

function fromBackup(json) {
  if (json?.app !== 'autoplaner') throw new Error('Keine Autoplaner-Sicherung.');
  // Fehlende Personen/Autos aus der Sicherung übernehmen
  const src = sanitizeSetup(json.setup);
  const setup = structuredClone(state.setup);
  for (const p of src.people) if (!setup.people.some((x) => x.id === p.id)) setup.people.push(p);
  for (const c of src.cars) if (!setup.cars.some((x) => x.id === c.id)) setup.cars.push(c);
  setup.people = setup.people.slice(0, MAX_ITEMS);
  setup.cars = setup.cars.slice(0, MAX_ITEMS);
  const prev = state.setup;
  state.setup = setup; // für die Validierung
  try {
    let skipped = 0;
    const entries = [], bookings = [], reminders = [];
    for (const e of Array.isArray(json.entries) ? json.entries : []) {
      const res = validateEntry(e);
      if (res.data) entries.push(res.data); else skipped++;
    }
    for (const b of Array.isArray(json.bookings) ? json.bookings : []) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(b?.date) && carOf(b.car) && people().some((p) => p.id === b.driver)) {
        bookings.push({ date: b.date, car: b.car, driver: b.driver });
      } else skipped++;
    }
    for (const r of Array.isArray(json.reminders) ? json.reminders : []) {
      const res = validateReminder(r);
      if (res.data) reminders.push(res.data); else skipped++;
    }
    const setupChanged = JSON.stringify(setup) !== JSON.stringify(prev);
    return { entries, bookings, reminders, skipped, setup: setupChanged ? setup : null };
  } finally { state.setup = prev; }
}

const entryKey = (e) => [e.car, entryType(e), e.date, e.odometer ?? '', e.cost, e.amount ?? ''].join('|');
const reminderKey = (r) => [r.car, r.title, r.due].join('|');

async function importFile(file) {
  if (file.size > 5 * 1024 * 1024) return toast('Datei zu groß (max. 5 MB)');
  let data;
  try {
    const text = await file.text();
    data = /\.json$/i.test(file.name) || text.trim().startsWith('{') ? fromBackup(JSON.parse(text)) : entriesFromCsv(text);
  } catch (e) { return toast('Import fehlgeschlagen: ' + (e.message || e)); }
  const haveE = new Set(state.entries.map(entryKey));
  const haveR = new Set(state.reminders.map(reminderKey));
  const entries = data.entries.filter((e) => { const k = entryKey(e); if (haveE.has(k)) return false; haveE.add(k); return true; });
  const reminders = data.reminders.filter((r) => { const k = reminderKey(r); if (haveR.has(k)) return false; haveR.add(k); return true; });
  const bookings = data.bookings.filter((b) => bookingFor(b.date, b.car)?.driver !== b.driver);
  const dupes = data.entries.length - entries.length + data.reminders.length - reminders.length;
  const parts = [`${entries.length} Kosteneinträge`, `${bookings.length} Kalender-Einteilungen`, `${reminders.length} Fristen`];
  if (data.setup) parts.push('neue Personen/Autos');
  if (!entries.length && !bookings.length && !reminders.length && !data.setup) {
    return toast(`Nichts Neues zu importieren${dupes ? ` (${dupes} bereits vorhanden)` : ''}`);
  }
  const extra = [dupes && `${dupes} bereits vorhanden`, data.skipped && `${data.skipped} ungültig`].filter(Boolean).join(', ');
  if (!confirm(`Importieren: ${parts.join(', ')}?${extra ? `\n(Übersprungen: ${extra})` : ''}\nBestehende Kalender-Einteilungen an denselben Tagen werden überschrieben.`)) return;
  run(async () => {
    if (data.setup) { await saveSetup(state.code, data.setup); state.setup = data.setup; applyColors(); }
    await importData(state.code, { entries, bookings, reminders }, state.name);
  }, 'Import abgeschlossen');
}

/* ---------- Kosten ---------- */

function lastOdometer(car) {
  return state.entries
    .filter((e) => e.car === car && Number.isFinite(e.odometer))
    .reduce((max, e) => Math.max(max, e.odometer), -1);
}

function sortEntries(list) {
  return [...list].sort((a, b) =>
    b.date.localeCompare(a.date) || ((b.odometer ?? 0) - (a.odometer ?? 0)) ||
    ((b.createdAt?.toMillis?.() ?? Infinity) - (a.createdAt?.toMillis?.() ?? Infinity)));
}

function monthLabel(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function renderEntries() {
  const list = sortEntries(state.entries);
  const groups = [];
  for (const e of list) {
    const key = e.date.slice(0, 7);
    if (groups[groups.length - 1]?.key !== key) groups.push({ key, items: [], total: 0 });
    const g = groups[groups.length - 1];
    g.items.push(e);
    g.total += e.cost;
  }
  return `
    <button class="btn primary block add-btn" data-action="open-entry">${icon('plus')}<span>Kosten erfassen</span></button>
    ${groups.length ? groups.map((g) => `
      <section class="card">
        <div class="group-head"><h3>${monthLabel(g.key + '-01')}</h3><span class="muted">${eur.format(g.total)}</span></div>
        <ul class="list">${g.items.map(entryItem).join('')}</ul>
      </section>`).join('') : `
      <section class="card empty-state">
        <p><strong>Noch keine Einträge</strong></p>
        <p class="muted">Tanken, Laden, Werkstatt, Parken, Versicherung … einfach erfassen – die Auswertung rechnet den Rest.</p>
      </section>`}
    ${state.entrySheet ? renderEntrySheet() : ''}`;
}

function renderEntrySheet() {
  const car = carOf(state.entryCar) ? state.entryCar : cars()[0].id;
  const last = lastOdometer(car);
  return `
    <div class="overlay" data-action="close-entry">
      <form class="dialog" id="entry-form">
        <div class="sheet-head">
          <h3>Neuer Eintrag</h3>
          <button class="icon-btn" type="button" data-action="close-entry" aria-label="Schließen">✕</button>
        </div>
        <div class="seg">
          ${cars().map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}" ${c.id === car ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        </div>
        <label><span>Art</span><select name="type">
          ${TYPES.map((t) => `<option value="${t.id}" ${t.id === state.entryType ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select></label>
        <div class="row">
          <label><span>Datum</span><input type="date" name="date" value="${isoDate(new Date())}" required></label>
          <label><span id="odo-label">Kilometerstand</span><input name="odometer" inputmode="numeric" pattern="[0-9]*" value="${last >= 0 ? last : ''}"></label>
        </div>
        <div class="row">
          <label id="amount-wrap"><span>Menge in <b id="unit">${unit(car)}</b></span><input name="amount" inputmode="decimal" placeholder="0,0"></label>
          <label><span>Kosten in €</span><input name="cost" inputmode="decimal" placeholder="0,00" required></label>
        </div>
        <p class="preview muted small" id="entry-preview">&nbsp;</p>
        <label class="check" id="full-wrap">
          <input type="checkbox" name="full" checked> Vollgetankt
        </label>
        <fieldset>
          <legend>Bezahlt von</legend>
          <div class="seg">
            ${people().map((p) => `<label class="seg-opt pc"${pc(p.id)}><input type="radio" name="paidBy" value="${p.id}" ${p.id === state.name ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}
          </div>
        </fieldset>
        <label><span>Notiz</span><input name="note" maxlength="300" placeholder="optional"></label>
        <button class="btn primary block" type="submit">Speichern</button>
      </form>
    </div>`;
}

// Felder je nach Auto und Art ein-/ausblenden
function updateEntryForm(form) {
  const f = new FormData(form);
  const car = f.get('car');
  const fuel = f.get('type') === 'fuel';
  form.querySelector('#unit').textContent = unit(car);
  form.querySelector('#amount-wrap').hidden = !fuel;
  form.elements.amount.required = fuel;
  form.elements.odometer.required = fuel;
  form.querySelector('#odo-label').textContent = fuel ? 'Kilometerstand' : 'Kilometerstand (optional)';
  form.querySelector('#full-wrap').hidden = !(fuel && isCombustion(car));
  updateEntryPreview(form);
}

function updateEntryPreview(form) {
  const f = new FormData(form);
  const car = f.get('car');
  const amount = parseNum(f.get('amount'));
  const cost = parseNum(f.get('cost'));
  const odoRaw = String(f.get('odometer') || '').trim();
  const odo = Number(odoRaw);
  const last = lastOdometer(car);
  const parts = [];
  if (f.get('type') === 'fuel' && amount > 0 && cost >= 0) parts.push(`${num.format(cost / amount)} €/${unit(car)}`);
  if (odoRaw && last >= 0 && Number.isInteger(odo) && odo > last) parts.push(`+${num.format(odo - last)} km seit letztem Eintrag`);
  if (odoRaw && last >= 0 && Number.isInteger(odo) && odo < last) parts.push(`Kilometerstand unter letztem Wert (${num.format(last)})`);
  form.querySelector('#entry-preview').innerHTML = parts.length ? esc(parts.join(' · ')) : '&nbsp;';
}

function entryItem(e) {
  const type = entryType(e);
  const fuel = type === 'fuel';
  const per = fuel && e.amount > 0 ? ` · ${num.format(e.cost / e.amount)} €/${unit(e.car)}` : '';
  const what = fuel ? `${num.format(e.amount)} ${unit(e.car)}${per}` : esc(typeLabel(type));
  const payer = payerOf(e);
  const details = [
    esc(carName(e.car)), fmtDate(e.date),
    Number.isFinite(e.odometer) ? `${num.format(e.odometer)} km` : '',
    fuel && isCombustion(e.car) ? (e.full ? 'voll' : 'teilweise') : '',
    payer ? `<i class="dot pc"${pc(payer)}></i>${esc(personName(payer))}` : '',
    e.note ? esc(e.note) : ''
  ].filter(Boolean).join(' · ');
  return `<li class="item">
    <span class="car-tag cc"${cc(e.car)}>${esc(carOf(e.car)?.short || '?')}</span>
    <div class="grow">
      <strong>${eur.format(e.cost)}</strong> <span class="muted">${what}</span>
      <div class="note">${details}</div>
    </div>
    <button class="icon-btn small danger" data-action="delete-entry" data-id="${esc(e.id)}" aria-label="Löschen">✕</button>
  </li>`;
}

function onEntryCarChange(form) {
  const car = new FormData(form).get('car');
  state.entryCar = car;
  const last = lastOdometer(car);
  form.elements.odometer.value = last >= 0 ? last : '';
  updateEntryForm(form);
}

// Prüft Eingaben (Formular, CSV, Backup) und liefert ein regelkonformes Dokument
function validateEntry(r) {
  const car = r?.car;
  if (!carOf(car)) return { error: 'Bitte Auto wählen' };
  const type = r.type || 'fuel';
  if (!TYPES.some((t) => t.id === type)) return { error: 'Ungültige Art' };
  const date = String(r.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Ungültiges Datum' };
  const odoRaw = String(r.odometer ?? '').trim();
  const odometer = odoRaw === '' ? null : Number(odoRaw);
  if (odometer !== null && !(Number.isInteger(odometer) && odometer >= 0 && odometer < 10000000)) return { error: 'Ungültiger Kilometerstand' };
  if (type === 'fuel' && odometer === null) return { error: 'Kilometerstand fehlt' };
  const amount = parseNum(r.amount);
  if (type === 'fuel' && !(amount > 0 && amount < 10000)) return { error: 'Ungültige Menge' };
  const cost = parseNum(r.cost);
  if (!(cost >= 0 && cost < 100000)) return { error: 'Ungültige Kosten' };
  const me = ID_RE.test(state.name) ? state.name : people()[0].id;
  const data = {
    car, type, date,
    cost: round2(cost),
    note: String(r.note || '').trim().slice(0, 300),
    createdBy: ID_RE.test(r.createdBy || '') ? r.createdBy : me,
    paidBy: ID_RE.test(r.paidBy || '') ? r.paidBy : (ID_RE.test(r.createdBy || '') ? r.createdBy : me)
  };
  if (odometer !== null) data.odometer = odometer;
  if (type === 'fuel') {
    data.amount = round2(amount);
    data.full = isCombustion(car) ? r.full === true || r.full === 'on' : false;
  }
  return { data };
}

function submitEntry(form) {
  const f = new FormData(form);
  const res = validateEntry({
    car: f.get('car'), type: f.get('type'), date: f.get('date'), odometer: f.get('odometer'),
    amount: f.get('amount'), cost: f.get('cost'), full: f.get('full'), note: f.get('note'),
    createdBy: state.name, paidBy: f.get('paidBy')
  });
  if (res.error) return toast(res.error);
  const data = res.data;
  const last = lastOdometer(data.car);
  if (data.odometer != null && data.odometer < last && !confirm(`Kilometerstand ${num.format(data.odometer)} ist kleiner als der letzte (${num.format(last)}). Trotzdem speichern?`)) return;
  addItem(state.code, 'entries', data).catch((e) => toast('Fehler: ' + e.message));
  state.entryType = data.type;
  state.entrySheet = false;
  render();
  toast('Gespeichert');
}

/* ---------- Fristen ---------- */

const DUE_SOON_DAYS = 30;

function dueIn(r) { return daysBetween(isoDate(new Date()), r.due); }
function dueReminders() {
  return [...state.reminders].filter((r) => dueIn(r) <= DUE_SOON_DAYS).sort((a, b) => a.due.localeCompare(b.due));
}
function dueLabel(r) {
  const d = dueIn(r);
  if (d < 0) return `<span class="due overdue">${-d} ${-d === 1 ? 'Tag' : 'Tage'} überfällig</span>`;
  if (d === 0) return '<span class="due overdue">heute</span>';
  return `<span class="due${d <= DUE_SOON_DAYS ? ' soon' : ''}">in ${d} ${d === 1 ? 'Tag' : 'Tagen'}</span>`;
}
function intervalLabel(n) {
  if (!n) return 'einmalig';
  if (n % 12 === 0) return n === 12 ? 'jährlich' : `alle ${n / 12} Jahre`;
  return n === 1 ? 'monatlich' : `alle ${n} Monate`;
}

function renderReminders() {
  const list = [...state.reminders].sort((a, b) => a.due.localeCompare(b.due));
  return `
    <button class="btn primary block add-btn" data-action="open-reminder">${icon('plus')}<span>Frist hinzufügen</span></button>
    ${list.length ? `<section class="card"><ul class="list">${list.map((r) => `
      <li class="item">
        <span class="car-tag cc"${cc(r.car)}>${esc(carOf(r.car)?.short || '?')}</span>
        <div class="grow">
          <strong>${esc(r.title)}</strong> ${dueLabel(r)}
          <div class="note">${esc(carName(r.car))} · ${fmtDate(r.due)} · ${intervalLabel(r.intervalMonths)}${r.note ? ` · ${esc(r.note)}` : ''}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-sm" data-action="reminder-done" data-id="${esc(r.id)}">Erledigt</button>
          <button class="icon-btn small" data-action="open-reminder" data-id="${esc(r.id)}" aria-label="Bearbeiten">✎</button>
        </div>
      </li>`).join('')}</ul></section>` : `
      <section class="card empty-state">
        <p><strong>Keine Fristen</strong></p>
        <p class="muted">HU/TÜV, Service, Reifenwechsel, Versicherung … eintragen. Fällige Fristen (≤ ${DUE_SOON_DAYS} Tage) erscheinen im Kalender und als Zähler im Menü.</p>
      </section>`}
    ${state.reminderSheet ? renderReminderSheet() : ''}`;
}

function renderReminderSheet() {
  const r = state.reminders.find((x) => x.id === state.reminderSheet) || null;
  const car = r?.car || (carOf(state.entryCar) ? state.entryCar : cars()[0].id);
  const iv = r ? r.intervalMonths : 12;
  const ivs = [...new Set([0, 1, 3, 6, 12, 24, 36, iv])].sort((a, b) => a - b);
  return `
    <div class="overlay" data-action="close-reminder">
      <form class="dialog" id="reminder-form" data-id="${esc(r?.id || '')}">
        <div class="sheet-head">
          <h3>${r ? 'Frist bearbeiten' : 'Neue Frist'}</h3>
          <button class="icon-btn" type="button" data-action="close-reminder" aria-label="Schließen">✕</button>
        </div>
        <div class="seg">
          ${cars().map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}" ${c.id === car ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        </div>
        <label><span>Was</span><input name="title" list="reminder-presets" maxlength="80" required value="${esc(r?.title || '')}" placeholder="z. B. HU / TÜV"></label>
        <datalist id="reminder-presets">${REMINDER_PRESETS.map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="row">
          <label><span>Fällig am</span><input type="date" name="due" required value="${esc(r?.due || '')}"></label>
          <label><span>Wiederholung</span><select name="intervalMonths">
            ${ivs.map((n) => `<option value="${n}" ${n === iv ? 'selected' : ''}>${intervalLabel(n)}</option>`).join('')}
          </select></label>
        </div>
        <label><span>Notiz</span><input name="note" maxlength="300" placeholder="optional" value="${esc(r?.note || '')}"></label>
        <button class="btn primary block" type="submit">Speichern</button>
        ${r ? `<button class="btn danger block" type="button" data-action="delete-reminder" data-id="${esc(r.id)}">Löschen</button>` : ''}
      </form>
    </div>`;
}

function validateReminder(r) {
  if (!carOf(r?.car)) return { error: 'Bitte Auto wählen' };
  const title = String(r.title || '').trim().slice(0, 80);
  if (!title) return { error: 'Bitte angeben, was fällig ist' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.due || ''))) return { error: 'Ungültiges Datum' };
  const intervalMonths = Number(r.intervalMonths) || 0;
  if (!(Number.isInteger(intervalMonths) && intervalMonths >= 0 && intervalMonths <= 120)) return { error: 'Ungültige Wiederholung' };
  return { data: {
    car: r.car, title, due: r.due, intervalMonths,
    note: String(r.note || '').trim().slice(0, 300),
    createdBy: ID_RE.test(r.createdBy || '') ? r.createdBy : state.name
  } };
}

function submitReminder(form) {
  const f = new FormData(form);
  const id = form.dataset.id;
  const old = state.reminders.find((x) => x.id === id);
  const res = validateReminder({
    car: f.get('car'), title: f.get('title'), due: f.get('due'), intervalMonths: f.get('intervalMonths'),
    note: f.get('note'), createdBy: old?.createdBy || state.name
  });
  if (res.error) return toast(res.error);
  (old ? updateItem(state.code, 'reminders', id, res.data) : addItem(state.code, 'reminders', res.data))
    .catch((e) => toast('Fehler: ' + e.message));
  state.reminderSheet = null;
  render();
  toast('Gespeichert');
}

function reminderDone(id) {
  const r = state.reminders.find((x) => x.id === id);
  if (!r) return;
  const err = (e) => toast('Fehler: ' + e.message);
  if (r.intervalMonths > 0) {
    // Nächster Termin ab bisheriger Fälligkeit; lag die weit zurück, ab heute
    let next = addMonths(r.due, r.intervalMonths);
    if (next < isoDate(new Date())) next = addMonths(isoDate(new Date()), r.intervalMonths);
    updateItem(state.code, 'reminders', r.id, { due: next }).catch(err);
    toast(`Erledigt – nächster Termin ${fmtDate(next)}`, {
      label: 'Rückgängig', run: () => updateItem(state.code, 'reminders', r.id, { due: r.due }).catch(err)
    });
  } else deleteReminder(r, 'Erledigt');
}

function deleteReminder(r, msg = 'Frist gelöscht') {
  const err = (e) => toast('Fehler: ' + e.message);
  deleteItem(state.code, 'reminders', r.id).catch(err);
  toast(msg, {
    label: 'Rückgängig',
    run: () => { const { id, createdAt, ...data } = r; addItem(state.code, 'reminders', data).catch(err); }
  });
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
  const all = state.entries.filter((e) => e.car === car && e.date >= from);
  const fuel = all.filter((e) => entryType(e) === 'fuel' && Number.isFinite(e.odometer))
    .sort((a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date));
  const sum = (l, k) => l.reduce((s, e) => s + (e[k] || 0), 0);
  const totalCost = sum(all, 'cost');
  const fuelCost = sum(fuel, 'cost');
  const fuelAmount = sum(fuel, 'amount');
  const odos = all.map((e) => e.odometer).filter(Number.isFinite);
  const km = odos.length > 1 ? Math.max(...odos) - Math.min(...odos) : 0;
  const fuelKm = fuel.length > 1 ? fuel[fuel.length - 1].odometer - fuel[0].odometer : 0;
  const rest = fuel.slice(1);
  const byType = TYPES.filter((t) => t.id !== 'fuel')
    .map((t) => ({ ...t, value: sum(all.filter((e) => entryType(e) === t.id), 'cost') }))
    .filter((t) => t.value > 0);
  return {
    count: all.length,
    fuelCount: fuel.length,
    km,
    fuelCost,
    byType,
    consumption: fuelKm > 0 ? sum(rest, 'amount') / fuelKm * 100 : null,
    costPer100: fuelKm > 0 ? sum(rest, 'cost') / fuelKm * 100 : null,
    totalPer100: km > 0 ? totalCost / km * 100 : null,
    avgPrice: fuelAmount > 0 ? fuelCost / fuelAmount : null,
    totalCost,
    months: monthlyCosts(all)
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
      <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(bh, m.value > 0 ? 1 : 0)}" rx="2" class="bar cc"/>
      ${m.value > 0 ? `<text x="${x + barW / 2}" y="${y - 4}" class="bar-val">${Math.round(m.value)}</text>` : ''}
      <text x="${x + barW / 2}" y="${h - 6}" class="bar-lbl">${esc(m.label)}</text>
    </g>`;
  }).join('');
  return `<div class="chart-scroll"><svg class="chart"${cc(car)} viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Kosten pro Monat">
    <line x1="0" y1="${h - bottom}" x2="${width}" y2="${h - bottom}" class="axis"/>${bars}</svg></div>`;
}

// Kosten je Auto nach gebuchten Kalendertagen (bis heute) verteilen, gegen Gezahltes verrechnen
function settlement(from) {
  const today = isoDate(new Date());
  const ids = people().map((p) => p.id);
  const zero = () => Object.fromEntries(ids.map((i) => [i, 0]));
  const paid = zero(), share = zero(), usage = [];
  let unassigned = 0;
  for (const c of cars()) {
    const list = state.entries.filter((e) => e.car === c.id && e.date >= from);
    const cost = list.reduce((s, e) => s + e.cost, 0);
    for (const e of list) {
      const p = payerOf(e);
      if (p in paid) paid[p] += e.cost; else unassigned += e.cost;
    }
    if (!cost) continue;
    const days = zero();
    for (const b of state.bookings) {
      if (b.car === c.id && b.date >= from && b.date <= today && b.driver in days) days[b.driver]++;
    }
    const total = Object.values(days).reduce((a, b) => a + b, 0);
    for (const i of ids) share[i] += total ? cost * days[i] / total : cost / ids.length;
    usage.push({ car: c, days, total });
  }
  // Fremd bezahlte Kosten (entfernte Personen) zählen als von allen anteilig bezahlt
  if (unassigned) for (const i of ids) paid[i] += unassigned / ids.length;
  const balance = Object.fromEntries(ids.map((i) => [i, paid[i] - share[i]]));
  const debt = ids.filter((i) => balance[i] < -0.005).map((i) => ({ id: i, v: -balance[i] })).sort((a, b) => b.v - a.v);
  const cred = ids.filter((i) => balance[i] > 0.005).map((i) => ({ id: i, v: balance[i] })).sort((a, b) => b.v - a.v);
  const transfers = [];
  for (const d of debt) {
    for (const c of cred) {
      const v = Math.min(d.v, c.v);
      if (v < 0.005) continue;
      transfers.push({ from: d.id, to: c.id, v });
      d.v -= v; c.v -= v;
    }
  }
  return { ids, paid, share, balance, usage, transfers };
}

function renderSettlement(from) {
  const s = settlement(from);
  if (!s.usage.length) return '';
  return `
    <section class="card">
      <h3>Abrechnung</h3>
      <table class="settle">
        <tr><th>Person</th><th>Gezahlt</th><th>Anteil</th><th>Saldo</th></tr>
        ${s.ids.map((i) => `<tr><td><i class="dot pc"${pc(i)}></i> ${esc(personName(i))}</td>
          <td>${eur.format(s.paid[i])}</td><td>${eur.format(s.share[i])}</td>
          <td class="${s.balance[i] > 0.005 ? 'pos' : s.balance[i] < -0.005 ? 'neg' : ''}">${eur.format(s.balance[i])}</td></tr>`).join('')}
      </table>
      ${s.transfers.length
        ? `<ul class="kv">${s.transfers.map((t) => `<li><span>${esc(personName(t.from))} → ${esc(personName(t.to))}</span><strong>${eur.format(t.v)}</strong></li>`).join('')}</ul>`
        : '<p class="muted small">Alles ausgeglichen.</p>'}
      <p class="muted small">${s.usage.map((u) => `${esc(u.car.name)}: ${u.total
        ? s.ids.filter((i) => u.days[i]).map((i) => `${esc(personName(i))} ${u.days[i]} T`).join(', ')
        : 'keine Buchungen – gleich verteilt'}`).join(' · ')}</p>
      <p class="hint">Die Kosten jedes Autos werden nach gebuchten Kalendertagen (bis heute) aufgeteilt. „Bezahlt von“ legt fest, wer ausgelegt hat.</p>
    </section>`;
}

function renderStats() {
  const from = periodStart();
  return `
    <section class="card">
      <div class="seg">
        ${PERIODS.map((p) => `<button class="seg-opt btn-seg ${p.id === state.statsPeriod ? 'active' : ''}" data-action="period" data-period="${p.id}">${p.label}</button>`).join('')}
      </div>
    </section>
    ${renderSettlement(from)}
    ${cars().map((c) => {
      const s = carStats(c.id, from);
      const u = unit(c.id);
      const fmt = (v, suffix) => (v == null ? '–' : `${num.format(v)} ${suffix}`);
      return `
        <section class="card car-card cc"${cc(c.id)}>
          <h3>${esc(c.name)}</h3>
          <div class="stat-big">${eur.format(s.totalCost)}<small>Gesamtkosten · ${s.count} Einträge</small></div>
          <ul class="kv">
            <li><span>Gefahrene km</span><span>${num.format(s.km)} km</span></li>
            <li><span>Ø Gesamtkosten</span><span>${s.totalPer100 == null ? '–' : `${eur.format(s.totalPer100)} /100 km`}</span></li>
            <li><span>${isCombustion(c.id) ? 'Tanken' : 'Laden'}</span><span>${eur.format(s.fuelCost)}</span></li>
            ${s.byType.map((t) => `<li><span>${esc(t.label)}</span><span>${eur.format(t.value)}</span></li>`).join('')}
            <li><span>Ø Verbrauch</span><span>${fmt(s.consumption, `${u}/100 km`)}</span></li>
            <li><span>Ø Energiekosten</span><span>${s.costPer100 == null ? '–' : `${eur.format(s.costPer100)} /100 km`}</span></li>
            <li><span>Ø Preis</span><span>${s.avgPrice == null ? '–' : `${num.format(s.avgPrice)} €/${u}`}</span></li>
          </ul>
          ${isCombustion(c.id) ? '<p class="hint">Verbrauch stimmt nur, wenn jedes Mal vollgetankt wurde.</p>' : ''}
          ${s.fuelCount === 1 ? '<p class="muted small">Verbrauch ab zwei Tank-/Ladeeinträgen.</p>' : ''}
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
  const week = mondayOf(isoDate(new Date()));
  return `
    <section class="card">
      <h3>Du bist</h3>
      <div class="seg">${people().map((p) => `
        <button class="seg-opt btn-seg pc ${p.id === state.name ? 'active' : ''}"${pc(p.id)} data-action="set-name" data-name="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h3>Personen & Autos</h3>
      <form id="setup-form">
        <p class="set-label">Personen</p>
        ${people().map((p) => `<div class="edit-row">
          <i class="dot pc"${pc(p.id)}></i>
          <input name="p-${p.id}" value="${esc(p.name)}" maxlength="20" required aria-label="Name">
          <button class="icon-btn small danger" type="button" data-action="remove-person" data-id="${p.id}" aria-label="${esc(p.name)} entfernen">✕</button>
        </div>`).join('')}
        ${people().length < MAX_ITEMS ? '<input name="new-person" maxlength="20" placeholder="Person hinzufügen" aria-label="Neue Person">' : ''}
        <p class="set-label">Autos</p>
        ${cars().map((c) => `<div class="edit-row">
          <input class="short" name="cs-${c.id}" value="${esc(c.short)}" maxlength="2" required aria-label="Kürzel">
          <input name="c-${c.id}" value="${esc(c.name)}" maxlength="30" required aria-label="Name">
          <select name="ck-${c.id}" aria-label="Antrieb">${kindOptions(c.kind)}</select>
          <button class="icon-btn small danger" type="button" data-action="remove-car" data-id="${c.id}" aria-label="${esc(c.name)} entfernen">✕</button>
        </div>`).join('')}
        ${cars().length < MAX_ITEMS ? `<div class="edit-row">
          <input name="new-car" maxlength="30" placeholder="Auto hinzufügen" aria-label="Neues Auto">
          <select name="new-car-kind" aria-label="Antrieb">${kindOptions('fuel')}</select>
        </div>` : ''}
        <button class="btn block" type="submit">Speichern</button>
      </form>
      <p class="muted small">Gilt für alle Geräte im Haushalt. Beim Entfernen bleiben bestehende Einträge erhalten.</p>
    </section>
    <section class="card">
      <h3>Darstellung</h3>
      <p class="set-label">Modus</p>
      ${segPref('theme', [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']], prefs.theme)}
      <p class="set-label">Farbschema</p>
      ${segPref('scheme', [['warm', 'Warm'], ['cool', 'Kühl'], ['green', 'Grün'], ['contrast', 'Kontrast']], prefs.scheme)}
      ${people().map((p, i) => { const k = p.id; const cur = prefs.colors[k] || SWATCHES[i % SWATCHES.length]; return `
      <p class="set-label">Farbe ${esc(p.name)}</p>
      <div class="swatches">${SWATCHES.map((c) => `
        <button class="swatch ${cur === c ? 'active' : ''}" style="background:${c}" data-action="pref" data-key="color-${k}" data-value="${c}" aria-label="Farbe ${c}"></button>`).join('')}</div>`; }).join('')}
      <p class="set-label">Schriftgröße</p>
      ${segPref('size', [['normal', 'Normal'], ['large', 'Groß']], prefs.size)}
      <p class="set-label">Start-Ansicht</p>
      ${segPref('startTab', TABS.slice(0, 4).map((t) => [t.id, t.short]), prefs.startTab)}
      <button class="btn link block" data-action="reset-prefs">Darstellung zurücksetzen</button>
    </section>
    <section class="card">
      <h3>Kalender</h3>
      <button class="btn danger block" data-action="reset-week">Aktuelle Woche zurücksetzen</button>
      <p class="muted small">Löscht alle Einteilungen der KW ${weekNumber(week)} (${shortRange(week)}) für alle Autos.</p>
    </section>
    <section class="card">
      <h3>Daten</h3>
      <button class="btn block" data-action="export-json">Backup herunterladen (JSON)</button>
      <button class="btn block" data-action="export-csv">Kosten als CSV exportieren</button>
      <button class="btn block" data-action="import" ${state.busy ? 'disabled' : ''}>Backup / CSV importieren</button>
      <input type="file" id="import-file" accept=".json,.csv,application/json,text/csv" hidden>
      <p class="muted small">${state.entries.length} Kosteneinträge · ${state.bookings.length} Kalender-Einteilungen · ${state.reminders.length} Fristen.
        Import ergänzt nur – vorhandene Einträge werden nicht doppelt angelegt. CSV im Format des Exports (Spalten Datum, Auto, Art, Kilometerstand, Menge, Kosten EUR …).</p>
    </section>
    <section class="card">
      <h3>Einladen</h3>
      ${state.invite ? inviteBox() : ''}
      <button class="btn block" data-action="new-invite" ${state.busy ? 'disabled' : ''}>${state.invite ? 'Neue Einladung erstellen' : 'Einladung erstellen'}</button>
      <button class="btn link block" data-action="revoke-invites" ${state.busy ? 'disabled' : ''}>Offene Einladungen widerrufen</button>
      <p class="muted small">Einladungen gelten ${INVITE_HOURS} h und nur für ein Gerät.</p>
    </section>
    <section class="card">
      <h3>Geräte</h3>
      <label class="check"><input type="checkbox" data-action="toggle-lock" ${state.config.locked ? 'checked' : ''} ${state.busy ? 'disabled' : ''}>
        Beitritt nur mit Einladung</label>
      <p class="muted small">${state.config.locked ? 'Der Code allein reicht nicht, um beizutreten.' : 'Achtung: Jeder mit dem Code kann beitreten.'}</p>
      <ul class="device-list">${state.members.map((m) => {
        const me = m.id === auth.currentUser?.uid;
        const since = m.joinedAt?.toMillis ? fmtTime(m.joinedAt.toMillis()) : '';
        return `<li><span>${esc(m.device || 'Gerät')}${me ? ' <b>(dieses Gerät)</b>' : ''}<br><span class="muted small">seit ${esc(since)}</span></span>
          ${me ? '' : `<button class="btn danger btn-sm" data-action="remove-member" data-id="${esc(m.id)}" ${state.busy ? 'disabled' : ''}>Entfernen</button>`}</li>`;
      }).join('')}</ul>
    </section>
    <section class="card">
      <h3>Haushaltscode</h3>
      ${state.showCode ? `<div class="code-box">${esc(state.code)}</div>
      <button class="btn block" data-action="copy" data-text="${esc(state.code)}">Code kopieren</button>`
      : `<button class="btn block" data-action="show-code">Code anzeigen</button>`}
      <button class="btn danger block" data-action="rotate-code" ${state.busy ? 'disabled' : ''}>Code erneuern</button>
      <p class="muted small">Falls der Code in falsche Hände geraten ist: Alle Daten ziehen in einen neuen Haushalt um, alle anderen Geräte verlieren den Zugriff und brauchen eine neue Einladung.</p>
    </section>
    <section class="card">
      <h3>Anderem Haushalt beitreten</h3>
      <form id="switch-form">
        <label>Einladungslink oder Code<input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
        <button class="btn block" type="submit">Wechseln</button>
      </form>
    </section>
    <section class="card">
      <button class="btn danger block" data-action="leave">Haushalt verlassen</button>
      <p class="muted small">Die Daten bleiben im Haushalt erhalten. Ohne Code ist kein erneuter Zugriff möglich.</p>
    </section>`;
}

function kindOptions(kind) {
  return [['fuel', 'Verbrenner'], ['electric', 'Elektro']]
    .map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${l}</option>`).join('');
}

function submitSetup(form) {
  const f = new FormData(form);
  const val = (k) => String(f.get(k) || '').trim();
  const setup = {
    people: people().map((p) => ({ id: p.id, name: (val(`p-${p.id}`) || p.name).slice(0, 20) })),
    cars: cars().map((c) => {
      const name = (val(`c-${c.id}`) || c.name).slice(0, 30);
      return { id: c.id, name, short: (val(`cs-${c.id}`) || name[0]).slice(0, 2), kind: f.get(`ck-${c.id}`) === 'electric' ? 'electric' : 'fuel' };
    })
  };
  const np = val('new-person').slice(0, 20);
  if (np) setup.people.push({ id: slugId(np, setup.people.map((p) => p.id)), name: np });
  const nc = val('new-car').slice(0, 30);
  if (nc) setup.cars.push({ id: slugId(nc, setup.cars.map((c) => c.id)), name: nc, short: nc[0].toUpperCase(), kind: f.get('new-car-kind') === 'electric' ? 'electric' : 'fuel' });
  storeSetup(setup, 'Gespeichert');
}

function storeSetup(setup, msg) {
  setup = sanitizeSetup(setup);
  state.setup = setup;
  applyColors();
  saveSetup(state.code, setup).then(() => msg && toast(msg), (e) => toast('Fehler: ' + errText(e)));
  render();
}

function removeFromSetup(kind, id) {
  const list = kind === 'person' ? people() : cars();
  const item = list.find((x) => x.id === id);
  if (!item) return;
  if (list.length <= 1) return toast(kind === 'person' ? 'Mindestens eine Person nötig' : 'Mindestens ein Auto nötig');
  const what = kind === 'person' ? 'Person' : 'Auto';
  if (!confirm(`${what} „${item.name}“ entfernen? Bestehende Einträge bleiben erhalten, werden aber nicht mehr zugeordnet.`)) return;
  const setup = structuredClone(state.setup);
  if (kind === 'person') setup.people = setup.people.filter((p) => p.id !== id);
  else setup.cars = setup.cars.filter((c) => c.id !== id);
  storeSetup(setup, `${what} entfernt`);
}

/* ---------- Main render ---------- */

const TABS = [
  { id: 'calendar', label: 'Kalender', short: 'Kalender', icon: 'calendar' },
  { id: 'entries', label: 'Kosten', short: 'Kosten', icon: 'fuel' },
  { id: 'reminders', label: 'Fristen', short: 'Fristen', icon: 'bell' },
  { id: 'stats', label: 'Auswertung', short: 'Auswertung', icon: 'chart' },
  { id: 'settings', label: 'Einstellungen', short: 'Einstellungen', icon: 'gear' }
];

const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M4 11h11"/><path d="M15 8h2a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'
};
function icon(name) {
  return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function render() {
  // Eigene Person wurde entfernt oder existiert in diesem Haushalt nicht
  if (!state.setupStep && state.code && state.setupLoaded && !people().some((p) => p.id === state.name)) state.setupStep = 'name';
  if (state.setupStep) return renderSetup();
  const scroll = window.scrollY;
  const views = { calendar: renderCalendar, entries: renderEntries, reminders: renderReminders, stats: renderStats, settings: renderSettings };
  const active = document.activeElement;
  const focusName = active && active.form && active.name && active.type !== 'radio' ? { form: active.form.id, name: active.name, value: active.value } : null;
  if (focusName) return; // Nicht neu rendern, während der Nutzer tippt
  // Ungespeicherte Formulareingaben (Eintragsformular) über Re-Renders hinweg erhalten
  const drafts = ['entry-form', 'reminder-form'].map((id) => {
    const form = document.getElementById(id);
    if (!form) return null;
    return { id, fields: [...form.elements].filter((el) => el.name).map((el) => ({ name: el.name, value: el.value, checked: el.checked, type: el.type })) };
  }).filter(Boolean);
  const dueCount = dueReminders().length;
  app.innerHTML = `
    <header class="topbar">
      <span>${esc(TABS.find((t) => t.id === state.tab).label)}</span>
      <span class="me pc"${pc(state.name)}>${esc(personName(state.name))}</span>
    </header>
    ${state.error ? `<div class="banner">${esc(state.error)}</div>` : ''}
    ${state.offline && !state.error ? `<div class="banner">Keine Verbindung zum Server – Änderungen sind nur auf diesem Gerät gespeichert.</div>` : ''}
    <main class="content">${views[state.tab]()}</main>
    <nav class="tabbar">
      ${TABS.map((t) => `<button class="tab ${t.id === state.tab ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
        ${icon(t.icon)}<span>${t.short}</span>${t.id === 'reminders' && dueCount ? `<span class="badge" aria-label="${dueCount} fällig">${dueCount}</span>` : ''}</button>`).join('')}
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
  if (entryForm) updateEntryForm(entryForm);
  window.scrollTo(0, scroll);
}

/* ---------- Events ---------- */

app.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action } = el.dataset;
  switch (action) {
    case 'create':
      state.error = null;
      run(async () => {
        try { await createNewHousehold(); state.setupStep = 'created'; }
        catch (e) { state.error = 'Erstellen fehlgeschlagen: ' + errText(e); }
      });
      return;
    case 'confirm-created':
      state.setupStep = 'name';
      break;
    case 'reload': location.reload(); return;
    case 'share-invite':
      navigator.share({ title: 'Autoplaner', text: 'Einladung zum Autoplaner:', url: state.invite.link }).catch(() => {});
      return;
    case 'new-invite': run(newInvite); return;
    case 'revoke-invites':
      run(async () => { const n = await revokeInvites(state.code); state.invite = null; toast(`${n} Einladung(en) widerrufen`); });
      return;
    case 'toggle-lock': {
      const locked = el.checked;
      run(() => setLocked(state.code, locked), locked ? 'Haushalt gesperrt' : 'Beitritt mit Code erlaubt');
      return;
    }
    case 'remove-member':
      if (confirm('Dieses Gerät entfernen? Es verliert sofort den Zugriff.')) run(() => removeMember(state.code, el.dataset.id), 'Gerät entfernt');
      return;
    case 'show-code': state.showCode = true; break;
    case 'rotate-code':
      if (confirm('Code wirklich erneuern? Alle anderen Geräte verlieren den Zugriff und brauchen eine neue Einladung.')) {
        run(rotateCode, 'Neuer Code aktiv – jetzt neue Einladung erstellen');
      }
      return;
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
      state.reminderSheet = null;
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
    case 'open-reminder': state.reminderSheet = el.dataset.id || 'new'; break;
    case 'close-reminder':
      if (ev.target !== el && !el.matches('button')) return;
      state.reminderSheet = null;
      break;
    case 'reminder-done': reminderDone(el.dataset.id); return;
    case 'delete-reminder': {
      const r = state.reminders.find((x) => x.id === el.dataset.id);
      if (r) deleteReminder(r);
      state.reminderSheet = null;
      break;
    }
    case 'remove-person': removeFromSetup('person', el.dataset.id); return;
    case 'remove-car': removeFromSetup('car', el.dataset.id); return;
    case 'export-json': exportJson(); return;
    case 'import': document.getElementById('import-file')?.click(); return;
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
  if (ev.target.id === 'import-file') {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (file) importFile(file);
    return;
  }
  const form = ev.target.form;
  if (form?.id === 'day-form') { updateDayWarning(form); saveDayCar(form, ev.target.name); }
  if (form?.id === 'entry-form' && ev.target.name === 'car') onEntryCarChange(form);
  if (form?.id === 'entry-form' && ev.target.name === 'type') { state.entryType = ev.target.value; updateEntryForm(form); }
  if (form?.id === 'reminder-form' && ev.target.name === 'title') {
    const preset = REMINDER_PRESETS.find(([t]) => t === ev.target.value);
    if (preset && !form.dataset.id) form.elements.intervalMonths.value = String(preset[1]);
  }
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
  else if (form.id === 'reminder-form') submitReminder(form);
  else if (form.id === 'setup-form') submitSetup(form);
  else if (form.id === 'join-form' || form.id === 'switch-form') {
    const parsed = parseInvite(new FormData(form).get('code'));
    const isJoin = form.id === 'join-form';
    if (!parsed) {
      if (isJoin) { state.error = 'Ungültiger Link oder Code.'; render(); }
      else toast('Ungültiger Link oder Code');
      return;
    }
    state.error = null;
    run(async () => {
      try {
        await enterHousehold(parsed.code, parsed.invite);
        if (isJoin) state.setupStep = 'name';
        else { toast('Haushalt gewechselt'); state.tab = 'calendar'; }
      } catch (e) {
        if (isJoin) state.error = errText(e); else throw e;
      }
    });
  }
});

// Ausstehende Renderings nachholen, wenn ein Eingabefeld verlassen wird
app.addEventListener('focusout', () => setTimeout(() => {
  if (!app.contains(document.activeElement) || !document.activeElement.form) render();
}, 0));

/* ---------- Boot ---------- */

async function boot() {
  // Neues Format: /#h=CODE&i=TOKEN; altes /?h=CODE wird weiter akzeptiert.
  const link = parseInvite(location.href);
  const linkCode = link?.code;
  if (location.hash || location.search) history.replaceState(null, '', location.pathname);

  try {
    await ensureAuth();
  } catch (e) {
    app.innerHTML = `<main class="setup"><h1>Verbindung fehlgeschlagen</h1><p class="error">${esc(e.message)}</p>
      <button class="btn primary block" data-action="reload">Erneut versuchen</button></main>`;
    return;
  }

  const storedCode = localStorage.getItem(LS_CODE);
  // Früher wurde der Anzeigename gespeichert ("Lukas"), jetzt die ID ("lukas")
  const storedName = (localStorage.getItem(LS_NAME) || '').toLowerCase();

  if (linkCode && CODE_RE.test(linkCode) && linkCode !== storedCode) {
    if (!storedCode || confirm('Diesem Haushalt beitreten? Der aktuelle Haushalt wird verlassen.')) {
      try {
        await enterHousehold(linkCode, link.invite);
      } catch (e) {
        state.error = 'Beitritt fehlgeschlagen: ' + errText(e);
        state.setupStep = 'start';
        return render();
      }
      state.name = ID_RE.test(storedName) ? storedName : null;
      state.setupStep = state.name ? null : 'name';
      return render();
    }
  }

  if (storedCode && CODE_RE.test(storedCode)) {
    // Bestehende Haushalte (vor Einführung der Mitgliedschaft) treten automatisch bei, solange nicht gesperrt.
    try { await enterHousehold(storedCode, null); }
    catch (e) { setHousehold(storedCode); state.error = 'Kein Zugriff: ' + errText(e); }
    if (ID_RE.test(storedName)) state.name = storedName;
    else state.setupStep = 'name';
  } else {
    state.setupStep = 'start';
  }
  render();
}

boot();
