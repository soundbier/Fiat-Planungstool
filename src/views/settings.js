import { auth, saveSetup } from '../firebase.js';
import { INVITE_HOURS } from '../household.js';
import { MAX_ITEMS, sanitizeSetup, slugId } from '../lib/model.js';
import { esc, fmtTime, isoDate, mondayOf, shortRange, weekNumber } from '../lib/util.js';
import { TABS, render } from '../render.js';
import { applyColors, cars, cc, people, prefs, state } from '../state.js';
import { avatar, errText, icon, toast } from '../ui.js';
import { inviteBox } from './setup.js';

/* ---------- Einstellungen ---------- */
export function segPref(key, options, cur, label) {
  return `<div class="seg" role="group" aria-label="${esc(label)}">${options.map(([v, l]) => `
    <button class="seg-btn" data-action="pref" data-key="${key}" data-value="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
}

function setting(label, control) {
  return `<div class="setting"><span class="setting-label">${label}</span>${control}</div>`;
}

export function renderSettings() {
  const week = mondayOf(isoDate(new Date()));
  const busy = state.busy ? ' disabled' : '';
  return `
    <section class="section" aria-labelledby="me-title">
      <h2 class="section-title" id="me-title">Ich bin</h2>
      <div class="seg" role="group" aria-label="Ich bin">${people().map((p) => `
        <button class="seg-btn" data-action="set-name" data-name="${p.id}" aria-pressed="${p.id === state.name}">${avatar(p.id, 'xs')}${esc(p.name)}</button>`).join('')}</div>
    </section>

    <section class="section" aria-labelledby="look-title">
      <h2 class="section-title" id="look-title">Darstellung</h2>
      ${setting('Erscheinungsbild', segPref('theme', [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']], prefs.theme, 'Erscheinungsbild'))}
      ${setting('Schriftgröße', segPref('size', [['normal', 'Normal'], ['large', 'Groß']], prefs.size, 'Schriftgröße'))}
      ${setting('Beim Öffnen', segPref('startTab', TABS.map((t) => [t.id, t.label]), prefs.startTab, 'Beim Öffnen'))}
    </section>

    <section class="section" aria-labelledby="setup-title">
      <h2 class="section-title" id="setup-title">Personen und Autos</h2>
      <form id="setup-form">
        <div class="setting"><span class="setting-label">Personen</span><div class="edit-list">
          ${people().map((p) => `<div class="edit-row">
            ${avatar(p.id)}
            <input name="p-${p.id}" value="${esc(p.name)}" maxlength="20" required aria-label="Name" autocomplete="off">
            <button class="icon-btn" type="button" data-action="remove-person" data-id="${p.id}" aria-label="${esc(p.name)} entfernen">${icon('x')}</button>
          </div>`).join('')}
          ${people().length < MAX_ITEMS ? '<input name="new-person" maxlength="20" placeholder="Person hinzufügen" aria-label="Neue Person" autocomplete="off">' : ''}
        </div></div>
        <div class="setting"><span class="setting-label">Autos</span><div class="edit-list">
          ${cars().map((c) => `<div class="edit-row"${cc(c.id)}>
            <input class="short car-short" name="cs-${c.id}" value="${esc(c.short)}" maxlength="2" required aria-label="Kürzel" autocomplete="off">
            <input name="c-${c.id}" value="${esc(c.name)}" maxlength="30" required aria-label="Name" autocomplete="off">
            <select name="ck-${c.id}" aria-label="Antrieb">${kindOptions(c.kind)}</select>
            <button class="icon-btn" type="button" data-action="remove-car" data-id="${c.id}" aria-label="${esc(c.name)} entfernen">${icon('x')}</button>
          </div>`).join('')}
          ${cars().length < MAX_ITEMS ? `<div class="edit-row">
            <input name="new-car" maxlength="30" placeholder="Auto hinzufügen" aria-label="Neues Auto" autocomplete="off">
            <select name="new-car-kind" aria-label="Antrieb">${kindOptions('fuel')}</select>
          </div>` : ''}
        </div></div>
        <button class="btn btn-block" type="submit">Speichern</button>
      </form>
      <p class="footnote">Gilt für alle Geräte im Haushalt. Beim Entfernen bleiben bestehende Einträge erhalten.</p>
    </section>

    <section class="section" aria-labelledby="data-title">
      <h2 class="section-title" id="data-title">Daten</h2>
      <div class="list">
        <button class="list-btn" data-action="export-json">${icon('download')}Backup herunterladen (JSON)</button>
        <button class="list-btn" data-action="export-csv">${icon('download')}Kosten als CSV exportieren</button>
        <button class="list-btn" data-action="import"${busy}>${icon('upload')}Backup oder CSV importieren</button>
        <button class="list-btn danger" data-action="reset-week">${icon('trash-2')}KW ${weekNumber(week)} leeren</button>
      </div>
      <input type="file" id="import-file" accept=".json,.csv,application/json,text/csv" hidden>
      <p class="footnote">${state.entries.length} Kosteneinträge · ${state.bookings.length} Kalendertage · ${state.reminders.length} Fristen.
        Import ergänzt nur, doppelte Einträge werden übersprungen. „Leeren“ entfernt alle Einteilungen vom ${shortRange(week)}.</p>
    </section>

    <section class="section" aria-labelledby="invite-title">
      <h2 class="section-title" id="invite-title">Einladen</h2>
      ${state.invite ? inviteBox() : ''}
      <div class="list">
        <button class="list-btn" data-action="new-invite"${busy}>${icon('user-plus')}${state.invite ? 'Neue Einladung erstellen' : 'Einladung erstellen'}</button>
        <button class="list-btn" data-action="revoke-invites"${busy}>${icon('x')}Offene Einladungen widerrufen</button>
      </div>
      <p class="footnote">Einladungen gelten ${INVITE_HOURS} Stunden und nur für ein Gerät.</p>
    </section>

    <section class="section" aria-labelledby="devices-title">
      <h2 class="section-title" id="devices-title">Geräte</h2>
      <label class="check"><span>Beitritt nur mit Einladung</span>
        <input class="switch" type="checkbox" role="switch" data-action="toggle-lock"${state.config.locked ? ' checked' : ''}${busy}></label>
      <p class="footnote">${state.config.locked ? 'Der Code allein reicht nicht, um beizutreten.' : 'Jeder mit dem Code kann beitreten.'}</p>
      <ul>${state.members.map((m) => {
        const me = m.id === auth.currentUser?.uid;
        const since = m.joinedAt?.toMillis ? fmtTime(m.joinedAt.toMillis()) : '';
        return `<li class="device">
          <div>${icon('smartphone')}<span class="row-main"><span class="row-title">${esc(m.device || 'Gerät')}</span><span class="row-sub">${me ? 'Dieses Gerät' : `seit ${esc(since)}`}</span></span></div>
          ${me ? '' : `<button class="btn btn-danger" data-action="remove-member" data-id="${esc(m.id)}"${busy}>Entfernen</button>`}
        </li>`;
      }).join('')}</ul>
    </section>

    <section class="section" aria-labelledby="code-title">
      <h2 class="section-title" id="code-title">Haushaltscode</h2>
      ${state.showCode ? `<div class="code-box">${esc(state.code)}</div>` : ''}
      <div class="list">
        ${state.showCode
          ? `<button class="list-btn" data-action="copy" data-text="${esc(state.code)}">${icon('copy')}Code kopieren</button>`
          : `<button class="list-btn" data-action="show-code">${icon('key-round')}Code anzeigen</button>`}
        <button class="list-btn danger" data-action="rotate-code"${busy}>${icon('refresh-cw')}Code erneuern</button>
      </div>
      <p class="footnote">Falls der Code in falsche Hände geraten ist: Alle Daten ziehen in einen neuen Haushalt um, alle anderen Geräte verlieren den Zugriff und brauchen eine neue Einladung.</p>
    </section>

    <section class="section" aria-labelledby="switch-title">
      <h2 class="section-title" id="switch-title">Anderem Haushalt beitreten</h2>
      <form id="switch-form">
        <label class="field"><span>Einladungslink oder Code</span><input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
        <button class="btn btn-block" type="submit">Wechseln</button>
      </form>
    </section>

    <section class="section">
      <div class="list">
        <button class="list-btn danger" data-action="leave">${icon('log-out')}Haushalt verlassen</button>
      </div>
      <p class="footnote">Die Daten bleiben im Haushalt erhalten. Ohne Code ist kein erneuter Zugriff möglich.</p>
    </section>`;
}

export function kindOptions(kind) {
  return [['fuel', 'Verbrenner'], ['electric', 'Elektro']]
    .map(([v, l]) => `<option value="${v}"${v === kind ? ' selected' : ''}>${l}</option>`).join('');
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
