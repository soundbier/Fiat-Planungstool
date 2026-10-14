// @ts-check
// CSV-Export/-Import und JSON-Backup (reine Funktionen).
import { pad } from './util.js';
import {
  TYPES, MAX_ITEMS, entryType, payerOf, findCarIn, sanitizeSetup, sortEntries, validateEntry, validateReminder
} from './model.js';

/** @typedef {import('./model.js').Setup} Setup */
/** @typedef {import('./model.js').Entry} Entry */
/** @typedef {import('./model.js').Booking} Booking */
/** @typedef {import('./model.js').Reminder} Reminder */
/** @typedef {{ entries: Entry[], bookings: Booking[], reminders: Reminder[], skipped: number, setup?: Setup | null }} ImportData */

export const CSV_HEAD = ['Datum', 'Auto', 'Art', 'Kilometerstand', 'Menge', 'Einheit', 'Kosten EUR', 'Vollgetankt', 'Bezahlt von', 'Erfasst von', 'Notiz'];

/**
 * @param {Entry[]} entries
 * @param {Setup} setup
 * @returns {string} CSV mit `;` und BOM (für Excel)
 */
export function entriesToCsv(entries, setup) {
  const de = (/** @type {unknown} */ n) => (n == null ? '' : String(n).replace('.', ','));
  const person = (/** @type {string} */ id) => setup.people.find((p) => p.id === id)?.name || id || '';
  /** @type {unknown[][]} */
  const rows = [CSV_HEAD];
  for (const e of sortEntries(entries)) {
    const car = findCarIn(setup, e.car);
    const fuel = entryType(e) === 'fuel';
    const electric = car?.kind === 'electric';
    rows.push([
      e.date, car?.name || e.car, TYPES.find((t) => t.id === entryType(e))?.label, e.odometer ?? '',
      fuel ? de(e.amount) : '', fuel ? (electric ? 'kWh' : 'L') : '', de(e.cost),
      fuel && !electric ? (e.full ? 'ja' : 'nein') : '', person(payerOf(e)), person(e.createdBy), e.note || ''
    ]);
  }
  return '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

/** CSV mit Anführungszeichen, `;` oder `,` als Trenner. @param {string} text @returns {string[][]} */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let cur = '', q = false;
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

/** @param {Setup} setup @param {unknown} v */
function findCar(setup, v) {
  const t = String(v || '').trim().toLowerCase();
  return setup.cars.find((c) => c.id === t || c.name.toLowerCase() === t)?.id || null;
}
/** @param {Setup} setup @param {unknown} v */
function findPerson(setup, v) {
  const t = String(v || '').trim().toLowerCase();
  return setup.people.find((p) => p.id === t || p.name.toLowerCase() === t)?.id || null;
}
/** @param {unknown} v */
function findType(v) {
  const t = String(v || '').trim().toLowerCase();
  if (!t || ['tanken', 'laden', 'tanken / laden'].includes(t)) return 'fuel';
  return TYPES.find((x) => x.id === t || x.label.toLowerCase() === t)?.id || null;
}
/** `DD.MM.YYYY` oder ISO. @param {unknown} v */
function csvDate(v) {
  const t = String(v || '').trim();
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : t;
}

/**
 * Einträge aus CSV (Format des Exports, auch ältere Exporte ohne „Art“/„Bezahlt von“).
 * @param {string} text
 * @param {Setup} setup
 * @param {string} me
 * @returns {ImportData}
 */
export function entriesFromCsv(text, setup, me) {
  const rows = parseCsv(text);
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  const col = (/** @type {string[]} */ row, /** @type {string} */ name) => { const i = head.indexOf(name.toLowerCase()); return i < 0 ? '' : row[i]; };
  if (!head.includes('datum') || !head.includes('auto')) throw new Error('CSV-Spalten „Datum“ und „Auto“ fehlen.');
  /** @type {Entry[]} */
  const entries = [];
  let skipped = 0;
  for (const r of rows) {
    const res = validateEntry({
      car: findCar(setup, col(r, 'Auto')),
      type: findType(col(r, 'Art')),
      date: csvDate(col(r, 'Datum')),
      odometer: col(r, 'Kilometerstand'),
      amount: col(r, 'Menge'),
      cost: col(r, 'Kosten EUR') || col(r, 'Kosten'),
      full: /^(ja|1|true|x)$/i.test(String(col(r, 'Vollgetankt')).trim()),
      note: col(r, 'Notiz'),
      createdBy: findPerson(setup, col(r, 'Erfasst von')),
      paidBy: findPerson(setup, col(r, 'Bezahlt von'))
    }, setup, me);
    if (res.data) entries.push(res.data); else skipped++;
  }
  return { entries, bookings: [], reminders: [], skipped };
}

/**
 * JSON-Backup prüfen. Fehlende Personen/Autos werden ergänzt (`setup` ist dann gesetzt).
 * @param {any} json
 * @param {Setup} current
 * @param {string} me
 * @returns {ImportData}
 */
export function fromBackup(json, current, me) {
  if (json?.app !== 'autoplaner') throw new Error('Keine Autoplaner-Sicherung.');
  const src = sanitizeSetup(json.setup);
  const setup = structuredClone(current);
  for (const p of src.people) if (!setup.people.some((x) => x.id === p.id)) setup.people.push(p);
  for (const c of src.cars) if (!setup.cars.some((x) => x.id === c.id)) setup.cars.push(c);
  setup.people = setup.people.slice(0, MAX_ITEMS);
  setup.cars = setup.cars.slice(0, MAX_ITEMS);
  let skipped = 0;
  /** @type {Entry[]} */ const entries = [];
  /** @type {Booking[]} */ const bookings = [];
  /** @type {Reminder[]} */ const reminders = [];
  for (const e of Array.isArray(json.entries) ? json.entries : []) {
    const res = validateEntry(e, setup, me);
    if (res.data) entries.push(res.data); else skipped++;
  }
  for (const b of Array.isArray(json.bookings) ? json.bookings : []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(b?.date) && findCarIn(setup, b.car) && setup.people.some((p) => p.id === b.driver)) {
      bookings.push({ date: b.date, car: b.car, driver: b.driver });
    } else skipped++;
  }
  for (const r of Array.isArray(json.reminders) ? json.reminders : []) {
    const res = validateReminder(r, setup, me);
    if (res.data) reminders.push(res.data); else skipped++;
  }
  const changed = JSON.stringify(setup) !== JSON.stringify(current);
  return { entries, bookings, reminders, skipped, setup: changed ? setup : null };
}

/**
 * @param {{ setup: Setup, bookings: Booking[], entries: Entry[], reminders: Reminder[] }} data
 */
export function toBackup({ setup, bookings, entries, reminders }) {
  const strip = (/** @type {any} */ { id, createdAt, ...rest }) => rest;
  return {
    app: 'autoplaner',
    version: 2,
    exportedAt: new Date().toISOString(),
    setup,
    bookings: bookings.map((b) => ({ date: b.date, car: b.car, driver: b.driver })),
    entries: entries.map(strip),
    reminders: reminders.map(strip)
  };
}
