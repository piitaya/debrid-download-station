// Takes the README screenshots: runs the built app against the fake NAS / debrid services.
// Usage: npm run build && npm run screenshots
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContextOptions, Page } from 'playwright-core';
import { listen } from '../test/serve.js';
import { createMockServer } from '../test/mocks/server.js';
import { launchBrowser } from './browser.js';

const OUT = new URL('../docs/screenshots/', import.meta.url);
const PORT = 8099;
const APP = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT, { recursive: true });
const mock = createMockServer({ speed: 60 * 1024 * 1024 });
const mockServer = await listen(mock.app);

const dataDir = mkdtempSync(join(tmpdir(), 'dds-shots-'));
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({
    apiKeys: { alldebrid: 'mock', realdebrid: 'mock' },
    defaultProvider: 'alldebrid',
    categories: [
      { id: 'films', name: 'Films', icon: 'movie', destination: 'video/Films' },
      { id: 'series', name: 'Séries', icon: 'tv', destination: 'video/Séries' },
      { id: 'kids', name: 'Enfants', icon: 'kids', destination: 'video/Enfants' },
      { id: 'music', name: 'Musique', icon: 'music', destination: 'music' },
    ],
    defaultCategoryId: 'films',
    createSubfolder: true,
    deleteFromDebrid: false,
  }),
);

const server = spawn('node', ['dist/server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    SYNOLOGY_URL: mockServer.url,
    ALLDEBRID_API_URL: `${mockServer.url}/alldebrid`,
    REALDEBRID_API_URL: `${mockServer.url}/realdebrid`,
    TORBOX_API_URL: `${mockServer.url}/torbox`,
    LOG_LEVEL: 'warn',
  },
  stdio: 'inherit',
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Server did not start');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const iphone: BrowserContextOptions = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  locale: 'fr-FR',
};
const desktop: BrowserContextOptions = {
  viewport: { width: 1360, height: 860 },
  deviceScaleFactor: 2,
  locale: 'fr-FR',
};

async function login(page: Page): Promise<void> {
  await page.goto(APP);
  await page.getByLabel(/utilisateur/).fill('paul');
  await page.getByLabel('Mot de passe').fill('paul');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByText('Nouveau téléchargement').waitFor();
}

async function shot(page: Page, name: string): Promise<void> {
  await sleep(400);
  await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname });
  console.log(`✓ ${name}.png`);
}

try {
  await waitForServer();
  const browser = await launchBrowser();

  // Login screen.
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ ...iphone, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(APP);
    await page.getByRole('button', { name: 'Se connecter' }).waitFor();
    await shot(page, `iphone-login-${scheme}`);
    await context.close();
  }

  // Fill the activity list through the API, like the app does.
  const context = await browser.newContext({ ...iphone, colorScheme: 'light' });
  const page = await context.newPage();
  await login(page);
  const add = async (magnet: string, categoryId: string, provider = 'alldebrid') => {
    const response = await page.request.post(`${APP}/api/jobs`, {
      headers: { 'X-Requested-With': 'dds' },
      data: { magnets: [magnet], provider, categoryId },
    });
    if (!response.ok()) throw new Error(await response.text());
  };
  const hash = (n: number) => n.toString(16).padStart(40, '0');
  await add(`magnet:?xt=urn:btih:${hash(1)}&dn=Big.Buck.Bunny.2008.720p.mkv`, 'films');
  await add(`magnet:?xt=urn:btih:${hash(2)}&dn=Sintel.S01.1080p.WEB`, 'series');
  await add(
    `magnet:?xt=urn:btih:${hash(3)}&dn=Tears.of.Steel.2012.1080p.slow`,
    'films',
    'realdebrid',
  );
  await add(`magnet:?xt=urn:btih:${hash(4)}&dn=Cosmos.Laundromat.dead`, 'kids');
  await sleep(9000);
  await add(`magnet:?xt=urn:btih:${hash(5)}&dn=Spring.2019.1080p.mkv`, 'kids');
  await sleep(2500);

  await page.reload();
  await page.getByText('Activité').waitFor();
  await page
    .locator('dds-add-card textarea')
    .fill(`magnet:?xt=urn:btih:${hash(6)}&dn=Agent.327.Operation.Barbershop.2017.2160p.mkv`);
  await page.getByRole('button', { name: 'Séries', exact: true }).click();
  await shot(page, 'iphone-home-light');

  await page.goto(`${APP}/#/settings`);
  await page.getByText('Services debrid').waitFor();
  await sleep(800);
  await shot(page, 'iphone-settings-light');
  await context.close();

  // Dark mode + expanded job.
  const dark = await browser.newContext({ ...iphone, colorScheme: 'dark' });
  const darkPage = await dark.newPage();
  await login(darkPage);
  await darkPage.getByText('Activité').waitFor();
  await darkPage.locator('dds-job-card').filter({ hasText: 'Sintel' }).locator('.summary').click();
  await darkPage.locator('dds-job-card').filter({ hasText: 'Sintel' }).scrollIntoViewIfNeeded();
  await shot(darkPage, 'iphone-activity-dark');
  await dark.close();

  // Desktop.
  for (const scheme of ['light', 'dark'] as const) {
    const wide = await browser.newContext({ ...desktop, colorScheme: scheme });
    const widePage = await wide.newPage();
    await login(widePage);
    await widePage.getByText('Activité').waitFor();
    await shot(widePage, `desktop-home-${scheme}`);
    if (scheme === 'light') {
      await widePage.goto(`${APP}/#/settings`);
      await widePage.getByText('Dossiers', { exact: true }).waitFor();
      await widePage.getByRole('button', { name: 'Ajouter un dossier' }).click();
      await widePage.getByPlaceholder('Films, Séries…').fill('Documentaires');
      await widePage.getByRole('button', { name: 'Parcourir' }).click();
      await widePage.getByRole('button', { name: 'video', exact: true }).click();
      await widePage.getByRole('button', { name: 'Choisir ce dossier' }).waitFor();
      await shot(widePage, 'desktop-folder-picker');
    }
    await wide.close();
  }

  await browser.close();
} finally {
  server.kill('SIGTERM');
  await mockServer.close();
}
