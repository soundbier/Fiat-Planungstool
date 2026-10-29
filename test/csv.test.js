import { describe, it, expect } from 'vitest';
import { DEFAULT_SETUP } from '../src/lib/model.js';
import { parseCsv, entriesToCsv, entriesFromCsv, fromBackup, toBackup } from '../src/lib/csv.js';

const setup = structuredClone(DEFAULT_SETUP);

describe('parseCsv', () => {
  it('Anführungszeichen, Trenner und Zeilenumbrüche in Feldern', () => {
    expect(parseCsv('﻿"a";"b ""x""";"c;d"\r\n1;"2\n3";4\n\n')).toEqual([['a', 'b "x"', 'c;d'], ['1', '2\n3', '4']]);
  });
  it('Komma als Trenner', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('CSV-Roundtrip', () => {
  const entries = [
    { car: 'citroen', type: 'fuel', date: '2026-01-02', odometer: 1234, amount: 40.5, cost: 70.1, full: true, note: 'Semi;kolon "x"', createdBy: 'lukas', paidBy: 'marie' },
    { car: 'fiat', type: 'service', date: '2026-01-03', cost: 200, note: '', createdBy: 'marie', paidBy: 'marie' }
  ];
  it('Export → Import ergibt dieselben Einträge', () => {
    const csv = entriesToCsv(entries, setup);
    expect(csv.startsWith('﻿"Datum";"Auto";"Art"')).toBe(true);
    const res = entriesFromCsv(csv, setup, 'lukas');
    expect(res.skipped).toBe(0);
    expect(res.entries).toEqual([entries[1], entries[0]]);
  });
  it('alter Export (ohne Art/Bezahlt von) und deutsches Datum', () => {
    const csv = '"Datum";"Auto";"Kilometerstand";"Menge";"Einheit";"Kosten EUR";"Vollgetankt";"Erfasst von";"Notiz"\n'
      + '"5.1.2026";"Fiat 500e";"100";"10,5";"kWh";"4,20";"";"Marie";""\n"x";"?";"";"";"";"";"";"";""';
    const res = entriesFromCsv(csv, setup, 'lukas');
    expect(res.skipped).toBe(1);
    expect(res.entries).toEqual([{ car: 'fiat', type: 'fuel', date: '2026-01-05', odometer: 100, amount: 10.5, cost: 4.2, full: false, note: '', createdBy: 'marie', paidBy: 'marie' }]);
  });
  it('fehlende Pflichtspalten', () => {
    expect(() => entriesFromCsv('a;b\n1;2', setup, 'lukas')).toThrow(/Datum/);
  });
});

describe('Backup', () => {
  it('toBackup → fromBackup, fehlende Personen/Autos werden ergänzt', () => {
    const big = { people: [...setup.people, { id: 'tom', name: 'Tom' }], cars: [...setup.cars, { id: 'golf', name: 'Golf', short: 'G', kind: 'fuel' }] };
    const data = toBackup({
      setup: big,
      bookings: [{ id: 'x', date: '2026-01-01', car: 'golf', driver: 'tom', updatedAt: 1 }],
      entries: [{ id: 'e', createdAt: 1, car: 'golf', type: 'toll', date: '2026-01-01', cost: 9, note: '', createdBy: 'tom', paidBy: 'tom' }],
      reminders: [{ id: 'r', createdAt: 1, car: 'golf', title: 'HU', due: '2027-01-01', intervalMonths: 24, note: '', createdBy: 'tom' }],
      recurring: [{ id: 'w', createdAt: 1, car: 'golf', type: 'tax', cost: 90, note: '', paidBy: 'tom', start: '2026-01-01', next: '2027-01-01', intervalMonths: 12, createdBy: 'tom' }]
    });
    expect(data.version).toBe(3);
    expect(data.recurring[0].id).toBeUndefined();
    expect(data.bookings[0]).toEqual({ date: '2026-01-01', car: 'golf', driver: 'tom' });
    expect(data.entries[0].id).toBeUndefined();
    const res = fromBackup(JSON.parse(JSON.stringify(data)), setup, 'lukas');
    expect(res.setup.people.map((p) => p.id)).toEqual(['lukas', 'marie', 'tom']);
    expect(res.setup.cars.map((c) => c.id)).toEqual(['fiat', 'citroen', 'golf']);
    expect(res.entries).toHaveLength(1);
    expect(res.bookings).toHaveLength(1);
    expect(res.reminders).toHaveLength(1);
    expect(res.recurring).toEqual([{ car: 'golf', type: 'tax', cost: 90, note: '', paidBy: 'tom', start: '2026-01-01', next: '2027-01-01', intervalMonths: 12, createdBy: 'tom' }]);
    expect(res.skipped).toBe(0);
  });
  it('keine Änderung am Setup → setup null; Ungültiges wird gezählt', () => {
    const res = fromBackup({ app: 'autoplaner', setup, entries: [{ car: 'fiat' }], bookings: [{ date: 'x' }], reminders: [] }, setup, 'lukas');
    expect(res.setup).toBeNull();
    expect(res.recurring).toEqual([]); // ältere Backups ohne Wiederholungen
    expect(res.skipped).toBe(2);
  });
  it('fremde Datei', () => {
    expect(() => fromBackup({ foo: 1 }, setup, 'lukas')).toThrow();
  });
});
