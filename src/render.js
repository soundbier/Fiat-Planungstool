import { esc } from './lib/util.js';
import { pc, personName, state } from './state.js';
import { app, errText, focusBySelector, focusSelector, focusables, icon, initialOf, toast } from './ui.js';
import { renderCalendar, renderDayDialog, updateDayWarning } from './views/calendar.js';
import { renderEntries, renderEntrySheet, updateEntryForm } from './views/entries.js';
import { renderReminderSheet } from './views/reminders.js';
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

/* ---------- Navigation: drei Hauptpunkte, Einstellungen über das Profil oben rechts ---------- */
export const TABS = [
  { id: 'calendar', label: 'Kalender', icon: 'calendar-days' },
  { id: 'entries', label: 'Erfassen', icon: 'circle-plus' },
  { id: 'stats', label: 'Auswertung', icon: 'chart-column' }
];
const TITLES = { calendar: 'Kalender', entries: 'Erfassen', stats: 'Auswertung', settings: 'Einstellungen' };
const VIEWS = { calendar: renderCalendar, entries: renderEntries, stats: renderStats, settings: renderSettings };

const SYNC_LABEL = {
  synced: 'Synchronisiert',
  pending: 'Speichert …',
  connecting: 'Verbinde …',
  offline: 'Offline'
};

/** Formulare, deren ungespeicherte Eingaben Re-Renders überstehen */
const DRAFT_FORMS = ['entry-form', 'entry-edit', 'reminder-form'];

/** Welcher Dialog offen ist (für Fokus-Management) */
let lastDialog = null;
function openDialog() {
  return state.dayDialog ? 'day' : state.entrySheet ? 'entry' : state.reminderSheet ? 'reminder' : null;
}

/** Fokus nach dem Neuaufbau setzen: in neu geöffnete Dialoge, zurück zum Auslöser, sonst wie vorher. */
function restoreFocus(prevSel) {
  const dialog = openDialog();
  const box = /** @type {HTMLElement | null} */ (app.querySelector('.sheet'));
  if (dialog && dialog !== lastDialog && box) {
    const first = box.querySelector('input:checked') || focusables(box).find((el) => el.matches('input, select, textarea')) || focusables(box)[0];
    /** @type {HTMLElement} */ (first || box).focus({ preventScroll: true });
  } else if (!dialog && lastDialog) {
    if (!focusBySelector(state.returnFocus)) focusBySelector(prevSel);
    state.returnFocus = null;
  } else focusBySelector(prevSel);
  lastDialog = dialog;
}

function renderNotices() {
  const list = [];
  if (state.error) {
    list.push(`<div class="notice notice-error" role="alert">${icon('circle-alert')}<div class="notice-body"><p>${esc(state.error)}</p>
      <div class="notice-actions"><button class="btn-quiet" data-action="reload">${icon('refresh-cw')}Neu laden</button></div></div></div>`);
  } else if (state.sync === 'offline') {
    list.push(`<div class="notice" role="status">${icon('cloud-off')}<p>Offline. Änderungen werden übertragen, sobald wieder eine Verbindung besteht.</p></div>`);
  }
  return list.length ? `<div class="notices">${list.join('')}</div>` : '';
}

function renderSheet() {
  if (state.dayDialog) return renderDayDialog(state.dayDialog);
  if (state.entrySheet) return renderEntrySheet();
  if (state.reminderSheet) return renderReminderSheet();
  return '';
}

let frame = 0;
/** Render im nächsten Frame, mehrere Aufrufe (z. B. Snapshots aller Sammlungen) werden zusammengefasst. */
export function scheduleRender() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
}

export function render() {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  // Eigene Person wurde entfernt oder existiert in diesem Haushalt nicht
  if (!state.setupStep && state.code && state.setupLoaded && !state.setup.people.some((p) => p.id === state.name)) state.setupStep = 'name';
  if (state.setupStep) return renderSetup();
  const scroll = window.scrollY;
  const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
  if (active && active.form && active.name && active.type !== 'radio') return; // Nicht neu rendern, während der Nutzer tippt
  const prevFocus = focusSelector(document.activeElement);
  // Nur geänderte Formulare (data-dirty) übernehmen; unberührte zeigen frische Vorbelegungen
  const drafts = DRAFT_FORMS.map((id) => {
    const form = /** @type {HTMLFormElement | null} */ (document.getElementById(id));
    if (!form || !form.dataset.dirty) return null;
    return { id, mode: form.dataset.mode, fields: /** @type {HTMLInputElement[]} */ ([...form.elements]).filter((el) => el.name).map((el) => ({ name: el.name, value: el.value, checked: el.checked, type: el.type })) };
  }).filter(Boolean);
  const view = VIEWS[state.tab]();
  const sheet = renderSheet();
  const settingsOpen = state.tab === 'settings';
  const busySync = state.sync === 'pending' || state.sync === 'connecting';
  app.innerHTML = `
    <header class="appbar">
      <h1>${TITLES[state.tab]}</h1>
      <div class="appbar-end">
        <span class="sync" role="status">${busySync ? esc(SYNC_LABEL[state.sync]) : `<span class="sr-only">${SYNC_LABEL[state.sync]}</span>`}</span>
        <button class="avatar-btn" data-action="tab" data-tab="settings" aria-label="Einstellungen (${esc(personName(state.name))})"${settingsOpen ? ' aria-current="page"' : ''}${pc(state.name)}>
          <span class="avatar avatar-md" aria-hidden="true">${esc(initialOf(state.name))}</span>
        </button>
      </div>
    </header>
    ${renderNotices()}
    <main class="page" data-tab="${state.tab}">${view}</main>
    <nav class="tabbar" aria-label="Hauptnavigation">
      ${TABS.map((t) => `<button class="tab" data-action="tab" data-tab="${t.id}"${t.id === state.tab ? ' aria-current="page"' : ''}>${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
    </nav>
    ${sheet}`;
  document.body.classList.toggle('sheet-open', !!sheet);
  for (const draft of drafts) {
    const form = /** @type {HTMLFormElement | null} */ (document.getElementById(draft.id));
    if (!form || form.dataset.mode !== draft.mode) continue;
    form.dataset.dirty = '1';
    for (const f of draft.fields) {
      const els = /** @type {HTMLInputElement[]} */ ([...form.elements]).filter((el) => el.name === f.name);
      if (f.type === 'radio') { const r = els.find((el) => el.value === f.value); if (r && f.checked) r.checked = true; }
      else if (f.type === 'checkbox') els.forEach((el) => { el.checked = f.checked; });
      else els.forEach((el) => { el.value = f.value; });
    }
  }
  const dayForm = document.getElementById('day-form');
  if (dayForm) updateDayWarning(dayForm);
  app.querySelectorAll('form[data-form="entry"]').forEach(updateEntryForm);
  window.scrollTo(0, scroll);
  restoreFocus(prevFocus);
}
