import { expect, test } from '@playwright/test';

/** Neuen Haushalt anlegen, als `name` weiter; liefert den Einladungslink */
async function createHousehold(page, name = 'Lukas') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Haushalt erstellen' }).click();
  const copy = page.getByRole('button', { name: 'Link kopieren' });
  await expect(copy).toBeVisible();
  await expect(page.locator('.qr svg')).toBeVisible();
  const link = await copy.getAttribute('data-text');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kalender' })).toBeVisible();
  return link;
}

/** Heute im Tages-Sheet für ein Auto eine Person wählen */
async function bookToday(page, car, person) {
  await page.locator('.today-col').first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('group', { name: car }).getByText(person, { exact: true }).click();
  await expect(page.locator('.toast')).toContainText(`${car}, `);
  await sheet.getByRole('button', { name: 'Fertig' }).click();
  await expect(sheet).toBeHidden();
}

test('Haushalt erstellen, buchen, Buchung bleibt nach Neuladen', async ({ page }) => {
  await createHousehold(page);
  await bookToday(page, 'Fiat 500e', 'Lukas');
  const today = page.locator('.today-col').first();
  await expect(today).toHaveAccessibleName(/Fiat 500e Lukas, Citroën frei/);
  await page.reload();
  await expect(page.locator('.today-col').first()).toHaveAccessibleName(/Fiat 500e Lukas/);
});

test('zweites Gerät tritt per Einladung bei und sieht die Buchung', async ({ page, browser }) => {
  const link = await createHousehold(page);
  await bookToday(page, 'Citroën', 'Lukas');
  const other = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page2 = await other.newPage();
  await page2.goto(link);
  await page2.getByRole('button', { name: 'Marie' }).click();
  await expect(page2.locator('.today-col').first()).toHaveAccessibleName(/Citroën Lukas/);
  // Einladung ist einmalig: drittes Gerät wird abgelehnt
  const third = await browser.newContext();
  const page3 = await third.newPage();
  await page3.goto(link);
  await expect(page3.getByRole('alert')).toContainText('Beitritt fehlgeschlagen');
  await other.close();
  await third.close();
});

test('Laden erfassen: Verlauf mit Verbrauch, Auswertung', async ({ page }) => {
  await createHousehold(page);
  await page.getByRole('button', { name: 'Erfassen' }).click();
  const form = page.locator('#entry-form');
  for (const [odo, kwh, eur] of [['1000', '20', '8'], ['1200', '30', '12']]) {
    await form.getByText('Fiat 500e').click();
    await form.locator('[name="odometer"]').fill(odo);
    await form.locator('[name="amount"]').fill(kwh);
    await form.locator('[name="cost"]').fill(eur);
    await form.getByRole('button', { name: 'Eintragen' }).click();
    await expect(page.locator('.toast')).toHaveText('Gespeichert');
  }
  const history = page.locator('section', { has: page.getByRole('heading', { name: 'Verlauf' }) });
  await expect(history.getByText('Laden · 30 kWh')).toBeVisible();
  await expect(history).toContainText('15 kWh/100 km'); // 30 kWh auf 200 km
  await page.getByRole('button', { name: 'Auswertung' }).click();
  await expect(page.locator('#area-cars')).toBeVisible();
  await expect(page.locator('#area-costs').locator('..')).toContainText('20,00 €');
});

test('Woche übernehmen und rückgängig machen', async ({ page }) => {
  await createHousehold(page);
  await bookToday(page, 'Fiat 500e', 'Lukas');
  await page.getByRole('button', { name: /Woche in KW \d+ übernehmen/ }).click();
  const week = page.locator('ol.week');
  await expect(week.getByRole('button', { name: /Fiat 500e Lukas/ })).toHaveCount(1);
  await page.locator('.toast').getByRole('button', { name: 'Rückgängig' }).click();
  await expect(week.getByRole('button', { name: /Fiat 500e Lukas/ })).toHaveCount(0);
});
