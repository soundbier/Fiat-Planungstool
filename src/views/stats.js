import { carStats, settlement } from '../lib/model.js';
import { esc, eur, isoDate, num } from '../lib/util.js';
import { cars, cc, isCombustion, pc, personName, state, today, unit } from '../state.js';

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

export function barChart(months, car) {
  if (!months.length) return '<p class="muted">Keine Daten.</p>';
  const barW = 28, gap = 10, h = 140, top = 18, bottom = 22;
  const max = Math.max(1, ...months.map((m) => m.value));
  const width = months.length * (barW + gap) + gap;
  const bars = months.map((m, i) => {
    const bh = (m.value / max) * (h - top - bottom);
    const x = gap + i * (barW + gap);
    const y = h - bottom - bh;
    return `<g>
      <title>${esc(m.label)}: ${eur.format(m.value)}</title>
      <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(bh, m.value > 0 ? 1 : 0)}" rx="2" class="bar cc"/>
      ${m.value > 0 ? `<text x="${x + barW / 2}" y="${y - 4}" class="bar-val">${Math.round(m.value)}</text>` : ''}
      <text x="${x + barW / 2}" y="${h - 6}" class="bar-lbl">${esc(m.label)}</text>
    </g>`;
  }).join('');
  return `<div class="chart-scroll"><svg class="chart"${cc(car)} viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Kosten pro Monat">
    <line x1="0" y1="${h - bottom}" x2="${width}" y2="${h - bottom}" class="axis"/>${bars}</svg></div>`;
}

export function renderSettlement(from) {
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

export function renderStats() {
  const from = periodStart();
  return `
    <section class="card">
      <div class="seg">
        ${PERIODS.map((p) => `<button class="seg-opt btn-seg ${p.id === state.statsPeriod ? 'active' : ''}" data-action="period" data-period="${p.id}">${p.label}</button>`).join('')}
      </div>
    </section>
    ${renderSettlement(from)}
    ${cars().map((c) => {
      const s = carStats(state.entries, c.id, from);
      const u = unit(c.id);
      const fmt = (v, suffix) => (v == null ? '–' : `${num.format(v)} ${suffix}`);
      return `
        <section class="card car-card cc"${cc(c.id)}>
          <h3>${esc(c.name)}</h3>
          <div class="stat-big">${eur.format(s.totalCost)}<small>Gesamtkosten · ${s.count} Einträge</small></div>
          <ul class="kv">
            <li><span>Gefahrene km</span><span>${num.format(s.km)} km</span></li>
            <li><span>Ø Gesamtkosten</span><span>${s.totalPer100 == null ? '–' : `${eur.format(s.totalPer100)} /100 km`}</span></li>
            <li><span>${isCombustion(c.id) ? 'Tanken' : 'Laden'}</span><span>${eur.format(s.fuelCost)}</span></li>
            ${s.byType.map((t) => `<li><span>${esc(t.label)}</span><span>${eur.format(t.value)}</span></li>`).join('')}
            <li><span>Ø Verbrauch</span><span>${fmt(s.consumption, `${u}/100 km`)}</span></li>
            <li><span>Ø Energiekosten</span><span>${s.costPer100 == null ? '–' : `${eur.format(s.costPer100)} /100 km`}</span></li>
            <li><span>Ø Preis</span><span>${s.avgPrice == null ? '–' : `${num.format(s.avgPrice)} €/${u}`}</span></li>
          </ul>
          ${isCombustion(c.id) ? '<p class="hint">Verbrauch stimmt nur, wenn jedes Mal vollgetankt wurde.</p>' : ''}
          ${s.fuelCount === 1 ? '<p class="muted small">Verbrauch ab zwei Tank-/Ladeeinträgen.</p>' : ''}
          <h4>Kosten pro Monat</h4>
          ${barChart(s.months, c.id)}
        </section>`;
    }).join('')}`;
}
