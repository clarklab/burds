import { chromium } from 'playwright';
import { writeFile } from 'fs/promises';

const SEARCHES = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
const page = await ctx.newPage();

const all = {};
for (const q of SEARCHES) {
  const slug = encodeURIComponent(q.trim().replace(/\s+/g, '-'));
  try {
    await page.goto(`https://pixabay.com/sound-effects/search/${slug}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    const rows = await page.evaluate(() => {
      const out = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        const src = o.sources && (o.sources.mp3 || o.sources.src);
        if (src && /\.mp3/.test(String(src))) {
          out.push({ title: o.title || o.name || '', dur: o.duration || 0, dl: o.downloads || 0, likes: o.likes || 0, src: String(src) });
        }
        Object.values(o).forEach(walk);
      };
      walk(window.__BOOTSTRAP__);
      // de-dupe
      const seen = new Set();
      return out.filter((r) => !seen.has(r.src) && seen.add(r.src));
    });
    all[q] = rows.slice(0, 12);
    console.log(`-- ${q}: ${rows.length} results`);
  } catch (e) { console.log(`-- ${q}: ERR ${e.message.split('\n')[0]}`); all[q] = []; }
}
await writeFile('/tmp/pixabay-results.json', JSON.stringify(all, null, 1));
console.log('saved /tmp/pixabay-results.json');
await browser.close();
