import { carStats, settlement } from '../lib/model.js';
import { esc, eur } from '../lib/util.js';
import { cars, personName, state, today } from '../state.js';
import { icon, person } from '../ui.js';
import { stackBar } from './charts.js';

/** Gesamtkosten aller Autos im Zeitraum, aufgeteilt nach Auto */
export function renderCosts(from) {
  const all = cars().map((c) => ({ c, s: carStats(state.entries, c.id, from) }));
  const total = all.reduce((a, x) => a + x.s.totalCost, 0);
  if (!total) return '';
  return `
    <section class="section" aria-labelledby="costs-title">
      <h2 class="section-title" id="costs-title">Kosten</h2>
      <p class="kpi"><span class="kpi-value">${eur.format(total)}</span></p>
      <p class="kpi-sub">alle Autos im Zeitraum</p>
      ${all.length > 1 ? stackBar(all.filter((x) => x.s.totalCost > 0).map((x) => ({ label: x.c.name, value: x.s.totalCost, color: `var(--car-${x.c.id})` }))) : ''}
    </section>`;
}

const signed = (v) => (v > 0.005 ? '+' : '') + eur.format(Math.abs(v) < 0.005 ? 0 : v);

/** Wer schuldet wem: Kosten je Auto nach gebuchten Kalendertagen verteilt, gegen „Bezahlt von“ verrechnet */
export function renderSettlement(from) {
  const s = settlement({ setup: state.setup, entries: state.entries, bookings: state.bookings, from, today: today() });
  if (!s.usage.length) return '';
  const open = !!state.expanded.settlement;
  return `
    <section class="section" aria-labelledby="settle-title">
      <h2 class="section-title" id="settle-title">Abrechnung</h2>
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
