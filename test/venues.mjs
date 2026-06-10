// Dev helper: boot each venue, let it play on auto-pilot, screenshot it, and
// fail on any console error. Not part of the smoke test — a visual QA harness.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/scores')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ scores: [] }));
    return;
  }
  try {
    let q = p === '/' ? '/index.html' : p;
    const data = await readFile(join(ROOT, normalize(q)));
    res.writeHead(200, { 'content-type': MIME[extname(q)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('CONSOLE:', m.text()); } });
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR:', e.stack || e.message); });

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

for (const id of ['beach', 'wedding', 'concert']) {
  await page.click(`.level-chip[data-level="${id}"]`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(ROOT, `test/shot-menu-${id}.png`) });
  await page.click('#playBtn');
  await page.waitForTimeout(id === 'beach' ? 2500 : 5200); // circuits: fly into the crowd
  await page.evaluate(() => { window.game.timeLeft = 30; }); // keep the round alive
  await page.screenshot({ path: join(ROOT, `test/shot-${id}-1.png`) });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(ROOT, `test/shot-${id}-2.png`) });
  // back to menu for the next pick
  await page.evaluate(() => { window.game.timeLeft = 0.05; });
  await page.waitForTimeout(1200);
  const back = await page.$('#menuBtn');
  if (back) await back.click();
  else await page.evaluate(() => window.game._showMenu());
  await page.waitForTimeout(500);
}

await browser.close();
server.close();
console.log('errors:', errors.length);
process.exit(errors.length ? 1 : 0);
