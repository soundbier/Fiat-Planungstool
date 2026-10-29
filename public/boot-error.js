// Fehler beim Laden (z. B. fehlende Firebase-Konfiguration), bevor die App selbst etwas anzeigen kann
window.addEventListener('error', function (e) {
  var app = document.getElementById('app');
  if (app && app.querySelector('.loading')) {
    app.innerHTML = '<main class="onboard"><div class="onboard-top"><h1>Fehler</h1>'
      + '<p class="lead">Die App konnte nicht starten.</p><p class="error" role="alert"></p></div>'
      + '<div class="onboard-actions"><button class="btn btn-primary btn-block" type="button">Erneut versuchen</button></div></main>';
    app.querySelector('.error').textContent = e.message;
    app.querySelector('button').addEventListener('click', function () { location.reload(); });
  }
});
