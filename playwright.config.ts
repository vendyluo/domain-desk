import { defineConfig, devices } from '@playwright/test';

const baseURL = `http://127.0.0.1:${process.env.E2E_PORT || '4173'}`;
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run e2e:serve',
    url: `${baseURL}/settings`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 320, height: 720 } } }
  ]
});
