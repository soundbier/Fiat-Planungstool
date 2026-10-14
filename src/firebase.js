import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

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

export function subscribe(code, name, cb, onError) {
  return onSnapshot(query(col(code, name), orderBy('date', 'desc')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError);
}

export const addItem = (code, name, data) =>
  addDoc(col(code, name), { ...data, createdAt: serverTimestamp() });
export const updateItem = (code, name, id, data) =>
  updateDoc(doc(db, 'households', code, name, id), data);
export const deleteItem = (code, name, id) =>
  deleteDoc(doc(db, 'households', code, name, id));
