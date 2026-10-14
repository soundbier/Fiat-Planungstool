# Autoplaner

PWA für Lukas und Marie zum gemeinsamen Planen des Autos: Kalender für Fiat 500e und Citroën, Tanken/Laden erfassen, Auswertung der Kosten.
Vite + Vanilla JS + Firebase Firestore (offlinefähig via `persistentLocalCache`). Kein Account nötig – Zugriff über einen geheimen Haushaltscode.

## Funktionsweise

- Beim Start meldet sich die App unsichtbar per **Firebase Anonymous Auth** an.
- Erster Start: **Neuen Haushalt erstellen** (zufälliger 24-stelliger Code via `crypto.getRandomValues`, mit Kopieren-Button und QR-Code) oder **Haushalt beitreten** (Code eingeben oder Link `https://deine-domain/?h=CODE` öffnen).
- Danach **Wer bist du?** – Lukas oder Marie. Code und Name liegen in `localStorage` und sind in den Einstellungen änderbar.
- Daten: `households/{code}/bookings` und `households/{code}/entries`.
- **Wer den Code kennt, hat Zugriff.** Code nur mit vertrauten Personen teilen.

## Lokale Entwicklung

```bash
npm install
npm run dev
```

## Setup

### 1. Firebase-Projekt

1. <https://console.firebase.google.com> → **Projekt hinzufügen**.
2. **Build → Firestore Database → Datenbank erstellen** (Produktionsmodus, Region z. B. `eur3`).
3. **Projektübersicht → Web-App hinzufügen** (`</>`), Config kopieren und in `src/firebase-config.js` eintragen.
   Die Werte sind nicht geheim; der Schutz erfolgt über die Security Rules.

### 2. Anonymous Auth aktivieren

**Build → Authentication → Jetzt starten → Sign-in method → Anonym → Aktivieren → Speichern.**

### 3. Security Rules einfügen

**Firestore Database → Regeln**: Inhalt von [`firestore.rules`](firestore.rules) einfügen und **Veröffentlichen**.
(Alternativ: `firebase deploy --only firestore:rules` mit der Firebase CLI.)

Die Regeln:
- erlauben Zugriff nur für angemeldete Nutzer (`request.auth != null`) und nur unterhalb von `households/{code}/bookings` bzw. `/entries`,
- verbieten jeden Zugriff auf `households` selbst (kein `list` → Codes sind nicht auslesbar),
- prüfen bei Buchungen, dass die Dokument-ID `{date}_{car}` entspricht,
- validieren alle Felder (Fahrer/Person, Auto `fiat`/`citroen`, Typ `fuel`/`charge`, Datums-/Zeitformate, Zahlenbereiche, Notizlänge).

Die Abfrage sortiert nach `date`; dafür genügt der automatische Einzelfeld-Index.

### 4. Cloudflare Pages

1. Repository auf GitHub pushen.
2. Cloudflare Dashboard → **Workers & Pages → Erstellen → Pages → Mit Git verbinden** → Repository wählen.
3. Build-Einstellungen:
   - Framework-Preset: *Keines* (oder Vite)
   - Build-Befehl: `npm run build`
   - Ausgabeverzeichnis: `dist`
   - Optional Umgebungsvariable `NODE_VERSION` = `20`
4. **Speichern und bereitstellen.** Jeder Push auf den Produktionsbranch deployt automatisch.

### 5. Autorisierte Domain in Firebase eintragen

**Authentication → Einstellungen → Autorisierte Domains → Domain hinzufügen**:
`dein-projekt.pages.dev` (und ggf. eigene Domain). Ohne diesen Eintrag schlägt die anonyme Anmeldung fehl.

### 6. Auf dem iPhone installieren

Seite in Safari öffnen → Teilen → **Zum Home-Bildschirm**.

## Datenmodell

`bookings` – Dokument-ID `{YYYY-MM-DD}_{car}` (ein Dokument pro Tag und Auto; "frei" = Dokument gelöscht)

| Feld | Typ |
|---|---|
| date | `"YYYY-MM-DD"` |
| car | `"fiat"` (Fiat 500e) \| `"citroen"` (Citroën) |
| driver | `"lukas"` \| `"marie"` |
| updatedBy | `"lukas"` \| `"marie"` |
| updatedAt | Server-Timestamp |

`entries`

| Feld | Typ |
|---|---|
| person | `"Lukas"` \| `"Marie"` |
| type | `"fuel"` \| `"charge"` |
| date | `"YYYY-MM-DD"` |
| amount | Zahl > 0 (Liter bzw. kWh) |
| cost | Zahl ≥ 0 (EUR) |
| odometer | Ganzzahl ≥ 0 oder `null` |
| note | string (≤ 300) |
| createdAt | Server-Timestamp |
