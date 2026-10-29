import { esc, fmtTime } from '../lib/util.js';
import { people, state } from '../state.js';
import { app, avatar, icon, qrSvg } from '../ui.js';

/* ---------- Einrichtung (ohne Account) ---------- */
export function renderSetup() {
  const step = state.setupStep;
  const error = state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : '';
  let body = '';
  if (step === 'start') {
    body = `
      <div class="onboard-top">
        <img class="onboard-logo" src="/icon.svg" alt="" width="56" height="56">
        <h1>Autoplaner</h1>
        <p class="lead">Wer fährt wann welches Auto – und was es kostet.</p>
      </div>
      <div class="onboard-actions">
        ${error}
        <button class="btn btn-primary btn-block" data-action="create"${state.busy ? ' disabled' : ''}>Haushalt erstellen</button>
        <button class="btn btn-block" data-action="goto-join">Mit Einladung beitreten</button>
        <p class="footnote">Kein Konto nötig. Zugang nur per Einladung.</p>
      </div>`;
  } else if (step === 'created') {
    body = `
      <div class="onboard-top">
        <h1>Zweite Person einladen</h1>
        <p class="lead">QR-Code scannen lassen oder den Link schicken.</p>
      </div>
      ${inviteBox()}
      <div class="onboard-actions">
        <button class="btn btn-primary btn-block" data-action="confirm-created">Weiter</button>
      </div>`;
  } else if (step === 'join') {
    body = `
      <div class="onboard-top">
        <button class="icon-btn back" data-action="back-start" aria-label="Zurück">${icon('chevron-left')}</button>
        <h1>Beitreten</h1>
        <p class="lead">Einladungslink einfügen oder den QR-Code mit der Kamera öffnen.</p>
      </div>
      <form id="join-form" class="onboard-actions">
        <label class="field"><span>Einladungslink oder Code</span>
          <input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="Link einfügen">
        </label>
        ${error}
        <button class="btn btn-primary btn-block" type="submit"${state.busy ? ' disabled' : ''}>Beitreten</button>
      </form>`;
  } else if (step === 'name') {
    body = `
      <div class="onboard-top">
        <h1>Wer bist du?</h1>
        <p class="lead">Lässt sich später in den Einstellungen ändern.</p>
      </div>
      <div class="people-pick">
        ${people().map((p) => `<button class="person-row" data-action="set-name" data-name="${p.id}">
          ${avatar(p.id, 'lg')}<span>${esc(p.name)}</span>${icon('chevron-right')}</button>`).join('')}
      </div>`;
  }
  app.innerHTML = `<main class="onboard">${body}</main>`;
}

export function inviteBox() {
  const inv = state.invite;
  if (!inv) return '';
  return `
    <div class="invite">
      <div class="qr">${qrSvg(inv.link)}</div>
      <div class="btn-row">
        <button class="btn" data-action="copy" data-text="${esc(inv.link)}">${icon('copy')}Link kopieren</button>
        ${navigator.share ? `<button class="btn" data-action="share-invite">${icon('share')}Teilen</button>` : ''}
      </div>
      <p class="footnote">Einmalig nutzbar, gültig bis ${esc(fmtTime(inv.expires))}. Nur persönlich weitergeben, nicht in Gruppen posten.</p>
    </div>`;
}
