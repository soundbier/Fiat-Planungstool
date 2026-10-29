import { describe, it, expect } from 'vitest';
import {
  kmTrend, weekdayUsage,
  ALL, SHARED, DEFAULT_SETUP, sanitizeSetup, slugId, validateEntry, validateReminder, sortEntries, lastOdometer, odometerIssues,
  carStats, monthlyCosts, settlement, dueIn, dueReminders, intervalLabel, entryKey
} from '../src/lib/model.js';

const setup = structuredClone(DEFAULT_SETUP);
const fuel = (date, odometer, amount, cost, extra = {}) =>
  ({ car: 'citroen', type: 'fuel', date, odometer, amount, cost, full: true, note: '', createdBy: 'lukas', ...extra });

describe('Stammdaten', () => {
  it('slugId: Umlaute, Akzente, Eindeutigkeit', () => {
    expect(slugId('Jörg', [])).toBe('joerg');
    expect(slugId('Citroën C3', [])).toBe('citroenc3');
    expect(slugId('Marie', ['marie', 'marie2'])).toBe('marie3');
    expect(slugId('!!!', [])).toBe('x');
  });
  it('sanitizeSetup filtert ungültige und doppelte IDs', () => {
    const s = sanitizeSetup({
      people: [{ id: 'a', name: ' Anna ' }, { id: 'a', name: 'Doppelt' }, { id: 'B<', name: 'Böse' }, { id: 'c', name: '' }],
      cars: [{ id: 'golf', name: 'Golf', kind: 'electric' }, { id: 'x', name: 'X', kind: 'diesel' }]
    });
    expect(s.people).toEqual([{ id: 'a', name: 'Anna' }]);
    expect(s.cars).toEqual([
      { id: 'golf', name: 'Golf', short: 'G', kind: 'electric' },
      { id: 'x', name: 'X', short: 'X', kind: 'fuel' }
    ]);
  });
  it('sanitizeSetup fällt auf Standard zurück', () => {
    expect(sanitizeSetup(null)).toEqual(DEFAULT_SETUP);
    expect(sanitizeSetup({ people: [], cars: [{ id: 'a', name: 'A' }] })).toEqual(DEFAULT_SETUP);
  });
});

describe('validateEntry', () => {
  it('Tanken mit Komma-Zahlen', () => {
    const r = validateEntry({ car: 'citroen', type: 'fuel', date: '2026-01-02', odometer: '1234', amount: '40,456', cost: '70,129', full: 'on', note: ' n ' }, setup, 'marie');
    expect(r.data).toEqual({ car: 'citroen', type: 'fuel', date: '2026-01-02', odometer: 1234, amount: 40.46, cost: 70.13, full: true, note: 'n', createdBy: 'marie', paidBy: 'marie' });
  });
  it('Elektroauto: full immer false', () => {
    const r = validateEntry({ car: 'fiat', date: '2026-01-02', odometer: 1, amount: 10, cost: 3, full: true }, setup, 'lukas');
    expect(r.data.full).toBe(false);
    expect(r.data.type).toBe('fuel');
  });
  it('Andere Kostenarten ohne Menge und Kilometerstand', () => {
    const r = validateEntry({ car: 'fiat', type: 'parking', date: '2026-01-02', cost: '4', amount: '99', paidBy: 'marie' }, setup, 'lukas');
    expect(r.data).toEqual({ car: 'fiat', type: 'parking', date: '2026-01-02', cost: 4, note: '', createdBy: 'lukas', paidBy: 'marie' });
  });
  it.each([
    [{ car: 'nope', date: '2026-01-02', cost: 1 }, 'Bitte Auto wählen'],
    [{ car: 'fiat', type: 'x', date: '2026-01-02', cost: 1 }, 'Ungültige Art'],
    [{ car: 'fiat', type: 'other', date: '2.1.2026', cost: 1 }, 'Ungültiges Datum'],
    [{ car: 'fiat', type: 'fuel', date: '2026-01-02', amount: 1, cost: 1 }, 'Kilometerstand fehlt'],
    [{ car: 'fiat', type: 'other', date: '2026-01-02', odometer: '1,5', cost: 1 }, 'Ungültiger Kilometerstand'],
    [{ car: 'fiat', type: 'fuel', date: '2026-01-02', odometer: 1, amount: 0, cost: 1 }, 'Ungültige Menge'],
    [{ car: 'fiat', type: 'other', date: '2026-01-02', cost: -1 }, 'Ungültige Kosten'],
    [{ car: 'fiat', type: 'other', date: '2026-01-02', cost: '' }, 'Ungültige Kosten']
  ])('Fehler %#', (input, msg) => {
    expect(validateEntry(input, setup, 'lukas').error).toBe(msg);
  });
});

describe('validateReminder', () => {
  it('gültig', () => {
    expect(validateReminder({ car: 'fiat', title: ' HU ', due: '2027-01-01', intervalMonths: '24' }, setup, 'lukas').data)
      .toEqual({ car: 'fiat', title: 'HU', due: '2027-01-01', intervalMonths: 24, note: '', createdBy: 'lukas' });
  });
  it('Fehler', () => {
    expect(validateReminder({ car: 'fiat', title: '', due: '2027-01-01' }, setup, 'lukas').error).toBeTruthy();
    expect(validateReminder({ car: 'fiat', title: 'x', due: '' }, setup, 'lukas').error).toBeTruthy();
    expect(validateReminder({ car: 'fiat', title: 'x', due: '2027-01-01', intervalMonths: 500 }, setup, 'lukas').error).toBeTruthy();
  });
});

describe('Kilometerstand', () => {
  const entries = [fuel('2026-01-01', 1000, 40, 70), fuel('2026-02-01', 1600, 35, 60), fuel('2026-03-01', 2200, 30, 55)];
  it('lastOdometer', () => {
    expect(lastOdometer(entries, 'citroen')).toBe(2200);
    expect(lastOdometer(entries, 'fiat')).toBe(-1);
  });
  it('plausibler Wert', () => {
    expect(odometerIssues(entries, 'citroen', '2026-03-10', 2500)).toEqual([]);
    expect(odometerIssues(entries, 'citroen', '2026-01-15', 1300)).toEqual([]);
  });
  it('kleiner als vorheriger Eintrag', () => {
    expect(odometerIssues(entries, 'citroen', '2026-03-10', 2100)[0]).toMatch(/kleiner als am 01\.03\.2026/);
  });
  it('größer als späterer Eintrag', () => {
    expect(odometerIssues(entries, 'citroen', '2026-01-15', 1700)[0]).toMatch(/größer als beim späteren Eintrag/);
  });
  it('großer Sprung und km pro Tag', () => {
    expect(odometerIssues(entries, 'citroen', '2027-01-01', 9000)[0]).toMatch(/großer Sprung/);
    expect(odometerIssues(entries, 'citroen', '2026-03-02', 4200)[0]).toMatch(/km pro Tag/);
  });
});

describe('Auswertung', () => {
  const entries = [
    fuel('2026-01-01', 1000, 40, 70),
    fuel('2026-02-01', 1500, 30, 60),
    fuel('2026-03-01', 2000, 35, 63),
    { car: 'citroen', type: 'service', date: '2026-02-10', odometer: 1200, cost: 200, note: '', createdBy: 'marie' },
    { car: 'fiat', type: 'parking', date: '2026-02-10', cost: 5, note: '', createdBy: 'marie' }
  ];
  it('carStats: Verbrauch ohne ersten Tankvorgang', () => {
    const s = carStats(entries, 'citroen', '0000-00-00');
    expect(s.count).toBe(4);
    expect(s.km).toBe(1000);
    expect(s.consumption).toBeCloseTo(6.5); // (30 + 35) / 1000 km
    expect(s.costPer100).toBeCloseTo(12.3);
    expect(s.totalCost).toBe(393);
    expect(s.totalPer100).toBeCloseTo(39.3);
    expect(s.avgPrice).toBeCloseTo(193 / 105);
    expect(s.byType).toEqual([{ id: 'service', label: 'Werkstatt / Service', value: 200 }]);
  });
  it('carStats: Zeitraum und leere Daten', () => {
    expect(carStats(entries, 'citroen', '2026-02-05').count).toBe(2);
    const empty = carStats([], 'fiat', '0000-00-00');
    expect(empty.consumption).toBeNull();
    expect(empty.months).toEqual([]);
  });
  it('monthlyCosts füllt leere Monate', () => {
    const m = monthlyCosts([fuel('2025-11-03', 1, 1, 10), fuel('2026-01-20', 2, 1, 5)]);
    expect(m.map((x) => [x.key, x.value])).toEqual([['2025-11', 10], ['2025-12', 0], ['2026-01', 5]]);
  });
  it('sortEntries: neueste zuerst', () => {
    expect(sortEntries(entries).map((e) => e.date)).toEqual(['2026-03-01', '2026-02-10', '2026-02-10', '2026-02-01', '2026-01-01']);
  });
});

describe('settlement', () => {
  const base = { setup, from: '2026-01-01', today: '2026-01-31' };
  const e = (car, cost, payer) => ({ car, type: 'other', date: '2026-01-10', cost, note: '', createdBy: 'lukas', paidBy: payer });
  const b = (date, car, driver) => ({ date, car, driver });
  it('verteilt nach gebuchten Tagen', () => {
    const s = settlement({ ...base, entries: [e('citroen', 90, 'lukas')],
      bookings: [b('2026-01-01', 'citroen', 'lukas'), b('2026-01-02', 'citroen', 'marie'), b('2026-01-03', 'citroen', 'marie')] });
    expect(s.share).toEqual({ lukas: 30, marie: 60 });
    expect(s.balance).toEqual({ lukas: 60, marie: -60 });
    expect(s.transfers).toEqual([{ from: 'marie', to: 'lukas', v: 60 }]);
  });
  it('ohne Buchungen gleich verteilt; zukünftige Buchungen zählen nicht', () => {
    const s = settlement({ ...base, entries: [e('fiat', 50, 'marie')], bookings: [b('2026-02-15', 'fiat', 'lukas')] });
    expect(s.share).toEqual({ lukas: 25, marie: 25 });
    expect(s.transfers).toEqual([{ from: 'lukas', to: 'marie', v: 25 }]);
  });
  it('ausgeglichen → keine Überweisung', () => {
    const s = settlement({ ...base, entries: [e('fiat', 10, 'lukas'), e('citroen', 10, 'marie')], bookings: [] });
    expect(s.transfers).toEqual([]);
  });
  it('drei Personen, mehrere Überweisungen', () => {
    const s3 = { people: [...setup.people, { id: 'tom', name: 'Tom' }], cars: setup.cars };
    const s = settlement({ ...base, setup: s3, entries: [e('fiat', 90, 'tom')], bookings: [] });
    expect(s.transfers).toEqual([{ from: 'lukas', to: 'tom', v: 30 }, { from: 'marie', to: 'tom', v: 30 }]);
  });
  it('Zahler, die nicht mehr existieren, zählen anteilig für alle', () => {
    const s = settlement({ ...base, entries: [e('fiat', 40, 'weg')], bookings: [] });
    expect(s.paid).toEqual({ lukas: 20, marie: 20 });
    expect(s.transfers).toEqual([]);
  });
  it('alte Einträge ohne paidBy nutzen createdBy', () => {
    const s = settlement({ ...base, entries: [{ car: 'fiat', date: '2026-01-05', cost: 10, note: '', createdBy: 'marie' }], bookings: [] });
    expect(s.paid.marie).toBe(10);
  });
});

describe('Fristen', () => {
  const r = (due) => ({ car: 'fiat', title: 't', due, intervalMonths: 0, note: '', createdBy: 'lukas' });
  it('dueIn / dueReminders', () => {
    expect(dueIn(r('2026-10-20'), '2026-10-14')).toBe(6);
    const list = [r('2027-01-01'), r('2026-11-10'), r('2026-10-01')];
    expect(dueReminders(list, '2026-10-14').map((x) => x.due)).toEqual(['2026-10-01', '2026-11-10']);
  });
  it('intervalLabel', () => {
    expect(intervalLabel(0)).toBe('einmalig');
    expect(intervalLabel(1)).toBe('monatlich');
    expect(intervalLabel(6)).toBe('alle 6 Monate');
    expect(intervalLabel(12)).toBe('jährlich');
    expect(intervalLabel(24)).toBe('alle 2 Jahre');
  });
  it('entryKey erkennt Duplikate unabhängig von id/createdAt', () => {
    const a = fuel('2026-01-01', 1, 2, 3);
    expect(entryKey({ ...a, id: 'x', createdAt: 1 })).toBe(entryKey(a));
    expect(entryKey({ ...a, type: undefined })).toBe(entryKey(a));
  });
});

describe('Gemeinschaftskonto / Alle', () => {
  it('teilt Konto-Zahlungen und Alle-Tage auf alle auf', () => {
    const s = settlement({
      setup: DEFAULT_SETUP, today: '2026-01-31', from: '2026-01-01',
      entries: [{ car: 'fiat', date: '2026-01-05', cost: 100, createdBy: 'lukas', paidBy: SHARED, note: '' }],
      bookings: [{ date: '2026-01-02', car: 'fiat', driver: ALL }, { date: '2026-01-03', car: 'fiat', driver: 'lukas' }]
    });
    expect(s.paid).toEqual({ lukas: 50, marie: 50 });
    expect(s.share.lukas).toBeCloseTo(66.67);
    expect(s.transfers).toHaveLength(1);
  });
});

import { consumptionSeries, recurringDue, recurringFromEntry, recurringEntry, bookingConflict } from '../src/lib/model.js';

describe('Verbrauch je Tankvorgang', () => {
  it('Verbrenner: nur zwischen Volltankungen, Teilbetankungen aufaddiert', () => {
    const list = [
      fuel('2026-01-01', 1000, 40, 70),
      fuel('2026-01-10', 1300, 10, 18, { full: false }),
      fuel('2026-01-20', 1500, 20, 35, { id: 'b' })
    ];
    expect(consumptionSeries(list, 'citroen', true)).toEqual([{ id: 'b', date: '2026-01-20', km: 500, value: 6 }]);
  });
  it('Elektro: jeder Ladevorgang zählt', () => {
    const e = (d, o, a) => ({ ...fuel(d, o, a, 5), car: 'fiat', full: false });
    expect(consumptionSeries([e('2026-01-01', 0, 10), e('2026-01-05', 100, 15)], 'fiat', false).map((p) => p.value)).toEqual([15]);
  });
});

describe('Wiederkehrende Kosten', () => {
  const entry = { car: 'fiat', type: 'insurance', date: '2026-01-31', cost: 50, note: 'HUK', createdBy: 'lukas', paidBy: 'konto' };
  it('aus Eintrag', () => {
    const r = recurringFromEntry(entry, 1).data;
    expect(r).toMatchObject({ start: '2026-01-31', next: '2026-02-28', intervalMonths: 1, paidBy: 'konto' });
    expect(recurringFromEntry({ ...entry, type: 'fuel' }, 1).error).toBeTruthy();
    expect(recurringFromEntry(entry, 0).error).toBeTruthy();
  });
  it('fällige Termine ohne wandernde Monatsenden', () => {
    const r = recurringFromEntry(entry, 1).data;
    expect(recurringDue(r, '2026-04-15')).toEqual({ dates: ['2026-02-28', '2026-03-31'], next: '2026-04-30' });
    expect(recurringDue({ ...r, next: '2026-04-30' }, '2026-04-15').dates).toEqual([]);
    expect(recurringEntry(r, '2026-02-28')).toEqual({ ...entry, date: '2026-02-28' });
  });
});

describe('Buchungskonflikt', () => {
  const b = { date: '2026-01-01', car: 'fiat', driver: 'marie', updatedBy: 'marie' };
  it('erkennt fremde Buchung', () => {
    expect(bookingConflict(b, 'lukas', 'lukas')).toBe('marie');
    expect(bookingConflict(b, null, 'lukas')).toBe('marie');
    expect(bookingConflict(null, 'lukas', 'lukas')).toBeNull();
    expect(bookingConflict({ ...b, updatedBy: 'lukas' }, 'lukas', 'lukas')).toBeNull();
    expect(bookingConflict(b, 'lukas', 'marie')).toBeNull();
  });
});

describe('Kilometer und Werktage', () => {
  const odo = (date, odometer) => ({ car: 'fiat', type: 'odo', date, odometer, cost: 0, note: '', createdBy: 'lukas' });
  it('validateEntry: Kilometerstand ohne Kosten', () => {
    expect(validateEntry({ car: 'fiat', type: 'odo', date: '2026-01-01', odometer: '1234', cost: '9' }, setup, 'lukas').data)
      .toMatchObject({ type: 'odo', odometer: 1234, cost: 0 });
    expect(validateEntry({ car: 'fiat', type: 'odo', date: '2026-01-01' }, setup, 'lukas').error).toMatch(/Kilometerstand/);
  });
  it('kmTrend: pro Monat und Tendenz', () => {
    const t = kmTrend([odo('2026-01-01', 1000), odo('2026-02-01', 1310), odo('2026-07-20', 3000)], 'fiat', '0000-00-00', '2026-08-01');
    expect(t.odometer).toBe(3000);
    expect(t.perYear).toBeCloseTo(2000 / 200 * 365);
    expect(t.months.find((m) => m.key === '2026-02').value).toBe(310);
    expect(t.recentPerMonth).not.toBeNull();
    expect(kmTrend([], 'fiat', '0000-00-00', '2026-08-01')).toBeNull();
  });
  it('weekdayUsage: nur Mo–Fr', () => {
    // 2026-01-05 = Montag; 2 Wochen bis Fr 2026-01-16
    const b = (date, driver) => ({ date, car: 'fiat', driver });
    const r = weekdayUsage({ setup, from: '0000-00-00', today: '2026-01-16',
      bookings: [b('2026-01-05', 'lukas'), b('2026-01-06', 'lukas'), b('2026-01-10', 'lukas'), b('2026-01-12', 'alle')] });
    const fiat = r.find((x) => x.car.id === 'fiat');
    expect(fiat.weeks).toBe(2);
    expect(fiat.perWeek).toEqual({ lukas: 1.5, marie: 0.5 });
  });
});
