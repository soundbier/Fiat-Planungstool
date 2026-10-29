import { importData, saveSetup } from '../firebase.js';
import { entriesFromCsv, entriesToCsv, fromBackup, toBackup } from '../lib/csv.js';
import { entryKey, recurringKey, reminderKey } from '../lib/model.js';
import { run } from '../render.js';
import { applyColors, state, today } from '../state.js';
import { download, toast } from '../ui.js';
import { bookingFor } from './calendar.js';

export function exportCsv() {
  if (!state.entries.length) return toast('Keine Einträge zum Exportieren');
  download(`autoplaner-${today()}.csv`, entriesToCsv(state.entries, state.setup), 'text/csv;charset=utf-8');
}

export function exportJson() {
  const data = toBackup(state);
  download(`autoplaner-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

/** @param {File} file */
export async function importFile(file) {
  if (file.size > 5 * 1024 * 1024) return toast('Datei zu groß (max. 5 MB)');
  let data;
  try {
    const text = await file.text();
    data = /\.json$/i.test(file.name) || text.trim().startsWith('{') ? fromBackup(JSON.parse(text), state.setup, state.name)
      : entriesFromCsv(text, state.setup, state.name);
  } catch (e) { return toast('Import fehlgeschlagen: ' + (e.message || e)); }
  const haveE = new Set(state.entries.map(entryKey));
  const haveR = new Set(state.reminders.map(reminderKey));
  const entries = data.entries.filter((e) => { const k = entryKey(e); if (haveE.has(k)) return false; haveE.add(k); return true; });
  const reminders = data.reminders.filter((r) => { const k = reminderKey(r); if (haveR.has(k)) return false; haveR.add(k); return true; });
  const haveW = new Set(state.recurring.map(recurringKey));
  const recurring = data.recurring.filter((r) => { const k = recurringKey(r); if (haveW.has(k)) return false; haveW.add(k); return true; });
  const bookings = data.bookings.filter((b) => bookingFor(b.date, b.car)?.driver !== b.driver);
  const dupes = data.entries.length - entries.length + data.reminders.length - reminders.length + data.recurring.length - recurring.length;
  const parts = [`${entries.length} Kosteneinträge`, `${bookings.length} Kalender-Einteilungen`, `${reminders.length} Fristen`];
  if (recurring.length) parts.push(`${recurring.length} ${recurring.length === 1 ? 'Wiederholung' : 'Wiederholungen'}`);
  if (data.setup) parts.push('neue Personen/Autos');
  if (!entries.length && !bookings.length && !reminders.length && !recurring.length && !data.setup) {
    return toast(`Nichts Neues zu importieren${dupes ? ` (${dupes} bereits vorhanden)` : ''}`);
  }
  const extra = [dupes && `${dupes} bereits vorhanden`, data.skipped && `${data.skipped} ungültig`].filter(Boolean).join(', ');
  if (!confirm(`Importieren: ${parts.join(', ')}?${extra ? `\n(Übersprungen: ${extra})` : ''}\nBestehende Kalender-Einteilungen an denselben Tagen werden überschrieben.`)) return;
  run(async () => {
    if (data.setup) { await saveSetup(state.code, data.setup); state.setup = data.setup; applyColors(); }
    await importData(state.code, { entries, bookings, reminders, recurring }, state.name);
  }, 'Import abgeschlossen');
}
