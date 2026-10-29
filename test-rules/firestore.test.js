import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const CODE = 'A'.repeat(24);
const TOKEN = 'T'.repeat(24);
const H = `households/${CODE}`;
const hours = (n) => Timestamp.fromMillis(Date.now() + n * 3600 * 1000);

let env;
beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-autoplaner',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) }
  });
});
afterAll(() => env?.cleanup());
beforeEach(() => env.clearFirestore());

/** Firestore als angemeldetes Gerät */
const as = (uid) => env.authenticatedContext(uid).firestore();
/** Daten ohne Rules anlegen */
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
/** Haushalt mit Mitglied `member` (optional gesperrt) */
const household = (locked = true, member = 'm1') => seed(async (db) => {
  await setDoc(doc(db, `${H}/members/${member}`), { device: 'Test', joinedAt: Timestamp.now() });
  if (locked !== null) await setDoc(doc(db, `${H}/meta/config`), { locked });
});

const booking = (extra = {}) => ({ date: '2026-01-05', car: 'fiat', driver: 'lukas', updatedBy: 'lukas', updatedAt: serverTimestamp(), ...extra });
const entry = (extra = {}) => ({
  car: 'citroen', type: 'fuel', date: '2026-01-05', odometer: 1000, amount: 40, cost: 70, full: true,
  note: '', createdBy: 'lukas', paidBy: 'lukas', createdAt: serverTimestamp(), ...extra
});
const reminder = (extra = {}) => ({ car: 'fiat', title: 'HU', due: '2027-01-01', intervalMonths: 24, note: '', createdBy: 'lukas', createdAt: serverTimestamp(), ...extra });
const recurring = (extra = {}) => ({
  car: 'fiat', type: 'insurance', cost: 120, note: '', paidBy: 'lukas', start: '2026-01-01', next: '2027-01-01',
  intervalMonths: 12, createdBy: 'lukas', createdAt: serverTimestamp(), ...extra
});
const setup = (extra = {}) => ({
  people: [{ id: 'lukas', name: 'Lukas' }, { id: 'marie', name: 'Marie' }],
  cars: [{ id: 'fiat', name: 'Fiat 500e', short: 'F', kind: 'electric' }],
  ...extra
});

describe('Grundsätzlich', () => {
  it('kein Zugriff auf households selbst und auf fremde Pfade', async () => {
    await household();
    await assertFails(getDoc(doc(as('m1'), H)));
    await assertFails(getDocs(collection(as('m1'), 'households')));
    await assertFails(setDoc(doc(as('m1'), 'other/x'), { a: 1 }));
  });
  it('ohne Anmeldung kein Zugriff', async () => {
    await household();
    await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), `${H}/bookings`)));
  });
  it('Nicht-Mitglieder lesen und schreiben nichts', async () => {
    await household();
    await assertFails(getDocs(collection(as('x'), `${H}/bookings`)));
    await assertFails(setDoc(doc(as('x'), `${H}/bookings/2026-01-05_fiat`), booking()));
    await assertFails(getDoc(doc(as('x'), `${H}/meta/setup`)));
  });
});

describe('Mitgliedschaft und Einladungen', () => {
  const join = (db, uid, invite) => {
    const b = writeBatch(db);
    b.set(doc(db, `${H}/members/${uid}`), { device: 'Neu', joinedAt: serverTimestamp(), ...(invite ? { invite } : {}) });
    if (invite) b.delete(doc(db, `${H}/invites/${invite}`));
    return b.commit();
  };
  const invite = (expiresAt = hours(24)) => seed((db) => setDoc(doc(db, `${H}/invites/${TOKEN}`), { createdAt: Timestamp.now(), expiresAt }));

  it('neuer Haushalt: Beitritt ohne config, danach sperren', async () => {
    const db = as('m1');
    await assertSucceeds(join(db, 'm1'));
    await assertSucceeds(setDoc(doc(db, `${H}/meta/config`), { locked: true }));
  });
  it('offener Haushalt: Beitritt mit Code', async () => {
    await household(false);
    await assertSucceeds(join(as('m2'), 'm2'));
  });
  it('gesperrt: ohne Einladung abgelehnt', async () => {
    await household(true);
    await assertFails(join(as('m2'), 'm2'));
  });
  it('gesperrt: mit gültiger Einladung, die im selben Batch gelöscht wird', async () => {
    await household(true);
    await invite();
    await assertSucceeds(join(as('m2'), 'm2', TOKEN));
    // einmalig: zweites Gerät scheitert
    await assertFails(join(as('m3'), 'm3', TOKEN));
  });
  it('Einladung muss gelöscht werden und gültig sein', async () => {
    await household(true);
    await invite();
    const db = as('m2');
    await assertFails(setDoc(doc(db, `${H}/members/m2`), { device: 'Neu', joinedAt: serverTimestamp(), invite: TOKEN }));
    await env.clearFirestore();
    await household(true);
    await invite(hours(-1));
    await assertFails(join(as('m2'), 'm2', TOKEN));
  });
  it('nur für sich selbst beitreten, Felder geprüft, kein Update', async () => {
    await household(false);
    await assertFails(join(as('m2'), 'm3'));
    await assertFails(setDoc(doc(as('m2'), `${H}/members/m2`), { device: 'x', joinedAt: serverTimestamp(), admin: true }));
    await assertFails(updateDoc(doc(as('m1'), `${H}/members/m1`), { device: 'y' }));
  });
  it('Mitglieder entfernen Geräte; Fremde nicht', async () => {
    await household();
    await seed((db) => setDoc(doc(db, `${H}/members/m2`), { device: 'B', joinedAt: Timestamp.now() }));
    await assertFails(deleteDoc(doc(as('x'), `${H}/members/m2`)));
    await assertSucceeds(deleteDoc(doc(as('m1'), `${H}/members/m2`)));
  });
  it('Einladungen: höchstens 7 Tage, nur Mitglieder', async () => {
    await household();
    const ref = (db) => doc(db, `${H}/invites/${TOKEN}`);
    await assertFails(setDoc(ref(as('x')), { createdAt: serverTimestamp(), expiresAt: hours(24) }));
    await assertFails(setDoc(ref(as('m1')), { createdAt: serverTimestamp(), expiresAt: hours(24 * 8) }));
    await assertSucceeds(setDoc(ref(as('m1')), { createdAt: serverTimestamp(), expiresAt: hours(24) }));
  });
});

describe('Stammdaten (meta/setup)', () => {
  const save = (data) => setDoc(doc(as('m1'), `${H}/meta/setup`), data);
  beforeEach(() => household());

  it('gültig', () => assertSucceeds(save(setup())));
  it.each([
    ['zusätzliches Feld', setup({ extra: 1 })],
    ['leere Personenliste', setup({ people: [] })],
    ['11 Personen', setup({ people: Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })) })],
    ['reservierte ID', setup({ people: [{ id: 'alle', name: 'Alle' }] })],
    ['ungültige ID', setup({ people: [{ id: 'Lukas!', name: 'Lukas' }] })],
    ['Name zu lang', setup({ people: [{ id: 'a', name: 'x'.repeat(21) }] })],
    ['Person mit Zusatzfeld', setup({ people: [{ id: 'a', name: 'A', admin: true }] })],
    ['Person ohne Namen', setup({ people: [{ id: 'a' }] })],
    ['Auto: falscher Antrieb', setup({ cars: [{ id: 'golf', name: 'Golf', short: 'G', kind: 'diesel' }] })],
    ['Auto: Kürzel zu lang', setup({ cars: [{ id: 'golf', name: 'Golf', short: 'GOL', kind: 'fuel' }] })],
    ['Auto an Position 10 ungültig', setup({ cars: [...Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: 'C', short: 'C', kind: 'fuel' })), { id: 'c9', name: '', short: 'C', kind: 'fuel' }] })]
  ])('abgelehnt: %s', (_, data) => assertFails(save(data)));
  it('config: nur locked', async () => {
    await assertFails(setDoc(doc(as('m1'), `${H}/meta/config`), { locked: true, x: 1 }));
    await assertFails(deleteDoc(doc(as('m1'), `${H}/meta/config`)));
  });
});

describe('Buchungen', () => {
  beforeEach(() => household());
  const ref = (id) => doc(as('m1'), `${H}/bookings/${id}`);

  it('gültig, ändern und löschen', async () => {
    await assertSucceeds(setDoc(ref('2026-01-05_fiat'), booking()));
    await assertSucceeds(setDoc(ref('2026-01-05_fiat'), booking({ driver: 'alle' })));
    await assertSucceeds(deleteDoc(ref('2026-01-05_fiat')));
  });
  it('ID muss {date}_{car} sein', () => assertFails(setDoc(ref('2026-01-06_fiat'), booking())));
  it('Felder und Zeitstempel', async () => {
    await assertFails(setDoc(ref('2026-01-05_fiat'), booking({ note: 'x' })));
    await assertFails(setDoc(ref('2026-01-05_fiat'), booking({ updatedAt: Timestamp.now() })));
    await assertFails(setDoc(ref('2026-1-5_fiat'), booking({ date: '2026-1-5' })));
  });
});

describe('Einträge', () => {
  beforeEach(() => household());
  const ref = (id = 'e1') => doc(as('m1'), `${H}/entries/${id}`);

  it('Tanken, Kilometerstand und sonstige Kosten', async () => {
    await assertSucceeds(setDoc(ref('a'), entry()));
    await assertSucceeds(setDoc(ref('b'), { car: 'fiat', type: 'odo', date: '2026-01-05', odometer: 1200, cost: 0, note: '', createdBy: 'lukas', paidBy: 'lukas', createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(ref('c'), { car: 'fiat', type: 'parking', date: '2026-01-05', cost: 4, note: '', createdBy: 'marie', paidBy: 'konto', createdAt: serverTimestamp() }));
  });
  it.each([
    ['Tanken ohne Kilometerstand', (() => { const e = entry(); delete e.odometer; return e; })()],
    ['Kilometerstand mit Kosten', { car: 'fiat', type: 'odo', date: '2026-01-05', odometer: 1, cost: 5, note: '', createdBy: 'lukas', createdAt: serverTimestamp() }],
    ['unbekannte Art', entry({ type: 'party' })],
    ['negative Kosten', entry({ cost: -1 })],
    ['Kilometerstand keine Ganzzahl', entry({ odometer: 1.5 })],
    ['Notiz zu lang', entry({ note: 'x'.repeat(301) })],
    ['zusätzliches Feld', entry({ secret: 1 })],
    ['createdAt in der Zukunft', entry({ createdAt: hours(1) })]
  ])('abgelehnt: %s', (_, data) => assertFails(setDoc(ref(), data)));
  it('createdAt aus der Vergangenheit (Code erneuern)', () => assertSucceeds(setDoc(ref(), entry({ createdAt: hours(-48) }))));
  it('bearbeiten nur mit unverändertem createdAt', async () => {
    await assertSucceeds(setDoc(ref(), entry()));
    await assertSucceeds(updateDoc(ref(), { cost: 80, note: 'neu' }));
    await assertFails(updateDoc(ref(), { createdAt: hours(-1) }));
    await assertFails(updateDoc(ref(), { cost: -5 }));
  });
});

describe('Fristen und Wiederholungen', () => {
  beforeEach(() => household());

  it('Frist anlegen, Fälligkeit ändern, createdAt bleibt', async () => {
    const ref = doc(as('m1'), `${H}/reminders/r1`);
    await assertFails(setDoc(ref, reminder({ title: '' })));
    await assertFails(setDoc(ref, reminder({ intervalMonths: 121 })));
    await assertSucceeds(setDoc(ref, reminder()));
    await assertSucceeds(updateDoc(ref, { due: '2029-01-01' }));
    await assertFails(updateDoc(ref, { createdAt: hours(-1) }));
  });
  it('Wiederholung: Tanken nicht erlaubt, nur next änderbar', async () => {
    const ref = doc(as('m1'), `${H}/recurring/w1`);
    await assertFails(setDoc(ref, recurring({ type: 'fuel' })));
    await assertFails(setDoc(ref, recurring({ intervalMonths: 0 })));
    await assertSucceeds(setDoc(ref, recurring()));
    await assertSucceeds(updateDoc(ref, { next: '2028-01-01' }));
    await assertFails(updateDoc(ref, { cost: 1 }));
  });
  it('erzeugte Einträge: zweites Gerät kann denselben Termin nicht erneut anlegen', async () => {
    const id = 'rw120270101';
    const data = { car: 'fiat', type: 'insurance', date: '2027-01-01', cost: 120, note: '', createdBy: 'lukas', paidBy: 'lukas', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(as('m1'), `${H}/entries/${id}`), data));
    await assertFails(setDoc(doc(as('m1'), `${H}/entries/${id}`), data));
  });
});
