import { dueReminders } from './lib/model.js';
import { esc } from './lib/util.js';
import { pc, people, personName, state, today } from './state.js';
import { app, errText, icon, toast } from './ui.js';
import { renderCalendar, updateDayWarning } from './views/calendar.js';
import { renderEntries, updateEntryForm } from './views/entries.js';
import { renderReminders } from './views/reminders.js';
import { renderSettings } from './views/settings.js';
import { renderSetup } from './views/setup.js';
import { renderStats } from './views/stats.js';

// Asynchrone Aktion mit Sperre gegen Doppelklicks
export async function run(fn, okMsg) {
  if (state.busy) return;
  state.busy = true;
  render();
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { console.error(e); toast('Fehler: ' + errText(e)); }
  finally { state.busy = false; render(); }
}

/* ---------- Main render ---------- */
export const TABS = [
  { id: 'calendar', label: 'Kalender', short: 'Kalender', icon: 'calendar' },
  { id: 'entries', label: 'Kosten', short: 'Kosten', icon: 'fuel' },
  { id: 'reminders', label: 'Fristen', short: 'Fristen', icon: 'bell' },
  { id: 'stats', label: 'Auswertung', short: 'Auswertung', icon: 'chart' },
  { id: 'settings', label: 'Einstellungen', short: 'Einstellungen', icon: 'gear' }
];

export function render() {
  // Eigene Person wurde entfernt oder existiert in diesem Haushalt nicht
  if (!state.setupStep && state.code && state.setupLoaded && !people().some((p) => p.id === state.name)) state.setupStep = 'name';
  if (state.setupStep) return renderSetup();
  const scroll = window.scrollY;
  const views = { calendar: renderCalendar, entries: renderEntries, reminders: renderReminders, stats: renderStats, settings: renderSettings };
  const active = document.activeElement;
  const focusName = active && active.form && active.name && active.type !== 'radio' ? { form: active.form.id, name: active.name, value: active.value } : null;
  if (focusName) return; // Nicht neu rendern, während der Nutzer tippt
  // Ungespeicherte Formulareingaben (Eintragsformular) über Re-Renders hinweg erhalten
  const drafts = ['entry-form', 'reminder-form'].map((id) => {
    const form = document.getElementById(id);
    if (!form) return null;
    return { id, fields: [...form.elements].filter((el) => el.name).map((el) => ({ name: el.name, value: el.value, checked: el.checked, type: el.type })) };
  }).filter(Boolean);
  const dueCount = dueReminders(state.reminders, today()).length;
  app.innerHTML = `
    <header class="topbar">
      <span>${esc(TABS.find((t) => t.id === state.tab).label)}</span>
      <span class="me pc"${pc(state.name)}>${esc(personName(state.name))}</span>
    </header>
    ${state.error ? `<div class="banner">${esc(state.error)}</div>` : ''}
    ${state.offline && !state.error ? `<div class="banner">Keine Verbindung zum Server – Änderungen sind nur auf diesem Gerät gespeichert.</div>` : ''}
    <main class="content">${views[state.tab]()}</main>
    <nav class="tabbar">
      ${TABS.map((t) => `<button class="tab ${t.id === state.tab ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
        ${icon(t.icon)}<span>${t.short}</span>${t.id === 'reminders' && dueCount ? `<span class="badge" aria-label="${dueCount} fällig">${dueCount}</span>` : ''}</button>`).join('')}
    </nav>`;
  for (const draft of drafts) {
    const form = document.getElementById(draft.id);
    if (!form) continue;
    for (const f of draft.fields) {
      const els = [...form.elements].filter((el) => el.name === f.name);
      if (f.type === 'radio') { const r = els.find((el) => el.value === f.value); if (r && f.checked) r.checked = true; }
      else if (f.type === 'checkbox') els.forEach((el) => { el.checked = f.checked; });
      else els.forEach((el) => { el.value = f.value; });
    }
  }
  const dayForm = document.getElementById('day-form');
  if (dayForm) updateDayWarning(dayForm);
  const entryForm = document.getElementById('entry-form');
  if (entryForm) updateEntryForm(entryForm);
  window.scrollTo(0, scroll);
}
