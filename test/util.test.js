import { describe, it, expect } from 'vitest';
import {
  esc, isoDate, parseNum, round2, daysBetween, addDays, addMonths, mondayOf, weekNumber, shortRange,
  generateCode, parseInvite, CODE_RE, ALPHABET
} from '../src/lib/util.js';

describe('Datum', () => {
  it('isoDate nutzt lokales Datum', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('addDays über Monats- und Jahresgrenzen', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
  it('addDays über Zeitumstellung', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });
  it('addMonths begrenzt auf Monatsende', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-08-15', 24)).toBe('2028-08-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
  it('daysBetween', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });
  it('mondayOf', () => {
    expect(mondayOf('2026-10-14')).toBe('2026-10-12'); // Mittwoch
    expect(mondayOf('2026-10-18')).toBe('2026-10-12'); // Sonntag
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
  });
  it('weekNumber nach ISO 8601', () => {
    expect(weekNumber('2026-10-14')).toBe(42);
    expect(weekNumber('2026-01-01')).toBe(1);
    expect(weekNumber('2027-01-01')).toBe(53); // Freitag → KW 53 von 2026
    expect(weekNumber('2024-12-30')).toBe(1);
  });
  it('shortRange', () => {
    expect(shortRange('2026-10-12')).toBe('12.10. – 18.10.');
  });
});

describe('Zahlen und Text', () => {
  it('parseNum akzeptiert Komma und Punkt', () => {
    expect(parseNum('12,5')).toBe(12.5);
    expect(parseNum(' 3.25 ')).toBe(3.25);
    expect(parseNum('')).toBeNaN();
    expect(parseNum(null)).toBeNaN();
    expect(parseNum('abc')).toBeNaN();
  });
  it('round2', () => {
    expect(round2(1.005 * 100 / 100)).toBeCloseTo(1, 2);
    expect(round2(12.3456)).toBe(12.35);
  });
  it('esc maskiert HTML', () => {
    expect(esc('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    expect(esc(null)).toBe('');
  });
});

describe('Codes und Einladungen', () => {
  it('generateCode liefert gültige Codes aus dem Alphabet', () => {
    const c = generateCode(24);
    expect(c).toHaveLength(24);
    expect(CODE_RE.test(c)).toBe(true);
    expect([...c].every((ch) => ALPHABET.includes(ch))).toBe(true);
    expect(generateCode()).not.toBe(c);
  });
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const tok = 'abcdefghijkmnopqrstuvwxyz';
  it('parseInvite: reiner Code', () => {
    expect(parseInvite(code)).toEqual({ code, invite: null });
  });
  it('parseInvite: Link mit Fragment', () => {
    expect(parseInvite(`https://x.de/#h=${code}&i=${tok}`)).toEqual({ code, invite: tok });
  });
  it('parseInvite: alter Link mit Query', () => {
    expect(parseInvite(`https://x.de/?h=${code}`)).toEqual({ code, invite: null });
  });
  it('parseInvite: ungültige Eingaben', () => {
    expect(parseInvite('kurz')).toBeNull();
    expect(parseInvite('https://x.de/#h=<script>')).toBeNull();
    expect(parseInvite(`https://x.de/#h=${code}&i=bad!`)).toEqual({ code, invite: null });
    expect(parseInvite('')).toBeNull();
  });
});
