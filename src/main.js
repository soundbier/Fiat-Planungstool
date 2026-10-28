import './style.css';
import { initPwa } from './pwa.js';
import { addItem, deleteItem, ensureAuth, removeMember, revokeInvites, setLocked } from './firebase.js';
import { createNewHousehold, enterHousehold, leaveHousehold, newInvite, refreshSync, rotateCode, setHousehold, shareHousehold } from './household.js';
import { ID_RE, REMINDER_PRESETS } from './lib/model.js';
import { CODE_RE, addDays, esc, firstOfMonth, isoDate, mondayOf, parseInvite } from './lib/util.js';
import { render, run } from './render.js';
import { DEFAULT_PREFS, LS_CODE, LS_NAME, applyPrefs, prefs, setPref, state } from './state.js';
import { app, blurActive, copyText, errText, focusBySelector, focusSelector, focusables, toast } from './ui.js';
import { copyWeek, resetWeek, saveDayCar, updateDayWarning } from './views/calendar.js';
import { exportCsv, exportJson, importFile } from './views/data.js';
import { onEntryCarChange, submitEntry, updateEntryForm, updateEntryPreview } from './views/entries.js';
import { submitKm } from './views/stats.js';
import { deleteReminder, reminderDone, submitReminder } from './views/reminders.js';
import { removeFromSetup, submitSetup } from './views/settings.js';

applyPrefs();

if (['calendar', 'entries', 'reminders', 'stats'].includes(prefs.startTab)) state.tab = prefs.startTab;

/* ---------- Events ---------- */
app.addEventListener('click', (ev) => {
  const el = /** @type {HTMLInputElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-action]'));
  if (!el) return;
  const { action } = el.dataset;
  switch (action) {
    case 'create':
      state.error = null;
      run(async () => {
        try { await createNewHousehold(); state.setupStep = 'created'; }
        catch (e) { state.error = 'Erstellen fehlgeschlagen: ' + errText(e); }
      });
      return;
    case 'confirm-created':
      state.setupStep = 'name';
      break;
    case 'reload': location.reload(); return;
    case 'share-invite':
      navigator.share({ title: 'Autoplaner', text: 'Einladung zum Autoplaner:', url: state.invite.link }).catch(() => {});
      return;
    case 'new-invite': run(newInvite); return;
    case 'revoke-invites':
      run(async () => { const n = await revokeInvites(state.code); state.invite = null; toast(`${n} Einladung(en) widerrufen`); });
      return;
    case 'toggle-lock': {
      const locked = el.checked;
      run(() => setLocked(state.code, locked), locked ? 'Haushalt gesperrt' : 'Beitritt mit Code erlaubt');
      return;
    }
    case 'remove-member':
      if (confirm('Dieses Gerät entfernen? Es verliert sofort den Zugriff.')) run(() => removeMember(state.code, el.dataset.id), 'Gerät entfernt');
      return;
    case 'show-code': state.showCode = true; break;
    case 'rotate-code':
      if (confirm('Code wirklich erneuern? Alle anderen Geräte verlieren den Zugriff und brauchen eine neue Einladung.')) {
        run(rotateCode, 'Neuer Code aktiv – jetzt neue Einladung erstellen');
      }
      return;
    case 'goto-join': state.error = null; state.setupStep = 'join'; break;
    case 'back-start': state.error = null; state.setupStep = 'start'; break;
    case 'set-name':
      state.name = el.dataset.name;
      localStorage.setItem(LS_NAME, state.name);
      state.setupStep = null;
      break;
    case 'copy': copyText(el.dataset.text); return;
    case 'share': shareHousehold(); return;
    case 'leave':
      if (confirm('Haushalt wirklich verlassen? Notiere dir vorher den Code, falls du später zurückkehren willst.')) leaveHousehold();
      return;
    case 'tab':
      state.tab = el.dataset.tab;
      state.dayDialog = null;
      state.entrySheet = false;
      state.reminderSheet = null;
      blurActive();
      app.innerHTML = '';
      render();
      window.scrollTo(0, 0);
      focusBySelector(`button[data-action="tab"][data-tab="${state.tab}"]`);
      return;
    case 'month':
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + Number(el.dataset.delta), 1);
      break;
    case 'period': state.statsPeriod = el.dataset.period; break;
    case 'open-day':
      state.returnFocus = focusSelector(el);
      state.selectedDay = el.dataset.day;
      state.dayDialog = el.dataset.day;
      break;
    case 'day-step':
      state.dayDialog = addDays(state.dayDialog, Number(el.dataset.delta));
      state.selectedDay = state.dayDialog;
      break;
    case 'month-today': state.month = firstOfMonth(new Date()); break;
    case 'cal-week': state.week = addDays(state.week, Number(el.dataset.delta)); break;
    case 'cal-week-today': state.week = mondayOf(isoDate(new Date())); break;
    case 'week':
      state.copyWeek = addDays(state.copyWeek || mondayOf(isoDate(new Date())), Number(el.dataset.delta));
      break;
    case 'open-entry': state.returnFocus = focusSelector(el); state.entryEdit = null; state.entrySheet = true; break;
    case 'edit-entry': state.returnFocus = focusSelector(el); state.entryEdit = el.dataset.id; state.entrySheet = true; break;
    case 'open-reminder': state.returnFocus = focusSelector(el); state.reminderSheet = el.dataset.id || 'new'; break;
    case 'close-reminder':
      if (ev.target !== el && !el.matches('button')) return;
      state.reminderSheet = null;
      break;
    case 'reminder-done': reminderDone(el.dataset.id); return;
    case 'delete-reminder': {
      const r = state.reminders.find((x) => x.id === el.dataset.id);
      if (r) deleteReminder(r);
      state.reminderSheet = null;
      break;
    }
    case 'remove-person': removeFromSetup('person', el.dataset.id); return;
    case 'remove-car': removeFromSetup('car', el.dataset.id); return;
    case 'export-json': exportJson(); return;
    case 'import': document.getElementById('import-file')?.click(); return;
    case 'close-entry':
      if (ev.target !== el && !el.matches('button')) return;
      state.entrySheet = false;
      state.entryEdit = null;
      break;
    case 'close-day':
      if (ev.target !== el && !el.matches('button')) return; // Klicks im Dialog nicht als Overlay-Klick werten
      state.dayDialog = null;
      break;
    case 'copy-week': copyWeek(); return;
    case 'reset-week': resetWeek(); return;
    case 'export-csv': exportCsv(); return;
    case 'pref': setPref(el.dataset.key, el.dataset.value); break;
    case 'reset-prefs': {
      const before = structuredClone(prefs);
      const restore = (p) => { Object.assign(prefs, p, { colors: { ...p.colors } }); setPref('theme', prefs.theme); render(); };
      restore(DEFAULT_PREFS);
      toast('Darstellung zurückgesetzt', { label: 'Rückgängig', run: () => restore(before) });
      return;
    }
    case 'delete-recurring': {
      const rec = state.recurring.find((r) => r.id === el.dataset.id);
      if (!rec || !confirm('Wiederholung beenden? Bereits erfasste Einträge bleiben erhalten.')) return;
      deleteItem(state.code, 'recurring', rec.id).catch((e) => toast('Fehler: ' + e.message));
      toast('Wiederholung beendet');
      break;
    }
    case 'delete-entry': {
      const entry = state.entries.find((e) => e.id === el.dataset.id);
      if (!entry) return;
      deleteItem(state.code, 'entries', entry.id).catch((e) => toast('Fehler: ' + e.message));
      toast('Eintrag gelöscht', {
        label: 'Rückgängig',
        run: () => {
          const { id, createdAt, ...data } = entry;
          addItem(state.code, 'entries', data).catch((e) => toast('Fehler: ' + e.message));
        }
      });
      return;
    }
    default: return;
  }
  render();
});

app.addEventListener('change', (ev) => {
  const target = /** @type {HTMLInputElement} */ (ev.target);
  if (target.id === 'import-file') {
    const file = target.files?.[0];
    target.value = '';
    if (file) importFile(file);
    return;
  }
  const form = target.form;
  if (form?.id === 'day-form') { updateDayWarning(form); saveDayCar(form, target.name); }
  if (form?.id === 'entry-form' && target.name === 'car') onEntryCarChange(form);
  if (form?.id === 'entry-form' && target.name === 'type') { state.entryType = target.value; updateEntryForm(form); }
  if (form?.id === 'reminder-form' && target.name === 'title') {
    const preset = REMINDER_PRESETS.find(([t]) => t === target.value);
    if (preset && !form.dataset.id) /** @type {HTMLSelectElement} */ (form.elements.namedItem('intervalMonths')).value = String(preset[1]);
  }
});

app.addEventListener('input', (ev) => {
  const target = /** @type {HTMLInputElement} */ (ev.target);
  const form = target.form;
  if (form?.id === 'entry-form') updateEntryPreview(form);
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = /** @type {HTMLFormElement} */ (ev.target);
  blurActive();
  if (form.id === 'day-form') return;
  if (form.id === 'entry-form') submitEntry(form);
  else if (form.id === 'reminder-form') submitReminder(form);
  else if (form.id === 'setup-form') submitSetup(form);
  else if (form.classList.contains('km-form')) submitKm(form);
  else if (form.id === 'join-form' || form.id === 'switch-form') {
    const parsed = parseInvite(new FormData(form).get('code'), location.origin);
    const isJoin = form.id === 'join-form';
    if (!parsed) {
      if (isJoin) { state.error = 'Ungültiger Link oder Code.'; render(); }
      else toast('Ungültiger Link oder Code');
      return;
    }
    state.error = null;
    run(async () => {
      try {
        await enterHousehold(parsed.code, parsed.invite);
        if (isJoin) state.setupStep = 'name';
        else { toast('Haushalt gewechselt'); state.tab = 'calendar'; }
      } catch (e) {
        if (isJoin) state.error = errText(e); else throw e;
      }
    });
  }
});

/* ---------- Tastatur: Dialoge schließen (Esc) und Fokus im Dialog halten (Tab) ---------- */

function closeDialog() {
  if (state.dayDialog) state.dayDialog = null;
  else if (state.entrySheet) state.entrySheet = false;
  else if (state.reminderSheet) state.reminderSheet = null;
  else return false;
  blurActive();
  render();
  return true;
}

document.addEventListener('keydown', (ev) => {
  const box = /** @type {HTMLElement | null} */ (app.querySelector('.dialog'));
  if (!box) return;
  if (ev.key === 'Escape') {
    if (closeDialog()) ev.preventDefault();
    return;
  }
  if (ev.key !== 'Tab') return;
  const list = focusables(box);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (!box.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
  else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
});

/* ---------- Wischgesten: Monat/Woche im Kalender, Tag im Tagesdialog ---------- */

let touch = null;
app.addEventListener('touchstart', (ev) => {
  const zone = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('[data-swipe]'));
  touch = zone && ev.touches.length === 1 ? { zone: zone.dataset.swipe, x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null;
}, { passive: true });
app.addEventListener('touchend', (ev) => {
  if (!touch) return;
  const dx = ev.changedTouches[0].clientX - touch.x;
  const dy = ev.changedTouches[0].clientY - touch.y;
  const zone = touch.zone;
  touch = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const dir = dx < 0 ? 1 : -1; // nach links wischen = vor
  if (zone === 'month') state.month = new Date(state.month.getFullYear(), state.month.getMonth() + dir, 1);
  else if (zone === 'week') state.week = addDays(state.week, 7 * dir);
  else if (zone === 'day' && state.dayDialog) {
    if (app.querySelector('#day-form')?.contains(document.activeElement)) blurActive();
    state.dayDialog = addDays(state.dayDialog, dir);
    state.selectedDay = state.dayDialog;
  } else return;
  render();
}, { passive: true });

window.addEventListener('online', refreshSync);
window.addEventListener('offline', refreshSync);

// Ausstehende Renderings nachholen, wenn ein Eingabefeld verlassen wird
// (nur nach Eingabefeldern – render() blockiert nur dort; sonst entstünde eine Schleife,
// weil das Ersetzen des fokussierten Elements selbst ein focusout auslöst)
app.addEventListener('focusout', (ev) => {
  const t = /** @type {HTMLInputElement} */ (ev.target);
  if (!t.form || !t.name || t.type === 'radio') return;
  setTimeout(() => {
    if (!app.contains(document.activeElement) || !(/** @type {HTMLInputElement} */ (document.activeElement).form)) render();
  }, 0);
});

/* ---------- Boot ---------- */
async function boot() {
  // Neues Format: /#h=CODE&i=TOKEN; altes /?h=CODE wird weiter akzeptiert.
  const link = parseInvite(location.href, location.origin);
  const linkCode = link?.code;
  if (location.hash || location.search) history.replaceState(null, '', location.pathname);

  try {
    await ensureAuth();
  } catch (e) {
    app.innerHTML = `<main class="setup"><h1>Verbindung fehlgeschlagen</h1><p class="error">${esc(e.message)}</p>
      <button class="btn primary block" data-action="reload">Erneut versuchen</button></main>`;
    return;
  }

  const storedCode = localStorage.getItem(LS_CODE);
  // Früher wurde der Anzeigename gespeichert ("Lukas"), jetzt die ID ("lukas")
  const storedName = (localStorage.getItem(LS_NAME) || '').toLowerCase();

  if (linkCode && CODE_RE.test(linkCode) && linkCode !== storedCode) {
    if (!storedCode || confirm('Diesem Haushalt beitreten? Der aktuelle Haushalt wird verlassen.')) {
      try {
        await enterHousehold(linkCode, link.invite);
      } catch (e) {
        state.error = 'Beitritt fehlgeschlagen: ' + errText(e);
        state.setupStep = 'start';
        return render();
      }
      state.name = ID_RE.test(storedName) ? storedName : null;
      state.setupStep = state.name ? null : 'name';
      return render();
    }
  }

  if (storedCode && CODE_RE.test(storedCode)) {
    // Bestehende Haushalte (vor Einführung der Mitgliedschaft) treten automatisch bei, solange nicht gesperrt.
    try { await enterHousehold(storedCode, null); }
    catch (e) { setHousehold(storedCode); state.error = 'Kein Zugriff: ' + errText(e); }
    if (ID_RE.test(storedName)) state.name = storedName;
    else state.setupStep = 'name';
  } else {
    state.setupStep = 'start';
  }
  render();
}

boot();
initPwa();
