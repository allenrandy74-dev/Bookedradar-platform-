import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20000,
  expect: { timeout: 4000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'evidence/report' }], ['json', { outputFile: 'evidence/results.json' }]],
  outputDir: 'evidence/results',
  use: {
    browserName: 'chromium', headless: true,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block', acceptDownloads: false,
    screenshot: 'only-on-failure', trace: 'off', video: 'off',
    launchOptions: { args: ['--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--no-pings', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] }
  }
});
