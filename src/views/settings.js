import { auth, saveSetup } from '../firebase.js';
import { INVITE_HOURS } from '../household.js';
import { MAX_ITEMS, sanitizeSetup, slugId } from '../lib/model.js';
import { esc, fmtTime, isoDate, mondayOf, shortRange, weekNumber } from '../lib/util.js';
import { TABS, render } from '../render.js';
import { SWATCHES, applyColors, cars, pc, people, prefs, state } from '../state.js';
import { errText, icon, toast } from '../ui.js';
import { inviteBox } from './setup.js';

/* ---------- Settings ---------- */
const SWATCH_NAMES = ['Blau', 'Rot', 'Petrol', 'Lila', 'Orange', 'Grün', 'Pink', 'Grau'];

export function segPref(key, options, cur) {
  return `<div class="seg">${options.map(([v, l]) => `
    <button class="seg-opt btn-seg ${v === cur ? 'active' : ''}" data-action="pref" data-key="${key}" data-value="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
}

export function renderSettings() {
  const week = mondayOf(isoDate(new Date()));
  return `
    <section class="card">
      <h3>Du bist</h3>
      <div class="seg">${people().map((p) => `
        <button class="seg-opt btn-seg pc ${p.id === state.name ? 'active' : ''}"${pc(p.id)} data-action="set-name" data-name="${p.id}" aria-pressed="${p.id === state.name}">${esc(p.name)}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h3>Personen & Autos</h3>
      <form id="setup-form">
        <p class="set-label">Personen</p>
        ${people().map((p) => `<div class="edit-row">
          <i class="dot pc"${pc(p.id)}></i>
          <input name="p-${p.id}" value="${esc(p.name)}" maxlength="20" required aria-label="Name">
          <button class="icon-btn small danger" type="button" data-action="remove-person" data-id="${p.id}" aria-label="${esc(p.name)} entfernen">${icon('close')}</button>
        </div>`).join('')}
        ${people().length < MAX_ITEMS ? '<input name="new-person" maxlength="20" placeholder="Person hinzufügen" aria-label="Neue Person">' : ''}
        <p class="set-label">Autos</p>
        ${cars().map((c) => `<div class="edit-row">
          <input class="short" name="cs-${c.id}" value="${esc(c.short)}" maxlength="2" required aria-label="Kürzel">
          <input name="c-${c.id}" value="${esc(c.name)}" maxlength="30" required aria-label="Name">
          <select name="ck-${c.id}" aria-label="Antrieb">${kindOptions(c.kind)}</select>
          <button class="icon-btn small danger" type="button" data-action="remove-car" data-id="${c.id}" aria-label="${esc(c.name)} entfernen">${icon('close')}</button>
        </div>`).join('')}
        ${cars().length < MAX_ITEMS ? `<div class="edit-row">
          <input name="new-car" maxlength="30" placeholder="Auto hinzufügen" aria-label="Neues Auto">
          <select name="new-car-kind" aria-label="Antrieb">${kindOptions('fuel')}</select>
        </div>` : ''}
        <button class="btn block" type="submit">Speichern</button>
      </form>
      <p class="muted small">Gilt für alle Geräte im Haushalt. Beim Entfernen bleiben bestehende Einträge erhalten.</p>
    </section>
    <section class="card">
      <h3>Darstellung</h3>
      <p class="set-label">Modus</p>
      ${segPref('theme', [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']], prefs.theme)}
      <p class="set-label">Farbschema</p>
      ${segPref('scheme', [['warm', 'Warm'], ['cool', 'Kühl'], ['green', 'Grün'], ['contrast', 'Kontrast']], prefs.scheme)}
      ${people().map((p, i) => { const k = p.id; const cur = prefs.colors[k] || SWATCHES[i % SWATCHES.length]; return `
      <p class="set-label">Farbe ${esc(p.name)}</p>
      <div class="swatches" role="group" aria-label="Farbe ${esc(p.name)}">${SWATCHES.map((c, j) => `
        <button class="swatch ${cur === c ? 'active' : ''}" style="background:${c}" data-action="pref" data-key="color-${k}" data-value="${c}" aria-label="${SWATCH_NAMES[j]}" aria-pressed="${cur === c}"></button>`).join('')}</div>`; }).join('')}
      <p class="set-label">Schriftgröße</p>
      ${segPref('size', [['normal', 'Normal'], ['large', 'Groß']], prefs.size)}
      <p class="set-label">Start-Ansicht</p>
      ${segPref('startTab', TABS.slice(0, 4).map((t) => [t.id, t.short]), prefs.startTab)}
      <button class="btn link block" data-action="reset-prefs">Darstellung zurücksetzen</button>
    </section>
    <section class="card">
      <h3>Kalender</h3>
      <button class="btn danger block" data-action="reset-week">Aktuelle Woche zurücksetzen</button>
      <p class="muted small">Löscht alle Einteilungen der KW ${weekNumber(week)} (${shortRange(week)}) für alle Autos.</p>
    </section>
    <section class="card">
      <h3>Daten</h3>
      <button class="btn block" data-action="export-json">Backup herunterladen (JSON)</button>
      <button class="btn block" data-action="export-csv">Kosten als CSV exportieren</button>
      <button class="btn block" data-action="import" ${state.busy ? 'disabled' : ''}>Backup / CSV importieren</button>
      <input type="file" id="import-file" accept=".json,.csv,application/json,text/csv" hidden>
      <p class="muted small">${state.entries.length} Kosteneinträge · ${state.bookings.length} Kalender-Einteilungen · ${state.reminders.length} Fristen.
        Import ergänzt nur – vorhandene Einträge werden nicht doppelt angelegt. CSV im Format des Exports (Spalten Datum, Auto, Art, Kilometerstand, Menge, Kosten EUR …).</p>
    </section>
    <section class="card">
      <h3>Einladen</h3>
      ${state.invite ? inviteBox() : ''}
      <button class="btn block" data-action="new-invite" ${state.busy ? 'disabled' : ''}>${state.invite ? 'Neue Einladung erstellen' : 'Einladung erstellen'}</button>
      <button class="btn link block" data-action="revoke-invites" ${state.busy ? 'disabled' : ''}>Offene Einladungen widerrufen</button>
      <p class="muted small">Einladungen gelten ${INVITE_HOURS} h und nur für ein Gerät.</p>
    </section>
    <section class="card">
      <h3>Geräte</h3>
      <label class="check"><input type="checkbox" data-action="toggle-lock" ${state.config.locked ? 'checked' : ''} ${state.busy ? 'disabled' : ''}>
        Beitritt nur mit Einladung</label>
      <p class="muted small">${state.config.locked ? 'Der Code allein reicht nicht, um beizutreten.' : 'Achtung: Jeder mit dem Code kann beitreten.'}</p>
      <ul class="device-list">${state.members.map((m) => {
        const me = m.id === auth.currentUser?.uid;
        const since = m.joinedAt?.toMillis ? fmtTime(m.joinedAt.toMillis()) : '';
        return `<li><span>${esc(m.device || 'Gerät')}${me ? ' <b>(dieses Gerät)</b>' : ''}<br><span class="muted small">seit ${esc(since)}</span></span>
          ${me ? '' : `<button class="btn danger btn-sm" data-action="remove-member" data-id="${esc(m.id)}" ${state.busy ? 'disabled' : ''}>Entfernen</button>`}</li>`;
      }).join('')}</ul>
    </section>
    <section class="card">
      <h3>Haushaltscode</h3>
      ${state.showCode ? `<div class="code-box">${esc(state.code)}</div>
      <button class="btn block" data-action="copy" data-text="${esc(state.code)}">Code kopieren</button>`
      : `<button class="btn block" data-action="show-code">Code anzeigen</button>`}
      <button class="btn danger block" data-action="rotate-code" ${state.busy ? 'disabled' : ''}>Code erneuern</button>
      <p class="muted small">Falls der Code in falsche Hände geraten ist: Alle Daten ziehen in einen neuen Haushalt um, alle anderen Geräte verlieren den Zugriff und brauchen eine neue Einladung.</p>
    </section>
    <section class="card">
      <h3>Anderem Haushalt beitreten</h3>
      <form id="switch-form">
        <label>Einladungslink oder Code<input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
        <button class="btn block" type="submit">Wechseln</button>
      </form>
    </section>
    <section class="card">
      <button class="btn danger block" data-action="leave">Haushalt verlassen</button>
      <p class="muted small">Die Daten bleiben im Haushalt erhalten. Ohne Code ist kein erneuter Zugriff möglich.</p>
    </section>`;
}

export function kindOptions(kind) {
  return [['fuel', 'Verbrenner'], ['electric', 'Elektro']]
    .map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${l}</option>`).join('');
}

export function submitSetup(form) {
  const f = new FormData(form);
  const val = (k) => String(f.get(k) || '').trim();
  const setup = {
    people: people().map((p) => ({ id: p.id, name: (val(`p-${p.id}`) || p.name).slice(0, 20) })),
    cars: cars().map((c) => {
      const name = (val(`c-${c.id}`) || c.name).slice(0, 30);
      return { id: c.id, name, short: (val(`cs-${c.id}`) || name[0]).slice(0, 2), kind: f.get(`ck-${c.id}`) === 'electric' ? 'electric' : 'fuel' };
    })
  };
  const np = val('new-person').slice(0, 20);
  if (np) setup.people.push({ id: slugId(np, setup.people.map((p) => p.id)), name: np });
  const nc = val('new-car').slice(0, 30);
  if (nc) setup.cars.push({ id: slugId(nc, setup.cars.map((c) => c.id)), name: nc, short: nc[0].toUpperCase(), kind: f.get('new-car-kind') === 'electric' ? 'electric' : 'fuel' });
  storeSetup(setup, 'Gespeichert');
}

export function storeSetup(setup, msg) {
  setup = sanitizeSetup(setup);
  state.setup = setup;
  applyColors();
  saveSetup(state.code, setup).then(() => msg && toast(msg), (e) => toast('Fehler: ' + errText(e)));
  render();
}

export function removeFromSetup(kind, id) {
  const list = kind === 'person' ? people() : cars();
  const item = list.find((x) => x.id === id);
  if (!item) return;
  if (list.length <= 1) return toast(kind === 'person' ? 'Mindestens eine Person nötig' : 'Mindestens ein Auto nötig');
  const what = kind === 'person' ? 'Person' : 'Auto';
  const before = structuredClone(state.setup);
  const setup = structuredClone(state.setup);
  if (kind === 'person') setup.people = setup.people.filter((p) => p.id !== id);
  else setup.cars = setup.cars.filter((c) => c.id !== id);
  storeSetup(setup);
  // Bestehende Einträge bleiben erhalten; Wiederherstellen ordnet sie wieder zu
  toast(`${what} „${item.name}“ entfernt`, { label: 'Rückgängig', run: () => storeSetup(before, 'Wiederhergestellt') });
}
