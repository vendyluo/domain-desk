import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('local email → attribution → attachment → approved reply → customer answer → next action and opportunity', async ({
  page,
  request
}, info) => {
  const suffix = info.project.name;
  const subject = `Daily flow ${suffix} — 詢價`;
  const endpoint = '/cdn-cgi/local/email?from=buyer@customer.example&to=hello@inquiries.example';
  const mime = [
    'From: Buyer <buyer@customer.example>',
    'To: hello@inquiries.example',
    `Message-ID: <Flow-${suffix}@Customer.example>`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=flow',
    '',
    '--flow',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Could you quote 25 seats? 真實流程測試（本機）',
    '--flow',
    'Content-Type: text/plain',
    'Content-Disposition: attachment; filename="requirements.txt"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('25 seats\nTaipei office\n').toString('base64'),
    '--flow--'
  ].join('\r\n');
  for (let i = 0; i < 2; i++) expect((await request.post(endpoint, { data: mime })).ok()).toBe(true);
  await page.goto('/inbox');
  const inboxRow = page.getByRole('link', { name: new RegExp(`Daily flow ${suffix}`) });
  await expect(inboxRow).toHaveCount(1);
  await inboxRow.click();
  await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
  await page.waitForURL('**/conversations/**');
  const conversationUrl = page.url();
  await expect(
    page.locator('header').getByText('Field Notes · inquiries.example · hello@inquiries.example', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Message timeline' }).locator(':scope > article')).toHaveCount(1);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'requirements.txt' }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  let downloaded = '';
  for await (const chunk of stream!) downloaded += chunk.toString();
  expect(downloaded).toBe('25 seats\nTaipei office\n');
  await page.getByLabel('Reply text', { exact: true }).fill('25 seats cost $250/month. 我們可以安排試用。');
  await page.getByRole('button', { name: 'Save draft for review' }).click();
  await page.reload(); // draft survives navigation/reload before approval
  const workspace = page.getByRole('region', { name: 'Reply workspace' });
  await expect(workspace).toContainText('buyer@customer.example');
  await expect(workspace).toContainText('hello@inquiries.example');
  await expect(page.getByRole('button', { name: 'Send approved reply once' })).toHaveCount(0);
  await workspace.screenshot({ path: info.outputPath('reply-review.png') });
  await page.getByRole('button', { name: 'Approve this exact reply' }).click();
  // Capture the exact request for replay after send (e.g. browser resubmission).
  const draftId = await workspace.locator('input[name=id]').last().inputValue();
  const approvedHash = await workspace.locator('input[name=hash]').inputValue();
  await page.getByRole('button', { name: 'Send approved reply once' }).click();
  await expect(page.getByRole('heading', { name: 'Reply outcome · accepted', exact: true })).toBeVisible();
  const provider = (await page.getByText(/^Provider Message-ID:/).innerText())
    .replace('Provider Message-ID: ', '')
    .trim();
  const replay = await request.post(`${conversationUrl}?/reply`, {
    headers: { Origin: new URL(conversationUrl).origin, Accept: 'application/json' },
    form: { operation: 'send', id: draftId, hash: approvedHash }
  });
  expect(await replay.json()).toMatchObject({ type: 'failure', status: 400 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Message timeline' }).locator(':scope > article')).toHaveCount(2);
  await expect(workspace).toContainText('delivery is not verified');
  await workspace.screenshot({ path: info.outputPath('reply-accepted.png') });
  expect(
    (
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    ).violations.filter((v) => ['critical', 'serious'].includes(v.impact || ''))
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const answer = [
    'From: Buyer <buyer@customer.example>',
    'To: hello@inquiries.example',
    `Message-ID: <Answer-${suffix}@Customer.example>`,
    `In-Reply-To: <${provider.replace(/^<|>$/g, '')}>`,
    `Subject: Re: ${subject}`,
    '',
    'Thanks, please arrange the trial.'
  ].join('\r\n');
  expect((await request.post(endpoint, { data: answer })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Message timeline' }).locator(':scope > article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Mark handled' }).click();
  await expect(page.getByText('Handled', { exact: true })).toBeVisible();
  const action = `Arrange trial ${suffix}`;
  await page.getByLabel('Next action', { exact: true }).fill(action);
  await page.getByRole('button', { name: 'Add next action' }).click();
  await page.goto('/today');
  const actionRow = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: action, exact: true }) });
  await expect(actionRow).toBeVisible();
  await expect(actionRow.getByRole('button', { name: 'Complete', exact: true })).not.toBeVisible();
  await actionRow.getByText('Manage next action', { exact: true }).click();
  await actionRow.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(actionRow).toHaveCount(0);
  await page.goto(conversationUrl);
  await page.getByLabel('Title', { exact: true }).fill(`Trial plan ${suffix}`);
  await page.getByLabel('Desired outcome', { exact: true }).fill('Agree a 25-seat annual plan');
  await page.getByRole('button', { name: 'Create as new' }).click();
  await expect(page.getByRole('heading', { name: `Trial plan ${suffix}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Qualify', exact: true }).click();
  await page.getByLabel('Required next action').fill(`Review trial ${suffix}`);
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await page.getByLabel('Why was it won?').fill('Customer confirmed the annual plan');
  await page.getByRole('button', { name: 'Mark won', exact: true }).click();
  await expect(page.getByText('Customer confirmed the annual plan').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('opportunity-won.png'), fullPage: true });
});

test('production hostname cannot use local bypass or public intake to read private data', async ({ request }) => {
  for (const path of [
    '/inbox',
    '/settings',
    '/attachments/attachment:e2e',
    '/conversations/conversation:e2e',
    '/intake/mailbox:e2e'
  ]) {
    const response = await request.get(path, {
      headers: { Host: 'desk.example', 'Cf-Access-Jwt-Assertion': 'forged' }
    });
    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain('顾客 Ada');
  }
  const mutation = await request.post('/conversations/conversation:e2e?/reply', {
    headers: { Host: 'desk.example', Origin: 'https://desk.example' },
    form: { operation: 'send' }
  });
  expect(mutation.status()).toBe(403);
});

test('unresolved reply blocks sending and supports evidence-only reconciliation', async ({ page }, info) => {
  await page.goto(`/conversations/uncertain:${info.project.name}`);
  await expect(page.getByRole('status')).toContainText('Further replies are blocked');
  await expect(page.getByRole('button', { name: 'Save draft for review' })).toHaveCount(0);
  await page.getByText('Reconcile with provider evidence', { exact: true }).click();
  await page.getByLabel('Evidenced outcome').selectOption('accepted');
  await page.getByLabel('Provider evidence', { exact: true }).fill('Provider support record 987 confirms acceptance');
  await page.getByRole('button', { name: 'Record confirmed outcome' }).click();
  await expect(page.getByRole('alert')).toContainText('Message-ID');
  await page.getByText('Reconcile with provider evidence', { exact: true }).click();
  await expect(page.getByLabel('Provider evidence', { exact: true })).toHaveValue(
    'Provider support record 987 confirms acceptance'
  );
  await page
    .getByRole('region', { name: 'Reply workspace' })
    .screenshot({ path: info.outputPath('reply-unresolved.png') });
  await page.getByLabel('Evidenced outcome').selectOption('accepted');
  await page.getByLabel('Provider Message-ID (required for acceptance)').fill('<evidenced@inquiries.example>');
  await page.getByLabel('Provider evidence', { exact: true }).fill('Provider support record 987 confirms acceptance');
  await page.getByRole('button', { name: 'Record confirmed outcome' }).click();
  await expect(page.getByRole('heading', { name: 'Reply outcome · accepted' })).toBeVisible();
  await expect(page.getByText('Recorded evidence: Provider support record 987 confirms acceptance')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
