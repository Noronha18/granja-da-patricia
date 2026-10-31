import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', workers: 1, use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] } }, webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: false } });
