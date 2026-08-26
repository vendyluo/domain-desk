import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectNoSeriousAccessibilityViolations(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
}

test('critical inbound CRM states are usable and safe', async ({ page }, testInfo) => {
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Pricing request/ })).toContainText('Pricing request — 年間契約');
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole('link', { name: /Pricing request/ }).click();
  await expect(page.getByRole('heading', { name: 'Pricing request — 年間契約', level: 1 })).toBeVisible();
  const messageBody = page.locator('[dir="auto"]').filter({ hasText: 'Could you quote 25 seats?' });
  await expect(messageBody).toContainText('<script>alert("never render")</script>');
  expect(await messageBody.evaluate((element) => element.innerHTML)).not.toContain('<script>');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'quote requirements.txt' }).click();
  expect((await download).suggestedFilename()).toBe('quote requirements.txt');

  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Mark handled' }).click();
    await expect(page.getByText('Handled', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reopen' }).click();
    await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();
  }

  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByText('Review seat pricing')).toBeVisible();
  await expect(page.getByText('Schedule technical review')).toBeVisible();

  await page.goto('/contacts');
  await expect(page.getByRole('link', { name: /顾客 Ada/ })).toBeVisible();
  await page.goto('/opportunities');
  await expect(page.getByRole('link', { name: 'Annual team plan' })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByText('0003 · opportunities')).toBeVisible();
  await expect(page.getByText('Ready · R2')).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test('navigation, keyboard, empty filter, and 320px layout remain operable', async ({ page }, testInfo) => {
  await page.goto('/inbox');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  } else {
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Search conversations' })).toBeFocused();
  }

  await page.getByRole('textbox', { name: 'Search conversations' }).fill('not present');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('heading', { name: 'No matching conversations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reset filters' })).toBeVisible();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBe(false);
});
