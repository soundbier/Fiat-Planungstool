import { carStats, settlement } from '../lib/model.js';
import { esc, eur, num } from '../lib/util.js';
import { cars, cc, isCombustion, personName, state, today, unit } from '../state.js';
import { carBadge, icon, kv, person } from '../ui.js';
import { barChart, shade, stackBar } from './charts.js';

/** Kosten eines Autos: Summe, je 100 km, Details mit Kostenarten und Verlauf */
function carCosts(c, s) {
  const u = unit(c.id);
  const fuel = isCombustion(c.id) ? 'Tanken' : 'Laden';
  const key = `cost-${c.id}`;
  const open = !!state.expanded[key];
  const parts = [{ label: fuel, value: s.fuelCost }, ...s.byType].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const sub = [
    `${s.count} ${s.count === 1 ? 'Eintrag' : 'Einträge'}`,
    s.totalPer100 != null ? `${eur.format(s.totalPer100)} pro 100 km` : ''
  ].filter(Boolean).join(' · ');
  return `
    <section class="section"${cc(c.id)} aria-labelledby="${key}-title">
      <div class="car-stat-head">${carBadge(c.id)}<h3 id="${key}-title">${esc(c.name)}</h3><strong class="car-stat-end">${eur.format(s.totalCost)}</strong></div>
      <p class="kpi-sub">${sub}</p>
      <button class="disclosure" data-action="toggle" data-key="${key}" aria-expanded="${open}"${open ? ` aria-controls="${key}-details"` : ''}>Details${icon('chevron-down')}</button>
      ${open ? `<div class="details" id="${key}-details">
        ${kv([
          [fuel, eur.format(s.fuelCost)],
          s.costPer100 != null && [`${fuel} pro 100 km`, eur.format(s.costPer100)],
          s.avgPrice != null && ['Ø Preis', `${num.format(s.avgPrice)} €/${u}`],
          s.totalPer100 != null && ['Alle Kosten pro 100 km', eur.format(s.totalPer100)]
        ])}
        ${parts.length > 1 ? `<h4>Kostenarten</h4>${stackBar(parts.map((p, i) => ({ ...p, color: shade(i) })))}` : ''}
        ${s.months.some((m) => m.value) ? `<h4>Kosten pro Monat</h4>${barChart(s.months, c.id)}` : ''}
      </div>` : ''}
    </section>`;
}

const signed = (v) => (v > 0.005 ? '+' : '') + eur.format(Math.abs(v) < 0.005 ? 0 : v);

/** Wer schuldet wem: Kosten je Auto nach gebuchten Kalendertagen verteilt, gegen „Bezahlt von“ verrechnet */
function renderSettlement(from) {
  const s = settlement({ setup: state.setup, entries: state.entries, bookings: state.bookings, from, today: today() });
  if (!s.usage.length) return '';
  const open = !!state.expanded.settlement;
  return `
    <section class="section" aria-labelledby="settle-title">
      <h3 class="section-title" id="settle-title">Abrechnung</h3>
      ${s.transfers.length
        ? `<ul class="transfers">${s.transfers.map((t) => `<li class="transfer">
            ${person(t.from)}<span class="sr-only">zahlt an</span>${icon('arrow-right')}${person(t.to)}<strong>${eur.format(t.v)}</strong></li>`).join('')}</ul>`
        : `<p class="settled">${icon('check')}Ausgeglichen</p>`}
      <button class="disclosure" data-action="toggle" data-key="settlement" aria-expanded="${open}"${open ? ' aria-controls="settle-details"' : ''}>Berechnung${icon('chevron-down')}</button>
      ${open ? `<div class="details" id="settle-details">
        ${s.ids.map((i) => `<div class="settle-person">
          <div class="settle-head">${person(i)}<strong>${signed(s.balance[i])}</strong></div>
          <p class="row-sub">Gezahlt ${eur.format(s.paid[i])} · Anteil ${eur.format(s.share[i])}</p>
        </div>`).join('')}
        <p class="footnote">${s.usage.map((u) => `${esc(u.car.name)}: ${u.total
          ? s.ids.filter((i) => u.days[i]).map((i) => `${esc(personName(i))} ${u.days[i]} ${u.days[i] === 1 ? 'Tag' : 'Tage'}`).join(', ')
          : 'keine Buchungen, gleich verteilt'}`).join(' · ')}</p>
        <p class="footnote">Die Kosten jedes Autos werden nach gebuchten Kalendertagen bis heute aufgeteilt. „Bezahlt von“ legt fest, wer ausgelegt hat.</p>
      </div>` : ''}
    </section>`;
}

/** Bereich Kosten: Summe aller Autos, je Auto, Abrechnung */
export function renderCosts(from) {
  const all = cars().map((c) => ({ c, s: carStats(state.entries, c.id, from) })).filter((x) => x.s.totalCost > 0);
  if (!all.length) return '';
  const total = all.reduce((a, x) => a + x.s.totalCost, 0);
  return `
    <section class="area" aria-labelledby="area-costs">
      <h2 class="area-title" id="area-costs">Kosten</h2>
      <div>
        <p class="kpi"><span class="kpi-value">${eur.format(total)}</span></p>
        <p class="kpi-sub">alle Autos im Zeitraum</p>
      </div>
      ${all.map((x) => carCosts(x.c, x.s)).join('')}
      ${renderSettlement(from)}
    </section>`;
}
