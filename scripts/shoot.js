import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'screenshots');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.SHOOT_BASE || 'http://127.0.0.1:4321';
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'gallery-2025', path: '/paintings-2025' },
  { name: 'abstracts', path: '/abstracts' },
  { name: 'work-detail', path: '/works/the-seven-sisters' },
  { name: 'bio', path: '/bio' },
  { name: 'contact', path: '/contact' },
  { name: 'admin-works', path: '/admin/works' },
];
const VIEWPORTS = [
  { label: 'desktop', width: 1280, height: 800 },
  { label: 'mobile', width: 390, height: 844 },
];

const PER_PAGE_MS = 12000;

function killswitch(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout ${label} ${ms}ms`)), ms)
  );
}

async function shoot(page, url, file) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: file, fullPage: true });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let okCount = 0;
  const results = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const p of PAGES) {
      const name = `${p.name}-${vp.label}`;
      const file = resolve(OUT, `${name}.png`);
      const url = BASE + p.path;
      try {
        await Promise.race([shoot(page, url, file), killswitch(PER_PAGE_MS, name)]);
        console.log(`OK ${name}`);
        results.push({ name, ok: true });
        okCount++;
      } catch (e) {
        console.log(`FAIL ${name}: ${e.message}`);
        results.push({ name, ok: false, err: e.message });
      }
    }
  }

  await browser.close();
  console.log(`\nDONE ${okCount}/${PAGES.length * VIEWPORTS.length}`);
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
