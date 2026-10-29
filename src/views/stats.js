import { odometerIssues, validateEntry, weekdayUsage } from '../lib/model.js';
import { addItem } from '../firebase.js';
import { esc, isoDate, num } from '../lib/util.js';
import { cars, people, state, today } from '../state.js';
import { carBadge, icon, person, toast } from '../ui.js';
import { renderCar } from './stats-vehicle.js';
import { renderCosts, renderSettlement } from './stats-finance.js';

/* ---------- Auswertung ---------- */
export const PERIODS = [
  { id: '30', label: '30 Tage' },
  { id: 'year', label: 'Dieses Jahr' },
  { id: 'all', label: 'Alles' }
];

export function periodStart() {
  const now = new Date();
  if (state.statsPeriod === '30') return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
  if (state.statsPeriod === 'year') return `${now.getFullYear()}-01-01`;
  return '0000-00-00';
}

/** Ø gebuchte Werktage pro Woche je Person und Auto */
function renderWeekdays(from) {
  const rows = weekdayUsage({ setup: state.setup, bookings: state.bookings, from, today: today() }).filter((r) => r.weeks);
  if (!rows.length) return '';
  return `
    <section class="section" aria-labelledby="weekdays-title">
      <h2 class="section-title" id="weekdays-title">Werktage pro Woche</h2>
      <table class="table">
        <thead><tr><th scope="col"><span class="sr-only">Person</span></th>${rows.map((r) => `<th scope="col">${carBadge(r.car.id)}<span class="sr-only">${esc(r.car.name)}</span></th>`).join('')}</tr></thead>
        <tbody>${people().map((p) => `<tr><th scope="row">${person(p.id)}</th>
          ${rows.map((r) => `<td>${num.format(Math.round(r.perWeek[p.id] * 10) / 10)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="footnote">Ø gebuchte Tage Mo–Fr je Woche, ab der ersten Buchung im Zeitraum bis heute.</p>
    </section>`;
}

export function submitKm(form) {
  const res = validateEntry({ car: form.dataset.car, type: 'odo', date: today(), odometer: new FormData(form).get('odometer'), note: '' }, state.setup, state.name);
  if (res.error) return toast(res.error);
  const issues = odometerIssues(state.entries, res.data.car, res.data.date, /** @type {number} */ (res.data.odometer));
  if (issues.length && !confirm(`${issues.join('\n')}\n\nTrotzdem speichern?`)) return;
  addItem(state.code, 'entries', res.data).catch((e) => toast('Fehler: ' + e.message));
  form.reset();
  toast('Kilometerstand gespeichert');
}

export function renderStats() {
  const from = periodStart();
  const period = `<div class="seg" role="group" aria-label="Zeitraum">
    ${PERIODS.map((p) => `<button class="seg-btn" data-action="period" data-period="${p.id}" aria-pressed="${p.id === state.statsPeriod}">${p.label}</button>`).join('')}
  </div>`;
  if (state.sync === 'connecting' && !state.entries.length) return `${period}<p class="muted">Lädt …</p>`;
  if (!state.entries.length) {
    return `${period}
      <div class="empty">
        ${icon('chart-column')}
        <p class="empty-title">Noch keine Daten</p>
        <p>Sobald Tank- oder Ladevorgänge mit Kilometerstand erfasst sind, stehen hier Verbrauch und Kosten je Auto.</p>
        <button class="btn" data-action="tab" data-tab="entries">Erfassen</button>
      </div>`;
  }
  return `${period}
    ${cars().map((c) => renderCar(c, from)).join('')}
    ${renderCosts(from)}
    ${renderSettlement(from)}
    ${renderWeekdays(from)}`;
}
