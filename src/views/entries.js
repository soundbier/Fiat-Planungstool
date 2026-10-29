import { addItem, replaceItem } from '../firebase.js';
import { REPEAT_OPTIONS, SHARED, TYPES, consumptionSeries, entryType, intervalLabel, recurringDue, recurringFromEntry, lastOdometer, odometerIssues, payerOf, sortEntries, validateEntry } from '../lib/model.js';
import { esc, eur, isoDate, monthLabel, num, parseNum } from '../lib/util.js';
import { render } from '../render.js';
import { carOf, cars, isCombustion, people, personName, state, typeLabel, unit } from '../state.js';
import { avatar, carBadge, dateNum, icon, shortDay, toast } from '../ui.js';

/* ---------- Vorbelegung ---------- */

/** Auto: zuletzt gewählt, sonst heute für mich gebucht, sonst Auto meines letzten Eintrags, sonst das erste */
function defaultCar() {
  if (carOf(state.entryCar)) return state.entryCar;
  const today = isoDate(new Date());
  const booked = cars().find((c) => state.bookings.some((b) => b.date === today && b.car === c.id && b.driver === state.name));
  if (booked) return booked.id;
  const mine = sortEntries(state.entries).find((e) => e.createdBy === state.name && carOf(e.car));
  return mine ? mine.car : cars()[0].id;
}

/** Bisherige Notizen beim Tanken/Laden eines Autos (z. B. Ladeorte), neueste zuerst */
function fuelNotes(car) {
  const notes = sortEntries(state.entries).filter((e) => e.car === car && entryType(e) === 'fuel' && e.note).map((e) => e.note);
  return [...new Set(notes)].slice(0, 8);
}

const noteOptions = (car) => fuelNotes(car).map((n) => `<option value="${esc(n)}">`).join('');
const el = (form, name) => form.querySelector(`[data-el="${name}"]`);
const dec = (/** @type {number | undefined} */ n) => (Number.isFinite(n) ? String(n).replace('.', ',') : '');
const r1 = (v) => num.format(Math.round(v * 10) / 10);

/* ---------- Formular (neu inline, Bearbeiten im Sheet) ---------- */

function entryForm(edit) {
  const car = edit ? edit.car : defaultCar();
  const type = edit ? entryType(edit) : state.entryType;
  const last = lastOdometer(state.entries, car);
  const odo = edit ? (Number.isFinite(edit.odometer) ? edit.odometer : '') : last >= 0 ? last : '';
  const paidBy = edit ? payerOf(edit) || edit.createdBy : state.name;
  const note = edit ? edit.note || '' : type === 'fuel' ? fuelNotes(car)[0] || '' : '';
  const id = edit ? 'entry-edit' : 'entry-form';
  const payers = [...people(), { id: SHARED, name: 'Gemeinsam' }];
  return `
    <form id="${id}" data-form="entry" data-mode="${edit ? esc(edit.id) : 'new'}"${edit ? ` data-edit="${esc(edit.id)}"` : ` data-prefill="${esc(note)}"`} aria-label="${edit ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}">
      <fieldset>
        <legend class="sr-only">Auto</legend>
        <div class="seg">
          ${cars().map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}"${c.id === car ? ' checked' : ''}><span>${carBadge(c.id)}<span>${esc(c.name)}</span></span></label>`).join('')}
        </div>
      </fieldset>
      <label class="field"><span>Art</span><select name="type">
        ${TYPES.map((t) => `<option value="${t.id}"${t.id === type ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
      </select></label>
      <div class="field-row">
        <label class="field"><span>Datum</span><input type="date" name="date" value="${edit ? esc(edit.date) : isoDate(new Date())}" required></label>
        <label class="field"><span data-el="odo-label">Kilometerstand</span><input name="odometer" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="next" value="${odo}"></label>
      </div>
      <div class="field-row">
        <label class="field" data-el="amount"><span>Menge in <span data-el="unit">${unit(car)}</span></span><input name="amount" inputmode="decimal" autocomplete="off" enterkeyhint="next" placeholder="0,0" value="${edit ? dec(edit.amount) : ''}"></label>
        <label class="field" data-el="cost"><span>Kosten in €</span><input name="cost" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0,00" value="${edit ? dec(edit.cost) : ''}" required></label>
      </div>
      <p class="preview" data-el="preview" aria-live="polite"></p>
      <p class="notice" data-el="odo-warn" role="alert" hidden></p>
      <label class="check" data-el="full"><span>Vollgetankt</span><input class="switch" type="checkbox" role="switch" name="full"${!edit || edit.full ? ' checked' : ''}></label>
      <fieldset class="field">
        <legend class="field-label">Bezahlt von</legend>
        <div class="seg">
          ${payers.map((p) => `<label class="seg-opt"><input type="radio" name="paidBy" value="${p.id}"${p.id === paidBy ? ' checked' : ''}${p.id === SHARED ? ` aria-label="${esc(personName(SHARED))}"` : ''}><span>${avatar(p.id, 'xs')}<span>${esc(p.name)}</span></span></label>`).join('')}
        </div>
      </fieldset>
      ${edit ? '' : `<label class="field" data-el="repeat"><span>Wiederholen</span><select name="repeat">
        ${REPEAT_OPTIONS.map((n) => `<option value="${n}">${n ? intervalLabel(n) : 'nie'}</option>`).join('')}
      </select></label>`}
      <label class="field"><span>Notiz</span><input name="note" maxlength="300" list="${id}-notes" autocomplete="off" placeholder="optional" value="${esc(note)}"></label>
      <datalist id="${id}-notes">${noteOptions(car)}</datalist>
      <button class="btn btn-primary btn-block" type="submit">${edit ? 'Speichern' : 'Eintragen'}</button>
      ${edit ? `<button class="btn btn-danger btn-block" type="button" data-action="delete-entry" data-id="${esc(edit.id)}">Eintrag löschen</button>` : ''}
    </form>`;
}

export function renderEntrySheet() {
  const edit = state.entries.find((e) => e.id === state.entryEdit);
  if (!edit) { state.entrySheet = false; state.entryEdit = null; return ''; }
  return `
    <div class="overlay" data-action="close-entry">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <div class="sheet-head">
          <h2 id="entry-title">Eintrag bearbeiten</h2>
          <button class="icon-btn" type="button" data-action="close-entry" aria-label="Schließen">${icon('x')}</button>
        </div>
        ${entryForm(edit)}
      </div>
    </div>`;
}

// Felder je nach Auto und Art ein-/ausblenden
export function updateEntryForm(form) {
  const f = new FormData(form);
  const car = String(f.get('car'));
  const fuel = f.get('type') === 'fuel';
  const odo = f.get('type') === 'odo';
  el(form, 'unit').textContent = unit(car);
  el(form, 'amount').hidden = !fuel;
  form.elements.amount.required = fuel;
  form.elements.odometer.required = fuel || odo;
  el(form, 'odo-label').textContent = fuel || odo ? 'Kilometerstand' : 'Kilometerstand (optional)';
  el(form, 'cost').hidden = odo;
  form.elements.cost.required = !odo;
  el(form, 'full').hidden = !(fuel && isCombustion(car));
  const repeat = el(form, 'repeat');
  if (repeat) repeat.hidden = fuel || odo;
  form.elements.note.placeholder = fuel ? `optional, z. B. ${isCombustion(car) ? 'Tankstelle' : 'Ladeort'}` : 'optional';
  updateEntryPreview(form);
}

export function updateEntryPreview(form) {
  const f = new FormData(form);
  const car = String(f.get('car'));
  const amount = parseNum(f.get('amount'));
  const cost = parseNum(f.get('cost'));
  const odoRaw = String(f.get('odometer') || '').trim();
  const odo = Number(odoRaw);
  const date = String(f.get('date') || '');
  const others = state.entries.filter((e) => e.id !== form.dataset.edit);
  const last = lastOdometer(others, car);
  const parts = [];
  if (f.get('type') === 'fuel' && amount > 0 && cost >= 0) parts.push(`${num.format(cost / amount)} €/${unit(car)}`);
  const issues = odoRaw && Number.isInteger(odo) && date ? odometerIssues(others, car, date, odo) : [];
  if (!issues.length && odoRaw && last >= 0 && Number.isInteger(odo) && odo > last) parts.push(`+${num.format(odo - last)} km seit letztem Eintrag`);
  el(form, 'preview').textContent = parts.join(' · ');
  const warn = el(form, 'odo-warn');
  warn.textContent = issues.join(' · ');
  warn.hidden = !issues.length;
}

/** Vorbelegte Notiz (letzter Ladeort) beim Wechsel von Auto oder Art nachziehen, solange sie unverändert ist */
export function syncNotePrefill(form) {
  if (form.dataset.mode !== 'new') return;
  const f = new FormData(form);
  const car = String(f.get('car'));
  const next = f.get('type') === 'fuel' ? fuelNotes(car)[0] || '' : '';
  const note = form.elements.note;
  if (note.value === (form.dataset.prefill || '')) note.value = next;
  form.dataset.prefill = next;
  form.querySelector('datalist').innerHTML = noteOptions(car);
}

export function onEntryCarChange(form) {
  const car = String(new FormData(form).get('car'));
  if (form.dataset.mode === 'new') state.entryCar = car;
  const last = lastOdometer(state.entries, car);
  form.elements.odometer.value = last >= 0 ? last : '';
  syncNotePrefill(form);
  updateEntryForm(form);
}

export function submitEntry(form) {
  const f = new FormData(form);
  const edit = form.dataset.edit ? state.entries.find((e) => e.id === form.dataset.edit) : null;
  if (form.dataset.edit && !edit) {
    state.entrySheet = false;
    state.entryEdit = null;
    render();
    return toast('Eintrag existiert nicht mehr');
  }
  const res = validateEntry({
    car: f.get('car'), type: f.get('type'), date: f.get('date'), odometer: f.get('odometer'),
    amount: f.get('amount'), cost: f.get('cost'), full: f.get('full'), note: f.get('note'),
    createdBy: edit ? edit.createdBy : state.name, paidBy: f.get('paidBy')
  }, state.setup, state.name);
  if (res.error) return toast(res.error);
  const data = res.data;
  const others = state.entries.filter((e) => e !== edit);
  const issues = data.odometer != null ? odometerIssues(others, data.car, data.date, data.odometer) : [];
  if (issues.length && !confirm(`${issues.join('\n')}\n\nTrotzdem speichern?`)) return;
  if (edit) {
    replaceItem(state.code, 'entries', edit.id, { ...data, createdAt: edit.createdAt }).catch((e) => toast('Fehler: ' + e.message));
    state.entrySheet = false;
    state.entryEdit = null;
    render();
    return toast('Gespeichert');
  }
  const repeat = data.type === 'fuel' || data.type === 'odo' ? 0 : Number(f.get('repeat')) || 0;
  let rec = null;
  if (repeat) {
    const r = recurringFromEntry(data, repeat);
    if (r.error) return toast(r.error);
    rec = r.data;
  }
  // Vor dem Schreiben zurücksetzen: der Snapshot kann sofort neu rendern
  state.entryType = data.type;
  state.entryCar = data.car;
  delete form.dataset.dirty;
  addItem(state.code, 'entries', data).catch((e) => toast('Fehler: ' + e.message));
  if (rec) addItem(state.code, 'recurring', rec).catch((e) => toast('Fehler: ' + e.message));
  render();
  toast(rec ? `Gespeichert · ${intervalLabel(repeat)}` : 'Gespeichert');
}

/* ---------- Verlauf ---------- */

/** Verbrauch je Tank-/Ladeeintrag (id → l bzw. kWh/100 km) */
function consumptionById() {
  const map = new Map();
  for (const c of cars()) for (const p of consumptionSeries(state.entries, c.id, isCombustion(c.id))) map.set(p.id, p.value);
  return map;
}

function entryRow(e, consumption) {
  const type = entryType(e);
  const fuel = type === 'fuel';
  const u = unit(e.car);
  const title = fuel ? `${typeLabel(type, e.car)} · ${num.format(e.amount)} ${u}` : esc(typeLabel(type, e.car));
  const sub = [
    shortDay(e.date),
    Number.isFinite(e.odometer) ? `${num.format(e.odometer)} km` : '',
    fuel && e.amount > 0 ? `${num.format(e.cost / e.amount)} €/${u}` : '',
    consumption != null ? `${r1(consumption)} ${u}/100 km` : '',
    fuel && isCombustion(e.car) && !e.full ? 'teilweise' : '',
    e.note ? esc(e.note) : ''
  ].filter(Boolean).join(' · ');
  const payer = payerOf(e);
  return `<li><button class="row" data-action="edit-entry" data-id="${esc(e.id)}">
    ${carBadge(e.car)}
    <span class="row-main"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span>
    <span class="row-end">${type === 'odo' ? '' : `<span class="row-amount">${eur.format(e.cost)}</span>`}${payer ? `<span class="person">${avatar(payer, 'xs')}<span>${esc(personName(payer))}</span></span>` : ''}</span>
  </button></li>`;
}

function renderRecurring() {
  if (!state.recurring.length) return '';
  const today = isoDate(new Date());
  return `
    <section class="section" aria-labelledby="recurring-title">
      <h2 class="section-title" id="recurring-title">Wiederkehrend</h2>
      <ul class="rows">${state.recurring.map((r) => `
        <li class="row-split">
          <div class="row">
            ${carBadge(r.car)}
            <span class="row-main">
              <span class="row-title">${esc(typeLabel(r.type))}</span>
              <span class="row-sub">${intervalLabel(r.intervalMonths)} · nächste ${dateNum(recurringDue(r, today).next)}${r.note ? ` · ${esc(r.note)}` : ''}</span>
            </span>
            <span class="row-end"><span class="row-amount">${eur.format(r.cost)}</span></span>
          </div>
          <button class="icon-btn" data-action="delete-recurring" data-id="${esc(r.id)}" aria-label="Wiederholung ${esc(typeLabel(r.type))} beenden">${icon('x')}</button>
        </li>`).join('')}</ul>
    </section>`;
}

export function renderEntries() {
  const list = sortEntries(state.entries);
  const cons = consumptionById();
  const groups = [];
  for (const e of list) {
    const key = e.date.slice(0, 7);
    if (groups[groups.length - 1]?.key !== key) groups.push({ key, items: [], total: 0 });
    const g = groups[groups.length - 1];
    g.items.push(e);
    g.total += e.cost;
  }
  const loading = state.sync === 'connecting' && !list.length;
  return `
    ${entryForm(null)}
    <section class="section" aria-labelledby="history-title">
      <h2 class="section-title" id="history-title">Verlauf</h2>
      ${loading ? '<p class="muted">Lädt …</p>' : groups.length ? groups.map((g) => `
        <div class="group">
          <div class="group-head"><h3>${monthLabel(g.key + '-01')}</h3><span>${eur.format(g.total)}</span></div>
          <ul class="rows">${g.items.map((e) => entryRow(e, cons.get(e.id))).join('')}</ul>
        </div>`).join('') : `
        <div class="empty">
          ${icon('receipt')}
          <p class="empty-title">Noch keine Einträge</p>
          <p>Tanken, Laden, Werkstatt oder Versicherung oben eintragen. Die Auswertung rechnet daraus Verbrauch und Kosten.</p>
        </div>`}
    </section>
    ${renderRecurring()}`;
}
