import { setBookingsBatch } from '../firebase.js';
import { ALL, bookingConflict, dueReminders, undoChanges, weekBookings, weekCopyChanges } from '../lib/model.js';
import { addDays, esc, fmtDateLong, isoDate, mondayOf, pad, shortRange, weekNumber } from '../lib/util.js';
import { render } from '../render.js';
import { carName, cars, pc, people, personName, prefs, state } from '../state.js';
import { avatar, carBadge, icon, initialOf, person, shortDay, toast, weekdayOf } from '../ui.js';
import { dueLabel, renderReminderSection } from './reminders.js';

/* ---------- Kalender ---------- */
// Index wird neu aufgebaut, sobald ein Snapshot state.bookings ersetzt (Dokument-ID = {date}_{car}, also eindeutig)
let indexed = null;
let index = new Map();
export function bookingFor(iso, car) {
  if (indexed !== state.bookings) {
    indexed = state.bookings;
    index = new Map(state.bookings.map((b) => [`${b.date}_${b.car}`, b]));
  }
  return index.get(`${iso}_${car}`) || null;
}

/** Vorlesbare Beschreibung eines Tages, z. B. „Mittwoch, 14. Oktober 2026: Fiat 500e Lukas, Citroën frei“ */
function dayLabel(iso) {
  return `${fmtDateLong(iso)}: ${cars().map((c) => `${c.name} ${bookingFor(iso, c.id) ? personName(bookingFor(iso, c.id).driver) : 'frei'}`).join(', ')}`;
}

/** Person, die an einem Tag für mehrere Autos eingetragen ist (Doppelbuchung) */
function clashOf(iso) {
  const drivers = cars().map((c) => bookingFor(iso, c.id)?.driver).filter((d) => d && d !== ALL);
  return drivers.find((d, i) => drivers.indexOf(d) !== i) || null;
}

/** Noch keine Daten vom Server und nichts im Cache */
const loading = () => state.sync === 'connecting' && !state.bookings.length;

function driverOf(iso, car) {
  const b = bookingFor(iso, car);
  if (b) return person(b.driver);
  return loading() ? '<span class="skel" aria-hidden="true"></span>' : '<span class="free">frei</span>';
}

function clashNote(iso) {
  const p = clashOf(iso);
  return p ? `<span class="clash-note">${icon('circle-alert')}${esc(personName(p))} für mehrere Autos</span>` : '';
}

/* Heute und morgen: „Wer fährt heute welches Auto?“ ohne Suchen */
function renderToday(today) {
  const days = [[today, 'Heute'], [addDays(today, 1), 'Morgen']];
  return `<div class="today">
    ${days.map(([iso, label]) => `<button class="today-col" data-action="open-day" data-day="${iso}" aria-label="${esc(`${label}, ${dayLabel(iso)}`)}">
      <span class="today-label"><b>${label}</b>${esc(shortDay(iso))}</span>
      ${cars().map((c) => `<span class="assign">${carBadge(c.id)}${driverOf(iso, c.id)}</span>`).join('')}
      ${clashNote(iso)}
    </button>`).join('')}
  </div>`;
}

function renderDue(today) {
  const due = dueReminders(state.reminders, today);
  if (!due.length) return '';
  return `<ul class="due-list" aria-label="Fällige Fristen">
    ${due.slice(0, 3).map((r) => `<li><button class="due-row" data-action="open-reminder" data-id="${esc(r.id)}">
      ${icon('bell')}<span class="due-title">${esc(r.title)} <span class="muted">· ${esc(carName(r.car))}</span></span>${dueLabel(r)}
    </button></li>`).join('')}
    ${due.length > 3 ? `<li class="due-more">${due.length - 3} weitere unter Fristen</li>` : ''}
  </ul>`;
}

/** Erster Start ohne Buchungen: zeigen, wie gebucht wird */
const hint = () => (!state.bookings.length && !loading() ? '<p class="footnote">Tag antippen und Person beim Auto wählen. Wird sofort gespeichert.</p>' : '');

function viewToggle() {
  return `<div class="seg" role="group" aria-label="Ansicht">
    ${[['week', 'Woche'], ['month', 'Monat']].map(([id, l]) => `<button class="seg-btn" data-action="pref" data-key="calView" data-value="${id}" aria-pressed="${prefs.calView === id}">${l}</button>`).join('')}
  </div>`;
}

function calHead(title, sub, isCurrent, nav) {
  return `<div class="cal-head">
    <h2>${title}${sub ? `<span class="muted">${sub}</span>` : ''}</h2>
    <div class="cal-nav">
      ${isCurrent ? '' : `<button class="btn-quiet" data-action="${nav.today}">Heute</button>`}
      <button class="icon-btn" data-action="${nav.step}" data-delta="${-nav.delta}" aria-label="${nav.prev}">${icon('chevron-left')}</button>
      <button class="icon-btn" data-action="${nav.step}" data-delta="${nav.delta}" aria-label="${nav.next}">${icon('chevron-right')}</button>
    </div>
  </div>`;
}

function renderWeek(today) {
  const start = state.week;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return `
    ${calHead(`KW ${weekNumber(start)}`, shortRange(start), start === mondayOf(today),
      { today: 'cal-week-today', step: 'cal-week', delta: 7, prev: 'Vorherige Woche', next: 'Nächste Woche' })}
    <ol class="week" data-swipe="week">
      ${days.map((iso) => `<li><button class="wday${iso === today ? ' today' : ''}${iso < today ? ' past' : ''}" data-action="open-day" data-day="${iso}" aria-label="${esc(dayLabel(iso))}"${iso === today ? ' aria-current="date"' : ''}>
        <span class="wday-date" aria-hidden="true"><span class="wday-name">${weekdayOf(iso)}</span><span class="wday-num">${Number(iso.slice(8))}</span></span>
        <span class="wday-cars">
          ${cars().map((c) => `<span class="assign"><span class="assign-car">${carBadge(c.id)}<span>${esc(c.name)}</span></span>${driverOf(iso, c.id)}</span>`).join('')}
          ${clashNote(iso)}
        </span>
      </button></li>`).join('')}
    </ol>
    ${hint()}
    <button class="btn-quiet copy-week" data-action="copy-week">${icon('copy')}Woche in KW ${weekNumber(addDays(start, 7))} übernehmen</button>`;
}

function renderMonth(today) {
  const m = state.month;
  const year = m.getFullYear(), month = m.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrent = year === new Date().getFullYear() && month === new Date().getMonth();
  const cells = [];
  let clash = false;
  let all = false;
  for (let i = 0; i < startOffset; i++) cells.push('<div class="mday-empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
    const dup = !!clashOf(iso);
    if (dup) clash = true;
    // Eine Zeile pro Auto (feste Reihenfolge), Farbe + Initiale = Person
    const slots = cars().map((c) => {
      const b = bookingFor(iso, c.id);
      if (b?.driver === ALL) all = true;
      return b ? `<span class="slot"${pc(b.driver)}>${esc(initialOf(b.driver))}</span>` : '<span class="slot slot-free"></span>';
    }).join('');
    cells.push(`<button class="mday${iso === today ? ' today' : ''}${iso < today ? ' past' : ''}${dup ? ' clash' : ''}" data-action="open-day" data-day="${iso}" aria-label="${esc(dayLabel(iso))}${dup ? ', Doppelbuchung' : ''}"${iso === today ? ' aria-current="date"' : ''}>
      <span class="mday-num">${d}</span>${slots}
    </button>`);
  }
  const title = m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `
    ${calHead(title, '', isCurrent, { today: 'month-today', step: 'month', delta: 1, prev: 'Vorheriger Monat', next: 'Nächster Monat' })}
    <div data-swipe="month">
      <div class="month-wd" aria-hidden="true">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="month-grid">${cells.join('')}</div>
    </div>
    ${hint()}
    <p class="legend">
      ${[...people().map((p) => p.id), ...(all ? [ALL] : [])].map((id) => `<span>${avatar(id, 'sm')}${esc(personName(id))}</span>`).join('')}
    </p>
    ${cars().length > 1 || clash ? `<p class="legend">
      ${cars().length > 1 ? `<span>Je Tag von oben:</span>${cars().map((c) => `<span>${carBadge(c.id, 'sm')}${esc(c.name)}</span>`).join('')}` : ''}
      ${clash ? '<span><i class="dot"></i>Person für mehrere Autos eingetragen</span>' : ''}
    </p>` : ''}`;
}

export function renderCalendar() {
  const today = isoDate(new Date());
  return `
    <div class="top">${renderToday(today)}${renderDue(today)}</div>
    <section class="cal" aria-label="Kalender">
      ${viewToggle()}
      ${prefs.calView === 'month' ? renderMonth(today) : renderWeek(today)}
    </section>
    ${renderReminderSection()}`;
}

/* ---------- Tages-Sheet: Tag antippen, Person beim Auto antippen – gespeichert ---------- */

function conflictNotice(c, k) {
  return `<div class="notice" role="alert">${icon('circle-alert')}<div class="notice-body">
    <p>${esc(c.name)} ist an diesem Tag für ${esc(personName(k.other))} eingetragen.</p>
    <div class="notice-actions">
      <button class="btn-quiet" type="button" data-action="day-override">${k.driver ? `Für ${esc(personName(k.driver))} übernehmen` : 'Freigeben'}</button>
      <button class="btn-quiet btn-muted" type="button" data-action="day-keep">Abbrechen</button>
    </div>
  </div></div>`;
}

export function renderDayDialog(iso) {
  const conflict = state.dayConflict?.iso === iso ? state.dayConflict : null;
  const thisYear = iso.slice(0, 4) === String(new Date().getFullYear());
  const title = thisYear ? fmtDateLong(iso).replace(/ \d{4}$/, '') : fmtDateLong(iso);
  return `
    <div class="overlay" data-action="close-day">
      <form class="sheet" id="day-form" data-day="${iso}" data-swipe="day" role="dialog" aria-modal="true" aria-labelledby="day-title">
        <div class="sheet-head">
          <button class="icon-btn" type="button" data-action="day-step" data-delta="-1" aria-label="Vorheriger Tag">${icon('chevron-left')}</button>
          <h2 id="day-title" class="center">${esc(title)}</h2>
          <button class="icon-btn" type="button" data-action="day-step" data-delta="1" aria-label="Nächster Tag">${icon('chevron-right')}</button>
        </div>
        ${cars().map((c) => {
          const b = bookingFor(iso, c.id);
          const cur = b?.driver || '';
          const opts = [...people().map((p) => p.id), ALL, ''];
          if (cur && cur !== ALL && !people().some((p) => p.id === cur)) opts.unshift(cur);
          const by = b && b.updatedBy && b.updatedBy !== state.name && b.updatedBy !== b.driver ? `<span class="muted">eingetragen von ${esc(personName(b.updatedBy))}</span>` : '';
          return `<fieldset class="pick">
            <legend class="sr-only">${esc(c.name)}</legend>
            <div class="pick-head" aria-hidden="true">${carBadge(c.id)}<span>${esc(c.name)}</span>${by}</div>
            <div class="choices">
              ${opts.map((v) => `<label class="choice${v ? '' : ' choice-free'}"${v ? pc(v) : ''}>
                <input type="radio" name="${c.id}" value="${v}"${cur === v ? ' checked' : ''}>
                <span>${v ? `${avatar(v, 'xs')}${esc(personName(v))}` : 'frei'}</span>
              </label>`).join('')}
            </div>
            ${conflict?.car === c.id ? conflictNotice(c, conflict) : ''}
          </fieldset>`;
        }).join('')}
        <p class="notice" id="day-warn" role="status" hidden></p>
        <div class="sheet-foot">
          <p class="footnote">Änderungen werden sofort gespeichert.</p>
          <button class="btn btn-primary btn-block" type="button" data-action="close-day">Fertig</button>
        </div>
      </form>
    </div>`;
}

export function updateDayWarning(form) {
  const f = new FormData(form);
  const drivers = cars().map((c) => f.get(c.id)).filter((d) => d && d !== ALL);
  const dup = drivers.find((d, i) => drivers.indexOf(d) !== i);
  const warn = form.querySelector('#day-warn');
  if (dup) {
    warn.textContent = `${personName(dup)} ist für mehrere Autos eingetragen.`;
    warn.hidden = false;
  } else warn.hidden = true;
}

function writeDay(iso, car, driver, prev) {
  const err = (e) => toast('Fehler: ' + e.message);
  setBookingsBatch(state.code, [{ date: iso, car, driver }], state.name).catch(err);
  toast(`${carName(car)}, ${shortDay(iso)}: ${driver ? personName(driver) : 'frei'}`, {
    label: 'Rückgängig',
    run: () => setBookingsBatch(state.code, [{ date: iso, car, driver: prev }], state.name).catch(err)
  });
}

export function saveDayCar(form, car) {
  const iso = form.dataset.day;
  const driver = /** @type {string | null} */ (new FormData(form).get(car)) || null;
  const booking = bookingFor(iso, car);
  const prev = booking?.driver || null;
  if (prev === driver) return;
  const other = bookingConflict(booking, driver, state.name);
  if (other) {
    // Buchung einer anderen Person: nicht still überschreiben, sondern im Sheet nachfragen
    const input = form.querySelector(`input[name="${car}"][value="${prev || ''}"]`);
    if (input) input.checked = true;
    state.dayConflict = { iso, car, driver, other };
    render();
    return;
  }
  if (state.dayConflict?.car === car) state.dayConflict = null;
  writeDay(iso, car, driver, prev);
}

export function overrideDayCar() {
  const k = state.dayConflict;
  if (!k) return;
  state.dayConflict = null;
  writeDay(k.iso, k.car, k.driver, bookingFor(k.iso, k.car)?.driver || null);
}

/** Angezeigte Woche in die Folgewoche übernehmen und dorthin wechseln */
export function copyWeek() {
  const start = state.week;
  const changes = weekCopyChanges(state.bookings, start, cars().map((c) => c.id));
  if (!changes.length) return toast('Folgewoche ist bereits identisch');
  const conflicts = changes.filter((ch) => bookingConflict(bookingFor(ch.date, ch.car), ch.driver, state.name));
  if (conflicts.length && !confirm(`${conflicts.length} Buchung${conflicts.length > 1 ? 'en' : ''} anderer Personen in der Folgewoche würde${conflicts.length > 1 ? 'n' : ''} überschrieben:\n`
    + conflicts.map((ch) => `${shortDay(ch.date)} ${carName(ch.car)}: ${personName(bookingFor(ch.date, ch.car).driver)}`).join('\n') + '\n\nTrotzdem übernehmen?')) return;
  const undo = undoChanges(state.bookings, changes);
  const me = state.name;
  setBookingsBatch(state.code, changes, me).catch((e) => toast('Fehler: ' + e.message));
  state.week = addDays(start, 7);
  render();
  toast(`In KW ${weekNumber(state.week)} übernommen`, {
    label: 'Rückgängig',
    run: () => setBookingsBatch(state.code, undo, me).catch((e) => toast('Fehler: ' + e.message))
  });
}

export function resetWeek() {
  const start = mondayOf(isoDate(new Date()));
  const undo = weekBookings(state.bookings, start, cars().map((c) => c.id));
  if (!undo.length) return toast('Aktuelle Woche ist bereits leer');
  if (!confirm(`Alle Einträge der KW ${weekNumber(start)} (${shortRange(start)}) löschen?`)) return;
  const me = state.name;
  setBookingsBatch(state.code, undo.map((u) => ({ ...u, driver: null })), me).catch((e) => toast('Fehler: ' + e.message));
  toast(`KW ${weekNumber(start)} geleert`, {
    label: 'Rückgängig',
    run: () => setBookingsBatch(state.code, undo, me).catch((e) => toast('Fehler: ' + e.message))
  });
}
