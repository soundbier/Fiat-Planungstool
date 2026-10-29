import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, deleteDoc, deleteField, getDoc, getDocs, getDocsFromServer, setDoc, updateDoc, writeBatch, onSnapshot, query, orderBy,
  serverTimestamp, Timestamp
} from 'firebase/firestore';
import { firebaseConfig, missingConfigKeys } from './firebase-config.js';

if (missingConfigKeys.length) {
  throw new Error('Firebase-Konfiguration fehlt: ' + missingConfigKeys.join(', ') +
    '. Umgebungsvariablen VITE_FIREBASE_* setzen (siehe README).');
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  // WebChannel-Streams werden von manchen Adblockern/Proxys/Virenscannern blockiert;
  // das SDK erkennt das selbst und weicht nur dann auf Long-Polling aus (experimentalAutoDetectLongPolling, Standard).
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export function ensureAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) { unsub(); resolve(user); }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch((e) => { unsub(); reject(e); });
  });
}

const col = (code, name) => collection(db, 'households', code, name);

export function subscribeEntries(code, cb, onError) {
  return onSnapshot(query(col(code, 'entries'), orderBy('date', 'desc')), { includeMetadataChanges: true },
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap.metadata),
    onError);
}

export const addItem = (code, name, data) =>
  addDoc(col(code, name), { ...data, createdAt: serverTimestamp() });
export const deleteItem = (code, name, id) =>
  deleteDoc(doc(db, 'households', code, name, id));
// Ersetzt die Felder, ohne createdAt anzufassen (ist bei unbestätigten Einträgen lokal noch null).
// Fehlende `optional`-Felder werden entfernt.
export const editItem = (code, name, id, data, optional) =>
  updateDoc(doc(db, 'households', code, name, id), { ...Object.fromEntries(optional.map((k) => [k, deleteField()])), ...data });
export const updateItem = (code, name, id, data) =>
  updateDoc(doc(db, 'households', code, name, id), data);

export function subscribeReminders(code, cb, onError) {
  return onSnapshot(col(code, 'reminders'), { includeMetadataChanges: true },
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap.metadata), onError);
}

export function subscribeRecurring(code, cb, onError) {
  return onSnapshot(col(code, 'recurring'), { includeMetadataChanges: true },
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap.metadata), onError);
}

// Fällige Einträge einer Wiederholung anlegen. Feste IDs: erzeugen zwei Geräte gleichzeitig, scheitert das zweite (Update verboten).
export function generateRecurring(code, rec, dates, next) {
  const batch = writeBatch(db);
  for (const { date, data } of dates) {
    batch.set(doc(db, 'households', code, 'entries', `r${rec.id}${date.replace(/-/g, '')}`), { ...data, createdAt: serverTimestamp() });
  }
  batch.update(doc(db, 'households', code, 'recurring', rec.id), { next });
  return batch.commit();
}

const setupRef = (code) => doc(db, 'households', code, 'meta', 'setup');
export function subscribeSetup(code, cb, onError) {
  return onSnapshot(setupRef(code), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}
export const saveSetup = (code, setup) => setDoc(setupRef(code), setup);

export function subscribeBookings(code, cb, onError) {
  return onSnapshot(col(code, 'bookings'), { includeMetadataChanges: true },
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap.metadata),
    onError);
}

const bookingRef = (code, date, car) => doc(db, 'households', code, 'bookings', `${date}_${car}`);

// changes: [{ date, car, driver|null }]
export function setBookingsBatch(code, changes, updatedBy) {
  const batch = writeBatch(db);
  for (const { date, car, driver } of changes) {
    if (driver) batch.set(bookingRef(code, date, car), { date, car, driver, updatedBy, updatedAt: serverTimestamp() });
    else batch.delete(bookingRef(code, date, car));
  }
  return batch.commit();
}

/* ---------- Mitgliedschaft, Einladungen, Code-Rotation ---------- */

const memberRef = (code, uid) => doc(db, 'households', code, 'members', uid);
const configRef = (code) => doc(db, 'households', code, 'meta', 'config');
const inviteRef = (code, token) => doc(db, 'households', code, 'invites', token);

export async function isMember(code, uid) {
  return (await getDoc(memberRef(code, uid))).exists();
}

// Einladung wird im selben Batch verbraucht (Rules erzwingen das).
export function joinHousehold(code, uid, device, invite) {
  const batch = writeBatch(db);
  batch.set(memberRef(code, uid), { device, joinedAt: serverTimestamp(), ...(invite ? { invite } : {}) });
  if (invite) batch.delete(inviteRef(code, invite));
  return batch.commit();
}

export async function createHousehold(code, uid, device, locked = true) {
  await joinHousehold(code, uid, device, null);
  await setDoc(configRef(code), { locked });
}

export const setLocked = (code, locked) => setDoc(configRef(code), { locked });

export function subscribeConfig(code, cb, onError) {
  return onSnapshot(configRef(code), (snap) => cb(snap.exists() ? snap.data() : { locked: false }), onError);
}

export function subscribeMembers(code, cb, onError) {
  return onSnapshot(collection(db, 'households', code, 'members'),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export const removeMember = (code, uid) => deleteDoc(memberRef(code, uid));

export async function createInvite(code, token, hours = 24) {
  await setDoc(inviteRef(code, token), {
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + hours * 3600 * 1000)
  });
}

export async function revokeInvites(code) {
  const snap = await getDocs(col(code, 'invites'));
  await commitChunks(snap.docs.map((d) => (b) => b.delete(d.ref)));
  return snap.size;
}

// Import: bookings [{date,car,driver}], entries/reminders/recurring ohne id/createdAt
export function importData(code, { bookings = [], entries = [], reminders = [], recurring = [] }, updatedBy) {
  return commitChunks([
    ...bookings.map(({ date, car, driver }) => (b) => b.set(bookingRef(code, date, car),
      { date, car, driver, updatedBy, updatedAt: serverTimestamp() })),
    ...entries.map((d) => (b) => b.set(doc(col(code, 'entries')), { ...d, createdAt: serverTimestamp() })),
    ...reminders.map((d) => (b) => b.set(doc(col(code, 'reminders')), { ...d, createdAt: serverTimestamp() })),
    ...recurring.map((d) => (b) => b.set(doc(col(code, 'recurring')), { ...d, createdAt: serverTimestamp() }))
  ]);
}

async function commitChunks(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = writeBatch(db);
    ops.slice(i, i + size).forEach((op) => op(batch));
    await batch.commit();
  }
}

/** Sammlungen, die „Code erneuern“ umzieht */
const DATA = ['bookings', 'entries', 'reminders', 'recurring'];

/** Dokument für den neuen Haushalt (Zeitstempel müssen den Rules entsprechen) */
function copyData(name, data) {
  if (name === 'bookings') return { ...data, updatedAt: serverTimestamp() };
  // Einträge behalten createdAt (Reihenfolge am selben Tag), unbestätigte bekommen die Serverzeit
  if (name === 'entries') return { ...data, createdAt: data.createdAt || serverTimestamp() };
  return { ...data, createdAt: serverTimestamp() };
}

/** Fehlende Dokumente (gleiche ID) in den neuen Haushalt kopieren; liefert die Quelldokumente je Sammlung. */
async function copyMissing(oldCode, newCode) {
  const [src, dst] = await Promise.all([
    Promise.all(DATA.map((n) => getDocsFromServer(col(oldCode, n)))),
    Promise.all(DATA.map((n) => getDocsFromServer(col(newCode, n))))
  ]);
  await commitChunks(DATA.flatMap((name, i) => {
    const have = new Set(dst[i].docs.map((d) => d.id));
    // Gleiche IDs: Buchungen heißen {date}_{car}, aus Wiederholungen erzeugte Einträge r{id}{datum}
    return src[i].docs.filter((d) => !have.has(d.id))
      .map((d) => (b) => b.set(doc(db, 'households', newCode, name, d.id), copyData(name, d.data())));
  }));
  return src;
}

/** Sperre des Haushalts; ohne config ist er offen, beim Umzug wird er dann gesperrt. */
export async function getLocked(code) {
  const cfg = await getDoc(configRef(code));
  return cfg.exists() ? cfg.data().locked : true;
}

/**
 * Zieht alle Daten in einen neuen Haushalt um. Jeder Schritt ist wiederholbar, ein abgebrochener Lauf
 * wird mit denselben Codes fortgesetzt (siehe household.js):
 * 1. neuen Haushalt anlegen und kopieren, 2. alten sperren, andere Geräte und Einladungen entfernen
 * (danach schreibt dort niemand mehr), 3. Nachzügler kopieren und prüfen, 4. alten leeren und verlassen.
 */
export async function rotateHousehold(oldCode, newCode, uid, device, locked) {
  if (!(await isMember(newCode, uid))) await createHousehold(newCode, uid, device, locked);
  const setup = await getDoc(setupRef(oldCode));
  if (setup.exists()) await saveSetup(newCode, setup.data());
  await copyMissing(oldCode, newCode);
  await setDoc(configRef(oldCode), { locked: true });
  const [invites, members] = await Promise.all([getDocs(col(oldCode, 'invites')), getDocs(col(oldCode, 'members'))]);
  await commitChunks([...invites.docs, ...members.docs.filter((d) => d.id !== uid)].map((d) => (b) => b.delete(d.ref)));
  const src = await copyMissing(oldCode, newCode);
  const copied = await Promise.all(DATA.map((n) => getDocsFromServer(col(newCode, n))));
  DATA.forEach((name, i) => {
    const have = new Set(copied[i].docs.map((d) => d.id));
    const missing = src[i].docs.filter((d) => !have.has(d.id)).length;
    if (missing) throw new Error(`Umzug unvollständig (${missing} in ${name}). Alter Haushalt bleibt erhalten, bitte erneut versuchen.`);
  });
  await commitChunks(src.flatMap((s) => s.docs).map((d) => (b) => b.delete(d.ref)));
  await removeMember(oldCode, uid);
}
