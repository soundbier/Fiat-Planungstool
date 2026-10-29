import { isoDate } from '../lib/util.js';
import { cars, state } from '../state.js';
import { icon } from '../ui.js';
import { renderCar } from './stats-vehicle.js';
import { renderUsage } from './stats-usage.js';
import { renderCosts } from './stats-finance.js';

/* ---------- Auswertung: Fahrzeuge, Nutzung, Kosten (von oben nach unten) ---------- */
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

export function renderStats() {
  const from = periodStart();
  const period = `<div class="seg" role="group" aria-label="Zeitraum">
    ${PERIODS.map((p) => `<button class="seg-btn" data-action="period" data-period="${p.id}" aria-pressed="${p.id === state.statsPeriod}">${p.label}</button>`).join('')}
  </div>`;
  const empty = !state.entries.length && !state.bookings.length;
  if (state.sync === 'connecting' && empty) return `${period}<p class="muted">Lädt …</p>`;
  if (empty) {
    return `${period}
      <div class="empty">
        ${icon('chart-column')}
        <p class="empty-title">Noch keine Daten</p>
        <p>Sobald Kilometerstände, Tank- oder Ladevorgänge oder Buchungen erfasst sind, stehen hier Fahrzeugdaten, Nutzung und Kosten je Auto.</p>
        <button class="btn" data-action="tab" data-tab="entries">Erfassen</button>
      </div>`;
  }
  return `${period}
    <section class="area" aria-labelledby="area-cars">
      <h2 class="area-title" id="area-cars">Fahrzeuge</h2>
      ${cars().map((c) => renderCar(c, from)).join('')}
    </section>
    ${renderUsage(from)}
    ${renderCosts(from)}`;
}
