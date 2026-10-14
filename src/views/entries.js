import { addItem } from '../firebase.js';
import { TYPES, entryType, lastOdometer, payerOf, sortEntries, validateEntry } from '../lib/model.js';
import { esc, eur, fmtDate, isoDate, monthLabel, num, parseNum } from '../lib/util.js';
import { render } from '../render.js';
import { carName, carOf, cars, cc, isCombustion, pc, people, personName, state, typeLabel, unit } from '../state.js';
import { icon, toast } from '../ui.js';

export function renderEntries() {
  const list = sortEntries(state.entries);
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
        <ul class="list">${g.items.map(entryItem).join('')}</ul>
      </section>`).join('') : `
      <section class="card empty-state">
        <p><strong>Noch keine Einträge</strong></p>
        <p class="muted">Tanken, Laden, Werkstatt, Parken, Versicherung … einfach erfassen – die Auswertung rechnet den Rest.</p>
      </section>`}
    ${state.entrySheet ? renderEntrySheet() : ''}`;
}

export function renderEntrySheet() {
  const car = carOf(state.entryCar) ? state.entryCar : cars()[0].id;
  const last = lastOdometer(state.entries, car);
  return `
    <div class="overlay" data-action="close-entry">
      <form class="dialog" id="entry-form">
        <div class="sheet-head">
          <h3>Neuer Eintrag</h3>
          <button class="icon-btn" type="button" data-action="close-entry" aria-label="Schließen">✕</button>
        </div>
        <div class="seg">
          ${cars().map((c) => `<label class="seg-opt"><input type="radio" name="car" value="${c.id}" ${c.id === car ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        </div>
        <label><span>Art</span><select name="type">
          ${TYPES.map((t) => `<option value="${t.id}" ${t.id === state.entryType ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select></label>
        <div class="row">
          <label><span>Datum</span><input type="date" name="date" value="${isoDate(new Date())}" required></label>
          <label><span id="odo-label">Kilometerstand</span><input name="odometer" inputmode="numeric" pattern="[0-9]*" value="${last >= 0 ? last : ''}"></label>
        </div>
        <div class="row">
          <label id="amount-wrap"><span>Menge in <b id="unit">${unit(car)}</b></span><input name="amount" inputmode="decimal" placeholder="0,0"></label>
          <label><span>Kosten in €</span><input name="cost" inputmode="decimal" placeholder="0,00" required></label>
        </div>
        <p class="preview muted small" id="entry-preview">&nbsp;</p>
        <label class="check" id="full-wrap">
          <input type="checkbox" name="full" checked> Vollgetankt
        </label>
        <fieldset>
          <legend>Bezahlt von</legend>
          <div class="seg">
            ${people().map((p) => `<label class="seg-opt pc"${pc(p.id)}><input type="radio" name="paidBy" value="${p.id}" ${p.id === state.name ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}
          </div>
        </fieldset>
        <label><span>Notiz</span><input name="note" maxlength="300" placeholder="optional"></label>
        <button class="btn primary block" type="submit">Speichern</button>
      </form>
    </div>`;
}

// Felder je nach Auto und Art ein-/ausblenden
export function updateEntryForm(form) {
  const f = new FormData(form);
  const car = f.get('car');
  const fuel = f.get('type') === 'fuel';
  form.querySelector('#unit').textContent = unit(car);
  form.querySelector('#amount-wrap').hidden = !fuel;
  form.elements.amount.required = fuel;
  form.elements.odometer.required = fuel;
  form.querySelector('#odo-label').textContent = fuel ? 'Kilometerstand' : 'Kilometerstand (optional)';
  form.querySelector('#full-wrap').hidden = !(fuel && isCombustion(car));
  updateEntryPreview(form);
}

export function updateEntryPreview(form) {
  const f = new FormData(form);
  const car = f.get('car');
  const amount = parseNum(f.get('amount'));
  const cost = parseNum(f.get('cost'));
  const odoRaw = String(f.get('odometer') || '').trim();
  const odo = Number(odoRaw);
  const last = lastOdometer(state.entries, car);
  const parts = [];
  if (f.get('type') === 'fuel' && amount > 0 && cost >= 0) parts.push(`${num.format(cost / amount)} €/${unit(car)}`);
  if (odoRaw && last >= 0 && Number.isInteger(odo) && odo > last) parts.push(`+${num.format(odo - last)} km seit letztem Eintrag`);
  if (odoRaw && last >= 0 && Number.isInteger(odo) && odo < last) parts.push(`Kilometerstand unter letztem Wert (${num.format(last)})`);
  form.querySelector('#entry-preview').innerHTML = parts.length ? esc(parts.join(' · ')) : '&nbsp;';
}

export function entryItem(e) {
  const type = entryType(e);
  const fuel = type === 'fuel';
  const per = fuel && e.amount > 0 ? ` · ${num.format(e.cost / e.amount)} €/${unit(e.car)}` : '';
  const what = fuel ? `${num.format(e.amount)} ${unit(e.car)}${per}` : esc(typeLabel(type));
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
    <button class="icon-btn small danger" data-action="delete-entry" data-id="${esc(e.id)}" aria-label="Löschen">✕</button>
  </li>`;
}

export function onEntryCarChange(form) {
  const car = new FormData(form).get('car');
  state.entryCar = car;
  const last = lastOdometer(state.entries, car);
  form.elements.odometer.value = last >= 0 ? last : '';
  updateEntryForm(form);
}

export function submitEntry(form) {
  const f = new FormData(form);
  const res = validateEntry({
    car: f.get('car'), type: f.get('type'), date: f.get('date'), odometer: f.get('odometer'),
    amount: f.get('amount'), cost: f.get('cost'), full: f.get('full'), note: f.get('note'),
    createdBy: state.name, paidBy: f.get('paidBy')
  }, state.setup, state.name);
  if (res.error) return toast(res.error);
  const data = res.data;
  const last = lastOdometer(state.entries, data.car);
  if (data.odometer != null && data.odometer < last && !confirm(`Kilometerstand ${num.format(data.odometer)} ist kleiner als der letzte (${num.format(last)}). Trotzdem speichern?`)) return;
  addItem(state.code, 'entries', data).catch((e) => toast('Fehler: ' + e.message));
  state.entryType = data.type;
  state.entrySheet = false;
  render();
  toast('Gespeichert');
}
