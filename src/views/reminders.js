import { addItem, deleteItem, updateItem } from '../firebase.js';
import { DUE_SOON_DAYS, REMINDER_PRESETS, dueIn, intervalLabel, validateReminder } from '../lib/model.js';
import { addMonths, esc, fmtDate, isoDate } from '../lib/util.js';
import { render } from '../render.js';
import { carOf, cars, state, today } from '../state.js';
import { carBadge, dateNum, icon, toast } from '../ui.js';

export function dueLabel(r) {
  const d = dueIn(r, today());
  if (d < 0) return `<span class="due overdue">${-d} ${-d === 1 ? 'Tag' : 'Tage'} überfällig</span>`;
  if (d === 0) return '<span class="due overdue">heute fällig</span>';
  return `<span class="due${d <= DUE_SOON_DAYS ? ' soon' : ''}">in ${d} ${d === 1 ? 'Tag' : 'Tagen'}</span>`;
}

/** Fristen als Abschnitt im Kalender (fällige stehen zusätzlich oben) */
export function renderReminderSection() {
  const list = [...state.reminders].sort((a, b) => a.due.localeCompare(b.due));
  return `
    <section class="section" aria-labelledby="reminders-title">
      <div class="section-head">
        <h2 id="reminders-title">Fristen</h2>
        <button class="btn-quiet" data-action="open-reminder">${icon('plus')}Neu</button>
      </div>
      ${list.length ? `<ul class="rows">${list.map((r) => `
        <li class="row-split">
          <button class="row" data-action="open-reminder" data-id="${esc(r.id)}">
            ${carBadge(r.car)}
            <span class="row-main">
              <span class="row-title">${esc(r.title)}</span>
              <span class="row-sub">${dateNum(r.due)} · ${intervalLabel(r.intervalMonths)}${r.note ? ` · ${esc(r.note)}` : ''}</span>
            </span>
            ${dueLabel(r)}
          </button>
          <button class="icon-btn" data-action="reminder-done" data-id="${esc(r.id)}" aria-label="${esc(r.title)} erledigt">${icon('check')}</button>
        </li>`).join('')}</ul>` : `
        <div class="empty">
          <p class="empty-title">Keine Fristen</p>
          <p>HU, Service, Reifenwechsel oder Versicherung eintragen. Fristen in den nächsten ${DUE_SOON_DAYS} Tagen stehen oben im Kalender.</p>
        </div>`}
    </section>`;
}

export function renderReminderSheet() {
  const r = state.reminders.find((x) => x.id === state.reminderSheet) || null;
  const car = r?.car || (carOf(state.entryCar) ? state.entryCar : cars()[0].id);
  const iv = r ? r.intervalMonths : 12;
  const ivs = [...new Set([0, 1, 3, 6, 12, 24, 36, iv])].sort((a, b) => a - b);
  return `
    <div class="overlay" data-action="close-reminder">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="reminder-title">
        <div class="sheet-head">
          <h2 id="reminder-title">${r ? 'Frist bearbeiten' : 'Neue Frist'}</h2>
          <button class="icon-btn" type="button" data-action="close-reminder" aria-label="Schließen">${icon('x')}</button>
        </div>
        <form id="reminder-form" data-id="${esc(r?.id || '')}" data-mode="${esc(r?.id || 'new')}">
          <fieldset>
            <legend class="sr-only">Auto</legend>
            <div class="seg">
              ${cars().map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}"${c.id === car ? ' checked' : ''}><span>${carBadge(c.id)}<span>${esc(c.name)}</span></span></label>`).join('')}
            </div>
          </fieldset>
          <label class="field"><span>Was</span><input name="title" list="reminder-presets" maxlength="80" required value="${esc(r?.title || '')}" placeholder="z. B. HU / TÜV" autocomplete="off"></label>
          <datalist id="reminder-presets">${REMINDER_PRESETS.map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist>
          <div class="field-row">
            <label class="field"><span>Fällig am</span><input type="date" name="due" required value="${esc(r?.due || '')}"></label>
            <label class="field"><span>Wiederholung</span><select name="intervalMonths">
              ${ivs.map((n) => `<option value="${n}"${n === iv ? ' selected' : ''}>${intervalLabel(n)}</option>`).join('')}
            </select></label>
          </div>
          <label class="field"><span>Notiz</span><input name="note" maxlength="300" placeholder="optional" value="${esc(r?.note || '')}" autocomplete="off"></label>
          <button class="btn btn-primary btn-block" type="submit">Speichern</button>
          ${r ? `<button class="btn btn-danger btn-block" type="button" data-action="delete-reminder" data-id="${esc(r.id)}">Frist löschen</button>` : ''}
        </form>
      </div>
    </div>`;
}

export function submitReminder(form) {
  const f = new FormData(form);
  const id = form.dataset.id;
  const old = state.reminders.find((x) => x.id === id);
  const res = validateReminder({
    car: f.get('car'), title: f.get('title'), due: f.get('due'), intervalMonths: f.get('intervalMonths'),
    note: f.get('note'), createdBy: old?.createdBy || state.name
  }, state.setup, state.name);
  if (res.error) return toast(res.error);
  (old ? updateItem(state.code, 'reminders', id, res.data) : addItem(state.code, 'reminders', res.data))
    .catch((e) => toast('Fehler: ' + e.message));
  state.reminderSheet = null;
  render();
  toast('Gespeichert');
}

export function reminderDone(id) {
  const r = state.reminders.find((x) => x.id === id);
  if (!r) return;
  const err = (e) => toast('Fehler: ' + e.message);
  if (r.intervalMonths > 0) {
    // Nächster Termin ab bisheriger Fälligkeit; lag die weit zurück, ab heute
    let next = addMonths(r.due, r.intervalMonths);
    if (next < isoDate(new Date())) next = addMonths(isoDate(new Date()), r.intervalMonths);
    updateItem(state.code, 'reminders', r.id, { due: next }).catch(err);
    toast(`Erledigt. Nächster Termin ${fmtDate(next)}`, {
      label: 'Rückgängig', run: () => updateItem(state.code, 'reminders', r.id, { due: r.due }).catch(err)
    });
  } else deleteReminder(r, 'Erledigt');
}

export function deleteReminder(r, msg = 'Frist gelöscht') {
  const err = (e) => toast('Fehler: ' + e.message);
  deleteItem(state.code, 'reminders', r.id).catch(err);
  toast(msg, {
    label: 'Rückgängig',
    run: () => { const { id, createdAt, ...data } = r; addItem(state.code, 'reminders', data).catch(err); }
  });
}
