import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dataDir = mkdtempSync(join(tmpdir(), 'freejira-browser-'));
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4180',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4180/api/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: { PORT: '4180', HOST: '127.0.0.1', DATA_DIR: dataDir },
  },
});
