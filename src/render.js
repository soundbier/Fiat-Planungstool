import { dueReminders } from './lib/model.js';
import { esc } from './lib/util.js';
import { pc, people, personName, state, today } from './state.js';
import { app, errText, focusBySelector, focusSelector, focusables, icon, toast } from './ui.js';
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

// Großer Seitentitel: kleiner Titel in der Kopfzeile erst nach dem Scrollen
const onScroll = () => document.documentElement.classList.toggle('scrolled', window.scrollY > 36);
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- Main render ---------- */
export const TABS = [
  { id: 'calendar', label: 'Kalender', short: 'Kalender', icon: 'calendar' },
  { id: 'entries', label: 'Kosten', short: 'Kosten', icon: 'fuel' },
  { id: 'reminders', label: 'Fristen', short: 'Fristen', icon: 'bell' },
  { id: 'stats', label: 'Auswertung', short: 'Auswertung', icon: 'chart' },
  { id: 'settings', label: 'Einstellungen', short: 'Einstellungen', icon: 'gear' }
];

const SYNC_LABEL = {
  synced: 'Synchronisiert',
  pending: 'Wird gespeichert …',
  connecting: 'Verbinde …',
  offline: 'Offline'
};

/** Welcher Dialog offen ist (für Fokus-Management) */
let lastDialog = null;
function openDialog() {
  return state.dayDialog ? 'day' : state.entrySheet ? 'entry' : state.reminderSheet ? 'reminder' : null;
}

/** Fokus nach dem Neuaufbau setzen: in neu geöffnete Dialoge, zurück zum Auslöser, sonst wie vorher. */
function restoreFocus(prevSel) {
  const dialog = openDialog();
  const box = /** @type {HTMLElement | null} */ (app.querySelector('.dialog'));
  if (dialog && dialog !== lastDialog && box) {
    const first = box.querySelector('input:checked') || focusables(box).find((el) => el.matches('input, select, textarea')) || focusables(box)[0];
    /** @type {HTMLElement} */ (first || box).focus({ preventScroll: true });
  } else if (!dialog && lastDialog) {
    if (!focusBySelector(state.returnFocus)) focusBySelector(prevSel);
    state.returnFocus = null;
  } else focusBySelector(prevSel);
  lastDialog = dialog;
}

export function render() {
  // Eigene Person wurde entfernt oder existiert in diesem Haushalt nicht
  if (!state.setupStep && state.code && state.setupLoaded && !people().some((p) => p.id === state.name)) state.setupStep = 'name';
  if (state.setupStep) return renderSetup();
  const scroll = window.scrollY;
  const views = { calendar: renderCalendar, entries: renderEntries, reminders: renderReminders, stats: renderStats, settings: renderSettings };
  const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
  const focusName = active && active.form && active.name && active.type !== 'radio' ? { form: active.form.id, name: active.name, value: active.value } : null;
  if (focusName) return; // Nicht neu rendern, während der Nutzer tippt
  const prevFocus = focusSelector(document.activeElement);
  // Ungespeicherte Formulareingaben (Eintragsformular) über Re-Renders hinweg erhalten
  const drafts = ['entry-form', 'reminder-form'].map((id) => {
    const form = /** @type {HTMLFormElement | null} */ (document.getElementById(id));
    if (!form) return null;
    return { id, fields: /** @type {HTMLInputElement[]} */ ([...form.elements]).filter((el) => el.name).map((el) => ({ name: el.name, value: el.value, checked: el.checked, type: el.type })) };
  }).filter(Boolean);
  const dueCount = dueReminders(state.reminders, today()).length;
  app.innerHTML = `
    <header class="topbar">
      <span class="topbar-title" aria-hidden="true">${esc(TABS.find((t) => t.id === state.tab).label)}</span>
      <span class="topbar-right">
        <span class="sync ${state.sync}" role="status" title="${SYNC_LABEL[state.sync]}"><i aria-hidden="true"></i><span class="sync-text">${SYNC_LABEL[state.sync]}</span></span>
        <span class="me pc"${pc(state.name)}>${esc(personName(state.name))}</span>
      </span>
    </header>
    ${state.error ? `<div class="banner" role="alert">${esc(state.error)}</div>` : ''}
    ${state.sync === 'offline' && !state.error ? `<div class="banner" role="status">Keine Verbindung zum Server – Änderungen sind nur auf diesem Gerät gespeichert und werden später übertragen.</div>` : ''}
    <main class="content"><h1 class="page-title">${esc(TABS.find((t) => t.id === state.tab).label)}</h1>${views[state.tab]()}</main>
    <nav class="tabbar" aria-label="Hauptnavigation">
      ${TABS.map((t) => `<button class="tab ${t.id === state.tab ? 'active' : ''}" data-action="tab" data-tab="${t.id}"${t.id === state.tab ? ' aria-current="page"' : ''}>
        ${icon(t.icon)}<span>${t.short}</span>${t.id === 'reminders' && dueCount ? `<span class="badge" aria-label="${dueCount} fällig">${dueCount}</span>` : ''}</button>`).join('')}
    </nav>`;
  for (const draft of drafts) {
    const form = /** @type {HTMLFormElement | null} */ (document.getElementById(draft.id));
    if (!form) continue;
    for (const f of draft.fields) {
      const els = /** @type {HTMLInputElement[]} */ ([...form.elements]).filter((el) => el.name === f.name);
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
  onScroll();
  restoreFocus(prevFocus);
}
