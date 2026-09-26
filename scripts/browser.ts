import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

/** Launches Chromium: CHROMIUM_PATH, a Playwright-managed browser, or a system one. */
export async function launchBrowser(): Promise<Browser> {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter((path): path is string => !!path && existsSync(path));
  return chromium.launch({ executablePath: candidates[0] });
}
