import { addItem, deleteItem, updateItem } from '../firebase.js';
import { DUE_SOON_DAYS, REMINDER_PRESETS, dueIn, intervalLabel, validateReminder } from '../lib/model.js';
import { addMonths, esc, fmtDate, isoDate } from '../lib/util.js';
import { render } from '../render.js';
import { carName, carOf, cars, cc, state, today } from '../state.js';
import { icon, toast } from '../ui.js';

export function dueLabel(r) {
  const d = dueIn(r, today());
  if (d < 0) return `<span class="due overdue">${-d} ${-d === 1 ? 'Tag' : 'Tage'} überfällig</span>`;
  if (d === 0) return '<span class="due overdue">heute</span>';
  return `<span class="due${d <= DUE_SOON_DAYS ? ' soon' : ''}">in ${d} ${d === 1 ? 'Tag' : 'Tagen'}</span>`;
}

export function renderReminders() {
  const list = [...state.reminders].sort((a, b) => a.due.localeCompare(b.due));
  return `
    <button class="btn primary block add-btn" data-action="open-reminder">${icon('plus')}<span>Frist hinzufügen</span></button>
    ${list.length ? `<section class="card"><ul class="list">${list.map((r) => `
      <li class="item">
        <span class="car-tag cc"${cc(r.car)}>${esc(carOf(r.car)?.short || '?')}</span>
        <div class="grow">
          <strong>${esc(r.title)}</strong> ${dueLabel(r)}
          <div class="note">${esc(carName(r.car))} · ${fmtDate(r.due)} · ${intervalLabel(r.intervalMonths)}${r.note ? ` · ${esc(r.note)}` : ''}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-sm" data-action="reminder-done" data-id="${esc(r.id)}">Erledigt</button>
          <button class="icon-btn small" data-action="open-reminder" data-id="${esc(r.id)}" aria-label="Bearbeiten">✎</button>
        </div>
      </li>`).join('')}</ul></section>` : `
      <section class="card empty-state">
        <p><strong>Keine Fristen</strong></p>
        <p class="muted">HU/TÜV, Service, Reifenwechsel, Versicherung … eintragen. Fällige Fristen (≤ ${DUE_SOON_DAYS} Tage) erscheinen im Kalender und als Zähler im Menü.</p>
      </section>`}
    ${state.reminderSheet ? renderReminderSheet() : ''}`;
}

export function renderReminderSheet() {
  const r = state.reminders.find((x) => x.id === state.reminderSheet) || null;
  const car = r?.car || (carOf(state.entryCar) ? state.entryCar : cars()[0].id);
  const iv = r ? r.intervalMonths : 12;
  const ivs = [...new Set([0, 1, 3, 6, 12, 24, 36, iv])].sort((a, b) => a - b);
  return `
    <div class="overlay" data-action="close-reminder">
      <form class="dialog" id="reminder-form" data-id="${esc(r?.id || '')}" role="dialog" aria-modal="true" aria-labelledby="reminder-title">
        <div class="sheet-head">
          <h3 id="reminder-title">${r ? 'Frist bearbeiten' : 'Neue Frist'}</h3>
          <button class="icon-btn" type="button" data-action="close-reminder" aria-label="Schließen">✕</button>
        </div>
        <div class="seg">
          ${cars().map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}" ${c.id === car ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        </div>
        <label><span>Was</span><input name="title" list="reminder-presets" maxlength="80" required value="${esc(r?.title || '')}" placeholder="z. B. HU / TÜV"></label>
        <datalist id="reminder-presets">${REMINDER_PRESETS.map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="row">
          <label><span>Fällig am</span><input type="date" name="due" required value="${esc(r?.due || '')}"></label>
          <label><span>Wiederholung</span><select name="intervalMonths">
            ${ivs.map((n) => `<option value="${n}" ${n === iv ? 'selected' : ''}>${intervalLabel(n)}</option>`).join('')}
          </select></label>
        </div>
        <label><span>Notiz</span><input name="note" maxlength="300" placeholder="optional" value="${esc(r?.note || '')}"></label>
        <button class="btn primary block" type="submit">Speichern</button>
        ${r ? `<button class="btn danger block" type="button" data-action="delete-reminder" data-id="${esc(r.id)}">Löschen</button>` : ''}
      </form>
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
    toast(`Erledigt – nächster Termin ${fmtDate(next)}`, {
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
