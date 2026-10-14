import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, deleteDoc, getDoc, getDocs, setDoc, updateDoc, writeBatch, onSnapshot, query, orderBy,
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
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  // WebChannel-Streams werden von manchen Adblockern/Proxys/Virenscannern blockiert.
  experimentalForceLongPolling: true
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

// Import: bookings [{date,car,driver}], entries/reminders ohne id/createdAt
export function importData(code, { bookings = [], entries = [], reminders = [] }, updatedBy) {
  return commitChunks([
    ...bookings.map(({ date, car, driver }) => (b) => b.set(bookingRef(code, date, car),
      { date, car, driver, updatedBy, updatedAt: serverTimestamp() })),
    ...entries.map((d) => (b) => b.set(doc(col(code, 'entries')), { ...d, createdAt: serverTimestamp() })),
    ...reminders.map((d) => (b) => b.set(doc(col(code, 'reminders')), { ...d, createdAt: serverTimestamp() }))
  ]);
}

async function commitChunks(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = writeBatch(db);
    ops.slice(i, i + size).forEach((op) => op(batch));
    await batch.commit();
  }
}

// Kopiert alle Daten in einen neuen Haushalt, sperrt den alten und entfernt dort Daten und Geräte.
export async function rotateHousehold(oldCode, newCode, uid, device) {
  const [cfg, setup, reminders, bookings, entries, invites, members] = await Promise.all([
    getDoc(configRef(oldCode)),
    getDoc(setupRef(oldCode)),
    getDocs(col(oldCode, 'reminders')),
    getDocs(col(oldCode, 'bookings')),
    getDocs(col(oldCode, 'entries')),
    getDocs(col(oldCode, 'invites')),
    getDocs(col(oldCode, 'members'))
  ]);
  await createHousehold(newCode, uid, device, cfg.exists() ? cfg.data().locked : true);
  if (setup.exists()) await saveSetup(newCode, setup.data());
  await commitChunks([
    ...bookings.docs.map((d) => (b) => b.set(doc(db, 'households', newCode, 'bookings', d.id),
      { ...d.data(), updatedAt: serverTimestamp() })),
    ...entries.docs.map((d) => (b) => b.set(doc(col(newCode, 'entries')),
      { ...d.data(), createdAt: serverTimestamp() })),
    ...reminders.docs.map((d) => (b) => b.set(doc(col(newCode, 'reminders')),
      { ...d.data(), createdAt: serverTimestamp() }))
  ]);
  await setDoc(configRef(oldCode), { locked: true });
  await commitChunks([...bookings.docs, ...entries.docs, ...reminders.docs, ...invites.docs].map((d) => (b) => b.delete(d.ref)));
  const others = members.docs.filter((d) => d.id !== uid);
  await commitChunks(others.map((d) => (b) => b.delete(d.ref)));
  await removeMember(oldCode, uid);
}
