import { esc, fmtTime } from '../lib/util.js';
import { pc, people, state } from '../state.js';
import { app, qrSvg } from '../ui.js';

/* ---------- Setup screens ---------- */
export function renderSetup() {
  const step = state.setupStep;
  let body = '';
  const steps = step === 'name' ? 2 : 1;
  const dots = `<div class="setup-steps" aria-hidden="true"><span class="on"></span><span class="${steps > 1 ? 'on' : ''}"></span></div>`;
  if (step === 'start') {
    body = `
      <div class="setup-hero">
        <img class="setup-logo" src="/icon.svg" alt="" width="88" height="88">
        <h1>Autoplaner</h1>
        <p class="muted">Wer fährt wann welches Auto – und was es kostet.</p>
      </div>
      <div class="setup-card">
        <button class="btn primary block lg" data-action="create">Neuen Haushalt erstellen</button>
        <button class="btn block lg" data-action="goto-join">Bestehendem Haushalt beitreten</button>
      </div>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
      <p class="muted small setup-foot">Kein Konto nötig – der Zugang erfolgt über eine persönliche Einladung.</p>`;
  } else if (step === 'created') {
    body = `
      ${dots}
      <div class="setup-hero compact">
        <h1>Haushalt erstellt</h1>
        <p class="muted">Lass die zweite Person den QR-Code scannen oder schick ihr den Link.</p>
      </div>
      <div class="setup-card">
        ${inviteBox()}
      </div>
      <button class="btn primary block lg" data-action="confirm-created">Weiter</button>`;
  } else if (step === 'join') {
    body = `
      ${dots}
      <div class="setup-hero compact">
        <h1>Haushalt beitreten</h1>
        <p class="muted">Füge den Einladungslink ein, den du erhalten hast – oder scanne den QR-Code mit der Kamera.</p>
      </div>
      <form id="join-form" class="setup-card">
        <label>Einladungslink oder Code
          <input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="Link einfügen">
        </label>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
        <button class="btn primary block lg" type="submit" ${state.busy ? 'disabled' : ''}>Beitreten</button>
      </form>
      <button class="btn link block" data-action="back-start">Zurück</button>`;
  } else if (step === 'name') {
    body = `
      ${dots}
      <div class="setup-hero compact">
        <h1>Wer bist du?</h1>
        <p class="muted">Lässt sich später in den Einstellungen ändern.</p>
      </div>
      <div class="person-grid">
        ${people().map((p) => `<button class="person-tile pc"${pc(p.id)} data-action="set-name" data-name="${p.id}">
          <span class="avatar">${esc(p.name[0])}</span><span>${esc(p.name)}</span></button>`).join('')}
      </div>`;
  }
  app.innerHTML = `<main class="setup">${body}</main>`;
}

export function inviteBox() {
  const inv = state.invite;
  if (!inv) return '';
  return `
    <div class="qr">${qrSvg(inv.link)}</div>
    <div class="btn-row">
      <button class="btn" data-action="copy" data-text="${esc(inv.link)}">Link kopieren</button>
      ${navigator.share ? `<button class="btn" data-action="share-invite">Teilen</button>` : ''}
    </div>
    <p class="muted small">Einmalig nutzbar, gültig bis ${esc(fmtTime(inv.expires))}. Nur persönlich an vertraute Personen weitergeben – nicht in Gruppen posten.</p>`;
}
