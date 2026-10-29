// Ersatz für re2js (~260 kB): Firestore braucht es nur für Regex-/LIKE-Ausdrücke in Pipelines, die die App nicht nutzt.
// Firestore fängt den Fehler ab und wertet den Ausdruck dann als Fehler aus.
export class RE2JS {
  static compile() {
    throw new Error('re2js ist im Autoplaner nicht enthalten');
  }
}
