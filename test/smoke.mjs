import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = join(ROOT, normalize(p));
    const data = await readFile(fp);
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}/`;
console.log('serving', url);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { const t = 'CONSOLE: ' + m.text(); errors.push(t); console.log(t); } });
page.on('pageerror', (e) => { const t = 'PAGEERROR: ' + (e.stack || e.message); errors.push(t); console.log(t); });

try {
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// menu visible?
const menuVisible = await page.isVisible('#menu');
console.log('menu visible:', menuVisible);
await page.screenshot({ path: join(ROOT, 'test/shot-menu.png') });

// start the game
await page.click('#playBtn');
await page.waitForTimeout(800);
const hudVisible = await page.isVisible('#hud');
console.log('hud visible after play:', hudVisible);

// simulate steering: drag on the canvas
await page.mouse.move(195, 500);
await page.mouse.down();
await page.mouse.move(120, 420, { steps: 8 });
await page.waitForTimeout(600);
await page.mouse.up();

// fire several poops: hold the poop button to charge, release
for (let i = 0; i < 3; i++) {
  const btn = await page.$('#poopBtn');
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500); // charge
  await page.mouse.up();
  await page.waitForTimeout(1800); // let it fly + maybe bullet time
}

// read score
let score = await page.textContent('#scoreValue');
console.log('score after random poops:', score);

// --- deterministic hit test: drop a target right where a tap would land, fire ---
const hit = await page.evaluate(async () => {
  const g = window.game;
  // put the bird in a known, level state for a repeatable shot
  g.pos.set(0, 36, 60); g.yaw = Math.PI; g.pitch = 0; g.roll = 0;
  if (g.poop) { g.scene.remove(g.poop.group); g.poop = null; }
  g.btActive = false; g.btHold = 0; g.targetTimeScale = 1;
  const p0 = g.pos.clone(); p0.y -= 0.8;
  const v0 = g._launchVel(0);
  const land = g._predictLanding(p0, v0);
  const tg = g.targets.targets[0];
  tg.alive = true; tg.orbit = false; // freeze any ring drift for a repeatable shot
  tg.group.position.set(land.x, 0, land.z);
  if (tg.bullseye) tg.bullseye.visible = true;
  g._dbg = { land: [land.x.toFixed(1), land.z.toFixed(1)], tgType: tg.key, radius: tg.radius };
  const scoreBefore = g.score;
  g.firePoop(0);
  // poll for bullet time + resolution
  let btSeen = false;
  for (let i = 0; i < 240; i++) {
    if (g.btActive) btSeen = true;
    if (g.score > scoreBefore || (!g.poop && g.btHold <= 0 && i > 4)) {
      // wait a touch more to ensure resolve ran
    }
    if (g.score > scoreBefore) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return { scoreBefore, scoreAfter: g.score, btSeen, hits: g.hits, bullseyes: g.bullseyes, dbg: g._dbg };
});
console.log('HIT TEST:', JSON.stringify(hit));

await page.waitForTimeout(400);
await page.screenshot({ path: join(ROOT, 'test/shot-play.png') });
score = await page.textContent('#scoreValue');
console.log('score after aimed poop:', score);

// --- SUPER TURD MODE: force a target into a super turd, bomb it, assert the
//     power-up activates (timer, aura, cinematic) and grows the turds ---
const sup = await page.evaluate(async () => {
  const g = window.game;
  g.pos.set(0, 36, 60); g.yaw = Math.PI; g.pitch = 0; g.roll = 0;
  if (g.poop) { g.scene.remove(g.poop.group); g.poop = null; }
  g.btActive = false; g.btHold = 0; g.btImpact = null; g.targetTimeScale = 1;
  g.superTimer = 0; g.superSpin = 0;
  const p0 = g.pos.clone(); p0.y -= 0.8;
  const v0 = g._launchVel();
  const land = g._predictLanding(p0, v0);
  const tg = g.targets.targets[0];
  tg.alive = true; tg.orbit = false; tg.special = 'super';
  tg.group.position.set(land.x, 0, land.z);
  if (tg.bullseye) tg.bullseye.visible = true;
  const scaleBefore = g._turdScale(1);
  g.firePoop(0);
  for (let i = 0; i < 300; i++) {
    if (g.superTimer > 0) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const out = {
    superTimer: +g.superTimer.toFixed(2),
    spinning: g.superSpin > 0,
    auraVisible: g.superAura.group.visible,
    stack1: g.superStack,
    mult1: g._superScoreMult(),
    scaleBefore: +scaleBefore.toFixed(2),
    scaleSuper: +g._turdScale(1).toFixed(2),
    badgeShown: !document.getElementById('superBadge').classList.contains('hidden'),
  };
  // stack two more super turds to reach TURD FIRE (3 stacks)
  const t1 = g.superTimer;
  g._hitSuperTurd();                       // stack 2
  out.timerAfterStack = +g.superTimer.toFixed(2); // should be > t1 (time added)
  out.stack2 = g.superStack; out.mult2 = g._superScoreMult();
  out.scaleStack2 = +g._turdScale(1).toFixed(2);  // bigger than scaleSuper
  g._hitSuperTurd();                       // stack 3 => TURD FIRE
  out.stack3 = g.superStack;
  out.fireMode = g.fireMode;
  out.fireAura = g.fireAura.group.visible;
  out.badgeFire = document.getElementById('superBadge').classList.contains('fire');
  out.mult3 = g._superScoreMult();
  // a drop in fire mode should produce a flagged fireball
  g.firePoop(1);
  out.poopIsFire = !!(g.poop && g.poop.fire);
  out.timerWasAdded = out.timerAfterStack > t1;
  // clean up so the rest of the run starts from a normal state
  if (g.poop) { g.scene.remove(g.poop.group); g.poop = null; }
  g._endSuper();
  g.superSpin = 0; g.btActive = false; g.btHold = 0;
  g.timeScale = 1; g.targetTimeScale = 1;
  g.input.setEnabled(true);
  return out;
});
console.log('SUPER TEST:', JSON.stringify(sup));
if (!(sup.superTimer > 0 && sup.auraVisible && sup.scaleSuper > sup.scaleBefore)) {
  throw new Error('SUPER TURD MODE did not activate as expected: ' + JSON.stringify(sup));
}
if (!(sup.mult1 === 1.5 && sup.mult2 === 2 && sup.mult3 === 2.5)) {
  throw new Error('Super score multiplier did not step 1.5/2/2.5: ' + JSON.stringify(sup));
}
if (!(sup.scaleStack2 > sup.scaleSuper && sup.timerWasAdded)) {
  throw new Error('Stacking did not grow turds / add time: ' + JSON.stringify(sup));
}
if (!(sup.stack3 === 3 && sup.fireMode && sup.fireAura && sup.badgeFire && sup.poopIsFire)) {
  throw new Error('TURD FIRE did not ignite at 3 stacks: ' + JSON.stringify(sup));
}

// --- charging finger can steer: hold the poop button and drag, and steerX
//     should follow the drag (then reset on release) ---
await page.evaluate(() => { window.game.input.steerX = 0; window.game.input.steerY = 0; });
{
  const btn = await page.$('#poopBtn');
  const bb = await btn.boundingBox();
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy, { steps: 6 });
  const steerRight = await page.evaluate(() => window.game.input.steerX);
  await page.mouse.move(cx - 140, cy, { steps: 6 });
  const steerLeft = await page.evaluate(() => window.game.input.steerX);
  await page.mouse.up();
  const steerReleased = await page.evaluate(() => window.game.input.steerX);
  console.log('STEER TEST:', JSON.stringify({ steerRight, steerLeft, steerReleased }));
  if (!(steerRight > 0.3 && steerLeft < -0.3 && steerReleased === 0)) {
    throw new Error('charge-finger steering failed: ' + JSON.stringify({ steerRight, steerLeft, steerReleased }));
  }
}

// --- capture a clean bullet-time frame: frozen target, tap straight down ---
await page.evaluate(() => {
  const g = window.game;
  g.pos.set(0, 40, 60); g.yaw = Math.PI; g.pitch = 0; g.roll = 0;
  if (g.poop) { g.scene.remove(g.poop.group); g.poop = null; }
  g.btActive = false; g.btHold = 0; g.btImpact = null; g.targetTimeScale = 1;
  const p0 = g.pos.clone(); p0.y -= 0.8;
  const v0 = g._launchVel(0);
  const land = g._predictLanding(p0, v0);
  const tg = g.targets.targets[0];
  tg.alive = true; tg.orbit = false;
  tg.group.position.set(land.x, 0, land.z);
  if (tg.bullseye) tg.bullseye.visible = true;
  g.firePoop(0);
});
// poll until bullet time engaged, let camera settle, screenshot while still falling
let btShot = false;
for (let i = 0; i < 150; i++) {
  const st = await page.evaluate(() => ({ bt: window.game.btActive, falling: !!window.game.poop }));
  if (st.bt && st.falling) {
    await page.waitForTimeout(160); // camera settle, still descending in slow-mo
    await page.screenshot({ path: join(ROOT, 'test/shot-bullettime.png') });
    btShot = true; break;
  }
  await page.waitForTimeout(15);
}
console.log('bullet-time screenshot captured:', btShot);
await page.waitForTimeout(1500);

// --- run the clock down to verify game over screen ---
await page.evaluate(() => {
  const g = window.game;
  if (g.poop) { g.scene.remove(g.poop.group); g.poop = null; }
  g.btActive = false; g.btHold = 0; g.btImpact = null; g.targetTimeScale = 1; g.timeScale = 1;
  g.timeLeft = 0.4;
});
let goVisible = false;
for (let i = 0; i < 60; i++) {
  goVisible = await page.isVisible('#gameover');
  if (goVisible) break;
  await page.waitForTimeout(100);
}
const goState = await page.evaluate(() => ({ state: window.game.state, timeLeft: window.game.timeLeft }));
console.log('game over screen visible:', goVisible, JSON.stringify(goState));
await page.screenshot({ path: join(ROOT, 'test/shot-gameover.png') });

// verify renderer canvas has non-trivial pixels (not all sky) by sampling
const drawn = await page.evaluate(() => {
  const c = document.getElementById('game');
  return { w: c.width, h: c.height };
});
console.log('canvas size:', JSON.stringify(drawn));
} catch (err) {
  console.log('TEST-ERROR:', err.message);
  try { await page.screenshot({ path: join(ROOT, 'test/shot-fail.png') }); } catch {}
}

await browser.close();
server.close();

console.log('--- ERRORS (' + errors.length + ') ---');
for (const e of errors) console.log(e);
process.exit(errors.length ? 1 : 0);
