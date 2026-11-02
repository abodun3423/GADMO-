// Generates GADMO's app icons from the logo mark (run once; the files are committed).
// Usage: pnpm --filter @gadmo/web icons
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const INDIGO = '#1f2a6b';
const SPARK = '#f2b705';

// The "within reach" G: same geometry as components/Logo.tsx, in a 200x200 box.
const mark = (stroke, width = 28) => `
  <g fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M34.2 76.1 A70 70 0 0 1 160.6 65.0"/>
    <path d="M153.6 145.0 A70 70 0 0 1 34.2 123.9"/>
    <path d="M153.6 145.0 L170 100 L118 100"/>
  </g>
  <circle cx="30" cy="100" r="${width / 2 - 1}" fill="${SPARK}"/>`;

/** An indigo tile with the white mark; `scale` is the mark's share of the tile. */
function tile({ radius, scale, width = 28 }) {
  const offset = (200 - 200 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect width="200" height="200" rx="${radius}" fill="${INDIGO}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${mark('#ffffff', width)}</g>
</svg>
`;
}

const icons = {
  // Browser tab: bolder strokes so it holds up at 16px.
  'icon.svg': tile({ radius: 44, scale: 0.72, width: 32 }),
  'icon-192.png': tile({ radius: 44, scale: 0.7 }),
  'icon-512.png': tile({ radius: 44, scale: 0.7 }),
  // Maskable: full bleed, mark inside the 80% safe zone.
  'maskable-512.png': tile({ radius: 0, scale: 0.56 }),
  // iOS rounds the corners itself.
  'apple-touch-icon.png': tile({ radius: 0, scale: 0.64 }),
};
const sizes = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'maskable-512.png': 512,
  'apple-touch-icon.png': 180,
};

// Locally, PW_CHANNEL=chrome uses your installed Chrome.
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL,
  executablePath: process.env.PW_EXECUTABLE,
});
const page = await browser.newPage();
for (const [name, svg] of Object.entries(icons)) {
  if (name.endsWith('.svg')) {
    writeFileSync(join(OUT, name), svg);
    continue;
  }
  const size = sizes[name];
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(OUT, name), omitBackground: true });
}
await browser.close();
console.log('Icons written to', OUT);
