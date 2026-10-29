import { auth, createHousehold, createInvite, isMember, joinHousehold, removeMember, rotateHousehold, subscribeBookings, subscribeConfig, subscribeEntries, subscribeMembers, subscribeRecurring, subscribeReminders, generateRecurring, subscribeSetup } from './firebase.js';
import { DEFAULT_SETUP, recurringDue, recurringEntry, sanitizeSetup } from './lib/model.js';
import { generateCode, isoDate } from './lib/util.js';
import { render, scheduleRender } from './render.js';
import { LS_CODE, LS_MEMBER, LS_NAME, applyColors, state } from './state.js';
import { copyText, errText, toast } from './ui.js';

let unsubs = [];

// Fragment statt Query: wird nie an den Server geschickt (keine Logs, kein Referrer).
export function inviteLink(code, token) {
  return `${location.origin}/#h=${encodeURIComponent(code)}&i=${encodeURIComponent(token)}`;
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Gerät';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

export const INVITE_HOURS = 24;

export async function newInvite() {
  const token = generateCode(24);
  await createInvite(state.code, token, INVITE_HOURS);
  state.invite = { link: inviteLink(state.code, token), expires: Date.now() + INVITE_HOURS * 3600 * 1000 };
  return state.invite;
}

export async function shareHousehold() {
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
/** Letzte Snapshot-Metadaten je Sammlung */
const meta = {};

/**
 * Sync-Status aus Snapshot-Metadaten und Netzstatus ableiten:
 * synced – alles beim Server; pending – lokale Änderungen noch nicht bestätigt;
 * connecting – nur Cache, Verbindung wird aufgebaut; offline – länger als 5 s ohne Server.
 */
export function refreshSync() {
  const list = Object.values(meta).filter(Boolean);
  const cached = !navigator.onLine || list.some((m) => m.fromCache);
  const pending = list.some((m) => m.hasPendingWrites);
  const prev = state.sync;
  if (!cached) {
    clearTimeout(offlineTimer);
    offlineTimer = null;
    state.sync = pending ? 'pending' : 'synced';
  } else if (!navigator.onLine) {
    clearTimeout(offlineTimer);
    offlineTimer = null;
    state.sync = 'offline';
  } else if (prev !== 'offline' && !offlineTimer) {
    state.sync = 'connecting';
    offlineTimer = setTimeout(() => { offlineTimer = null; state.sync = 'offline'; scheduleRender(); }, 5000);
  }
  if (state.sync !== prev) scheduleRender();
}

export function startSync() {
  stopSync();
  const onErr = (e) => {
    console.error(e);
    if (e.code === 'permission-denied') localStorage.removeItem(LS_MEMBER);
    state.error = 'Synchronisation fehlgeschlagen: ' + errText(e);
    scheduleRender();
  };
  for (const k of Object.keys(meta)) delete meta[k];
  const onMeta = (key, m) => { meta[key] = m; refreshSync(); };
  unsubs.push(subscribeBookings(state.code, (d, m) => { state.bookings = d; onMeta('bookings', m); scheduleRender(); }, onErr));
  unsubs.push(subscribeEntries(state.code, (d, m) => { state.entries = d; onMeta('entries', m); scheduleRender(); }, onErr));
  const quiet = (e) => console.warn(e);
  unsubs.push(subscribeReminders(state.code, (d, m) => { state.reminders = d; onMeta('reminders', m); scheduleRender(); }, quiet));
  unsubs.push(subscribeRecurring(state.code, (d, m) => {
    state.recurring = d;
    onMeta('recurring', m);
    if (!m.fromCache) runRecurring();
    scheduleRender();
  }, quiet));
  unsubs.push(subscribeSetup(state.code, (s) => {
    state.setup = sanitizeSetup(s);
    state.setupLoaded = true;
    applyColors();
    scheduleRender();
  }, quiet));
  unsubs.push(subscribeConfig(state.code, (c) => { state.config = c; scheduleRender(); }, quiet));
  unsubs.push(subscribeMembers(state.code, (m) => { state.members = m; scheduleRender(); }, quiet));
}

const runningRecurring = new Set();
/** Fällige wiederkehrende Kosten als Einträge anlegen. */
function runRecurring() {
  const now = isoDate(new Date());
  for (const r of state.recurring) {
    if (runningRecurring.has(r.id)) continue;
    const { dates, next } = recurringDue(r, now);
    if (!dates.length) continue;
    runningRecurring.add(r.id);
    generateRecurring(state.code, r, dates.map((date) => ({ date, data: recurringEntry(r, date) })), next)
      .catch((e) => console.warn('Wiederholung', e))
      .finally(() => runningRecurring.delete(r.id));
  }
}

export function stopSync() {
  clearTimeout(offlineTimer);
  offlineTimer = null;
  state.sync = 'connecting';
  unsubs.forEach((u) => u());
  unsubs = [];
  state.bookings = [];
  state.entries = [];
  state.reminders = [];
  state.recurring = [];
  state.setup = structuredClone(DEFAULT_SETUP);
  state.setupLoaded = false;
  state.members = [];
  state.config = { locked: false };
  state.invite = null;
  state.showCode = false;
}

export function setHousehold(code) {
  stopSync();
  state.error = null;
  state.code = code;
  localStorage.setItem(LS_CODE, code);
  startSync();
}

// Stellt sicher, dass dieses Gerät Mitglied ist (Beitritt ggf. mit Einladung), dann Sync starten.
export async function enterHousehold(code, invite) {
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

export async function createNewHousehold() {
  const code = generateCode(24);
  await createHousehold(code, auth.currentUser.uid, deviceLabel(), true);
  localStorage.setItem(LS_MEMBER, `${code}:${auth.currentUser.uid}`);
  setHousehold(code);
  await newInvite();
}

export async function rotateCode() {
  const newCode = generateCode(24);
  await rotateHousehold(state.code, newCode, auth.currentUser.uid, deviceLabel());
  localStorage.setItem(LS_MEMBER, `${newCode}:${auth.currentUser.uid}`);
  setHousehold(newCode);
}

export function leaveHousehold() {
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
