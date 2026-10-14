import { DEFAULT_SETUP, ID_RE, TYPES } from './lib/model.js';
import { firstOfMonth, isoDate, mondayOf } from './lib/util.js';

export const CAR_COLORS = ['#1f7a6d', '#c2581b', '#7a4bb0', '#3b7d2a', '#b0477f', '#2c5d8f', '#8a6d1d', '#4a4a48'];

export const LS_CODE = 'autoplaner.household';
export const LS_NAME = 'autoplaner.name';
export const LS_PREFS = 'autoplaner.prefs';
export const LS_MEMBER = 'autoplaner.member';

export const SWATCHES = ['#2c5d8f', '#a8324a', '#1f7a6d', '#7a4bb0', '#c2581b', '#3b7d2a', '#b0477f', '#4a4a48'];

export const DEFAULT_PREFS = { theme: 'system', scheme: 'warm', size: 'normal', startTab: 'calendar', calView: 'month', colors: {} };

/**
 * Gesamter UI-Zustand. Firestore-Daten werden per Snapshot-Listener hineingeschrieben (household.js).
 * @type {{
 *   code: string | null, name: string | null, tab: string,
 *   bookings: import('./lib/model.js').Booking[], entries: import('./lib/model.js').Entry[],
 *   reminders: import('./lib/model.js').Reminder[], setup: import('./lib/model.js').Setup, setupLoaded: boolean,
 *   members: any[], config: { locked: boolean }, invite: { link: string, expires: number } | null,
 *   showCode: boolean, busy: boolean, month: Date, week: string, selectedDay: string, statsPeriod: string,
 *   entryCar: string | null, entryType: string, reminderSheet: string | null, dayDialog: string | null,
 *   copyWeek: string | null, entrySheet: boolean, setupStep: string | null, error: string | null,
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
  setup: structuredClone(DEFAULT_SETUP),
  setupLoaded: false,
  members: [],
  config: { locked: false },
  invite: null,
  showCode: false,
  busy: false,
  month: firstOfMonth(new Date()),
  week: mondayOf(isoDate(new Date())),
  selectedDay: isoDate(new Date()),
  statsPeriod: 'year',
  entryCar: null,
  entryType: 'fuel',
  reminderSheet: null,
  dayDialog: null,
  copyWeek: null,
  entrySheet: false,
  setupStep: null,
  error: null,
  sync: 'connecting',
  returnFocus: null
};

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PREFS)) || {};
    return { ...DEFAULT_PREFS, ...p, colors: { ...DEFAULT_PREFS.colors, ...p.colors } };
  } catch { return { ...DEFAULT_PREFS, colors: { ...DEFAULT_PREFS.colors } }; }
}

export const prefs = loadPrefs();

export function applyPrefs() {
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  if (prefs.scheme === 'warm') delete root.dataset.scheme; else root.dataset.scheme = prefs.scheme;
  if (prefs.size === 'normal') delete root.dataset.size; else root.dataset.size = prefs.size;
  applyColors();
}

// Personen-/Autofarben als CSS-Variablen (--p-<id>, --car-<id>); IDs sind durch ID_RE CSS-sicher.
export function applyColors() {
  const st = document.documentElement.style;
  people().forEach((p, i) => st.setProperty(`--p-${p.id}`, prefs.colors[p.id] || SWATCHES[i % SWATCHES.length]));
  cars().forEach((c, i) => st.setProperty(`--car-${c.id}`, CAR_COLORS[i % CAR_COLORS.length]));
}

export function setPref(key, value) {
  if (key.startsWith('color-')) prefs.colors[key.slice(6)] = value;
  else prefs[key] = value;
  try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch {}
  applyPrefs();
}

/* ---------- Helpers ---------- */
export function people() { return state.setup.people; }

export function cars() { return state.setup.cars; }

export function personName(id) { return people().find((p) => p.id === id)?.name || id || ''; }

export function carOf(id) { return cars().find((c) => c.id === id) || null; }

export function carName(id) { return carOf(id)?.name || id; }

export function unit(car) { return carOf(car)?.kind === 'electric' ? 'kWh' : 'L'; }

export function isCombustion(car) { return carOf(car)?.kind !== 'electric'; }

export function typeLabel(type, car) {
  if (type === 'fuel') return car ? (isCombustion(car) ? 'Tanken' : 'Laden') : 'Tanken / Laden';
  return TYPES.find((t) => t.id === type)?.label || type;
}

export const pc = (id) => (ID_RE.test(id) ? ` style="--pc:var(--p-${id})"` : '');

export const cc = (id) => (ID_RE.test(id) ? ` style="--cc:var(--car-${id})"` : '');

/** Heutiges Datum (lokal) als ISO-String */
export function today() { return isoDate(new Date()); }
