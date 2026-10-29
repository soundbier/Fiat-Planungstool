import { esc, eur, num } from '../lib/util.js';
import { cc } from '../state.js';

/* ---------- Diagramme (SVG, ohne Bibliothek) ---------- */
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const dm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Balken je Monat; `avg` zeichnet eine gestrichelte Ø-Linie (Beschriftung liefert der Aufrufer) */
export function barChart(rawMonths, car, fmt = (v) => eur.format(v), label = 'Kosten pro Monat', avg = 0) {
  if (!rawMonths.length) return '<p class="muted">Keine Daten.</p>';
  // Kurze Achsenbeschriftung: Monat (3 Buchstaben), Jahr nur beim ersten Balken und im Januar
  const months = rawMonths.map((m) => (m.key ? { ...m, short: MONTHS[Number(m.key.slice(5, 7)) - 1], year: `’${m.key.slice(2, 4)}` } : m));
  const barW = 20, gap = 14, h = 132, top = 16, bottom = 32;
  const max = Math.max(1, avg, ...months.map((m) => m.value));
  const width = months.length * (barW + gap) + gap;
  const bars = months.map((m, i) => {
    const bh = (m.value / max) * (h - top - bottom);
    const x = gap + i * (barW + gap);
    const y = h - bottom - bh;
    return `<g>
      <title>${esc(m.label)}: ${fmt(m.value)}</title>
      <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(bh, m.value > 0 ? 2 : 0)}" rx="3" class="bar"/>
      ${m.value > 0 ? `<text x="${x + barW / 2}" y="${y - 5}" class="val">${Math.round(m.value)}</text>` : ''}
      <text x="${x + barW / 2}" y="${h - 17}">${esc(m.short || m.label)}</text>
      ${m.year && (i === 0 || m.short === 'Jan') ? `<text x="${x + barW / 2}" y="${h - 4}">${m.year}</text>` : ''}
    </g>`;
  }).join('');
  return `<div class="chart-scroll"><svg class="chart"${cc(car)} viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${esc(label)}">
    <line x1="0" y1="${h - bottom + .5}" x2="${width}" y2="${h - bottom + .5}" class="axis"/>
    ${avg > 0 ? `<line x1="0" y1="${h - bottom - (avg / max) * (h - top - bottom)}" x2="${width}" y2="${h - bottom - (avg / max) * (h - top - bottom)}" class="avg"><title>Ø ${fmt(avg)}</title></line>` : ''}${bars}</svg></div>`;
}

export function lineChart(series, car, u) {
  const step = 36, h = 120, top = 20, bottom = 22, pad = 18;
  const vals = series.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const width = pad * 2 + (series.length - 1) * step;
  const pts = series.map((p, i) => [pad + i * step, top + (1 - (p.value - min) / span) * (h - top - bottom)]);
  return `<div class="chart-scroll"><svg class="chart"${cc(car)} viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Verbrauch je Tank- oder Ladevorgang">
    <line x1="0" y1="${h - bottom + .5}" x2="${width}" y2="${h - bottom + .5}" class="axis"/>
    <polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="line"/>
    ${series.map((p, i) => `<g><title>${dm(p.date)}: ${num.format(p.value)} ${u}/100 km (${num.format(p.km)} km)</title>
      <circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="3" class="pt"/>
      <text x="${pts[i][0]}" y="${pts[i][1] - 8}" class="val">${num.format(Math.round(p.value * 10) / 10)}</text>
      <text x="${pts[i][0]}" y="${h - 6}">${dm(p.date)}</text></g>`).join('')}
  </svg></div>`;
}

/** Kleine Verlaufslinie ohne Achsen, z. B. Verbrauch der letzten Füllungen */
export function sparkline(series, car, u) {
  const w = 320, h = 44, pad = 4;
  const list = series.slice(-24);
  const vals = list.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = list.map((p, i) => [pad + (i / (list.length - 1)) * (w - 2 * pad), pad + (1 - (p.value - min) / span) * (h - 2 * pad)]);
  const [ex, ey] = pts[pts.length - 1];
  const first = list[0], last = list[list.length - 1];
  return `<svg class="spark"${cc(car)} viewBox="0 0 ${w} ${h}" role="img" aria-label="Verbrauchsverlauf ${dm(first.date)} bis ${dm(last.date)}: ${num.format(Math.round(min * 10) / 10)} bis ${num.format(Math.round(max * 10) / 10)} ${u}/100 km">
    <polyline points="${pts.map((p) => p.map((v) => Math.round(v * 10) / 10).join(',')).join(' ')}" class="line"/>
    <circle cx="${ex}" cy="${ey}" r="3.5" class="end"/>
  </svg>`;
}

/** Abgestufte Farbe für Anteile innerhalb eines Autos */
export const shade = (i) => ['var(--cc)', 'color-mix(in srgb, var(--cc) 62%, var(--bg))', 'color-mix(in srgb, var(--cc) 36%, var(--bg))', 'var(--text-2)', 'var(--text-3)', 'var(--surface-2)'][i % 6];

/** Horizontaler Anteilsbalken mit Legende. `parts[].color` überschreibt die Abstufung. */
export function stackBar(parts, fmt = (v) => eur.format(v)) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return '<p class="muted">Keine Daten.</p>';
  const color = (p, i) => p.color || shade(i);
  return `<div class="stack" role="img" aria-label="${parts.map((p) => `${esc(p.label)} ${fmt(p.value)}`).join(', ')}">
    ${parts.map((p, i) => `<span style="flex:${p.value};--seg:${color(p, i)}"></span>`).join('')}
  </div>
  <ul class="stack-legend">${parts.map((p, i) => `<li><i class="swatch" style="--seg:${color(p, i)}"></i><span>${esc(p.label)}</span><span class="muted">${Math.round(p.value / total * 100)} %</span><strong>${fmt(p.value)}</strong></li>`).join('')}</ul>`;
}
