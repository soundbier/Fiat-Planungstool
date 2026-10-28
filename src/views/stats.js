import { carStats, consumptionSeries, kmTrend, odometerIssues, settlement, validateEntry, weekdayUsage } from '../lib/model.js';
import { addItem } from '../firebase.js';
import { toast } from '../ui.js';
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

export function barChart(months, car, fmt = (v) => eur.format(v), label = 'Kosten pro Monat') {
  if (!months.length) return '<p class="muted">Keine Daten.</p>';
  const barW = 28, gap = 10, h = 140, top = 18, bottom = 22;
  const max = Math.max(1, ...months.map((m) => m.value));
  const width = months.length * (barW + gap) + gap;
  const bars = months.map((m, i) => {
    const bh = (m.value / max) * (h - top - bottom);
    const x = gap + i * (barW + gap);
    const y = h - bottom - bh;
    return `<g>
      <title>${esc(m.label)}: ${fmt(m.value)}</title>
      <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(bh, m.value > 0 ? 1 : 0)}" rx="2" class="bar cc"/>
      ${m.value > 0 ? `<text x="${x + barW / 2}" y="${y - 4}" class="bar-val">${Math.round(m.value)}</text>` : ''}
      <text x="${x + barW / 2}" y="${h - 6}" class="bar-lbl">${esc(m.label)}</text>
    </g>`;
  }).join('');
  return `<div class="chart-scroll"><svg class="chart"${cc(car)} viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${label}">
    <line x1="0" y1="${h - bottom}" x2="${width}" y2="${h - bottom}" class="axis"/>${bars}</svg></div>`;
}

export function lineChart(series, car, u) {
  const step = 32, h = 120, top = 16, bottom = 20, pad = 16;
  const vals = series.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const width = pad * 2 + (series.length - 1) * step;
  const pts = series.map((p, i) => [pad + i * step, top + (1 - (p.value - min) / span) * (h - top - bottom)]);
  return `<div class="chart-scroll"><svg class="chart"${cc(car)} viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Verbrauch je Tank-/Ladevorgang">
    <line x1="0" y1="${h - bottom}" x2="${width}" y2="${h - bottom}" class="axis"/>
    <polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="var(--cc)" stroke-width="2"/>
    ${series.map((p, i) => `<g><title>${esc(p.date.split('-').reverse().join('.'))}: ${num.format(p.value)} ${u}/100 km (${num.format(p.km)} km)</title>
      <circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="3.5" class="bar cc"/>
      <text x="${pts[i][0]}" y="${pts[i][1] - 6}" class="bar-val">${num.format(Math.round(p.value * 10) / 10)}</text>
      <text x="${pts[i][0]}" y="${h - 6}" class="bar-lbl">${esc(p.date.slice(8, 10) + '.' + p.date.slice(5, 7))}</text></g>`).join('')}
  </svg></div>`;
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

export function renderWeekdays(from) {
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

function renderKm(c, from) {
  const t = kmTrend(state.entries, c.id, from, today());
  const km = (v) => `${num.format(Math.round(v))} km`;
  const arrow = !t || Math.abs(t.trend) < 0.1 ? '' : t.trend > 0 ? ' ↑' : ' ↓';
  return `
    <h4>Kilometerstand</h4>
    ${t ? `<ul class="kv">
      <li><span>Aktuell (${esc(t.date.split('-').reverse().join('.'))})</span><span>${km(t.odometer)}</span></li>
      ${t.perMonth != null ? `<li><span>Ø pro Monat</span><span>${km(t.perMonth)}</span></li>
      <li><span>Hochgerechnet pro Jahr</span><span>${km(t.perYear)}</span></li>` : ''}
      ${t.recentPerMonth != null ? `<li><span>Tendenz (letzte 90 Tage)</span><span>${km(t.recentPerMonth)} /Monat${arrow}</span></li>` : ''}
    </ul>` : ''}
    <form class="km-form row" data-car="${esc(c.id)}">
      <input name="odometer" inputmode="numeric" pattern="[0-9]*" placeholder="Gesamt-km" aria-label="Kilometerstand ${esc(c.name)}" required>
      <button class="btn primary">Eintragen</button>
    </form>
    ${t && t.months.some((m) => m.value) ? `<h4>Kilometer pro Monat</h4>${barChart(t.months, c.id, km, 'Kilometer pro Monat')}` : ''}`;
}

export function submitKm(form) {
  const res = validateEntry({ car: form.dataset.car, type: 'odo', date: today(), odometer: new FormData(form).get('odometer'), note: '' }, state.setup, state.name);
  if (res.error) return toast(res.error);
  const issues = odometerIssues(state.entries, res.data.car, res.data.date, /** @type {number} */ (res.data.odometer));
  if (issues.length && !confirm(`${issues.join('\n')}\n\nTrotzdem speichern?`)) return;
  addItem(state.code, 'entries', res.data).catch((e) => toast('Fehler: ' + e.message));
  toast('Kilometerstand gespeichert');
}

export function renderStats() {
  const from = periodStart();
  return `
    <section class="card">
      <div class="seg">
        ${PERIODS.map((p) => `<button class="seg-opt btn-seg ${p.id === state.statsPeriod ? 'active' : ''}" data-action="period" data-period="${p.id}" aria-pressed="${p.id === state.statsPeriod}">${p.label}</button>`).join('')}
      </div>
    </section>
    ${renderSettlement(from)}
    ${renderWeekdays(from)}
    ${cars().map((c) => {
      const s = carStats(state.entries, c.id, from);
      const u = unit(c.id);
      const fmt = (v, suffix) => (v == null ? '–' : `${num.format(v)} ${suffix}`);
      const series = consumptionSeries(state.entries, c.id, isCombustion(c.id)).filter((p) => p.date >= from);
      const vals = series.map((p) => p.value);
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
            ${series.length ? `<li><span>Letzter Verbrauch</span><span>${fmt(vals[vals.length - 1], `${u}/100 km`)}</span></li>
            ${series.length > 1 ? `<li><span>Min / Max</span><span>${num.format(Math.min(...vals))} / ${fmt(Math.max(...vals), `${u}/100 km`)}</span></li>` : ''}` : ''}
            <li><span>Ø Energiekosten</span><span>${s.costPer100 == null ? '–' : `${eur.format(s.costPer100)} /100 km`}</span></li>
            <li><span>Ø Preis</span><span>${s.avgPrice == null ? '–' : `${num.format(s.avgPrice)} €/${u}`}</span></li>
          </ul>
          ${isCombustion(c.id) ? '<p class="hint">Verbrauch stimmt nur, wenn jedes Mal vollgetankt wurde.</p>' : ''}
          ${s.fuelCount === 1 ? '<p class="muted small">Verbrauch ab zwei Tank-/Ladeeinträgen.</p>' : ''}
          ${series.length > 1 ? `<h4>Verbrauch je ${isCombustion(c.id) ? 'Tankfüllung' : 'Ladung'}</h4>${lineChart(series, c.id, u)}` : ''}
          ${renderKm(c, from)}
          <h4>Kosten pro Monat</h4>
          ${barChart(s.months, c.id)}
        </section>`;
    }).join('')}`;
}
