import { workdayUsage } from '../lib/model.js';
import { esc } from '../lib/util.js';
import { cc, pc, people, personName, state, today } from '../state.js';
import { carBadge, icon, initialOf, person, shortDay } from '../ui.js';

const monthName = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', y === new Date().getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
};
const fixed1 = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const cells = (x) => `${people().map((p) => `<td>${x.days[p.id] || 0}</td>`).join('')}<td class="muted">${x.free}</td>`;

/** Mo–Fr einer Woche: Person (Kürzel), frei oder außerhalb des Monats/bis heute */
function slots(w) {
  const label = w.slots.filter((s) => s.counted).map((s) => `${shortDay(s.date)}: ${s.driver ? personName(s.driver) : 'frei'}`).join(', ');
  return `<span class="wk-slots" role="img" aria-label="${esc(label)}">${w.slots.map((s) => (!s.counted
    ? '<span class="slot slot-out"></span>'
    : s.driver ? `<span class="slot"${pc(s.driver)}>${esc(initialOf(s.driver))}</span>` : '<span class="slot slot-free"></span>')).join('')}</span>`;
}

function carUsage(u) {
  const key = `wd-${u.car.id}`;
  const cols = people().length + 2;
  const months = [...u.months].reverse().map((m) => {
    const k = `${key}-${m.key}`;
    const open = !!state.expanded[k];
    return `
      <tr class="usage-month">
        <th scope="row"><button class="disclosure" data-action="toggle" data-key="${k}" aria-expanded="${open}"${open ? ` aria-controls="${m.weeks.map((w) => `${k}-kw${w.kw}`).join(' ')}"` : ''}>
          <span><span class="usage-label">${esc(monthName(m.key))}</span><small>${m.workdays} ${m.workdays === 1 ? 'Werktag' : 'Werktage'}</small></span>${icon('chevron-down')}
        </button></th>${cells(m)}
      </tr>
      ${open ? `<tr class="usage-wd" aria-hidden="true"><td><span class="wk"><span class="wk-label"></span><span class="wk-slots">${['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((d) => `<span>${d}</span>`).join('')}</span></span></td><td colspan="${cols - 1}"></td></tr>
        ${m.weeks.map((w) => `<tr class="usage-week" id="${k}-kw${w.kw}">
          <th scope="row"><span class="wk"><span class="wk-label">KW ${w.kw}</span>${slots(w)}</span></th>${cells(w)}
        </tr>`).join('')}` : ''}`;
  }).join('');
  const weeks = Math.max(1, u.workdays / 5);
  return `
    <section class="section"${cc(u.car.id)} aria-labelledby="${key}-title">
      <div class="car-stat-head">${carBadge(u.car.id)}<h3 id="${key}-title">${esc(u.car.name)}</h3></div>
      <table class="table usage">
        <thead><tr><th scope="col">Monat</th>${people().map((p) => `<th scope="col">${person(p.id)}</th>`).join('')}<th scope="col">frei</th></tr></thead>
        <tbody>${months}</tbody>
        <tfoot><tr><th scope="row">Ø pro Woche</th>${people().map((p) => `<td>${fixed1(u.perWeek[p.id])}</td>`).join('')}<td class="muted">${fixed1(u.free / weeks)}</td></tr></tfoot>
      </table>
    </section>`;
}

/** Bereich Nutzung: gebuchte Werktage je Auto und Monat, aufklappbar bis zur Woche */
export function renderUsage(from) {
  const list = workdayUsage({ setup: state.setup, bookings: state.bookings, from, today: today() }).filter((u) => u.months.length);
  const head = '<h2 class="area-title" id="area-usage">Nutzung</h2>';
  if (!list.length) {
    return `
    <section class="area" aria-labelledby="area-usage">
      ${head}
      <p class="muted">Keine Buchungen im Zeitraum.</p>
      <button class="btn-quiet" data-action="tab" data-tab="calendar">Zum Kalender</button>
    </section>`;
  }
  return `
    <section class="area" aria-labelledby="area-usage">
      ${head}
      ${list.map(carUsage).join('')}
      <p class="footnote">Gebuchte Werktage Mo–Fr bis heute, ab der ersten Buchung im Zeitraum. „Alle“ zählt für jede Person. Monat antippen für die Wochen; eine Woche über den Monatswechsel zählt in jedem Monat nur mit dessen Tagen.</p>
    </section>`;
}
