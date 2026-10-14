import { setBookingsBatch } from '../firebase.js';
import { dueReminders } from '../lib/model.js';
import { addDays, esc, fmtDate, isoDate, mondayOf, pad, shortRange, weekNumber } from '../lib/util.js';
import { render } from '../render.js';
import { carOf, cars, cc, pc, people, personName, state } from '../state.js';
import { toast } from '../ui.js';
import { dueLabel } from './reminders.js';

/* ---------- Calendar ---------- */
export function bookingFor(iso, car) {
  return state.bookings.find((b) => b.date === iso && b.car === car) || null;
}

export function driverChip(iso, car) {
  const b = bookingFor(iso, car);
  return b
    ? `<span class="pill pc"${pc(b.driver)}>${esc(personName(b.driver))}</span>`
    : '<span class="pill free">frei</span>';
}

export function renderOverview() {
  const today = isoDate(new Date());
  const days = [[today, 'Heute'], [addDays(today, 1), 'Morgen']];
  const due = dueReminders(state.reminders, today);
  return `
    <section class="overview">
      ${days.map(([iso, label]) => `
        <button class="card ov-day" data-action="open-day" data-day="${iso}">
          <span class="ov-label">${label}</span>
          ${cars().map((c) => `<span class="ov-row"><span class="ov-car">${esc(c.name)}</span>${driverChip(iso, c.id)}</span>`).join('')}
        </button>`).join('')}
    </section>
    ${due.length ? `<section class="card">
      <div class="ov-due" role="link" tabindex="0" data-action="tab" data-tab="reminders">
        <h3>Fristen</h3>
        <ul class="list">${due.slice(0, 3).map((r) => `<li class="item">
          <span class="car-tag cc"${cc(r.car)}>${esc(carOf(r.car)?.short || '?')}</span>
          <span class="grow">${esc(r.title)}</span>${dueLabel(r)}</li>`).join('')}</ul>
      </div>
    </section>` : ''}`;
}

export function renderCalendar() {
  const m = state.month;
  const year = m.getFullYear(), month = m.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = isoDate(new Date());
  const weekStart = state.copyWeek || mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="day empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
    const chips = cars().map((c) => {
      const b = bookingFor(iso, c.id);
      return b ? `<span class="chip pc"${pc(b.driver)}>${esc(c.short)} ${esc(personName(b.driver))}</span>` : '';
    }).join('');
    const inWeek = iso >= weekStart && iso <= weekEnd;
    cells.push(`<button class="day${iso === today ? ' today' : ''}${iso < today ? ' past' : ''}${inWeek ? ' in-week' : ''}" data-action="open-day" data-day="${iso}">
      <span class="day-num">${d}</span>${chips}
    </button>`);
  }
  const title = m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `
    ${renderOverview()}
    <section class="card cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Vorheriger Monat">‹</button>
        <h2>${title}</h2>
        ${isCurrentMonth ? '' : '<button class="btn-text" data-action="month-today">Heute</button>'}
        <button class="icon-btn" data-action="month" data-delta="1" aria-label="Nächster Monat">›</button>
      </div>
      <div class="weekdays">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="grid">${cells.join('')}</div>
      <div class="legend">
        ${people().map((p) => `<span><i class="dot pc"${pc(p.id)}></i>${esc(p.name)}</span>`).join('')}
        <span>${cars().map((c) => `${esc(c.short)} ${esc(c.name)}`).join(' · ')}</span>
      </div>
    </section>
    <section class="card">
      <h3>Woche übertragen</h3>
      <div class="week-pick">
        <button class="icon-btn" data-action="week" data-delta="-7" aria-label="Vorherige Woche">‹</button>
        <div class="week-label"><strong>KW ${weekNumber(weekStart)}</strong><span class="muted">${shortRange(weekStart)}</span></div>
        <button class="icon-btn" data-action="week" data-delta="7" aria-label="Nächste Woche">›</button>
      </div>
      <button class="btn block" data-action="copy-week">Nach KW ${weekNumber(addDays(weekStart, 7))} kopieren</button>
    </section>
    ${state.dayDialog ? renderDayDialog(state.dayDialog) : ''}`;
}

export function renderDayDialog(iso) {
  return `
    <div class="overlay" data-action="close-day">
      <form class="dialog" id="day-form" data-day="${iso}">
        <div class="sheet-head">
          <button class="icon-btn" type="button" data-action="day-step" data-delta="-1" aria-label="Vorheriger Tag">‹</button>
          <h3>${fmtDate(iso)}</h3>
          <button class="icon-btn" type="button" data-action="day-step" data-delta="1" aria-label="Nächster Tag">›</button>
        </div>
        ${cars().map((c) => {
          const cur = bookingFor(iso, c.id)?.driver || '';
          const opts = [...people().map((p) => [p.id, p.name]), ['', 'frei']];
          if (cur && !people().some((p) => p.id === cur)) opts.unshift([cur, cur]);
          return `<fieldset>
            <legend>${esc(c.name)}</legend>
            <div class="seg">
              ${opts.map(([v, l]) => `
                <label class="seg-opt${v ? ' pc' : ''}"${v ? pc(v) : ''}><input type="radio" name="${c.id}" value="${v}" ${cur === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
            </div>
          </fieldset>`;
        }).join('')}
        <p class="warn" id="day-warn" hidden></p>
        <p class="muted small center">Änderungen werden sofort gespeichert.</p>
        <button class="btn primary block" type="button" data-action="close-day">Fertig</button>
      </form>
    </div>`;
}

export function updateDayWarning(form) {
  const f = new FormData(form);
  const drivers = cars().map((c) => f.get(c.id)).filter(Boolean);
  const dup = drivers.find((d, i) => drivers.indexOf(d) !== i);
  const warn = form.querySelector('#day-warn');
  if (dup) {
    warn.textContent = `${personName(dup)} ist für mehrere Autos eingetragen.`;
    warn.hidden = false;
  } else warn.hidden = true;
}

export function saveDayCar(form, car) {
  const iso = form.dataset.day;
  const driver = new FormData(form).get(car) || null;
  if ((bookingFor(iso, car)?.driver || null) === driver) return;
  setBookingsBatch(state.code, [{ date: iso, car, driver }], state.name)
    .catch((e) => toast('Fehler: ' + e.message));
}

export function copyWeek() {
  const start = state.copyWeek || mondayOf(isoDate(new Date()));
  const changes = [];
  for (let i = 0; i < 7; i++) {
    const src = addDays(start, i), dst = addDays(start, i + 7);
    for (const c of cars()) {
      const driver = bookingFor(src, c.id)?.driver || null;
      if ((bookingFor(dst, c.id)?.driver || null) !== driver) changes.push({ date: dst, car: c.id, driver });
    }
  }
  if (!changes.length) return toast('Folgewoche ist bereits identisch');
  const undo = changes.map((ch) => ({ ...ch, driver: bookingFor(ch.date, ch.car)?.driver || null }));
  const me = state.name;
  setBookingsBatch(state.code, changes, me).catch((e) => toast('Fehler: ' + e.message));
  state.copyWeek = addDays(start, 7);
  render();
  toast(`Nach KW ${weekNumber(state.copyWeek)} kopiert`, {
    label: 'Rückgängig',
    run: () => setBookingsBatch(state.code, undo, me).catch((e) => toast('Fehler: ' + e.message))
  });
}

export function resetWeek() {
  const start = mondayOf(isoDate(new Date()));
  const undo = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    for (const c of cars()) {
      const driver = bookingFor(date, c.id)?.driver;
      if (driver) undo.push({ date, car: c.id, driver });
    }
  }
  if (!undo.length) return toast('Aktuelle Woche ist bereits leer');
  if (!confirm(`Alle Einträge der KW ${weekNumber(start)} (${shortRange(start)}) löschen?`)) return;
  const me = state.name;
  setBookingsBatch(state.code, undo.map((u) => ({ ...u, driver: null })), me).catch((e) => toast('Fehler: ' + e.message));
  toast(`KW ${weekNumber(start)} zurückgesetzt`, {
    label: 'Rückgängig',
    run: () => setBookingsBatch(state.code, undo, me).catch((e) => toast('Fehler: ' + e.message))
  });
}
