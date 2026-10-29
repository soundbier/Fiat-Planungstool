import { odometerIssues, settlement, validateEntry, weekdayUsage } from '../lib/model.js';
import { addItem } from '../firebase.js';
import { toast } from '../ui.js';
import { esc, eur, isoDate, num } from '../lib/util.js';
import { cars, cc, pc, personName, prefs, setPref, state, today } from '../state.js';
import { renderVehicle } from './stats-vehicle.js';
import { renderFinance } from './stats-finance.js';

/* ---------- Stats ---------- */
export const PERIODS = [
  { id: '30', label: '30 Tage' },
  { id: 'year', label: 'Jahr' },
  { id: 'all', label: 'Alles' }
];

export function periodStart() {
  const now = new Date();
  if (state.statsPeriod === '30') return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
  if (state.statsPeriod === 'year') return `${now.getFullYear()}-01-01`;
  return '0000-00-00';
}

export function renderSettlement(from) {
  if (!shown('settlement')) return '';
  const s = settlement({ setup: state.setup, entries: state.entries, bookings: state.bookings, from, today: today() });
  if (!s.usage.length) return '';
  return `
    <section class="card">
      <h3>Abrechnung</h3>
      <table class="settle">
        <tr><th>Person</th><th>Gezahlt</th><th>Anteil</th><th>Saldo</th></tr>
        ${s.ids.map((i) => `<tr><td><i class="dot pc"${pc(i)}></i> ${esc(personName(i))}</td>
          <td>${eur.format(s.paid[i])}</td><td>${eur.format(s.share[i])}</td>
          <td class="${s.balance[i] > 0.005 ? 'pos' : s.balance[i] < -0.005 ? 'neg' : ''}">${eur.format(s.balance[i])}</td></tr>`).join('')}
      </table>
      ${s.transfers.length
        ? `<ul class="kv">${s.transfers.map((t) => `<li><span>${esc(personName(t.from))} → ${esc(personName(t.to))}</span><strong>${eur.format(t.v)}</strong></li>`).join('')}</ul>`
        : '<p class="muted small">Alles ausgeglichen.</p>'}
      <p class="muted small">${s.usage.map((u) => `${esc(u.car.name)}: ${u.total
        ? s.ids.filter((i) => u.days[i]).map((i) => `${esc(personName(i))} ${u.days[i]} T`).join(', ')
        : 'keine Buchungen – gleich verteilt'}`).join(' · ')}</p>
      <p class="hint">Die Kosten jedes Autos werden nach gebuchten Kalendertagen (bis heute) aufgeteilt. „Bezahlt von“ legt fest, wer ausgelegt hat.</p>
    </section>`;
}

export function renderWeekdays(from) {
  if (!shown('weekdays')) return '';
  const rows = weekdayUsage({ setup: state.setup, bookings: state.bookings, from, today: today() }).filter((r) => r.weeks);
  if (!rows.length) return '';
  const ids = state.setup.people.map((p) => p.id);
  return `
    <section class="card">
      <h3>Werktage pro Woche</h3>
      <table class="settle">
        <tr><th>Person</th>${rows.map((r) => `<th>${esc(r.car.name)}</th>`).join('')}</tr>
        ${ids.map((i) => `<tr><td><i class="dot pc"${pc(i)}></i> ${esc(personName(i))}</td>
          ${rows.map((r) => `<td>${num.format(Math.round(r.perWeek[i] * 10) / 10)}</td>`).join('')}</tr>`).join('')}
      </table>
      <p class="hint">Ø gebuchte Tage Mo–Fr je Woche, ab der ersten Buchung im Zeitraum bis heute.</p>
    </section>`;
}

export function submitKm(form) {
  const res = validateEntry({ car: form.dataset.car, type: 'odo', date: today(), odometer: new FormData(form).get('odometer'), note: '' }, state.setup, state.name);
  if (res.error) return toast(res.error);
  const issues = odometerIssues(state.entries, res.data.car, res.data.date, /** @type {number} */ (res.data.odometer));
  if (issues.length && !confirm(`${issues.join('\n')}\n\nTrotzdem speichern?`)) return;
  addItem(state.code, 'entries', res.data).catch((e) => toast('Fehler: ' + e.message));
  toast('Kilometerstand gespeichert');
}

export const STATS_TABS = [
  { id: 'vehicle', label: 'Fahrzeug & km' },
  { id: 'finance', label: 'Finanzen' }
];

/** Einstellbare Kennzahlen (Kacheln) und Abschnitte je Reiter */
export const METRICS = {
  vehicle: [
    { id: 'odo', label: 'Kilometerstand' },
    { id: 'km', label: 'Gefahrene km' },
    { id: 'perMonth', label: 'Ø km pro Monat' },
    { id: 'perYear', label: 'Hochrechnung pro Jahr' },
    { id: 'trend', label: 'Tendenz (90 Tage)' },
    { id: 'consumption', label: 'Ø Verbrauch' },
    { id: 'lastConsumption', label: 'Letzter Verbrauch' },
    { id: 'minmax', label: 'Min / Max Verbrauch' },
    { id: 'kmChart', label: 'Diagramm: km pro Monat' },
    { id: 'consChart', label: 'Diagramm: Verbrauch' },
    { id: 'odoList', label: 'Letzte Kilometerstände' },
    { id: 'weekdays', label: 'Werktage pro Woche' }
  ],
  finance: [
    { id: 'overall', label: 'Summe aller Autos' },
    { id: 'totalCost', label: 'Gesamtkosten' },
    { id: 'totalPer100', label: 'Kosten pro 100 km' },
    { id: 'energyPer100', label: 'Energiekosten pro 100 km' },
    { id: 'fuelCost', label: 'Tanken / Laden' },
    { id: 'avgPrice', label: 'Ø Preis' },
    { id: 'breakdown', label: 'Aufteilung nach Kostenart' },
    { id: 'costChart', label: 'Diagramm: Kosten pro Monat' },
    { id: 'settlement', label: 'Abrechnung' }
  ]
};

export const shown = (id) => !prefs.statsHidden.includes(id);

export function toggleMetric(id, on) {
  setPref('statsHidden', on ? prefs.statsHidden.filter((x) => x !== id) : [...prefs.statsHidden, id]);
}

export const fmtDate = (d) => d.split('-').reverse().join('.');

/** Kennzahl-Kachel; `explain` erklärt die Berechnung hinter dem ⓘ. */
export function tile(id, label, value, explain = '', extra = '') {
  if (!shown(id)) return '';
  return `<div class="tile">
    <div class="tile-head"><span class="tile-label">${label}</span>${explain ? `<details class="explain"><summary aria-label="Berechnung: ${label}">i</summary><p>${explain}</p></details>` : ''}</div>
    <div class="tile-val">${value}</div>${extra}
  </div>`;
}

export function tiles(html) { return html.trim() ? `<div class="tiles">${html}</div>` : ''; }

/** Gefilterte Autos (Filter „Alle“ oder ein bestimmtes Auto) */
export function statsCars() {
  const list = cars();
  return state.statsCar === 'all' ? list : list.filter((c) => c.id === state.statsCar);
}

function renderCustomize() {
  return `
    <section class="card customize">
      <div class="card-head"><h3>Angezeigte Kennzahlen</h3><button class="btn link" data-action="stats-reset">Alle zeigen</button></div>
      <div class="checks">
        ${METRICS[state.statsTab].map((m) => `<label class="check"><input type="checkbox" data-metric="${m.id}"${shown(m.id) ? ' checked' : ''}><span>${m.label}</span></label>`).join('')}
      </div>
    </section>`;
}

export function renderStats() {
  if (state.statsCar !== 'all' && !cars().some((c) => c.id === state.statsCar)) state.statsCar = 'all';
  const from = periodStart();
  const seg = (items, cur, action, key) => items.map((p) => `<button class="seg-opt btn-seg ${p.id === cur ? 'active' : ''}" data-action="${action}" data-${key}="${esc(p.id)}" aria-pressed="${p.id === cur}">${esc(p.label)}</button>`).join('');
  return `
    <div class="stats-tabs seg" role="group" aria-label="Auswertung">${seg(STATS_TABS, state.statsTab, 'stats-tab', 'tab')}</div>
    <section class="card toolbar">
      <div class="seg seg-sm">${seg(PERIODS, state.statsPeriod, 'period', 'period')}</div>
      ${cars().length > 1 ? `<div class="chips">
        <button class="fchip ${state.statsCar === 'all' ? 'active' : ''}" data-action="stats-car" data-car="all" aria-pressed="${state.statsCar === 'all'}">Alle</button>
        ${cars().map((c) => `<button class="fchip cc ${state.statsCar === c.id ? 'active' : ''}"${cc(c.id)} data-action="stats-car" data-car="${esc(c.id)}" aria-pressed="${state.statsCar === c.id}"><i class="dot"></i>${esc(c.name)}</button>`).join('')}
      </div>` : ''}
      <button class="btn link customize-btn ${state.statsCustomize ? 'active' : ''}" data-action="stats-customize" aria-expanded="${state.statsCustomize}">${state.statsCustomize ? 'Fertig' : 'Anpassen'}</button>
    </section>
    ${state.statsCustomize ? renderCustomize() : ''}
    ${state.statsTab === 'finance' ? renderFinance(from) : renderVehicle(from)}`;
}
