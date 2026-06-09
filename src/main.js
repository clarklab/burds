import * as THREE from 'three';
import { TargetManager, COURSE_HALF } from './world.js';
import { buildSeagull, buildPoop, buildFireball } from './models.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Effects, buildReticle, buildBirdShadow, buildSuperAura, buildFireAura } from './effects.js';
import { getName, fetchScores, submitScore, flushPending, cachedScores } from './scores.js';
import { LEVELS, LEVELS_BY_ID, DEFAULT_LEVEL } from './levels.js';
import { iconSvg } from './icons.js';

// Icon name for each tier-3 weapon mode (badge + toast + picker).
const MODE_ICON = { fire: 'fire', scatter: 'scatter', machinegun: 'machinegun' };

// Render a few flap frames of the actual seagull to transparent PNG sprites,
// used for the two birds that orbit the menu logo. One-off, on a throwaway
// renderer; returns [] (and the birds are simply skipped) if WebGL/readback
// isn't available.
function renderBirdSprites() {
  try {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(128, 128);
    renderer.setPixelRatio(2);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3); dir.position.set(2, 5, 4); scene.add(dir);
    const gull = buildSeagull();
    gull.group.rotation.set(0.12, -Math.PI / 2, 0); // face screen-right, slight nose-down
    scene.add(gull.group);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    cam.position.set(-1.6, 2.4, 8.8);
    cam.lookAt(0, 0.1, 0);
    const frames = [];
    for (const t of [0.1745, 0.349, 0.5236, 0.349]) { // wings up, mid, down, mid
      gull.flap(t, 1);
      renderer.render(scene, cam);
      frames.push(renderer.domElement.toDataURL('image/png'));
    }
    renderer.dispose();
    return frames;
  } catch (e) {
    return [];
  }
}

// ----- tuning constants -----
const BIRD_SPEED = 24;       // constant forward flight speed down the lane
const POWER_SPEED = 34;      // forward speed scaling for the (fixed) drop throw
const FIRE_POWER = 0.4;      // fixed throw power — holding no longer flings farther
const STRAFE_SPEED = 24;     // lateral m/s when steering across the lane
const GRAVITY = 34;          // poop gravity (m/s^2)
const MIN_ALT = 12;
const MAX_ALT = 56;
const FORWARD_YAW = Math.PI; // heading is locked forward down the straightaway (-Z)
const ROUND_TIME = 30;       // seconds

// ----- circuit levels (wedding / concert) -----
// The bird flies itself along the venue's long axis and the player only steers
// altitude. Turds are thrown a shorter, steeper distance than on the beach so
// the drop lands close ahead of the bird as it passes over the packed crowd.
const CIRCUIT_THROW = 22;    // forward launch speed for circuit drops (vs ~37 on the beach)
const TURN_TIME = 1.35;      // seconds for the scripted U-turn at each end of a pass

// ----- splash multi-hit -----
// A fully-charged / super turd splashes a whole cluster. BLAST is the extra
// radius (beyond a target's own catch radius) within which neighbours also get
// splatted. It scales with turd size, so only the big ones rack up the multis.
const BLAST_PER = 1.7;       // blast radius added per unit of turd scale over 1
const BLAST_MAX = 16;        // cap on how many targets one drop can splat

// Reticle hone: it starts big and tightens to the firing size as the shot lines
// up on a target, so the size itself tells you when to release.
const RET_BIG = 3.0;         // 3x oversized when nothing is lined up
const RET_FIRE = 0.6;        // final firing size when a hit is dialled in


// ----- SUPER TURD MODE -----
const SUPER_TIME = 15;       // seconds of giant turds from the first super turd
const SUPER_STACK_TIME = 10; // extra seconds each additional (stacked) super turd adds
const SUPER_SPIN_TIME = 1.8; // length of the camera-orbit transformation cinematic
const SUPER_TURD_MULT = 2.5; // base turd size multiplier while super mode is active
const SUPER_STACK_SIZE = 0.7;// extra size multiplier added per stack beyond the first
const TURD_SCALE_MAX = 6.5;  // cap so giant turds don't swallow the whole screen
const FIRE_STACK = 3;        // stacks needed to unlock a tier-3 weapon mode
const TURD_FOOTPRINT = 0.7;  // extra catch radius per unit of turd scale over 1 (bigger turd = easier hit)

// ----- tier-3 weapon modes (picked from a slow-mo menu on the 3rd stack) -----
const MODE_BONUS_TIME = 20;  // seconds added to the super window when you pick a mode
const PICKER_SCALE = 0.06;   // time slows almost to a stop while the picker is open
const SCATTER_COUNT = 5;     // pellets per scatter volley (Contra-style spread)
const SCATTER_SPREAD = 0.62; // total fan angle (radians) across the spread
const SCATTER_SIZE = 0.62;   // pellets are smaller than a normal turd
const MG_RATE = 3;           // machine-gun turds per second
const MG_POWER = 0.42;       // fixed hold-power for machine-gun turds

// ----- scoring / hit feel -----
const HIT_PAD = 0.6;         // horizontal slack added to a target's catch radius (more forgiving hits)
const BULLSEYE_ACC = 0.86;   // accuracy needed for a BULLSEYE (lower than before => easier to nail)
const DIRECT_ACC = 0.55;     // accuracy needed for a DIRECT HIT
const TIME_BONUS_HIT = 5;    // seconds added to the timer for any hit
const TIME_BONUS_BULLSEYE = 10; // seconds added to the timer for a bullseye (instead of the hit bonus)
// A poop predicted to land within this of a target triggers bullet-time, so even
// near-misses get the slow-mo treatment — bullet time fires far more often.
const BT_CATCH = 3.0;
// Bullet time is reserved for MAX-POWER drops: holding the turd to full charge
// slows time so you can line up the shot, and that slow-mo carries through the
// drop when it's on target.
const MAX_CHARGE_BT = 0.999; // charge level that counts as "max power"
const AIM_TIME_SCALE = 0.3;  // slow-mo factor while holding a maxed turd to aim

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 800);

    // ----- level selection -----
    // The player picks a level on the menu; each keeps its own high score. The
    // beach world doubles as the menu backdrop until a level is chosen.
    this.levels = LEVELS;
    this.levelId = DEFAULT_LEVEL;
    this.level = LEVELS_BY_ID[this.levelId];
    this.levelMode = this.level.mode;
    this.world = null;
    this.builtLevel = null;
    this._buildWorldFor(this.levelId);

    // player bird
    const gull = buildSeagull();
    this.birdModel = gull;
    this.bird = gull.group;
    this.scene.add(this.bird);

    this.birdShadow = buildBirdShadow();
    this.scene.add(this.birdShadow);

    // super-Saiyan + fire auras ride on the bird, hidden until earned
    this.superAura = buildSuperAura();
    this.bird.add(this.superAura.group);
    this.fireAura = buildFireAura();
    this.bird.add(this.fireAura.group);

    this.reticle = buildReticle();
    this.scene.add(this.reticle);

    this.targets = new TargetManager(this.scene);
    this.effects = new Effects(this.scene);
    this.audio = new Audio();
    this.input = new Input(this.canvas, document.getElementById('poopBtn'));

    // flight state — the bird always runs forward (-Z); steering strafes it
    // across a fixed-width lane and dives/climbs, but never turns it around.
    this.pos = new THREE.Vector3(0, 32, 0);
    this.yaw = FORWARD_YAW;
    this.pitch = 0;
    this.roll = 0;

    // circuit-flight state (wedding / concert auto-pilot loops)
    this.circuitDir = -1;  // -1 heading toward the front (-Z), +1 heading back (+Z)
    this.turning = false;
    this.turnT = 0;

    // charge / bullseye cue
    this._bullseyeReady = false;
    this._retScale = 1;

    // poops in flight (an array so scatter + machine gun can have many at once);
    // btPoop is the single one that owns bullet-time framing, when eligible.
    this.poops = [];
    this.btPoop = null;

    // time / bullet-time
    this.timeScale = 1;
    this.targetTimeScale = 1;
    this.btActive = false;
    this.btHold = 0;

    // super turd mode
    this.superTimer = 0;   // seconds of giant-turd mode remaining
    this.superSpin = 0;    // seconds of transformation cinematic remaining
    this.superStack = 0;   // how many super turds are stacked (0 = inactive)
    // tier-3 weapon: 'normal' (giant turds) until the 3rd stack lets you pick
    // 'fire' | 'scatter' | 'machinegun' from the slow-mo menu.
    this.weaponMode = 'normal';
    this.pickerOpen = false; // the slow-mo mode menu is up
    this._mgCooldown = 0;    // machine-gun fire-rate timer

    // round
    this.state = 'menu';
    this.score = 0;
    this.combo = 0;
    this.hits = 0;
    this.bullseyes = 0;
    this.timeLeft = ROUND_TIME;
    // Per-level high scores. The old single key seeds the beach best so existing
    // players keep their record.
    this.bests = {};
    for (const l of this.levels) {
      const legacy = l.id === 'beach' ? localStorage.getItem('gulldump_best') : null;
      this.bests[l.id] = parseInt(localStorage.getItem(this._bestKey(l.id)) || legacy || '0', 10);
    }
    this.best = this.bests[this.levelId];

    // dom
    this.dom = {
      hud: document.getElementById('hud'),
      menu: document.getElementById('menu'),
      gameover: document.getElementById('gameover'),
      loading: document.getElementById('loading'),
      score: document.getElementById('scoreValue'),
      timer: document.getElementById('timerValue'),
      timerPill: document.getElementById('timerPill'),
      combo: document.getElementById('comboValue'),
      comboPill: document.getElementById('comboPill'),
      toast: document.getElementById('hitToast'),
      chargeFg: document.querySelector('.charge-fg'),
      poopBtn: document.getElementById('poopBtn'),
      weaponPicker: document.getElementById('weaponPicker'),
      turdCam: document.getElementById('turdCam'),
      superBadge: document.getElementById('superBadge'),
      superBolt: document.getElementById('superBolt'),
      superLabel: document.getElementById('superLabel'),
      superMult: document.getElementById('superMult'),
      superTime: document.getElementById('superTime'),
      finalScore: document.getElementById('finalScore'),
      goHits: document.getElementById('goHits'),
      goBest: document.getElementById('goBest'),
      goBullseyes: document.getElementById('goBullseyes'),
      goBlurb: document.getElementById('goBlurb'),
      menuBest: document.getElementById('menuBest'),
      levelPick: document.getElementById('levelPick'),
      howTo: document.getElementById('howTo'),
      menuBoard: document.getElementById('menuBoard'),
      menuBoardTitle: document.getElementById('menuBoardTitle'),
      goTitle: document.getElementById('goTitle'),
      logoStage: document.getElementById('logoStage'),
      menuBoardList: document.getElementById('menuBoardList'),
      goBoardList: document.getElementById('goBoardList'),
      nameInput: document.getElementById('nameInput'),
      submitScoreBtn: document.getElementById('submitScoreBtn'),
    };
    this.dom.menuBest.textContent = this.best;
    this._initLevelPicker();

    // leaderboard state
    this._lbScores = cachedScores(this.levelId);
    this._goScore = 0;
    this._submitted = false;
    this._myId = null;

    this._bindUI();
    this._initMenuBirds();
    this._initLeaderboard();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.dom.loading.classList.add('hidden');

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _bindUI() {
    const start = () => { this.audio.unlock(); this.startRound(); };
    document.getElementById('playBtn').addEventListener('click', start);
    document.getElementById('againBtn').addEventListener('click', start);
    const menuBtn = document.getElementById('menuBtn');
    if (menuBtn) menuBtn.addEventListener('click', () => this._showMenu());

    // weapon picker (slow-mo menu on the 3rd super stack)
    for (const btn of this.dom.weaponPicker.querySelectorAll('[data-mode]')) {
      // pointerdown so a tap registers instantly during the slow-mo freeze
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); this._chooseWeapon(btn.dataset.mode); });
    }
  }

  // Return from the game-over screen to the menu so a different level can be
  // picked. The last-played venue stays as the backdrop.
  _showMenu() {
    this.state = 'menu';
    this.input.setEnabled(false);
    this._camLookAt = null;
    this.dom.gameover.classList.add('hidden');
    this.dom.hud.classList.add('hidden');
    this.dom.menu.classList.remove('hidden');
    this.dom.menuBest.textContent = this.bests[this.levelId];
    this._renderMenuBoard();
  }

  _bestKey(id) { return `burds_best_${id}`; }

  // (Re)build the scene world for a level, tearing the previous one down. The
  // bird, reticle, shadow and auras live outside the world root, so they persist.
  _buildWorldFor(id) {
    if (this.builtLevel === id) return;
    if (this.world && this.world.dispose) this.world.dispose();
    const lvl = LEVELS_BY_ID[id] || LEVELS_BY_ID[DEFAULT_LEVEL];
    this.world = lvl.build(this.scene, this.renderer);
    this.builtLevel = id;
  }

  // Build the row of level chips on the menu and wire up selection.
  _initLevelPicker() {
    const pick = this.dom.levelPick;
    if (pick) {
      pick.innerHTML = '';
      for (const l of this.levels) {
        const btn = document.createElement('button');
        btn.className = 'level-chip' + (l.id === this.levelId ? ' selected' : '');
        btn.dataset.level = l.id;
        btn.innerHTML = `<span class="lc-emoji">${iconSvg(l.icon, { size: 26 })}</span><span class="lc-name">${l.name}</span>`;
        btn.addEventListener('click', () => this._selectLevel(l.id));
        pick.appendChild(btn);
      }
    }
    this._renderHowTo();
  }

  _renderHowTo() {
    const el = this.dom.howTo;
    if (!el) return;
    el.innerHTML = '';
    for (const row of this.level.howto) {
      const div = document.createElement('div');
      div.className = 'howrow';
      div.innerHTML = `<span class="howicon">${iconSvg(row.icon, { size: 22 })}</span><span>${row.html}</span>`;
      el.appendChild(div);
    }
  }

  _selectLevel(id) {
    if (id === this.levelId) return;
    this.levelId = id;
    this.level = LEVELS_BY_ID[id];
    this.levelMode = this.level.mode;
    this.best = this.bests[id];
    // chip highlight
    if (this.dom.levelPick) {
      for (const c of this.dom.levelPick.children) c.classList.toggle('selected', c.dataset.level === id);
    }
    this.dom.menuBest.textContent = this.best;
    if (this.dom.menuBoardTitle) this.dom.menuBoardTitle.innerHTML = iconSvg('trophy', { size: 15, cls: 'title-ic' }) + `<span>${this.level.name} Top</span>`;
    this._renderHowTo();
    // swap the menu backdrop world to the chosen venue
    this._buildWorldFor(id);
    this._camLookAt = null; // let the idle camera re-settle on the new venue
    // load this level's leaderboard
    this._lbScores = cachedScores(this.levelId);
    this._renderMenuBoard();
    fetchScores(this.levelId).then((s) => {
      if (this.levelId !== id) return; // a newer selection won
      this._lbScores = s; this._renderMenuBoard();
    });
  }

  // ---- menu birds: two seagulls orbiting the logo (in front, then behind) ----
  _initMenuBirds() {
    this._menuBirds = [];
    const stage = this.dom.logoStage;
    if (!stage) return;
    const frames = renderBirdSprites();
    this._birdFrames = frames;
    if (!frames.length) return;
    for (let i = 0; i < 2; i++) {
      const el = document.createElement('img');
      el.className = 'menu-bird';
      el.src = frames[0];
      el.alt = '';
      el._fi = 0;
      stage.appendChild(el);
      this._menuBirds.push({ el, phase: i * Math.PI });
    }
  }

  _updateMenuBirds(time) {
    const birds = this._menuBirds;
    if (!birds || !birds.length) return;
    const stage = this.dom.logoStage;
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W) return;
    const cx = W * 0.5, cy = H * 0.5;
    const ax = W * 0.58, ay = H * 0.6;
    const frames = this._birdFrames;
    for (const b of birds) {
      const th = time * 0.55 + b.phase;
      const depth = Math.cos(th);                 // +1 in front, -1 behind
      const x = cx + Math.sin(th) * ax;
      const y = cy + depth * ay * 0.42;           // dips low+near in front, rides high+far behind
      const scale = 0.62 + 0.5 * (depth * 0.5 + 0.5); // bigger in front
      const flip = Math.cos(th) >= 0 ? 1 : -1;    // face travel direction
      const bank = -Math.sin(th) * 10;
      b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(flip * scale).toFixed(3)}, ${scale.toFixed(3)}) rotate(${bank.toFixed(1)}deg)`;
      b.el.style.zIndex = depth >= 0 ? 2 : 0;     // in front of / behind the logo
      const fi = ((time * 8 + b.phase * 1.5) | 0) % frames.length;
      if (b.el._fi !== fi) { b.el._fi = fi; b.el.src = frames[fi]; }
    }
  }

  // ---- global leaderboard ----
  _initLeaderboard() {
    this.dom.nameInput.value = getName();
    const submit = () => this._submitScore();
    this.dom.submitScoreBtn.addEventListener('click', submit);
    this.dom.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    this.dom.nameInput.addEventListener('input', () => {
      if (this.state === 'gameover' && !this._submitted) this._renderGoBoard();
    });
    if (this.dom.menuBoardTitle) this.dom.menuBoardTitle.innerHTML = iconSvg('trophy', { size: 15, cls: 'title-ic' }) + `<span>${this.level.name} Top</span>`;
    // render whatever we have cached immediately, then refresh from the server
    this._renderMenuBoard();
    fetchScores(this.levelId).then((s) => { this._lbScores = s; this._renderMenuBoard(); if (this.state === 'gameover') this._renderGoBoard(); });
    flushPending();
    window.addEventListener('online', () => {
      flushPending().then(() => fetchScores(this.levelId)).then((s) => { this._lbScores = s; this._renderMenuBoard(); });
    });
  }

  _fillBoard(listEl, scores, limit, meId) {
    if (!listEl) return;
    listEl.innerHTML = '';
    const top = scores.slice(0, limit);
    if (!top.length) {
      const li = document.createElement('li');
      li.className = 'board-empty';
      li.textContent = 'No scores yet — be the first!';
      listEl.appendChild(li);
      return;
    }
    top.forEach((e, i) => {
      const li = document.createElement('li');
      if (e.me || (meId && e.id === meId)) li.className = 'me';
      const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(i + 1);
      const name = document.createElement('span'); name.className = 'pname'; name.textContent = e.name || 'BURD';
      const score = document.createElement('span'); score.className = 'pscore'; score.textContent = String(e.score);
      li.append(rank, name, score);
      listEl.appendChild(li);
    });
  }

  _renderMenuBoard() {
    // On the welcome screen we keep things compact: if there are no scores yet
    // for this level, hide the board entirely rather than show an empty state.
    const scores = this._lbScores || [];
    if (this.dom.menuBoard) this.dom.menuBoard.classList.toggle('hidden', scores.length === 0);
    this._fillBoard(this.dom.menuBoardList, scores, 3, this._myId);
  }

  _renderGoBoard() {
    const scores = (this._lbScores || []).slice();
    let meId = this._myId;
    if (!this._submitted) {
      // provisional row so you can see where this run would land before you submit
      const prov = { id: '__me__', name: (this.dom.nameInput.value || 'YOU').toUpperCase(), score: this._goScore, me: true };
      scores.push(prov);
      scores.sort((a, b) => b.score - a.score);
      meId = '__me__';
    }
    this._fillBoard(this.dom.goBoardList, scores, 10, meId);
  }

  _submitScore() {
    if (this._submitted) return;
    const name = (this.dom.nameInput.value || '').trim() || 'BURD';
    const { list, entry } = submitScore(name, this._goScore, this.levelId, (merged) => {
      this._lbScores = merged;
      this._renderGoBoard();
      this._renderMenuBoard();
    });
    this._submitted = true;
    this._myId = entry.id;
    this._lbScores = list;
    this.dom.submitScoreBtn.disabled = true;
    this.dom.submitScoreBtn.innerHTML = `<span>SUBMITTED</span>` + iconSvg('check', { size: 15, cls: 'btn-ic' });
    this.dom.nameInput.blur();
    this._renderGoBoard();
    this._renderMenuBoard();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------
  startRound() {
    this.level = LEVELS_BY_ID[this.levelId];
    this.levelMode = this.level.mode;
    this.best = this.bests[this.levelId];
    this._buildWorldFor(this.levelId);

    this.score = 0;
    this.combo = 0;
    this.hits = 0;
    this.bullseyes = 0;
    this.timeLeft = ROUND_TIME;
    // Position the bird for the level's flight model.
    if (this.levelMode === 'circuit') {
      const c = this.level.circuit;
      this.pos.set(0, 30, c.startZ);
      this.circuitDir = -1;           // head toward the front (-Z) first
      this.yaw = Math.PI;
      this.turning = false; this.turnT = 0;
    } else {
      this.pos.set(0, 32, 0);
      this.yaw = FORWARD_YAW;
    }
    this.pitch = 0;
    this.roll = 0;
    this._camLookAt = null;
    this.timeScale = 1; this.targetTimeScale = 1; this.btActive = false; this.btPoop = null;
    this.superTimer = 0; this.superSpin = 0; this.superStack = 0; this.weaponMode = 'normal';
    this.pickerOpen = false; this.dom.weaponPicker.classList.add('hidden');
    this.superAura.group.visible = false;
    this.fireAura.group.visible = false;
    this.dom.poopBtn.classList.remove('super', 'fire', 'scatter', 'machinegun');
    this.dom.superBadge.classList.add('hidden');
    this.dom.superBadge.classList.remove('fire');
    this._setBullseyeReady(false);
    this.dom.turdCam.classList.add('hidden');
    for (const p of this.poops) this.scene.remove(p.group);
    this.poops = [];
    this.effects.clearDecals();
    this.targets.reset(this.pos, this.level);
    this.input.setEnabled(true);

    this.dom.score.textContent = '0';
    this.dom.timer.textContent = ROUND_TIME;
    this.dom.timerPill.classList.remove('warn');
    this.dom.comboPill.classList.remove('show');
    this.dom.menu.classList.add('hidden');
    this.dom.gameover.classList.add('hidden');
    this.dom.hud.classList.remove('hidden');

    this.state = 'playing';
  }

  endRound() {
    this.state = 'gameover';
    this.input.setEnabled(false);
    if (this.score > (this.bests[this.levelId] || 0)) {
      this.bests[this.levelId] = this.score;
      localStorage.setItem(this._bestKey(this.levelId), this.score);
      if (this.levelId === 'beach') localStorage.setItem('gulldump_best', this.score); // legacy key
    }
    this.best = this.bests[this.levelId];
    this.dom.finalScore.textContent = this.score;
    this.dom.goHits.textContent = this.hits;
    this.dom.goBest.textContent = this.best;
    this.dom.goBullseyes.textContent = this.bullseyes;
    this.dom.goBlurb.textContent = this._blurb();
    if (this.score === this.best && this.score > 0) this.dom.goTitle.innerHTML = `<span>NEW BEST!</span>` + iconSvg('trophy', { size: 30, cls: 'title-ic' });
    else this.dom.goTitle.textContent = "TIME'S UP!";

    // leaderboard: show where this run lands, ready to submit
    this._goScore = this.score;
    this._submitted = false;
    this._myId = null;
    this.dom.nameInput.value = getName();
    this.dom.submitScoreBtn.disabled = this.score <= 0;
    this.dom.submitScoreBtn.textContent = 'SUBMIT';
    this._renderGoBoard();
    fetchScores(this.levelId).then((s) => { this._lbScores = s; if (this.state === 'gameover') this._renderGoBoard(); this._renderMenuBoard(); });

    this.dom.hud.classList.add('hidden');
    this.dom.gameover.classList.remove('hidden');
  }

  _blurb() {
    if (this.score === 0) return 'A clean record. Disappointing.';
    if (this.bullseyes >= 5) return 'Sniper of the skies.';
    const big = this.hits >= 20, mid = this.hits >= 10;
    if (this.levelId === 'wedding') {
      if (big) return 'You absolutely ruined their special day.';
      if (mid) return 'Objection! Sustained, all over the guests.';
      return 'A few guests will need dry cleaning.';
    }
    if (this.levelId === 'concert') {
      if (big) return 'The whole pit got mosh-splatted.';
      if (mid) return 'Encore! The crowd is drenched.';
      return 'A solid set of splats.';
    }
    if (this.hits >= 12) return 'A reign of terror over the boardwalk!';
    if (this.hits >= 6) return 'Solid bombing run, captain.';
    return 'Not bad for a beach bird.';
  }

  // ---------------------------------------------------------------
  // Compute the poop launch velocity. The throw is FIXED (holding the button no
  // longer flings it harder or further) — it always lands the same distance
  // ahead for a given altitude, so aiming is about strafing under the target and
  // releasing on the beat, not about charging range.
  _launchVel(yawOffset = 0) {
    const yaw = this.yaw + yawOffset;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // Circuit levels throw shorter+steeper so the drop lands just ahead of the
    // bird as it passes over the packed crowd; the beach keeps its long lob.
    const fwdSpeed = this.levelMode === 'circuit' ? CIRCUIT_THROW : (BIRD_SPEED + FIRE_POWER * POWER_SPEED);
    const v = fwd.clone().multiplyScalar(fwdSpeed);
    v.y = Math.sin(this.pitch) * BIRD_SPEED - 1.5; // small initial downward
    return v;
  }

  // Predict landing point (y=0) for a launch velocity from a position.
  _predictLanding(p0, v0) {
    const t = this._timeToHeight(p0.y, v0.y, 0);
    if (t === null) return null;
    return new THREE.Vector3(p0.x + v0.x * t, 0, p0.z + v0.z * t);
  }

  // Descending time for the projectile to fall from p0y to targetY.
  _timeToHeight(p0y, v0y, targetY) {
    const g = GRAVITY;
    const disc = v0y * v0y - 2 * g * (targetY - p0y);
    if (disc < 0) return null;
    return (v0y + Math.sqrt(disc)) / g;
  }

  // Size multiplier from SUPER TURD MODE — 2.5x base, growing each stacked super
  // turd, so turds get even bigger the more you grab.
  _superSizeMult() {
    if (this.superStack <= 0) return 1;
    return SUPER_TURD_MULT + (this.superStack - 1) * SUPER_STACK_SIZE;
  }
  // Turd size for a given hold power. Holding longer makes a bigger turd; super
  // mode (and stacks) scale it up, capped so it never swallows the screen.
  _turdScale(power) {
    const s = THREE.MathUtils.lerp(0.8, 1.9, power) * this._superSizeMult();
    return Math.min(s, TURD_SCALE_MAX);
  }
  // Extra catch radius a turd of this size grants — a bigger turd splats over a
  // wider area, so it's easier to hit (and the giant super turds much easier).
  _turdCatch(power) {
    return Math.max(0, this._turdScale(power) - 1) * TURD_FOOTPRINT;
  }
  // Splash radius: how far beyond a target's own catch radius a turd also splats
  // neighbours. Grows with turd size, so only big / super turds rack up multis.
  _turdBlast(power) {
    return Math.max(0, this._turdScale(power) - 1) * BLAST_PER;
  }
  // Score multiplier while super mode is active: 1.5x, +0.5x per stack (2x, 2.5x…).
  _superScoreMult() {
    return this.superStack > 0 ? 1 + 0.5 * this.superStack : 1;
  }

  // Fire a single turd. `opts`:
  //   bt        — eligible for bullet time (normal/fire single shots only)
  //   yawOffset — fan the launch sideways (scatter spread)
  //   sizeMul   — shrink the turd (scatter pellets)
  //   silent    — skip the per-shot whoosh (volleys/auto-fire play one cue)
  firePoop(power, opts = {}) {
    const { bt = false, yawOffset = 0, sizeMul = 1, silent = false } = opts;
    const p0 = this.pos.clone().add(new THREE.Vector3(0, -0.8, 0));
    const v0 = this._launchVel(yawOffset);
    const fire = this.weaponMode === 'fire';
    const group = fire ? buildFireball() : buildPoop();
    const turdScale = this._turdScale(power) * sizeMul;
    const catchR = this._turdCatch(power) * sizeMul;
    const blast = this._turdBlast(power) * sizeMul;
    group.scale.setScalar(turdScale);
    group.position.copy(p0);
    this.scene.add(group);
    // Analytic projectile: pos(t) = p0 + v0*t + 0.5*g*t^2. Integrating exactly
    // (rather than Euler) means the predicted-landing reticle is truthful.
    const landing = this._predictLanding(p0, v0) || p0.clone();
    // Total fall time to the ground — used to pace the crowd's turn so each
    // figure finishes squaring up to the turd right as it arrives.
    const tFall = Math.max(0.001, this._timeToHeight(p0.y, v0.y, 0) || 1);
    const seq = this._turdSeq = (this._turdSeq || 0) + 1;
    // Only a MAX-POWER, bullet-time-eligible drop hunts for a slow-mo target.
    const maxShot = bt && power >= MAX_CHARGE_BT;
    let btTarget = null, tImpact = Infinity;
    if (maxShot) {
      for (const tg of this.targets.targets) {
        if (!tg.alive) continue;
        const d = Math.hypot(landing.x - tg.group.position.x, landing.z - tg.group.position.z);
        // A generous BT_CATCH (vs. the tighter hit radius) means even near-misses
        // sailing close past a victim earn the slow-mo flourish.
        if (d <= tg.radius + BT_CATCH + catchR) {
          const t = this._timeToHeight(p0.y, v0.y, tg.hitY);
          if (t !== null && t < tImpact) { tImpact = t; btTarget = tg; }
        }
      }
    }
    const p = { group, p0: p0.clone(), v0: v0.clone(), t: 0, pos: p0.clone(), vel: v0.clone(), prevY: p0.y, landing, btTarget, tImpact, tFall, seq, maxShot, power, turdScale, catch: catchR, blast, fire, bt, spin: 0 };
    this.poops.push(p);
    this.audio.poop();
    if (!silent) this.audio.whoosh();
    // Carry the aim slow-mo straight into the drop when a maxed shot is on target;
    // otherwise time snaps back to normal for the fall (no bullet time when the
    // turd isn't close to anyone).
    if (maxShot && btTarget) {
      this.btActive = true;
      this.targetTimeScale = 0.16;
      this.btTarget = btTarget;
      this.btPoop = p;
      this.audio.slowmo();
    }
    return p;
  }

  // Contra-style spread: one volley of pellets fanned across the lane. Single
  // tap or a charged hold both work — charge just makes bigger pellets.
  _fireScatter(power) {
    for (let i = 0; i < SCATTER_COUNT; i++) {
      const f = SCATTER_COUNT === 1 ? 0 : (i / (SCATTER_COUNT - 1) - 0.5);
      this.firePoop(power, { bt: false, yawOffset: f * SCATTER_SPREAD, sizeMul: SCATTER_SIZE, silent: i > 0 });
    }
  }

  // Resolve a landed drop. `hits` is the list of targets caught in the splash
  // (empty = a clean miss); each entry is { tg, acc }. A big charged / super
  // turd packs the list with neighbours, so one drop can rack up a huge combo.
  resolveDrop(p, hits, primary, impact) {
    const where = impact || p.pos;
    const bestAcc = hits.length ? Math.max(...hits.map((h) => h.acc)) : 0;
    const big = bestAcc >= BULLSEYE_ACC;
    // flat ground splat (lava-coloured for fireballs)...
    this.effects.splat(where, big, p.turdScale, p.fire);
    // ...plus one splash scaled up by how many got caught.
    if (hits.length) this.effects.splash(where, p.turdScale * Math.min(2.4, 0.85 + 0.28 * hits.length), p.fire);
    this.scene.remove(p.group);

    if (hits.length) {
      // best hit first so the toast/audio reflect the cleanest splat
      hits.sort((a, b) => b.acc - a.acc);
      let gain = 0, bestTier = 'SPLAT!', superHit = false;
      for (const h of hits) {
        this.hits++;
        this.combo++;
        let tier, mult;
        if (h.acc >= BULLSEYE_ACC) { tier = 'BULLSEYE!'; mult = 3; this.bullseyes++; }
        else if (h.acc >= DIRECT_ACC) { tier = 'DIRECT HIT!'; mult = 2; }
        else { tier = 'SPLAT!'; mult = 1.3; }
        if (h === hits[0]) bestTier = tier;
        const base = Math.round(h.tg.value * mult);
        const comboMult = 1 + (this.combo - 1) * 0.5;
        gain += Math.round(base * comboMult * this._superScoreMult());
        this.targets.kill(h.tg);
        if (h.tg.special === 'super') superHit = true;
      }
      this.score += gain;
      this.dom.score.textContent = this.score;

      if (bestAcc >= BULLSEYE_ACC) this.audio.bullseye();
      else if (bestAcc >= DIRECT_ACC) this.audio.splat(true);
      else this.audio.splat(false);

      // extra time for a clean shot, plus a touch for each extra victim splashed
      this.timeLeft += (bestAcc >= BULLSEYE_ACC ? TIME_BONUS_BULLSEYE : TIME_BONUS_HIT) + Math.max(0, hits.length - 1);
      this.dom.timer.textContent = Math.ceil(this.timeLeft);
      this.dom.timerPill.classList.toggle('warn', this.timeLeft <= 5);

      const prefix = hits.length > 1 ? `×${hits.length} ` : '';
      this._showToast(`${prefix}${bestTier} +${gain}`);
      this._showCombo();

      // bombing the rare golden super turd activates / stacks SUPER TURD MODE
      if (superHit) this._hitSuperTurd();
    } else if (p.bt) {
      // only an aimed single shot counts as a "miss" — spray volleys (scatter /
      // machine gun) don't reset the combo or spam the toast on every stray pellet
      this.combo = 0;
      this.dom.comboPill.classList.remove('show');
      this.audio.miss();
      this._showToast('missed!', null, true);
    }

    // drop this turd from the flight list
    const idx = this.poops.indexOf(p);
    if (idx >= 0) this.poops.splice(idx, 1);

    // bullet-time framing belongs to the one tracked turd; spray pellets just splat
    if (p === this.btPoop || (!this.btPoop && this.btActive)) {
      this.btImpact = where.clone();
      this.btPoop = null;
      this.btHold = this.btActive ? 0.5 : 0;
      // ...but never hand control back mid-transformation (the cinematic/menu own it)
      if (this.btHold <= 0 && this.superSpin <= 0 && !this.pickerOpen) {
        this.targetTimeScale = 1;
        this.btImpact = null;
      }
    }
  }

  // Grab a super turd: the first one kicks off SUPER TURD MODE with the full
  // super-Saiyan transformation (camera spin + lightning + elated yell); each
  // additional one *stacks* — bigger turds, a higher points multiplier, and more
  // time on the mode. Three in a row ignites TURD FIRE.
  _hitSuperTurd() {
    this.superStack += 1;
    if (this.superStack === 1) {
      this.superTimer = SUPER_TIME;
      this.superSpin = SUPER_SPIN_TIME;
      // clean-cut into the transformation: drop any bullet-time framing
      this.btActive = false; this.btHold = 0; this.btImpact = null; this.btPoop = null;
      this.targetTimeScale = 1;
      this.input.setEnabled(false);
      this.superAura.group.visible = true;
      this.dom.poopBtn.classList.add('super');
      this.dom.turdCam.classList.add('hidden');
      this.dom.superBadge.classList.remove('hidden');
      this.audio.seagullYell();
      this.audio.superZap();
      this._showToast('SUPER TURD MODE!', 'bolt');
    } else {
      // stack: more time, bigger turds, a louder celebration
      this.superTimer += SUPER_STACK_TIME;
      this.audio.superStack();
      this.audio.seagullYell();
      this._showToast(`SUPER TURD ×${this.superStack}!`, 'bolt');
    }

    // three stacked super turds => pick a tier-3 weapon from a slow-mo menu
    // (Fire / Scatter / Machine Gun). Only offered once per super window.
    if (this.weaponMode === 'normal' && !this.pickerOpen && this.superStack >= FIRE_STACK) {
      this._openWeaponPicker();
    }
    this._updateSuperBadge();
  }

  // Freeze the action (near-stop slow-mo) and present the weapon picker.
  _openWeaponPicker() {
    this.pickerOpen = true;
    this.btActive = false; this.btHold = 0; this.btImpact = null; this.btPoop = null;
    this.targetTimeScale = PICKER_SCALE;
    this.input.setEnabled(false);
    this.dom.weaponPicker.classList.remove('hidden');
    this.audio.superZap();
  }

  // Lock in a tier-3 weapon, bank the bonus time, and resume at full speed.
  _chooseWeapon(mode) {
    if (!this.pickerOpen) return;
    this.pickerOpen = false;
    this.dom.weaponPicker.classList.add('hidden');
    this.weaponMode = mode;
    this.superTimer += MODE_BONUS_TIME;
    this._mgCooldown = 0;

    this.dom.poopBtn.classList.remove('super', 'fire', 'scatter', 'machinegun');
    this.dom.superBadge.classList.remove('fire');
    if (mode === 'fire') {
      this.superAura.group.visible = false;
      this.fireAura.group.visible = true;
      this.dom.poopBtn.classList.add('fire');
      this.dom.superBadge.classList.add('fire');
      this.audio.fireRoar();
    } else {
      this.superAura.group.visible = true;
      this.fireAura.group.visible = false;
      this.dom.poopBtn.classList.add('super', mode === 'machinegun' ? 'machinegun' : 'scatter');
      this.audio.superStack();
    }
    this.audio.seagullYell();
    const label = mode === 'fire' ? 'TURD FIRE' : mode === 'scatter' ? 'SCATTER TURDS' : 'MACHINE GUN';
    this._showToast(`${label}!`, MODE_ICON[mode]);

    // resume play
    this.targetTimeScale = 1;
    this.input.setEnabled(true);
    this._updateSuperBadge();
  }

  _updateSuperBadge() {
    const m = this.weaponMode;
    const label = m === 'fire' ? 'TURD FIRE' : m === 'scatter' ? 'SCATTER' : m === 'machinegun' ? 'MACHINE GUN' : 'SUPER TURD';
    this.dom.superBolt.innerHTML = iconSvg(m === 'normal' ? 'bolt' : MODE_ICON[m], { size: 16, cls: 'badge-ic' });
    this.dom.superLabel.textContent = label;
    this.dom.superMult.textContent = '×' + this._superScoreMult().toFixed(1);
    this.dom.superTime.textContent = Math.ceil(this.superTimer);
  }

  _endSuper() {
    this.superTimer = 0;
    this.superStack = 0;
    this.weaponMode = 'normal';
    this.superAura.group.visible = false;
    this.fireAura.group.visible = false;
    this.dom.poopBtn.classList.remove('super', 'fire', 'scatter', 'machinegun');
    this.dom.superBadge.classList.add('hidden');
    this.dom.superBadge.classList.remove('fire');
  }

  _showToast(text, icon = null, miss = false) {
    const t = this.dom.toast;
    const glyph = icon ? iconSvg(icon, { size: 38, cls: 'toast-ic' }) : '';
    t.innerHTML = glyph + `<span>${text}</span>`;
    t.style.color = miss ? '#cfe8ff' : '#fff';
    t.classList.remove('hidden', 'pop');
    void t.offsetWidth; // reflow to restart animation
    t.classList.add('pop');
  }

  _showCombo() {
    if (this.combo >= 2) {
      this.dom.combo.textContent = `COMBO x${this.combo}`;
      this.dom.comboPill.classList.add('show');
    }
  }

  // ---------------------------------------------------------------
  _frame() {
    const dtReal = Math.min(this.clock.getDelta(), 0.05);

    // smooth time-scale toward target
    this.timeScale += (this.targetTimeScale - this.timeScale) * Math.min(1, dtReal * 16);
    const dt = dtReal * this.timeScale;

    if (this.state === 'playing') {
      this._updatePlay(dt, dtReal);
    } else {
      // idle camera drift on menu / gameover
      this._idleCamera(dtReal);
      this.birdModel.flap(this.clock.elapsedTime, 0.8);
    }

    // keep the scenery centred on the bird so the straightaway reads as endless
    this.world.update(this.pos);

    // two gulls orbiting the logo on the start screen
    if (this.state === 'menu') this._updateMenuBirds(this.clock.elapsedTime);

    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _idleCamera(dt) {
    // Circuit venues: hover the bird near the head of the venue and frame the
    // whole place from out front, so the menu shows off the wedding/concert set.
    if (this.levelMode === 'circuit' && this.level.circuit) {
      const c = this.level.circuit;
      const t = this.clock.elapsedTime;
      this.pos.set(Math.sin(t * 0.5) * 6, 22, c.frontTurnZ + 8 + Math.sin(t * 0.4) * 2);
      this.yaw = Math.PI + Math.sin(t * 0.3) * 0.3;
      this.pitch = 0;
      this.roll = Math.sin(t * 0.3) * 0.2;
      this._placeBird();
      const camPos = new THREE.Vector3(0, 24, c.frontTurnZ - 26);
      this.camera.position.lerp(camPos, Math.min(1, dt * 2));
      const focus = new THREE.Vector3(0, 7, (c.frontTurnZ + c.backTurnZ) / 2);
      this._camLookAt = this._camLookAt || focus.clone();
      this._camLookAt.lerp(focus, Math.min(1, dt * 2));
      this.camera.lookAt(this._camLookAt);
      return;
    }
    // gentle bird hover + slow orbit for menu backdrop
    this.yaw += dt * 0.15;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(fwd, BIRD_SPEED * 0.4 * dt);
    this.pos.y = 34 + Math.sin(this.clock.elapsedTime * 0.6) * 2;
    this._placeBird();
    this._chaseCamera(dt, false);
  }

  _updatePlay(dt, dtReal) {
    this.input.update(dtReal);

    // During the SUPER TURD transformation the camera orbits the bird while it
    // flies dead ahead — steering and firing are locked out for the cinematic.
    const cinematic = this.superSpin > 0;
    if (cinematic) {
      this.superSpin -= dtReal;
      if (this.superSpin <= 0 && this.state === 'playing' && !this.pickerOpen) this.input.setEnabled(true);
    }
    // steering + firing are also frozen while the weapon picker is up
    const locked = cinematic || this.pickerOpen;

    // ---- flight ----
    if (this.levelMode === 'circuit') {
      // Circuit venues fly themselves back and forth; the player only steers
      // altitude (and when/how-big to drop).
      this._circuitFlight(dt, dtReal, locked);
    } else {
      // Infinite runner: heading locked forward down the lane; steering
      // strafes across a fixed corridor and dives/climbs, never turning around.
      this.yaw = FORWARD_YAW;
      const strafe = locked ? 0 : this.input.steerX;
      this.pos.x = THREE.MathUtils.clamp(
        this.pos.x + strafe * STRAFE_SPEED * dt, -COURSE_HALF, COURSE_HALF,
      );

      // pitch toward steer target; roll banks visually into the strafe
      const targetPitch = locked ? 0 : this.input.steerY * 0.5;
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);
      this.roll += (-strafe * 0.6 - this.roll) * Math.min(1, dtReal * 6);

      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.pos.addScaledVector(fwd, BIRD_SPEED * dt);
      this.pos.y += Math.sin(this.pitch) * BIRD_SPEED * dt;
      this._clampAlt();
    }

    this._placeBird();
    const flapInt = 0.6 + Math.abs(this.input.steerY) * 0.6 + this.input.charge * 0.3;
    this.birdModel.flap(this.clock.elapsedTime * (this.timeScale * 0.5 + 0.5), flapInt);

    // ---- SUPER TURD MODE ----
    // The giant-turd window counts down once the transformation is over (and is
    // paused while the weapon picker is open).
    if (this.superTimer > 0 && !cinematic && !this.pickerOpen) {
      this.superTimer -= dtReal;
      if (this.superTimer <= 0) this._endSuper();
      else this.dom.superTime.textContent = Math.ceil(this.superTimer);
    }
    if (this.weaponMode === 'fire') this.fireAura.update(dtReal, 1);
    else if (this.superAura.group.visible) this.superAura.update(dtReal, cinematic ? 1 : 0.6);

    // ---- targets ---- (pass the live drop so every figure can swivel to face
    // the falling turd, timed to finish squaring up just as it arrives)
    const p = this.btPoop || this.poops[0];
    const drop = p ? { x: p.pos.x, z: p.pos.z, t: p.t, tFall: p.tFall, id: p.seq } : null;
    this.targets.update(dt, this.clock.elapsedTime, this.pos, drop);

    // ---- wall of death (concert) ---- announce the call and the collision
    const wod = this.targets.consumeWodEvent && this.targets.consumeWodEvent();
    if (wod === 'call') { this._showToast('WALL OF DEATH!', 'skull'); this.audio.seagullYell(); }
    else if (wod === 'clash') { this._showToast('CRUNCH!', 'burst'); this.audio.fireRoar(); }

    // ---- fire poop? ---- (locked out during the cinematic / weapon picker)
    const machineGun = this.weaponMode === 'machinegun';
    if (!locked) {
      if (machineGun) {
        // hold to rapid-fire ~3/sec; no charge, no bullet time, release to stop
        if (this.input.charging) {
          this._mgCooldown -= dtReal;
          if (this._mgCooldown <= 0) { this.firePoop(MG_POWER, { bt: false, silent: true }); this._mgCooldown = 1 / MG_RATE; }
        } else {
          this._mgCooldown = 0;
        }
        this.input.consumeFire(); // swallow the release so it can't double-fire
      } else {
        const fired = this.input.consumeFire();
        if (fired !== null && !this.poops.length) {
          if (this.weaponMode === 'scatter') this._fireScatter(fired);
          else this.firePoop(fired, { bt: true });
        }
      }
    }

    // ---- AIM BULLET TIME ----
    // Holding a turd to full charge slows time so you can line up the shot —
    // precision modes only (normal / fire), and never while turds are falling.
    const canAimBT = this.weaponMode === 'normal' || this.weaponMode === 'fire';
    const aimBT = !locked && canAimBT && !this.poops.length && this.input.charging && this.input.charge >= MAX_CHARGE_BT;
    if (this.pickerOpen) {
      this.targetTimeScale = PICKER_SCALE;
    } else if (aimBT) {
      this.targetTimeScale = AIM_TIME_SCALE;
    } else if (!this.btActive && this.btHold <= 0 && !cinematic) {
      this.targetTimeScale = 1;
    }

    // charge audio (machine gun and the picker don't charge)
    if (this.input.charging && !locked && !machineGun) {
      this.audio.startCharge();
      this.audio.setCharge(this.input.charge);
    } else {
      this.audio.stopCharge();
    }
    // charge ring
    const C = 339.3;
    const ringCharge = machineGun ? 0 : this.input.charge;
    this.dom.chargeFg.style.strokeDashoffset = C * (1 - ringCharge);
    this.dom.chargeFg.style.stroke = ringCharge > 0.8 ? '#ff2e4d' : (ringCharge > 0.4 ? '#ff9f1c' : '#ff4d6d');

    // ---- reticle (predicted landing) ----
    if (locked || machineGun || this.poops.length) { this.reticle.visible = false; this._setBullseyeReady(false); }
    else this._updateReticle();

    // ---- poop physics ----
    this._updatePoops(dt);

    // ---- bullet-time hold after impact ----
    if (this.btHold > 0) {
      this.btHold -= dtReal;
      if (this.btHold <= 0) {
        this.targetTimeScale = 1;
        this.btActive = false;
        this.btImpact = null;
        if (this.state === 'playing' && this.superSpin <= 0) this.input.setEnabled(true);
      }
    }

    // ---- camera ----
    if (cinematic) this._superCamera(dtReal);
    else this._chaseCamera(dtReal, this.btActive);
    // TURD CAM callout blinks only while bullet-time is framing the drop
    this.dom.turdCam.classList.toggle('hidden', !this.btActive || cinematic);

    // ---- timer (paused during bullet time and the transformation cinematic) ----
    if (!this.btActive && this.btHold <= 0 && !cinematic) {
      this.timeLeft -= dtReal;
      if (this.timeLeft <= 1e-4) { this.timeLeft = 0; this.endRound(); }
      const shown = Math.ceil(this.timeLeft);
      if (this.dom.timer.textContent != shown) this.dom.timer.textContent = shown;
      this.dom.timerPill.classList.toggle('warn', this.timeLeft <= 5);
    }
  }

  _clampAlt() {
    if (this.pos.y < MIN_ALT) { this.pos.y = MIN_ALT; if (this.pitch < 0) this.pitch = 0; }
    if (this.pos.y > MAX_ALT) { this.pos.y = MAX_ALT; if (this.pitch > 0) this.pitch = 0; }
  }

  // Circuit auto-pilot: the bird flies the venue's long axis itself, looping
  // past the couple/band and back over the crowd via a scripted U-turn at each
  // end. The player still STEERS, though — strafing left/right across the venue
  // and diving/climbing — so they can aim either side of the crowd.
  _circuitFlight(dt, dtReal, cinematic) {
    const c = this.level.circuit;
    const half = c.halfWidth || 12;
    const strafe = cinematic ? 0 : this.input.steerX;
    // Map "drag right" to the bird's on-screen right, not a fixed world axis.
    // The circuit doubles back, so on the return leg the camera faces the other
    // way — without this the lateral steering inverts coming back. The camera's
    // right vector has world-x component -cos(yaw) (±1 on the straights), which
    // also eases lateral authority to zero mid-turn as the bird points sideways.
    const dirX = -Math.cos(this.yaw);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x + strafe * dirX * STRAFE_SPEED * dt, -half, half);
    const targetPitch = cinematic ? 0 : this.input.steerY * 0.5;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);

    if (this.turning) {
      this.turnT += dtReal;
      const u = Math.min(1, this.turnT / TURN_TIME);
      const pr = u * u * (3 - 2 * u);                 // smoothstep
      this.yaw = this._turnYawFrom + Math.PI * pr;    // sweep through 180°
      this.pos.z += this._turnDir * BIRD_SPEED * Math.cos(pr * Math.PI) * dt; // nose past, then back
      this.pos.y += Math.sin(this.pitch) * BIRD_SPEED * dt;
      this._clampAlt();
      // bank into the turn, blended with any strafe lean
      const turnBank = Math.sin(pr * Math.PI) * 0.6 * this._turnDir;
      this.roll += (turnBank - strafe * 0.5 - this.roll) * Math.min(1, dtReal * 6);
      if (this.turnT >= TURN_TIME) {
        this.turning = false;
        this.circuitDir = -this.circuitDir;
        this.yaw = this.circuitDir < 0 ? Math.PI : 0;
      }
      return;
    }

    this.yaw = this.circuitDir < 0 ? Math.PI : 0;
    this.roll += (-strafe * 0.6 - this.roll) * Math.min(1, dtReal * 6); // bank into the strafe
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(fwd, BIRD_SPEED * dt);
    this.pos.y += Math.sin(this.pitch) * BIRD_SPEED * dt;
    this._clampAlt();
    if (this.circuitDir < 0 && this.pos.z <= c.frontTurnZ) this._beginTurn();
    else if (this.circuitDir > 0 && this.pos.z >= c.backTurnZ) this._beginTurn();
  }

  _beginTurn() {
    this.turning = true;
    this.turnT = 0;
    this._turnYawFrom = this.yaw;
    this._turnDir = this.circuitDir;
  }

  // The super-Saiyan camera: one full orbit around the bird over the cinematic,
  // bird heading dead ahead the whole time. Set directly (not lerped) so the
  // revolution is crisp; ends behind the bird so the chase cam resumes smoothly.
  _superCamera(dt) {
    const prog = THREE.MathUtils.clamp(1 - this.superSpin / SUPER_SPIN_TIME, 0, 1);
    const ang = prog * Math.PI * 2;
    const r = 15, h = 5.5;
    this.camera.position.set(
      this.pos.x + Math.sin(ang) * r,
      this.pos.y + h,
      this.pos.z + Math.cos(ang) * r,
    );
    const focus = this.pos.clone().add(new THREE.Vector3(0, 1, 0));
    this._camLookAt = focus.clone(); // keep in sync for a smooth hand-off back to chase
    this.camera.lookAt(focus);
  }

  _placeBird() {
    this.bird.position.copy(this.pos);
    this.bird.rotation.set(0, 0, 0);
    this.bird.rotation.order = 'YXZ';
    this.bird.rotation.y = this.yaw + Math.PI;
    this.bird.rotation.x = -this.pitch;
    this.bird.rotation.z = this.roll;
    // shadow
    this.birdShadow.position.set(this.pos.x, 0.16, this.pos.z);
    const altK = THREE.MathUtils.clamp((this.pos.y - MIN_ALT) / (MAX_ALT - MIN_ALT), 0, 1);
    const sc = 1.5 - altK * 0.7;
    this.birdShadow.scale.setScalar(sc);
    this.birdShadow.material.opacity = 0.28 - altK * 0.16;
  }

  _updateReticle() {
    if (this.poops.length) { this.reticle.visible = false; this._setBullseyeReady(false); return; }
    // The landing spot is fixed ahead (the throw doesn't change with charge), so
    // the reticle just shows where a drop lands right now.
    const p0 = this.pos.clone().add(new THREE.Vector3(0, -0.8, 0));
    const v0 = this._launchVel();
    const land = this._predictLanding(p0, v0);
    if (!land) { this.reticle.visible = false; this._setBullseyeReady(false); return; }
    this.reticle.visible = true;
    this.reticle.position.set(land.x, 0.16, land.z);

    // Predicted accuracy against the nearest target — mirrors resolveDrop (incl.
    // the turd-size catch bonus) so the reticle's promise matches the real shot.
    const power = this.input.charging ? this.input.charge : 0;
    const catchR = this._turdCatch(power);
    const near = this.targets.nearest(land, 40);
    let acc = 0;                 // 0 far → 1 dead-on
    if (near) {
      acc = THREE.MathUtils.clamp(1 - near.dist / (near.target.radius + HIT_PAD + catchR), 0, 1);
    }
    const bullseye = acc >= BULLSEYE_ACC; // release-now window (a hit is dialled in)
    const onTarget = acc > 0;

    // The reticle starts 3x oversized and hones down to the firing size as the
    // shot lines up — the size itself is the "release now" cue. When it's tight,
    // the target will be hit.
    const want = THREE.MathUtils.lerp(RET_BIG, RET_FIRE, acc);
    this._retScale += (want - this._retScale) * 0.3;
    this.reticle.scale.setScalar(this._retScale);

    const ring = this.reticle.userData.ring;
    const inner = this.reticle.userData.inner;
    const glow = this.reticle.userData.glow;
    const pulse = Math.sin(this.clock.elapsedTime * (bullseye ? 16 : 6)) * 0.5 + 0.5;
    const col = bullseye ? 0x35ff7a : (onTarget ? 0xffd23f : 0xffffff);
    ring.material.color.setHex(col);
    ring.material.opacity = 0.45 + (onTarget ? 0.4 : 0.2) + pulse * (bullseye ? 0.3 : 0.1);
    if (inner) inner.material.color.setHex(bullseye ? 0xffffff : 0xff4d6d);
    if (glow) {
      glow.visible = bullseye || (onTarget && acc > 0.45);
      glow.material.color.setHex(bullseye ? 0x35ff7a : 0xffd23f);
      glow.material.opacity = (bullseye ? 0.55 : 0.18) * (0.55 + pulse * 0.45);
      glow.scale.setScalar(bullseye ? 1.3 + pulse * 0.6 : 1.25);
    }

    this._setBullseyeReady(bullseye);
  }

  // Flip the "release NOW for a bullseye" cue: a green pulsing poop button plus a
  // one-shot lock ding the moment you cross into the window. So you *know*.
  _setBullseyeReady(on) {
    if (on === this._bullseyeReady) return;
    this._bullseyeReady = on;
    this.dom.poopBtn.classList.toggle('ready', on);
    if (on) this.audio.lock();
  }

  _updatePoops(dt) {
    // iterate a copy-safe index walk since resolveDrop splices the flight list
    for (let i = this.poops.length - 1; i >= 0; i--) {
      const p = this.poops[i];
      if (p) this._updatePoop(p, dt);
    }
  }

  _updatePoop(p, dt) {
    p.prevY = p.pos.y;
    p.t += dt;
    const t = p.t;
    p.pos.set(
      p.p0.x + p.v0.x * t,
      p.p0.y + p.v0.y * t - 0.5 * GRAVITY * t * t,
      p.p0.z + p.v0.z * t,
    );
    p.vel.set(p.v0.x, p.v0.y - GRAVITY * t, p.v0.z);
    p.spin += dt * 6;
    p.group.position.copy(p.pos);
    if (p.fire) {
      // keep the comet upright (tail trailing up) and lay down a lava trail
      p.group.rotation.set(0, p.spin, 0);
      this.effects.ember(p.pos, p.turdScale);
    } else {
      p.group.rotation.x = p.spin;
      p.group.rotation.z = p.spin * 0.7;
    }

    // (Bullet time, when it applies, is engaged at fire-time in firePoop — only
    // for a max-power drop that's heading close to a target.)

    // Collision uses the poop's predicted GROUND landing vs each target's ground
    // position, so accuracy matches exactly what the reticle showed the player.
    // Everything inside the (size-scaled) blast radius gets splatted; the closest
    // target is the "primary" whose height triggers the impact.
    if (p.vel.y < 0) {
      let prim = null, primD = Infinity;
      const cand = [];
      for (const tg of this.targets.targets) {
        if (!tg.alive) continue;
        const dx = p.landing.x - tg.group.position.x;
        const dz = p.landing.z - tg.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d <= tg.radius + HIT_PAD + p.blast) {
          cand.push({ tg, d });
          if (d < primD) { primD = d; prim = tg; }
        }
      }
      if (prim && p.pos.y <= prim.hitY + 0.4) {
        let list = cand;
        if (list.length > BLAST_MAX) list = cand.slice().sort((a, b) => a.d - b.d).slice(0, BLAST_MAX);
        // Accuracy ramps from 1 at dead-centre to 0 at the edge of the (tight)
        // catch radius — neighbours grazed by the splash come in as low-acc SPLATs.
        const hits = list.map(({ tg, d }) => ({
          tg, acc: THREE.MathUtils.clamp(1 - d / (tg.radius + HIT_PAD + p.catch), 0, 1),
        }));
        const impact = prim.group.position.clone(); impact.y = prim.hitY;
        p.pos.copy(impact);
        this.resolveDrop(p, hits, prim, impact);
        return;
      }
    }

    // hit the ground => miss
    if (p.pos.y <= 0.15) {
      p.pos.y = 0.12;
      this.resolveDrop(p, [], null, p.pos.clone());
    }
  }

  _chaseCamera(dt, bulletTime) {
    let desired, lookAt;
    if (bulletTime && (this.btPoop || this.btImpact)) {
      // TURD CAM: lock the framing onto the falling turd itself and chase it down
      // so we never lose it on the way to the target. We look at the poo (biased
      // a touch toward the target so the impact sits in the lower frame) from a
      // clean side-on angle, and pull in as it closes on the target.
      const tg = this.btTarget;
      const focus = tg && tg.group ? tg.group.position.clone().setY(tg.hitY)
        : (this.btImpact ? this.btImpact.clone() : new THREE.Vector3());
      const poopPos = this.btPoop ? this.btPoop.pos.clone()
        : (this.btImpact ? this.btImpact.clone() : focus.clone());
      const span = Math.max(2, poopPos.y - focus.y);
      // frame on the poo, nudged toward the target so both stay in shot
      const lookT = this.btPoop ? poopPos.clone().lerp(focus, 0.3) : focus.clone();
      const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const back = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const dir = side.multiplyScalar(1.0).add(back.multiplyScalar(0.18)).normalize();
      // close enough to read the poo clearly, with room below for the target
      const dist = THREE.MathUtils.clamp(span * 0.55 + 9, 13, 38);
      desired = lookT.clone().add(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, span * 0.08 + 1.5, 0));
      lookAt = lookT;
      this.camera.position.lerp(desired, Math.min(1, dt * 10));
      this._camLookAt = this._camLookAt || lookAt.clone();
      // track the poo tightly so it stays centred frame-to-frame
      this._camLookAt.lerp(lookAt, Math.min(1, dt * 16));
      this.camera.lookAt(this._camLookAt);
    } else {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      desired = this.pos.clone().addScaledVector(fwd, -13).add(new THREE.Vector3(0, 6.5, 0));
      lookAt = this.pos.clone().addScaledVector(fwd, 12).add(new THREE.Vector3(0, -5, 0));
      const k = Math.min(1, dt * 5);
      this.camera.position.lerp(desired, k);
      this._camLookAt = this._camLookAt || lookAt.clone();
      this._camLookAt.lerp(lookAt, Math.min(1, dt * 6));
      this.camera.lookAt(this._camLookAt);
    }
  }
}

// boot
window.addEventListener('load', () => { window.game = new Game(); });
