import { addItem, replaceItem } from '../firebase.js';
import { REPEAT_OPTIONS, SHARED, TYPES, consumptionSeries, entryType, intervalLabel, recurringDue, recurringFromEntry, lastOdometer, odometerIssues, payerOf, sortEntries, validateEntry } from '../lib/model.js';
import { esc, eur, fmtDate, isoDate, monthLabel, num, parseNum } from '../lib/util.js';
import { render } from '../render.js';
import { carName, carOf, cars, cc, isCombustion, pc, people, personName, state, typeLabel, unit } from '../state.js';
import { icon, toast } from '../ui.js';

function renderRecurring() {
  if (!state.recurring.length) return '';
  const today = isoDate(new Date());
  return `<section class="card">
    <h3>Wiederkehrend</h3>
    <ul class="list">${state.recurring.map((r) => `<li class="item">
      <span class="car-tag cc"${cc(r.car)}>${esc(carOf(r.car)?.short || '?')}</span>
      <div class="grow">
        <strong>${eur.format(r.cost)}</strong> <span class="muted">${esc(typeLabel(r.type))} · ${intervalLabel(r.intervalMonths)}</span>
        <div class="note">nächste: ${fmtDate(recurringDue(r, today).next)}${r.note ? ` · ${esc(r.note)}` : ''}</div>
      </div>
      <button class="icon-btn small danger" data-action="delete-recurring" data-id="${esc(r.id)}" aria-label="Wiederholung beenden">${icon('trash')}</button>
    </li>`).join('')}</ul>
  </section>`;
}

/** Verbrauch je Tank-/Ladeeintrag (id → l bzw. kWh/100 km) */
function consumptionById() {
  const map = new Map();
  for (const c of cars()) for (const p of consumptionSeries(state.entries, c.id, isCombustion(c.id))) map.set(p.id, p.value);
  return map;
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
  return `
    <button class="btn primary block add-btn" data-action="open-entry">${icon('plus')}<span>Kosten erfassen</span></button>
    ${groups.length ? groups.map((g) => `
      <section class="card">
        <div class="group-head"><h3>${monthLabel(g.key + '-01')}</h3><span class="muted">${eur.format(g.total)}</span></div>
        <ul class="list">${g.items.map((e) => entryItem(e, cons.get(e.id))).join('')}</ul>
      </section>`).join('') : `
      <section class="card empty-state">
        <span class="empty-icon">${icon('fuel')}</span>
        <p><strong>Noch keine Einträge</strong></p>
        <p class="muted">Tanken, Laden, Werkstatt, Parken, Versicherung … einfach erfassen – die Auswertung rechnet den Rest.</p>
      </section>`}
    ${renderRecurring()}
    ${state.entrySheet ? renderEntrySheet() : ''}`;
}

export function renderEntrySheet() {
  const edit = state.entries.find((e) => e.id === state.entryEdit);
  const car = edit ? edit.car : carOf(state.entryCar) ? state.entryCar : cars()[0].id;
  const last = lastOdometer(state.entries, car);
  const type = edit ? entryType(edit) : state.entryType;
  const odo = edit ? (Number.isFinite(edit.odometer) ? edit.odometer : '') : last >= 0 ? last : '';
  const paidBy = edit ? payerOf(edit) || edit.createdBy : state.name;
  const dec = (/** @type {number | undefined} */ n) => (Number.isFinite(n) ? String(n).replace('.', ',') : '');
  return `
    <div class="overlay" data-action="close-entry">
      <form class="dialog" id="entry-form" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <div class="sheet-head">
          <h3 id="entry-title">${edit ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</h3>
          <button class="icon-btn" type="button" data-action="close-entry" aria-label="Schließen">${icon('close')}</button>
        </div>
        <div class="seg">
          ${cars().map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}" ${c.id === car ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        </div>
        <label><span>Art</span><select name="type">
          ${TYPES.map((t) => `<option value="${t.id}" ${t.id === type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select></label>
        <div class="row">
          <label><span>Datum</span><input type="date" name="date" value="${edit ? esc(edit.date) : isoDate(new Date())}" required></label>
          <label><span id="odo-label">Kilometerstand</span><input name="odometer" inputmode="numeric" pattern="[0-9]*" value="${odo}"></label>
        </div>
        <div class="row">
          <label id="amount-wrap"><span>Menge in <b id="unit">${unit(car)}</b></span><input name="amount" inputmode="decimal" placeholder="0,0" value="${edit ? dec(edit.amount) : ''}"></label>
          <label><span>Kosten in €</span><input name="cost" inputmode="decimal" placeholder="0,00" value="${edit ? dec(edit.cost) : ''}" required></label>
        </div>
        <p class="preview muted small" id="entry-preview" aria-live="polite">&nbsp;</p>
        <p class="warn" id="odo-warn" role="alert" hidden></p>
        <label class="check" id="full-wrap">
          <input type="checkbox" name="full" ${!edit || edit.full ? 'checked' : ''}> Vollgetankt
        </label>
        <fieldset>
          <legend>Bezahlt von</legend>
          <div class="seg">
            ${[...people(), { id: SHARED, name: personName(SHARED) }].map((p) => `<label class="seg-opt pc"${pc(p.id)}><input type="radio" name="paidBy" value="${p.id}" ${p.id === paidBy ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}
          </div>
        </fieldset>
        ${edit ? '' : `<label id="repeat-wrap"><span>Wiederholen</span><select name="repeat">
          ${REPEAT_OPTIONS.map((n) => `<option value="${n}">${n ? intervalLabel(n) : 'nie'}</option>`).join('')}
        </select></label>`}
        <label><span>Notiz</span><input name="note" maxlength="300" placeholder="optional" value="${edit ? esc(edit.note || '') : ''}"></label>
        <button class="btn primary block" type="submit">Speichern</button>
      </form>
    </div>`;
}

// Felder je nach Auto und Art ein-/ausblenden
export function updateEntryForm(form) {
  const f = new FormData(form);
  const car = String(f.get('car'));
  const fuel = f.get('type') === 'fuel';
  form.querySelector('#unit').textContent = unit(car);
  form.querySelector('#amount-wrap').hidden = !fuel;
  form.elements.amount.required = fuel;
  form.elements.odometer.required = fuel;
  form.querySelector('#odo-label').textContent = fuel ? 'Kilometerstand' : 'Kilometerstand (optional)';
  form.querySelector('#full-wrap').hidden = !(fuel && isCombustion(car));
  const repeat = form.querySelector('#repeat-wrap');
  if (repeat) repeat.hidden = fuel;
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
  const others = state.entries.filter((e) => e.id !== state.entryEdit);
  const last = lastOdometer(others, car);
  const parts = [];
  if (f.get('type') === 'fuel' && amount > 0 && cost >= 0) parts.push(`${num.format(cost / amount)} €/${unit(car)}`);
  const issues = odoRaw && Number.isInteger(odo) && date ? odometerIssues(others, car, date, odo) : [];
  if (!issues.length && odoRaw && last >= 0 && Number.isInteger(odo) && odo > last) parts.push(`+${num.format(odo - last)} km seit letztem Eintrag`);
  form.querySelector('#entry-preview').innerHTML = parts.length ? esc(parts.join(' · ')) : '&nbsp;';
  const warn = form.querySelector('#odo-warn');
  warn.textContent = issues.join(' · ');
  warn.hidden = !issues.length;
}

export function entryItem(e, consumption) {
  const type = entryType(e);
  const fuel = type === 'fuel';
  const per = fuel && e.amount > 0 ? ` · ${num.format(e.cost / e.amount)} €/${unit(e.car)}` : '';
  const cons = consumption != null ? ` · ${num.format(consumption)} ${unit(e.car)}/100 km` : '';
  const what = fuel ? `${num.format(e.amount)} ${unit(e.car)}${per}${cons}` : esc(typeLabel(type));
  const payer = payerOf(e);
  const details = [
    esc(carName(e.car)), fmtDate(e.date),
    Number.isFinite(e.odometer) ? `${num.format(e.odometer)} km` : '',
    fuel && isCombustion(e.car) ? (e.full ? 'voll' : 'teilweise') : '',
    payer ? `<i class="dot pc"${pc(payer)}></i>${esc(personName(payer))}` : '',
    e.note ? esc(e.note) : ''
  ].filter(Boolean).join(' · ');
  return `<li class="item">
    <span class="car-tag cc"${cc(e.car)}>${esc(carOf(e.car)?.short || '?')}</span>
    <div class="grow">
      <strong>${eur.format(e.cost)}</strong> <span class="muted">${what}</span>
      <div class="note">${details}</div>
    </div>
    <button class="icon-btn small" data-action="edit-entry" data-id="${esc(e.id)}" aria-label="Bearbeiten">${icon('edit')}</button>
    <button class="icon-btn small danger" data-action="delete-entry" data-id="${esc(e.id)}" aria-label="Löschen">${icon('trash')}</button>
  </li>`;
}

export function onEntryCarChange(form) {
  const car = String(new FormData(form).get('car'));
  state.entryCar = car;
  const last = lastOdometer(state.entries, car);
  form.elements.odometer.value = last >= 0 ? last : '';
  updateEntryForm(form);
}

export function submitEntry(form) {
  const f = new FormData(form);
  const edit = state.entries.find((e) => e.id === state.entryEdit);
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
  const repeat = data.type === 'fuel' ? 0 : Number(f.get('repeat')) || 0;
  let rec = null;
  if (repeat) {
    const r = recurringFromEntry(data, repeat);
    if (r.error) return toast(r.error);
    rec = r.data;
  }
  addItem(state.code, 'entries', data).catch((e) => toast('Fehler: ' + e.message));
  if (rec) addItem(state.code, 'recurring', rec).catch((e) => toast('Fehler: ' + e.message));
  state.entryType = data.type;
  state.entrySheet = false;
  render();
  toast(rec ? `Gespeichert · ${intervalLabel(repeat)}` : 'Gespeichert');
}
