import { esc, eur, num } from '../lib/util.js';
import { cc } from '../state.js';

/* ---------- Diagramme (SVG) ---------- */
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

/** Horizontaler Anteilsbalken mit Legende, z. B. Kostenarten. */
export function stackBar(parts, fmt = (v) => eur.format(v)) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return '<p class="muted">Keine Daten.</p>';
  return `<div class="stack" role="img" aria-label="${parts.map((p) => `${esc(p.label)} ${fmt(p.value)}`).join(', ')}">
    ${parts.map((p, i) => `<span class="stack-seg s${i % 6}" style="flex:${p.value}" title="${esc(p.label)}: ${fmt(p.value)}"></span>`).join('')}
  </div>
  <ul class="stack-legend">${parts.map((p, i) => `<li><i class="sw s${i % 6}"></i><span>${esc(p.label)}</span><span class="muted">${Math.round(p.value / total * 100)} %</span><strong>${fmt(p.value)}</strong></li>`).join('')}</ul>`;
}
