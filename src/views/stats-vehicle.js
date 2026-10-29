import { carStats, consumptionSeries, kmTrend } from '../lib/model.js';
import { esc, num } from '../lib/util.js';
import { cc, isCombustion, state, today, typeLabel, unit } from '../state.js';
import { carBadge, dateNum, icon, kv } from '../ui.js';
import { barChart, lineChart } from './charts.js';

const km = (v) => `${num.format(Math.round(v))} km`;
const r1 = (v) => num.format(Math.round(v * 10) / 10);
const fixed1 = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function odoList(c) {
  const list = state.entries.filter((e) => e.car === c.id && Number.isFinite(e.odometer))
    .sort((a, b) => b.date.localeCompare(a.date) || /** @type {number} */ (b.odometer) - /** @type {number} */ (a.odometer));
  if (!list.length) return '';
  return `<ul class="rows">${list.slice(0, 5).map((e, i) => {
    const prev = list[i + 1];
    const diff = prev ? /** @type {number} */ (e.odometer) - /** @type {number} */ (prev.odometer) : null;
    return `<li><button class="row" data-action="edit-entry" data-id="${esc(e.id)}">
      <span class="row-main"><span class="row-title">${km(/** @type {number} */ (e.odometer))}</span><span class="row-sub">${dateNum(e.date)} · ${esc(typeLabel(e.type || 'fuel', c.id))}</span></span>
      <span class="row-end">${diff != null ? `+${num.format(diff)} km` : ''}</span>
    </button></li>`;
  }).join('')}</ul>`;
}

const trendIcon = (t) => (t && t.recentPerMonth != null && Math.abs(t.trend) >= 0.1
  ? ` <span class="trend" aria-label="${t.trend > 0 ? 'steigend' : 'fallend'}">${icon(t.trend > 0 ? 'trending-up' : 'trending-down')}</span>`
  : '');

function details(c, t, series) {
  const u = unit(c.id);
  const comb = isCombustion(c.id);
  const vals = series.map((p) => p.value);
  const rows = [
    t && ['Kilometerstand', `${km(t.odometer)} <small>${dateNum(t.date)}</small>`],
    t && ['Gefahren im Zeitraum', km(t.odometer - t.startOdometer)],
    t?.perMonth != null && ['Ø pro Monat', km(t.perMonth)],
    t?.perYear != null && ['Hochgerechnet pro Jahr', km(t.perYear)],
    t?.recentPerMonth != null && ['Letzte 90 Tage', `${km(t.recentPerMonth)}/Monat${trendIcon(t)}`],
    vals.length && ['Letzter Verbrauch', `${r1(vals[vals.length - 1])} ${u}/100 km`],
    vals.length > 1 && ['Min / Max', `${r1(Math.min(...vals))} / ${r1(Math.max(...vals))} ${u}/100 km`]
  ];
  return `
    ${rows.some(Boolean) ? kv(rows) : ''}
    ${series.length > 1 ? `<h4>Verbrauch je ${comb ? 'Tankfüllung' : 'Ladung'}</h4>${lineChart(series, c.id, u)}` : ''}
    ${t ? `<h4>Letzte Kilometerstände</h4>${odoList(c)}` : ''}
    <p class="footnote">Ø Verbrauch: ${comb ? 'getankte' : 'geladene'} Menge im Zeitraum ÷ km seit der ${comb ? 'Tankfüllung' : 'Ladung'} davor × 100.${comb ? ' Aussagekräftig nur bei Volltankungen.' : ''} km pro Monat: zwischen zwei Kilometerständen gleichmäßig verteilt. Hochrechnung: gefahrene km ÷ Tage × 365.</p>`;
}

/** Ein Auto, nur Fahrzeugdaten: Verbrauch, km pro Monat mit Tendenz, Details auf Wunsch */
export function renderCar(c, from) {
  const t = kmTrend(state.entries, c.id, from, today());
  const s = carStats(state.entries, c.id, from);
  const u = unit(c.id);
  const comb = isCombustion(c.id);
  const series = consumptionSeries(state.entries, c.id, comb).filter((p) => p.date >= from);
  const key = `car-${c.id}`;
  const open = !!state.expanded[key];
  const head = `<div class="car-stat-head">${carBadge(c.id)}<h3 id="${key}-title">${esc(c.name)}</h3></div>`;
  if (!t && !series.length) {
    return `
      <section class="section"${cc(c.id)} aria-labelledby="${key}-title">
        ${head}
        <p class="muted">Noch kein Kilometerstand im Zeitraum.</p>
        <button class="btn-quiet" data-action="tab" data-tab="entries">Kilometerstand erfassen</button>
      </section>`;
  }
  const sub = t ? `Stand ${km(t.odometer)} am ${dateNum(t.date)} · ${km(t.odometer - t.startOdometer)} im Zeitraum` : '';
  return `
    <section class="section"${cc(c.id)} aria-labelledby="${key}-title">
      ${head}
      <div class="kpis">
        <div>
          <p class="kpi-sub">Ø Verbrauch</p>
          <p class="kpi">${s.consumption != null
            ? `<span class="kpi-value">${fixed1(s.consumption)}</span><span class="kpi-unit">${u}/100 km</span>`
            : `<span class="kpi-value kpi-empty">–</span><span class="kpi-unit">${u}/100 km</span>`}</p>
        </div>
        <div>
          <p class="kpi-sub">Ø pro Monat</p>
          <p class="kpi">${t?.perMonth != null
            ? `<span class="kpi-value">${num.format(Math.round(t.perMonth))}</span><span class="kpi-unit">km${trendIcon(t)}</span>`
            : '<span class="kpi-value kpi-empty">–</span><span class="kpi-unit">km</span>'}</p>
        </div>
      </div>
      ${sub ? `<p class="kpi-sub">${sub}</p>` : ''}
      ${s.consumption == null ? `<p class="kpi-sub">Verbrauch erscheint ab der zweiten ${comb ? 'Volltankung' : 'Ladung'} mit Kilometerstand.</p>` : ''}
      ${t && t.months.some((m) => m.value) ? `
        <h4>Kilometer pro Monat</h4>
        ${barChart(t.months, c.id, km, 'Kilometer pro Monat', t.perMonth || 0)}
        ${t.perMonth ? `<p class="chart-legend"><i class="avg-swatch" aria-hidden="true"></i>Ø ${km(t.perMonth)} pro Monat</p>` : ''}` : ''}
      <button class="disclosure" data-action="toggle" data-key="${key}" aria-expanded="${open}"${open ? ` aria-controls="${key}-details"` : ''}>Details${icon('chevron-down')}</button>
      ${open ? `<div class="details" id="${key}-details">${details(c, t, series)}</div>` : ''}
    </section>`;
}
