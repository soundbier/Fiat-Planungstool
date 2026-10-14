import { auth, createHousehold, createInvite, isMember, joinHousehold, removeMember, rotateHousehold, subscribeBookings, subscribeConfig, subscribeEntries, subscribeMembers, subscribeReminders, subscribeSetup } from './firebase.js';
import { DEFAULT_SETUP, sanitizeSetup } from './lib/model.js';
import { generateCode } from './lib/util.js';
import { render } from './render.js';
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

export function startSync() {
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

export function stopSync() {
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
