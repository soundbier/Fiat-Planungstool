import { carStats, consumptionSeries, kmTrend } from '../lib/model.js';
import { esc, eur, num } from '../lib/util.js';
import { cc, isCombustion, state, today, typeLabel, unit } from '../state.js';
import { carBadge, dateNum, icon } from '../ui.js';
import { barChart, lineChart, shade, sparkline, stackBar } from './charts.js';

const km = (v) => `${num.format(Math.round(v))} km`;
const r1 = (v) => num.format(Math.round(v * 10) / 10);
const fixed1 = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;

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

function kmForm(c, t) {
  return `<form class="km-form" data-car="${esc(c.id)}">
    <div class="inline-field">
      <label class="field"><span>Neuer Kilometerstand</span><input name="odometer" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${t ? num.format(t.odometer) : 'km'}" required></label>
      <button class="btn">Eintragen</button>
    </div>
  </form>`;
}

function details(c, t, s, series) {
  const u = unit(c.id);
  const comb = isCombustion(c.id);
  const fuel = comb ? 'Tanken' : 'Laden';
  const vals = series.map((p) => p.value);
  const trend = t && t.recentPerMonth != null
    ? `${km(t.recentPerMonth)}/Monat${Math.abs(t.trend) >= 0.1 ? ` <span class="trend" aria-label="${t.trend > 0 ? 'steigend' : 'fallend'}">${icon(t.trend > 0 ? 'trending-up' : 'trending-down')}</span>` : ''}`
    : '';
  const vehicle = [
    t && ['Kilometerstand', `${km(t.odometer)} <small>${dateNum(t.date)}</small>`],
    t && ['Gefahren im Zeitraum', km(t.odometer - t.startOdometer)],
    t?.perMonth != null && ['Ø pro Monat', km(t.perMonth)],
    t?.perYear != null && ['Hochgerechnet pro Jahr', km(t.perYear)],
    trend && ['Letzte 90 Tage', trend],
    vals.length && ['Letzter Verbrauch', `${r1(vals[vals.length - 1])} ${u}/100 km`],
    vals.length > 1 && ['Min / Max', `${r1(Math.min(...vals))} / ${r1(Math.max(...vals))} ${u}/100 km`]
  ];
  const costs = [
    ['Gesamtkosten', `${eur.format(s.totalCost)} <small>${s.count} ${s.count === 1 ? 'Eintrag' : 'Einträge'}</small>`],
    s.totalPer100 != null && ['Alle Kosten pro 100 km', eur.format(s.totalPer100)],
    s.costPer100 != null && [`${fuel} pro 100 km`, eur.format(s.costPer100)],
    [fuel, eur.format(s.fuelCost)],
    s.avgPrice != null && ['Ø Preis', `${num.format(s.avgPrice)} €/${u}`]
  ];
  const parts = [{ label: fuel, value: s.fuelCost }, ...s.byType].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  return `
    ${vehicle.some(Boolean) ? `<h3>Fahrzeug</h3>${kv(vehicle)}` : ''}
    <h3>Kosten</h3>${kv(costs)}
    ${parts.length > 1 ? `<h3>Kostenarten</h3>${stackBar(parts.map((p, i) => ({ ...p, color: shade(i) })))}` : ''}
    ${s.months.some((m) => m.value) ? `<h3>Kosten pro Monat</h3>${barChart(s.months, c.id)}` : ''}
    ${t && t.months.some((m) => m.value) ? `<h3>Kilometer pro Monat</h3>${barChart(t.months, c.id, km, 'Kilometer pro Monat')}` : ''}
    ${series.length > 1 ? `<h3>Verbrauch je ${comb ? 'Tankfüllung' : 'Ladung'}</h3>${lineChart(series, c.id, u)}` : ''}
    <h3>Kilometerstand</h3>
    ${kmForm(c, t)}
    ${odoList(c)}
    <p class="footnote">Ø Verbrauch: ${comb ? 'getankte' : 'geladene'} Menge ab der zweiten ${comb ? 'Tankfüllung' : 'Ladung'} im Zeitraum ÷ gefahrene km × 100.${comb ? ' Aussagekräftig nur bei Volltankungen.' : ''} Hochrechnung: gefahrene km ÷ Tage × 365.</p>`;
}

/** Ein Auto: eine Kernzahl (Ø Verbrauch), Kosten je 100 km, kleine Verlaufslinie, Details auf Wunsch */
export function renderCar(c, from) {
  const t = kmTrend(state.entries, c.id, from, today());
  const s = carStats(state.entries, c.id, from);
  const u = unit(c.id);
  const comb = isCombustion(c.id);
  const series = consumptionSeries(state.entries, c.id, comb).filter((p) => p.date >= from);
  const driven = t ? t.odometer - t.startOdometer : s.km;
  const facts = [
    s.costPer100 != null ? `${eur.format(s.costPer100)} pro 100 km` : '',
    driven > 0 ? `${km(driven)} gefahren` : ''
  ].filter(Boolean);
  const key = `car-${c.id}`;
  const open = !!state.expanded[key];
  const kpi = s.consumption != null
    ? `<p class="kpi"><span class="kpi-value">${fixed1(s.consumption)}</span><span class="kpi-unit">${u}/100 km</span></p>
       <p class="kpi-sub">Ø Verbrauch${facts.length ? ` · ${facts.join(' · ')}` : ''}</p>`
    : `<p class="kpi"><span class="kpi-value kpi-empty">–</span><span class="kpi-unit">${u}/100 km</span></p>
       <p class="kpi-sub">Verbrauch erscheint ab der zweiten ${comb ? 'Volltankung' : 'Ladung'} mit Kilometerstand.${facts.length ? ` ${facts.join(' · ')}.` : ''}</p>`;
  return `
    <section class="section"${cc(c.id)} aria-labelledby="${key}-title">
      <div class="car-stat-head">${carBadge(c.id)}<h2 id="${key}-title">${esc(c.name)}</h2></div>
      ${kpi}
      ${series.length > 1 ? sparkline(series, c.id, u) : ''}
      <button class="disclosure" data-action="toggle" data-key="${key}" aria-expanded="${open}"${open ? ` aria-controls="${key}-details"` : ''}>Details${icon('chevron-down')}</button>
      ${open ? `<div class="details" id="${key}-details">${details(c, t, s, series)}</div>` : ''}
    </section>`;
}
