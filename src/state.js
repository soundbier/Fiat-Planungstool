import { ALL, DEFAULT_SETUP, ID_RE, SHARED, SPECIAL_NAMES, TYPES, sortEntries } from './lib/model.js';
import { firstOfMonth, isoDate, mondayOf } from './lib/util.js';

/** Feste Identitätsfarben (Tokens --id-* in style.css), vergeben nach Position in den Stammdaten */
export const PERSON_COLORS = ['blue', 'ochre', 'green', 'slate', 'brown', 'plum', 'teal'];
export const CAR_COLORS = ['teal', 'plum', 'brown', 'slate', 'green', 'ochre', 'blue'];

export const LS_CODE = 'autoplaner.household';
export const LS_NAME = 'autoplaner.name';
export const LS_PREFS = 'autoplaner.prefs';
export const LS_MEMBER = 'autoplaner.member';
/** Laufende Code-Erneuerung { old, new, locked } – wird beim nächsten Start fortgesetzt */
export const LS_ROTATE = 'autoplaner.rotate';

export const DEFAULT_PREFS = { theme: 'system', size: 'normal', startTab: 'calendar', calView: 'week' };

/**
 * Gesamter UI-Zustand. Firestore-Daten werden per Snapshot-Listener hineingeschrieben (household.js).
 * @type {{
 *   code: string | null, name: string | null, tab: string,
 *   bookings: import('./lib/model.js').Booking[], entries: import('./lib/model.js').Entry[],
 *   reminders: import('./lib/model.js').Reminder[], recurring: import('./lib/model.js').Recurring[], setup: import('./lib/model.js').Setup, setupLoaded: boolean,
 *   members: any[], config: { locked: boolean }, invite: { link: string, expires: number } | null,
 *   showCode: boolean, busy: boolean, month: Date, week: string, statsPeriod: string, expanded: Record<string, boolean>,
 *   entryCar: string | null, entryType: string, reminderSheet: string | null, dayDialog: string | null,
 *   dayConflict: { iso: string, car: string, driver: string | null, other: string } | null,
 *   entrySheet: boolean, entryEdit: string | null, setupStep: string | null, error: string | null,
 *   sync: 'synced' | 'pending' | 'connecting' | 'offline', returnFocus: string | null
 * }}
 */
export const state = {
  code: null,
  name: null,
  tab: 'calendar',
  bookings: [],
  entries: [],
  reminders: [],
  recurring: [],
  setup: structuredClone(DEFAULT_SETUP),
  setupLoaded: false,
  members: [],
  config: { locked: false },
  invite: null,
  showCode: false,
  busy: false,
  month: firstOfMonth(new Date()),
  week: mondayOf(isoDate(new Date())),
  statsPeriod: 'year',
  expanded: {},
  entryCar: null,
  entryType: 'fuel',
  reminderSheet: null,
  dayDialog: null,
  dayConflict: null,
  entrySheet: false,
  entryEdit: null,
  setupStep: null,
  error: null,
  sync: 'connecting',
  returnFocus: null
};

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(LS_PREFS)) || {}; } catch {}
  return Object.fromEntries(Object.entries(DEFAULT_PREFS).map(([k, v]) => [k, typeof p[k] === 'string' ? p[k] : v]));
}

export const prefs = loadPrefs();

const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

export function applyPrefs() {
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  if (prefs.size === 'normal') delete root.dataset.size; else root.dataset.size = prefs.size;
  // Statusleiste (PWA) passend zum aktiven Modus
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && !!darkQuery?.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e0e10' : '#ffffff');
  applyColors();
}
darkQuery?.addEventListener?.('change', applyPrefs);

// Personen-/Autofarben als CSS-Variablen (--p-<id>, --car-<id>); IDs sind durch ID_RE CSS-sicher.
export function applyColors() {
  const st = document.documentElement.style;
  people().forEach((p, i) => st.setProperty(`--p-${p.id}`, `var(--id-${PERSON_COLORS[i % PERSON_COLORS.length]})`));
  st.setProperty(`--p-${SHARED}`, 'var(--id-neutral)');
  st.setProperty(`--p-${ALL}`, 'var(--id-neutral)');
  cars().forEach((c, i) => st.setProperty(`--car-${c.id}`, `var(--id-${CAR_COLORS[i % CAR_COLORS.length]})`));
}

export function setPref(key, value) {
  if (!(key in DEFAULT_PREFS)) return;
  prefs[key] = value;
  try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch {}
  applyPrefs();
}

/* ---------- Helpers ---------- */
export function people() { return state.setup.people; }

export function cars() { return state.setup.cars; }

export function personName(id) { return people().find((p) => p.id === id)?.name || SPECIAL_NAMES[id] || id || ''; }

export function carOf(id) { return cars().find((c) => c.id === id) || null; }

export function carName(id) { return carOf(id)?.name || id; }

export function unit(car) { return carOf(car)?.kind === 'electric' ? 'kWh' : 'L'; }

export function isCombustion(car) { return carOf(car)?.kind !== 'electric'; }

export function typeLabel(type, car) {
  if (type === 'fuel') return car ? (isCombustion(car) ? 'Tanken' : 'Laden') : 'Tanken / Laden';
  return TYPES.find((t) => t.id === type)?.label || type;
}

export const pc = (id) => (ID_RE.test(id) ? ` style="--pc:var(--p-${id}, var(--id-neutral))"` : '');

export const cc = (id) => (ID_RE.test(id) ? ` style="--cc:var(--car-${id}, var(--id-neutral))"` : '');

/**
 * Ergebnis von `fn`, neu berechnet nur, wenn ein Snapshot state.entries bzw. state.setup ersetzt hat.
 * @template T @param {() => T} fn @returns {() => T}
 */
export function memoEntries(fn) {
  let entries = null, setup = null, value;
  return () => {
    if (entries !== state.entries || setup !== state.setup) { entries = state.entries; setup = state.setup; value = fn(); }
    return value;
  };
}

/** Einträge neueste zuerst (nicht verändern) */
export const sortedEntries = memoEntries(() => sortEntries(state.entries));

/** Heutiges Datum (lokal) als ISO-String */
export function today() { return isoDate(new Date()); }
