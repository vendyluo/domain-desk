import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectNoSeriousAccessibilityViolations(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
}

test('critical inbound CRM states are usable and safe', async ({ page }, testInfo) => {
  await page.goto('/inbox');
  await expect(page).toHaveTitle('Inbox · Domain Desk');
  await expect(
    testInfo.project.name === 'desktop'
      ? page.getByRole('link', { name: 'Domain Desk Inbound operations desk' })
      : page.locator('header').getByRole('link', { name: 'Domain Desk' })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Pricing request/ })).toContainText('Pricing request — 年間契約');
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath('inbox.png'), fullPage: true });

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
  await page.getByRole('link', { name: /^Due today/ }).click();
  await expect(page).toHaveURL(/#queue-2$/);
  await expect(page.getByRole('button', { name: 'Complete and replace', exact: true })).not.toBeVisible();
  await page.getByText('Update next step or record outcome', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete and replace', exact: true })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath('today-expanded.png'), fullPage: true });
  await page.getByText('Update next step or record outcome', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('today.png'), fullPage: true });

  await page.goto('/contacts');
  await expect(page.getByRole('link', { name: /顾客 Ada/ })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath('contacts.png'), fullPage: true });
  await page.goto('/opportunities');
  await expect(page.getByRole('link', { name: 'Annual team plan' })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath('opportunities.png'), fullPage: true });
  await page.goto('/settings');
  await expect(page.getByText('0003 · opportunities')).toBeVisible();
  await expect(page.getByText('Ready · R2')).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
});

test('navigation, keyboard, empty filter, and 320px layout remain operable', async ({ page }, testInfo) => {
  await page.goto('/inbox');
  // Retry the first interaction until hydration has attached the listeners.
  if (testInfo.project.name === 'mobile') {
    await expect(async () => {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  } else {
    await expect(async () => {
      await page.keyboard.press('/');
      await expect(page.getByRole('textbox', { name: 'Search conversations' })).toBeFocused({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
  }

  await page.getByRole('textbox', { name: 'Search conversations' }).fill('not present');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('heading', { name: 'No matching conversations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reset filters' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('inbox-empty.png'), fullPage: true });
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBe(false);
});

test('landing-page form intake accepts a verified submission into the inbox', async ({ page, request }, testInfo) => {
  const subject = `E2E form ${testInfo.project.name}`;
  const response = await request.post('/intake/mailbox:e2e', {
    headers: { Origin: 'https://inquiries.example' },
    form: {
      email: 'form-visitor@customer.example',
      name: 'Form Visitor',
      subject,
      message: 'Submitted through the embedded landing-page form.',
      'cf-turnstile-response': 'e2e-test-token'
    }
  });
  expect(response.status()).toBe(200);
  await page.goto('/inbox');
  await expect(page.getByRole('link', { name: new RegExp(subject) })).toBeVisible();
});
