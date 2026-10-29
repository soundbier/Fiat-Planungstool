import { carStats } from '../lib/model.js';
import { esc, eur, num } from '../lib/util.js';
import { cars, cc, isCombustion, state, unit } from '../state.js';
import { barChart, stackBar } from './charts.js';
import { renderSettlement, shown, statsCars, tile, tiles } from './stats.js';

function financeCard(c, from) {
  const s = carStats(state.entries, c.id, from);
  const u = unit(c.id);
  const fuel = isCombustion(c.id) ? 'Tanken' : 'Laden';
  const html = [
    tile('totalCost', 'Gesamtkosten', eur.format(s.totalCost), `Summe aller ${s.count} Einträge im Zeitraum.`, `<small>${s.count} Einträge</small>`),
    s.totalPer100 != null ? tile('totalPer100', 'Kosten / 100 km', eur.format(s.totalPer100), `${eur.format(s.totalCost)} ÷ ${num.format(s.km)} km × 100 – alle Kosten, auch Versicherung, Werkstatt usw.`) : '',
    s.costPer100 != null ? tile('energyPer100', 'Energie / 100 km', eur.format(s.costPer100), `${eur.format(s.consumedCost)} ÷ ${num.format(s.fuelKm)} km × 100 – nur ${fuel}, ohne die erste Füllung im Zeitraum.`) : '',
    tile('fuelCost', fuel, eur.format(s.fuelCost), `Summe aller ${fuel}-Einträge mit Kilometerstand im Zeitraum.`),
    s.avgPrice != null ? tile('avgPrice', 'Ø Preis', `${num.format(s.avgPrice)} <small>€/${u}</small>`, `${eur.format(s.fuelCost)} ÷ ${num.format(s.fuelAmount)} ${u} getankte/geladene Menge`) : ''
  ];
  const parts = [{ label: fuel, value: s.fuelCost }, ...s.byType].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  return `
    <section class="card car-card cc"${cc(c.id)}>
      <div class="card-head"><h3>${esc(c.name)}</h3></div>
      ${tiles(html.join('')) || '<p class="muted">Keine Kosten im Zeitraum.</p>'}
      ${shown('breakdown') && parts.length ? `<h4>Aufteilung nach Kostenart</h4>${stackBar(parts)}` : ''}
      ${shown('costChart') ? `<h4>Kosten pro Monat</h4>${barChart(s.months, c.id)}` : ''}
    </section>`;
}

export function renderFinance(from) {
  const list = statsCars();
  const overall = state.statsCar === 'all' && cars().length > 1 && shown('overall')
    ? (() => {
      const all = list.map((c) => ({ c, s: carStats(state.entries, c.id, from) }));
      const total = all.reduce((a, x) => a + x.s.totalCost, 0);
      return `<section class="card">
        <div class="tile-label">Summe aller Autos</div>
        <div class="stat-big">${eur.format(total)}</div>
        ${stackBar(all.map((x) => ({ label: x.c.name, value: x.s.totalCost })).filter((p) => p.value > 0))}
      </section>`;
    })()
    : '';
  return `${overall}${list.map((c) => financeCard(c, from)).join('')}${renderSettlement(from)}`;
}
