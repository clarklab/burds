// Dev helper: close-up portraits of the new character models — spawns a
// line-up in the live game scene, parks the camera in front, screenshots.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/scores')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"scores":[]}'); return; }
  try {
    const q = p === '/' ? '/index.html' : p;
    const data = await readFile(join(ROOT, normalize(q)));
    res.writeHead(200, { 'content-type': MIME[extname(q)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR:', e.stack || e.message); });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  for (const id of ['menu', 'hud', 'gameover', 'loading']) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }
  const game = window.game;
  const M = await import('./src/models.js');
  const builders = [
    () => M.buildPerson({ hat: true, shoes: true }),
    () => M.buildPerson({ hat: true, shoes: true }),
    () => M.buildKid(),
    () => M.buildBiker(),
    () => M.buildGroom(),
    () => M.buildBride(),
    () => M.buildFan(),
    () => M.buildBandMember('mic'),
    () => M.buildPicnic(),
    () => M.buildSeatedGuest(),
  ];
  const lineup = [];
  builders.forEach((b, i) => {
    const g = b();
    g.position.set(-13 + i * 3.0, 0, -20);
    game.scene.add(g);
    lineup.push(g);
  });
  // a shocked pair to check the panic pose on the new bodies
  const shocked = M.buildPerson({ hat: true, shoes: true });
  shocked.position.set(2, 0, -16);
  shocked.userData.setShocked(true);
  game.scene.add(shocked);
  // park the gull in shot too
  game.pos.set(-6, 2.2, -14.5);
  game.yaw = 0.4; game.pitch = 0; game.roll = 0;
  game._placeBird();
  // static camera looking at the line-up
  game.renderer.setAnimationLoop(null);
  game.camera.position.set(0, 3.4, -10);
  game.camera.lookAt(0, 1.4, -20);
  game.renderer.render(game.scene, game.camera);
});
await page.screenshot({ path: join(ROOT, 'test/shot-lineup.png') });

// second framing: out over the water for the wave shader + shoreline
await page.evaluate(() => {
  const game = window.game;
  game.world.update(game.pos); // keep world centred
  game.camera.position.set(-30, 12, -20);
  game.camera.lookAt(-160, 0, -60);
  game.renderer.render(game.scene, game.camera);
});
await page.screenshot({ path: join(ROOT, 'test/shot-sea.png') });
await browser.close();
server.close();
console.log('lineup captured, errors:', errors.length);
process.exit(errors.length ? 1 : 0);
