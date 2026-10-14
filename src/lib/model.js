// @ts-check
// Fachlogik: Stammdaten, Validierung, Auswertung, Abrechnung. Ohne DOM/Firebase, daher testbar.
import { DATE_RE, parseNum, round2, daysBetween } from './util.js';

/** @typedef {import('./util.js').IsoDate} IsoDate */
/** @typedef {{ id: string, name: string }} Person */
/** @typedef {'electric' | 'fuel'} CarKind */
/** @typedef {{ id: string, name: string, short: string, kind: CarKind }} Car */
/** @typedef {{ people: Person[], cars: Car[] }} Setup */
/** @typedef {'fuel' | 'service' | 'parking' | 'toll' | 'insurance' | 'tax' | 'other'} EntryType */
/**
 * Kosteneintrag. `type` fehlt bei alten Einträgen (= fuel), `paidBy` fehlt bei alten (= createdBy).
 * @typedef {{
 *   id?: string, car: string, type?: EntryType, date: IsoDate, odometer?: number, amount?: number,
 *   cost: number, full?: boolean, note: string, createdBy: string, paidBy?: string, createdAt?: unknown
 * }} Entry
 */
/** @typedef {{ id?: string, date: IsoDate, car: string, driver: string }} Booking */
/** @typedef {{ id?: string, car: string, title: string, due: IsoDate, intervalMonths: number, note: string, createdBy: string }} Reminder */
/** @template T @typedef {{ data: T, error?: undefined } | { error: string, data?: undefined }} Result */

export const ID_RE = /^[a-z0-9]{1,20}$/;
export const MAX_ITEMS = 10;
export const DUE_SOON_DAYS = 30;
/** Ab dieser Differenz zum vorherigen Eintrag wird beim Kilometerstand nachgefragt. */
export const MAX_KM_JUMP = 5000;

/** @type {Setup} */
export const DEFAULT_SETUP = {
  people: [{ id: 'lukas', name: 'Lukas' }, { id: 'marie', name: 'Marie' }],
  cars: [
    { id: 'fiat', name: 'Fiat 500e', short: 'F', kind: 'electric' },
    { id: 'citroen', name: 'Citroën', short: 'C', kind: 'fuel' }
  ]
};

/** @type {{ id: EntryType, label: string }[]} */
export const TYPES = [
  { id: 'fuel', label: 'Tanken / Laden' },
  { id: 'service', label: 'Werkstatt / Service' },
  { id: 'parking', label: 'Parken' },
  { id: 'toll', label: 'Maut / Vignette' },
  { id: 'insurance', label: 'Versicherung' },
  { id: 'tax', label: 'Kfz-Steuer' },
  { id: 'other', label: 'Sonstiges' }
];

/** @type {[string, number][]} */
export const REMINDER_PRESETS = [
  ['HU / TÜV', 24], ['Inspektion / Service', 12], ['Reifenwechsel', 6], ['Versicherung', 12],
  ['Kfz-Steuer', 12], ['Ölwechsel', 12], ['Bremsflüssigkeit', 24], ['Vignette', 12]
];

/** @param {Entry} e @returns {EntryType} */
export function entryType(e) { return e.type || 'fuel'; }
/** @param {Entry} e */
export function payerOf(e) { return e.paidBy || e.createdBy; }
/** @param {Setup} setup @param {string} id */
export function findCarIn(setup, id) { return setup.cars.find((c) => c.id === id) || null; }

/** URL-/CSS-sichere ID aus einem Namen, eindeutig gegenüber `taken`. @param {string} name @param {string[]} taken */
export function slugId(name, taken) {
  const base = String(name).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 16) || 'x';
  let id = base, i = 2;
  while (taken.includes(id)) id = base + i++;
  return id;
}

/**
 * Gespeicherte Stammdaten prüfen (Rules validieren die Listen nur grob). Ungültiges fällt auf DEFAULT_SETUP zurück.
 * @param {any} s
 * @returns {Setup}
 */
export function sanitizeSetup(s) {
  const seen = new Set();
  const ok = (/** @type {any} */ x) => x && ID_RE.test(x.id) && typeof x.name === 'string' && x.name.trim()
    && !seen.has(x.id) && seen.add(x.id);
  const ps = (Array.isArray(s?.people) ? s.people : []).filter(ok)
    .map((/** @type {any} */ p) => ({ id: p.id, name: p.name.trim().slice(0, 20) }));
  seen.clear();
  const cs = (Array.isArray(s?.cars) ? s.cars : []).filter(ok).map((/** @type {any} */ c) => ({
    id: c.id, name: c.name.trim().slice(0, 30),
    short: String(c.short || c.name.trim()[0]).slice(0, 2),
    kind: /** @type {CarKind} */ (c.kind === 'electric' ? 'electric' : 'fuel')
  }));
  return ps.length && cs.length ? { people: ps.slice(0, MAX_ITEMS), cars: cs.slice(0, MAX_ITEMS) } : structuredClone(DEFAULT_SETUP);
}

/**
 * Prüft Eingaben (Formular, CSV, Backup) und liefert ein regelkonformes Dokument (siehe firestore.rules).
 * @param {any} r Rohdaten, Zahlen dürfen Strings mit Komma sein
 * @param {Setup} setup
 * @param {string} me ID der erfassenden Person (Fallback)
 * @returns {Result<Entry>}
 */
export function validateEntry(r, setup, me) {
  const car = findCarIn(setup, r?.car);
  if (!car) return { error: 'Bitte Auto wählen' };
  const type = r.type || 'fuel';
  if (!TYPES.some((t) => t.id === type)) return { error: 'Ungültige Art' };
  const date = String(r.date || '');
  if (!DATE_RE.test(date)) return { error: 'Ungültiges Datum' };
  const odoRaw = String(r.odometer ?? '').trim();
  const odometer = odoRaw === '' ? null : Number(odoRaw);
  if (odometer !== null && !(Number.isInteger(odometer) && odometer >= 0 && odometer < 10000000)) return { error: 'Ungültiger Kilometerstand' };
  if (type === 'fuel' && odometer === null) return { error: 'Kilometerstand fehlt' };
  const amount = parseNum(r.amount);
  if (type === 'fuel' && !(amount > 0 && amount < 10000)) return { error: 'Ungültige Menge' };
  const cost = parseNum(r.cost);
  if (!(cost >= 0 && cost < 100000)) return { error: 'Ungültige Kosten' };
  const self = ID_RE.test(me) ? me : setup.people[0].id;
  const createdBy = ID_RE.test(r.createdBy || '') ? r.createdBy : self;
  /** @type {Entry} */
  const data = {
    car: car.id, type, date,
    cost: round2(cost),
    note: String(r.note || '').trim().slice(0, 300),
    createdBy,
    paidBy: ID_RE.test(r.paidBy || '') ? r.paidBy : createdBy
  };
  if (odometer !== null) data.odometer = odometer;
  if (type === 'fuel') {
    data.amount = round2(amount);
    data.full = car.kind !== 'electric' ? r.full === true || r.full === 'on' : false;
  }
  return { data };
}

/**
 * @param {any} r
 * @param {Setup} setup
 * @param {string} me
 * @returns {Result<Reminder>}
 */
export function validateReminder(r, setup, me) {
  if (!findCarIn(setup, r?.car)) return { error: 'Bitte Auto wählen' };
  const title = String(r.title || '').trim().slice(0, 80);
  if (!title) return { error: 'Bitte angeben, was fällig ist' };
  if (!DATE_RE.test(String(r.due || ''))) return { error: 'Ungültiges Datum' };
  const intervalMonths = Number(r.intervalMonths) || 0;
  if (!(Number.isInteger(intervalMonths) && intervalMonths >= 0 && intervalMonths <= 120)) return { error: 'Ungültige Wiederholung' };
  return { data: {
    car: r.car, title, due: r.due, intervalMonths,
    note: String(r.note || '').trim().slice(0, 300),
    createdBy: ID_RE.test(r.createdBy || '') ? r.createdBy : me
  } };
}

/** Neueste zuerst. @param {Entry[]} list */
export function sortEntries(list) {
  /** @param {Entry} e */
  const ms = (e) => /** @type {any} */ (e.createdAt)?.toMillis?.() ?? Infinity;
  return [...list].sort((a, b) =>
    b.date.localeCompare(a.date) || ((b.odometer ?? 0) - (a.odometer ?? 0)) || (ms(b) - ms(a)));
}

/** Höchster bekannter Kilometerstand, -1 wenn keiner. @param {Entry[]} entries @param {string} car */
export function lastOdometer(entries, car) {
  return entries
    .filter((e) => e.car === car && Number.isFinite(e.odometer))
    .reduce((max, e) => Math.max(max, /** @type {number} */ (e.odometer)), -1);
}

/**
 * Plausibilität eines Kilometerstands gegenüber den Einträgen davor und danach.
 * @param {Entry[]} entries
 * @param {string} car
 * @param {IsoDate} date
 * @param {number} odometer
 * @returns {string[]} Warnungen (leer = plausibel)
 */
export function odometerIssues(entries, car, date, odometer) {
  const list = entries.filter((e) => e.car === car && Number.isFinite(e.odometer));
  const before = list.filter((e) => e.date <= date);
  const after = list.filter((e) => e.date > date);
  const prev = before.reduce((/** @type {Entry | null} */ best, e) =>
    (!best || /** @type {number} */ (e.odometer) > /** @type {number} */ (best.odometer) ? e : best), null);
  const next = after.reduce((/** @type {Entry | null} */ best, e) =>
    (!best || /** @type {number} */ (e.odometer) < /** @type {number} */ (best.odometer) ? e : best), null);
  const fmt = (/** @type {number} */ n) => n.toLocaleString('de-DE');
  /** @type {string[]} */
  const out = [];
  if (prev && odometer < /** @type {number} */ (prev.odometer)) {
    out.push(`Kilometerstand kleiner als am ${prev.date.split('-').reverse().join('.')} (${fmt(/** @type {number} */ (prev.odometer))} km)`);
  }
  if (next && odometer > /** @type {number} */ (next.odometer)) {
    out.push(`Kilometerstand größer als beim späteren Eintrag am ${next.date.split('-').reverse().join('.')} (${fmt(/** @type {number} */ (next.odometer))} km)`);
  }
  if (prev && odometer >= /** @type {number} */ (prev.odometer)) {
    const diff = odometer - /** @type {number} */ (prev.odometer);
    const days = Math.max(1, daysBetween(prev.date, date));
    if (diff > MAX_KM_JUMP) out.push(`Ungewöhnlich großer Sprung: +${fmt(diff)} km seit letztem Eintrag`);
    else if (diff / days > 1500) out.push(`Unrealistisch: ${fmt(Math.round(diff / days))} km pro Tag seit letztem Eintrag`);
  }
  return out;
}

/** @param {Entry[]} list */
export function monthlyCosts(list) {
  if (!list.length) return [];
  const dates = list.map((e) => e.date).sort();
  let [y, m] = dates[0].split('-').map(Number);
  const [ey, em] = dates[dates.length - 1].split('-').map(Number);
  /** @type {{ key: string, label: string, value: number }[]} */
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push({
      key,
      label: new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }),
      value: list.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.cost, 0)
    });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Kennzahlen eines Autos ab `from`. Verbrauch aus Tank-/Ladeeinträgen: Menge ab dem zweiten Eintrag / gefahrene km.
 * @param {Entry[]} entries
 * @param {string} car
 * @param {IsoDate} from
 */
export function carStats(entries, car, from) {
  const all = entries.filter((e) => e.car === car && e.date >= from);
  const fuel = all.filter((e) => entryType(e) === 'fuel' && Number.isFinite(e.odometer))
    .sort((a, b) => /** @type {number} */ (a.odometer) - /** @type {number} */ (b.odometer) || a.date.localeCompare(b.date));
  const sum = (/** @type {Entry[]} */ l, /** @type {'cost' | 'amount'} */ k) => l.reduce((s, e) => s + (e[k] || 0), 0);
  const totalCost = sum(all, 'cost');
  const fuelCost = sum(fuel, 'cost');
  const fuelAmount = sum(fuel, 'amount');
  const odos = /** @type {number[]} */ (all.map((e) => e.odometer).filter(Number.isFinite));
  const km = odos.length > 1 ? Math.max(...odos) - Math.min(...odos) : 0;
  const fuelKm = fuel.length > 1 ? /** @type {number} */ (fuel[fuel.length - 1].odometer) - /** @type {number} */ (fuel[0].odometer) : 0;
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

/**
 * Kosten je Auto nach gebuchten Kalendertagen (bis `today`) verteilen und gegen Gezahltes verrechnen.
 * Ohne Buchungen wird gleich verteilt. Von entfernten Personen bezahlte Kosten gelten als von allen anteilig bezahlt.
 * @param {{ setup: Setup, entries: Entry[], bookings: Booking[], from: IsoDate, today: IsoDate }} p
 */
export function settlement({ setup, entries, bookings, from, today }) {
  const ids = setup.people.map((p) => p.id);
  /** @returns {Record<string, number>} */
  const zero = () => Object.fromEntries(ids.map((i) => [i, 0]));
  const paid = zero(), share = zero();
  /** @type {{ car: Car, days: Record<string, number>, total: number }[]} */
  const usage = [];
  let unassigned = 0;
  for (const c of setup.cars) {
    const list = entries.filter((e) => e.car === c.id && e.date >= from);
    const cost = list.reduce((s, e) => s + e.cost, 0);
    for (const e of list) {
      const p = payerOf(e);
      if (p in paid) paid[p] += e.cost; else unassigned += e.cost;
    }
    if (!cost) continue;
    const days = zero();
    for (const b of bookings) {
      if (b.car === c.id && b.date >= from && b.date <= today && b.driver in days) days[b.driver]++;
    }
    const total = Object.values(days).reduce((a, b) => a + b, 0);
    for (const i of ids) share[i] += total ? cost * days[i] / total : cost / ids.length;
    usage.push({ car: c, days, total });
  }
  if (unassigned) for (const i of ids) paid[i] += unassigned / ids.length;
  const balance = Object.fromEntries(ids.map((i) => [i, paid[i] - share[i]]));
  const debt = ids.filter((i) => balance[i] < -0.005).map((i) => ({ id: i, v: -balance[i] })).sort((a, b) => b.v - a.v);
  const cred = ids.filter((i) => balance[i] > 0.005).map((i) => ({ id: i, v: balance[i] })).sort((a, b) => b.v - a.v);
  /** @type {{ from: string, to: string, v: number }[]} */
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

/** @param {Reminder} r @param {IsoDate} today */
export function dueIn(r, today) { return daysBetween(today, r.due); }
/** Überfällige und bald fällige Fristen, früheste zuerst. @param {Reminder[]} list @param {IsoDate} today */
export function dueReminders(list, today) {
  return list.filter((r) => dueIn(r, today) <= DUE_SOON_DAYS).sort((a, b) => a.due.localeCompare(b.due));
}
/** @param {number} n */
export function intervalLabel(n) {
  if (!n) return 'einmalig';
  if (n % 12 === 0) return n === 12 ? 'jährlich' : `alle ${n / 12} Jahre`;
  return n === 1 ? 'monatlich' : `alle ${n} Monate`;
}

/** Schlüssel zum Erkennen doppelter Einträge beim Import. @param {Entry} e */
export const entryKey = (e) => [e.car, entryType(e), e.date, e.odometer ?? '', e.cost, e.amount ?? ''].join('|');
/** @param {Reminder} r */
export const reminderKey = (r) => [r.car, r.title, r.due].join('|');
