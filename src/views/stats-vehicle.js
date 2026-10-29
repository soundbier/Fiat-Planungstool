import { carStats, consumptionSeries, kmTrend } from '../lib/model.js';
import { esc, num } from '../lib/util.js';
import { cc, isCombustion, state, today, typeLabel, unit } from '../state.js';
import { barChart, lineChart } from './charts.js';
import { fmtDate, renderWeekdays, shown, statsCars, tile, tiles } from './stats.js';

const km = (v) => `${num.format(Math.round(v))} km`;
const r1 = (v) => num.format(Math.round(v * 10) / 10);

function odoList(c) {
  const list = state.entries.filter((e) => e.car === c.id && Number.isFinite(e.odometer))
    .sort((a, b) => b.date.localeCompare(a.date) || /** @type {number} */ (b.odometer) - /** @type {number} */ (a.odometer));
  if (!list.length) return '';
  const rows = list.slice(0, 5);
  return `<h4>Letzte Kilometerstände</h4>
    <ul class="odo-list">${rows.map((e, i) => {
      const prev = list[i + 1];
      const diff = prev ? /** @type {number} */ (e.odometer) - /** @type {number} */ (prev.odometer) : null;
      return `<li>
        <span class="odo-date">${fmtDate(e.date)}</span>
        <span class="muted small-inline">${esc(typeLabel(e.type || 'fuel', c.id))}</span>
        <strong>${km(/** @type {number} */ (e.odometer))}</strong>
        <span class="muted odo-diff">${diff != null ? `+${num.format(diff)}` : ''}</span>
        <button class="icon-btn small" data-action="edit-entry" data-id="${esc(e.id)}" aria-label="Eintrag vom ${fmtDate(e.date)} bearbeiten">✎</button>
      </li>`;
    }).join('')}</ul>`;
}

function vehicleCard(c, from) {
  const t = kmTrend(state.entries, c.id, from, today());
  const s = carStats(state.entries, c.id, from);
  const u = unit(c.id);
  const series = consumptionSeries(state.entries, c.id, isCombustion(c.id)).filter((p) => p.date >= from);
  const vals = series.map((p) => p.value);
  const driven = t ? t.odometer - t.startOdometer : 0;
  const arrow = !t || Math.abs(t.trend) < 0.1 ? '→' : t.trend > 0 ? '↑' : '↓';
  const html = t ? [
    tile('odo', 'Kilometerstand', km(t.odometer), `Letzter eingetragener Stand vom ${fmtDate(t.date)} – aus Tank-, Lade- oder km-Einträgen.`, `<small>${fmtDate(t.date)}</small>`),
    tile('km', 'Gefahrene km', km(driven), `${km(t.odometer)} (${fmtDate(t.date)}) − ${km(t.startOdometer)} (${fmtDate(t.startDate)}) = ${km(driven)}`),
    t.perMonth != null ? tile('perMonth', 'Ø pro Monat', km(t.perMonth), `${km(driven)} ÷ ${t.days} Tage × 30,44 Tage`) : '',
    t.perYear != null ? tile('perYear', 'km pro Jahr', km(t.perYear), `${km(driven)} ÷ ${t.days} Tage × 365 Tage`) : '',
    t.recentPerMonth != null ? tile('trend', 'Tendenz', `${km(t.recentPerMonth)} <span class="trend ${arrow === '↑' ? 'up' : arrow === '↓' ? 'down' : ''}">${arrow}</span>`,
      `km der letzten 90 Tage, hochgerechnet auf einen Monat. ${t.perMonth ? `Gegenüber Ø ${km(t.perMonth)}: ${t.trend > 0 ? '+' : ''}${Math.round(t.trend * 100)} %.` : ''} Pfeil erst ab ±10 %.`, '<small>pro Monat</small>') : ''
  ] : [];
  html.push(
    s.consumption != null ? tile('consumption', 'Ø Verbrauch', `${r1(s.consumption)} <small>${u}/100 km</small>`,
      `${r1(s.consumedAmount)} ${u} ÷ ${km(s.fuelKm)} × 100. Die erste ${isCombustion(c.id) ? 'Tankfüllung' : 'Ladung'} im Zeitraum zählt nicht mit, weil unklar ist, wofür sie verbraucht wurde.${isCombustion(c.id) ? ' Stimmt nur bei jedem Mal Volltanken.' : ''}`) : '',
    vals.length ? tile('lastConsumption', 'Letzter Verbrauch', `${r1(vals[vals.length - 1])} <small>${u}/100 km</small>`, `Menge der letzten ${isCombustion(c.id) ? 'Tankfüllung' : 'Ladung'} ÷ km seit der vorherigen × 100 (${fmtDate(series[series.length - 1].date)}).`) : '',
    vals.length > 1 ? tile('minmax', 'Min / Max', `${r1(Math.min(...vals))} / ${r1(Math.max(...vals))}`, `Niedrigster und höchster Verbrauch einzelner ${isCombustion(c.id) ? 'Tankfüllungen' : 'Ladungen'} im Zeitraum.`, `<small>${u}/100 km</small>`) : ''
  );
  return `
    <section class="card car-card cc"${cc(c.id)}>
      <div class="card-head">
        <h3>${esc(c.name)}</h3>
        <form class="km-form inline" data-car="${esc(c.id)}">
          <input name="odometer" inputmode="numeric" pattern="[0-9]*" placeholder="${t ? num.format(t.odometer) : 'Gesamt-km'}" aria-label="Neuer Kilometerstand ${esc(c.name)}" required>
          <button class="btn primary sm">km eintragen</button>
        </form>
      </div>
      ${tiles(html.join('')) || '<p class="muted">Noch keine Kilometerstände im Zeitraum.</p>'}
      ${shown('kmChart') && t && t.months.some((m) => m.value) ? `<h4>Kilometer pro Monat</h4>${barChart(t.months, c.id, km, 'Kilometer pro Monat')}` : ''}
      ${shown('consChart') && series.length > 1 ? `<h4>Verbrauch je ${isCombustion(c.id) ? 'Tankfüllung' : 'Ladung'}</h4>${lineChart(series, c.id, u)}` : ''}
      ${shown('odoList') ? odoList(c) : ''}
    </section>`;
}

export function renderVehicle(from) {
  return `${statsCars().map((c) => vehicleCard(c, from)).join('')}${renderWeekdays(from)}`;
}
