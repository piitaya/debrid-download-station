// Renders the PNG icons (PWA, iOS home screen) from src/web/public/icons/icon.svg.
import { readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser.js';

const dir = new URL('../src/web/public/icons/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir), 'utf8');

const icons = [
  { file: 'icon-192.png', size: 192, rounded: true, glyphScale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, glyphScale: 1 },
  // iOS rounds the corners itself and wants a full-bleed square.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, glyphScale: 1 },
  // Android masks the icon: keep the drawing well inside the safe zone.
  { file: 'icon-maskable-512.png', size: 512, rounded: false, glyphScale: 0.8 },
];

/** Square corners and/or a smaller glyph (everything drawn after the background). */
function variant(source: string, rounded: boolean, glyphScale: number): string {
  let result = rounded ? source : source.replace(/rx="\d+"/, 'rx="0"');
  if (glyphScale !== 1) {
    const offset = 256 * (1 - glyphScale);
    result = result
      // The first <rect> is the background: scale what is drawn on top of it.
      .replace(
        /(<rect [^>]*\/>)/,
        `$1<g transform="translate(${offset} ${offset}) scale(${glyphScale})">`,
      )
      .replace('</svg>', '</g></svg>');
  }
  return result;
}

const browser = await launchBrowser();
const page = await browser.newPage();
for (const icon of icons) {
  const body = variant(svg, icon.rounded, icon.glyphScale).replace(
    '<svg ',
    `<svg width="${icon.size}" height="${icon.size}" `,
  );
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${body}</body></html>`,
  );
  writeFileSync(
    new URL(icon.file, dir),
    await page.screenshot({ omitBackground: icon.rounded, type: 'png' }),
  );
  console.log(`✓ ${icon.file}`);
}
await browser.close();
