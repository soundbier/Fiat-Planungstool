window.addEventListener('error', function (e) {
  var app = document.getElementById('app');
  if (app && app.querySelector('.loading')) {
    app.innerHTML = '<main class="setup"><h1>Fehler</h1><p class="error"></p></main>';
    app.querySelector('.error').textContent = e.message;
  }
});
