import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, deleteDoc, writeBatch, onSnapshot, query, orderBy, serverTimestamp
} from 'firebase/firestore';
import { firebaseConfig, missingConfigKeys } from './firebase-config.js';

if (missingConfigKeys.length) {
  throw new Error('Firebase-Konfiguration fehlt: ' + missingConfigKeys.join(', ') +
    '. Umgebungsvariablen VITE_FIREBASE_* setzen (siehe README).');
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
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
  return onSnapshot(query(col(code, 'entries'), orderBy('date', 'desc')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError);
}

export const addItem = (code, name, data) =>
  addDoc(col(code, name), { ...data, createdAt: serverTimestamp() });
export const deleteItem = (code, name, id) =>
  deleteDoc(doc(db, 'households', code, name, id));

export function subscribeBookings(code, cb, onError) {
  return onSnapshot(col(code, 'bookings'),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
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
