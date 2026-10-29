# Autoplaner

PWA zum gemeinsamen Planen von Autos im Haushalt: Kalender, Kosten erfassen (Tanken/Laden, Werkstatt, Parken, Maut, Versicherung, Steuer …),
Fristen (HU/TÜV, Service, Reifenwechsel …), Auswertung mit Kostenaufteilung und JSON-/CSV-Backup.
Personen und Autos (Elektro in kWh, Verbrenner in Litern) sind in den Einstellungen frei konfigurierbar (Standard: Lukas, Marie, Fiat 500e, Citroën).
Vite + Vanilla JS + Firebase Firestore (offlinefähig via `persistentLocalCache`). Kein Account nötig – Zugriff über einen geheimen Haushaltscode.

## Funktionsweise

- Beim Start meldet sich die App unsichtbar per **Firebase Anonymous Auth** an (eine `uid` pro Gerät/Browser).
- Erster Start: **Neuen Haushalt erstellen** (zufälliger 24-stelliger Code via `crypto.getRandomValues`) – danach erscheint
  sofort eine **Einladung** (QR-Code/Link `https://deine-domain/#h=CODE&i=TOKEN`) für die zweite Person.
- Danach **Wer bist du?** – Lukas oder Marie. Code und Name liegen in `localStorage`.
- Daten: `households/{code}/bookings`, `/entries`, `/reminders`, `/recurring`, `/members/{uid}`, `/invites/{token}`, `/meta/config`, `/meta/setup` (Personen & Autos).
- **Wiederkehrende Kosten:** Beim Erfassen (außer Tanken/Laden) „Wiederholen“ wählen – fällige Einträge werden beim Start automatisch angelegt (`/recurring`), Beenden in der Kostenliste.
- **Verbrauch je Tankfüllung/Ladung:** in der Kostenliste und als Verlauf in der Auswertung (Verbrenner nur zwischen Volltankungen).
- **Buchungskonflikte:** Überschreiben einer Buchung einer anderen Person (Tagesdialog, Woche kopieren) muss bestätigt werden.
- **Abrechnung:** Kosten je Auto werden nach gebuchten Kalendertagen (bis heute) auf die Personen verteilt und mit „Bezahlt von“ verrechnet.
- **Nach dem Update** die neuen `firestore.rules` deployen – sonst schlagen Fristen, neue Kostenarten und Stammdaten fehl.

### Sicherheitsmodell (ohne Login)

- **Geräte-Mitgliedschaft:** Lesen/Schreiben nur, wenn `members/{uid}` des Geräts existiert.
- **Sperre** (`meta/config.locked`, Standard bei neuen Haushalten): Beitritt nur mit Einladung – der Code allein reicht nicht.
  Ältere Haushalte ohne `config` sind offen, bis die Sperre in den Einstellungen aktiviert wird; bestehende Geräte treten beim
  nächsten Start automatisch bei.
- **Einladungen:** einmalig (werden beim Beitritt im selben Batch gelöscht), 24 h gültig (Rules: max. 7 Tage), widerrufbar.
- **Link im Fragment** (`#…`): wird nicht an den Server gesendet, landet also nicht in Server-Logs oder Referrern.
  Alte Links `/?h=CODE` funktionieren weiterhin (nur bei offenen Haushalten).
- **Geräte entfernen:** In den Einstellungen sichtbar, jedes Gerät kann andere entfernen.
- **Code erneuern:** kopiert alle Daten in einen neuen Haushalt, sperrt den alten und löscht dort Daten und Geräte.
- **Security-Header** (CSP, Referrer-Policy, X-Frame-Options, …) in [`public/_headers`](public/_headers) für Cloudflare Pages.

## Lokale Entwicklung

```bash
npm install
npm run dev
npm test           # Vitest: Datums-, Auswertungs-, Abrechnungs-, CSV-/Backup- und Einladungslogik
npm run typecheck  # TypeScript-Prüfung der JSDoc-Typen (src/lib streng, Rest locker)
npm run check      # Typecheck + Tests + Build
```

### Aufbau

- `src/lib/` – reine Fachlogik ohne DOM/Firebase (`util.js`, `model.js`, `csv.js`), vollständig getestet (`test/`)
- `src/state.js` – UI-Zustand und Einstellungen, `src/household.js` – Haushalt, Sync, Sync-Status
- `src/views/` – Kalender, Kosten, Fristen, Auswertung, Einstellungen, Setup, Import/Export
- `src/render.js` – Rendering inkl. Fokus-Management, `src/main.js` – Events, Tastatur, Wischgesten, Start
- `src/pwa.js` – Service Worker (vite-plugin-pwa): App-Shell offline, Hinweis bei neuer Version

## Setup

### 1. Firebase-Projekt

1. <https://console.firebase.google.com> → **Projekt hinzufügen**.
2. **Build → Firestore Database → Datenbank erstellen** (Produktionsmodus, Region z. B. `eur3`).
3. **Projektübersicht → Web-App hinzufügen** (`</>`) und die Config-Werte notieren.
   Sie werden nicht im Repo gespeichert, sondern als Umgebungsvariablen gesetzt:

   | Variable | Firebase-Config-Feld |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | `apiKey` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
   | `VITE_FIREBASE_PROJECT_ID` | `projectId` |
   | `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
   | `VITE_FIREBASE_APP_ID` | `appId` |

   Lokal: `.env.example` nach `.env.local` kopieren und ausfüllen (`.env.local` ist in `.gitignore`).

   Hinweis: Vite baut diese Werte in das ausgelieferte JavaScript ein – sie sind im Browser sichtbar. Das ist bei
   Firebase-Web-Configs normal; der eigentliche Schutz sind die Security Rules (und optional App Check bzw. eine
   API-Key-Beschränkung auf eure Domain in der Google Cloud Console).

### 2. Anonymous Auth aktivieren

**Build → Authentication → Jetzt starten → Sign-in method → Anonym → Aktivieren → Speichern.**

### 3. Security Rules einfügen

**Firestore Database → Regeln**: Inhalt von [`firestore.rules`](firestore.rules) einfügen und **Veröffentlichen**.
(Alternativ: `firebase deploy --only firestore:rules` mit der Firebase CLI.)

Die Regeln:
- erlauben Zugriff nur für angemeldete Nutzer (`request.auth != null`) und nur unterhalb von `households/{code}/bookings` bzw. `/entries`,
- verbieten jeden Zugriff auf `households` selbst (kein `list` → Codes sind nicht auslesbar),
- erlauben Daten nur Mitgliedern (`members/{uid}`); Beitritt nur bei offenem Haushalt oder mit gültiger, einmaliger Einladung,
- prüfen bei Buchungen, dass die Dokument-ID `{date}_{car}` entspricht,
- validieren alle Felder (Fahrer/Ersteller `lukas`/`marie`, Auto `fiat`/`citroen`, Datumsformat, Zahlenbereiche, `full` nur beim Citroën, Notizlänge, Server-Timestamps).

Die Abfrage sortiert nach `date`; dafür genügt der automatische Einzelfeld-Index.

### 4. Cloudflare Pages

1. Repository auf GitHub pushen.
2. Cloudflare Dashboard → **Workers & Pages → Erstellen → Pages → Mit Git verbinden** → Repository wählen.
3. Build-Einstellungen:
   - Framework-Preset: *Keines* (oder Vite)
   - Build-Befehl: `npm run build`
   - Ausgabeverzeichnis: `dist`
   - Umgebungsvariablen (**Einstellungen → Variablen und Secrets**, für *Production* und *Preview*):
     alle sechs `VITE_FIREBASE_*`-Variablen aus Schritt 1, dazu optional `NODE_VERSION` = `20`.
     Ob als „Text“ oder „Secret“ angelegt, ist egal – beide stehen beim Build zur Verfügung.
     Nach dem Ändern von Variablen neu deployen, da sie zur Build-Zeit eingebaut werden.
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

`entries` – Einträge sind nicht bearbeitbar (nur anlegen und löschen)

| Feld | Typ |
|---|---|
| car | `"fiat"` \| `"citroen"` |
| date | `"YYYY-MM-DD"` |
| odometer | Ganzzahl ≥ 0 (km) |
| amount | Zahl > 0 (kWh beim Fiat, Liter beim Citroën) |
| cost | Zahl ≥ 0 (EUR) |
| full | bool (Volltank; beim Fiat immer `false`) |
| note | string (≤ 300) |
| createdBy | `"lukas"` \| `"marie"` |
| createdAt | Server-Timestamp |

## Auswertung

Gefiltert nach Zeitraum (30 Tage / laufendes Jahr / alles), von oben nach unten:

**Fahrzeuge** (je Auto, ohne Kosten)
- Gefahrene km = letzter − erster Kilometerstand, Ø km pro Monat mit Tendenz der letzten 90 Tage
- km pro Monat als Balken mit Ø-Linie; zwischen zwei Kilometerständen gleichmäßig auf die Tage verteilt
- Ø Verbrauch = Summe Menge im Zeitraum ÷ km seit dem Tank-/Ladeeintrag davor × 100 (ohne Eintrag davor zählt der erste im Zeitraum nur als Startpunkt; beim Citroën nur bei Volltank-Einträgen sinnvoll)
- Kilometerstand schnell erfassen: unter „Erfassen“ oben eine Zeile je Auto (Datum heute)

**Nutzung** (je Auto)
- Gebuchte Werktage Mo–Fr je Person und Monat bis heute, „Alle“ zählt für jede Person; Monat aufklappbar bis zur Kalenderwoche
- Eine Woche über den Monatswechsel erscheint in beiden Monaten mit den jeweiligen Tagen; Ø pro Woche über den Zeitraum

**Kosten** (ganz unten)
- Summe aller Autos, je Auto mit Ø Kosten/100 km = Summe Kosten ÷ km × 100 (km ab dem letzten Kilometerstand vor dem Zeitraum)
- Ø Preis = Gesamtkosten ÷ Gesamtmenge, Kostenarten, Kosten pro Monat als SVG-Balkendiagramm
- Abrechnung (wer schuldet wem)
