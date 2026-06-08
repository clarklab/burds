import * as THREE from 'three';
import { buildWorld, TargetManager, WORLD_RADIUS } from './world.js';
import { buildSeagull, buildPoop } from './models.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Effects, buildReticle, buildBirdShadow } from './effects.js';

// ----- tuning constants -----
const BIRD_SPEED = 24;       // constant forward flight speed
const POWER_SPEED = 34;      // extra forward speed at full charge
const GRAVITY = 34;          // poop gravity (m/s^2)
const MIN_ALT = 12;
const MAX_ALT = 56;
const YAW_RATE = 2.0;        // rad/s at full steer
const AUTO_YAW_RATE = 2.6;   // rad/s of auto-assist turn when hands-off (snappy enough to actually line up a run)
const CENTER = new THREE.Vector3(0, 0, 25);
const ROUND_TIME = 30;       // seconds

// Shortest signed angle for `a`, always in [-PI, PI]. Using atan2 (rather than
// a `% 2*PI`) is robust even when yaw has wound up to a large unbounded value,
// which a naive modulo gets wrong — and a wrong sign turns the bird the wrong
// way, which is exactly what made the old auto-aim fight the player.
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const BT_LEAD = 0.34;        // sim-seconds before impact to start slow-mo

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 800);

    buildWorld(this.scene, this.renderer);

    // player bird
    const gull = buildSeagull();
    this.birdModel = gull;
    this.bird = gull.group;
    this.scene.add(this.bird);

    this.birdShadow = buildBirdShadow();
    this.scene.add(this.birdShadow);

    this.reticle = buildReticle();
    this.scene.add(this.reticle);

    this.targets = new TargetManager(this.scene);
    this.effects = new Effects(this.scene);
    this.audio = new Audio();
    this.input = new Input(this.canvas, document.getElementById('poopBtn'));

    // flight state
    this.pos = new THREE.Vector3(0, 36, 105);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.roll = 0;

    // poop
    this.poop = null;

    // time / bullet-time
    this.timeScale = 1;
    this.targetTimeScale = 1;
    this.btActive = false;
    this.btHold = 0;

    // round
    this.state = 'menu';
    this.score = 0;
    this.combo = 0;
    this.hits = 0;
    this.bullseyes = 0;
    this.timeLeft = ROUND_TIME;
    this.best = parseInt(localStorage.getItem('gulldump_best') || '0', 10);

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
      finalScore: document.getElementById('finalScore'),
      goHits: document.getElementById('goHits'),
      goBest: document.getElementById('goBest'),
      goBullseyes: document.getElementById('goBullseyes'),
      goBlurb: document.getElementById('goBlurb'),
      menuBest: document.getElementById('menuBest'),
      goTitle: document.getElementById('goTitle'),
    };
    this.dom.menuBest.textContent = this.best;

    this._bindUI();
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
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------
  startRound() {
    this.score = 0;
    this.combo = 0;
    this.hits = 0;
    this.bullseyes = 0;
    this.timeLeft = ROUND_TIME;
    this.pos.set(0, 36, 105);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.roll = 0;
    this.timeScale = 1; this.targetTimeScale = 1; this.btActive = false;
    if (this.poop) { this.scene.remove(this.poop.group); this.poop = null; }
    this.effects.clearDecals();
    this.targets.reset();
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
    if (this.score > this.best) { this.best = this.score; localStorage.setItem('gulldump_best', this.best); }
    this.dom.finalScore.textContent = this.score;
    this.dom.goHits.textContent = this.hits;
    this.dom.goBest.textContent = this.best;
    this.dom.goBullseyes.textContent = this.bullseyes;
    this.dom.goBlurb.textContent = this._blurb();
    this.dom.goTitle.textContent = this.score === this.best && this.score > 0 ? 'NEW BEST! 🏆' : "TIME'S UP!";
    this.dom.hud.classList.add('hidden');
    this.dom.gameover.classList.remove('hidden');
  }

  _blurb() {
    if (this.score === 0) return 'A clean record. Disappointing.';
    if (this.bullseyes >= 5) return 'Sniper of the skies. 🎯';
    if (this.hits >= 12) return 'A reign of terror over the boardwalk!';
    if (this.hits >= 6) return 'Solid bombing run, captain.';
    return 'Not bad for a beach bird.';
  }

  // ---------------------------------------------------------------
  // Compute poop launch velocity for a given power (0..1).
  _launchVel(power) {
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const v = fwd.clone().multiplyScalar(BIRD_SPEED + power * POWER_SPEED);
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

  firePoop(power) {
    const p0 = this.pos.clone().add(new THREE.Vector3(0, -0.8, 0));
    const v0 = this._launchVel(power);
    const group = buildPoop();
    group.position.copy(p0);
    this.scene.add(group);
    // Analytic projectile: pos(t) = p0 + v0*t + 0.5*g*t^2. Integrating exactly
    // (rather than Euler) means the predicted-landing reticle is truthful.
    const landing = this._predictLanding(p0, v0) || p0.clone();
    // Pre-compute which target (if any) this poop will hit, and exactly when it
    // reaches that target's height — used to time the slow-mo lead-in.
    let btTarget = null, tImpact = Infinity;
    for (const tg of this.targets.targets) {
      if (!tg.alive) continue;
      const d = Math.hypot(landing.x - tg.group.position.x, landing.z - tg.group.position.z);
      if (d <= tg.radius + 0.3) {
        const t = this._timeToHeight(p0.y, v0.y, tg.hitY);
        if (t !== null && t < tImpact) { tImpact = t; btTarget = tg; }
      }
    }
    this.poop = { group, p0: p0.clone(), v0: v0.clone(), t: 0, pos: p0.clone(), vel: v0.clone(), prevY: p0.y, landing, btTarget, tImpact, power, spin: 0 };
    this.input.setEnabled(false);
    this.audio.poop();
    this.audio.whoosh();
  }

  resolvePoop(hit, target, acc, impact) {
    const p = this.poop;
    const big = acc >= 0.92;
    this.effects.splat(impact || p.pos, hit && big);
    this.scene.remove(p.group);

    if (hit) {
      this.hits++;
      this.combo++;
      let tier, mult;
      if (acc >= 0.92) { tier = 'BULLSEYE!'; mult = 3; this.bullseyes++; this.audio.bullseye(); }
      else if (acc >= 0.6) { tier = 'DIRECT HIT!'; mult = 2; this.audio.splat(true); }
      else { tier = 'SPLAT!'; mult = 1.3; this.audio.splat(false); }

      const base = Math.round(target.value * mult);
      const comboMult = 1 + (this.combo - 1) * 0.5;
      const gain = Math.round(base * comboMult);
      this.score += gain;
      this.dom.score.textContent = this.score;

      this._showToast(`${tier} +${gain}`);
      this._showCombo();
      this.targets.kill(target);
    } else {
      this.combo = 0;
      this.dom.comboPill.classList.remove('show');
      this.audio.miss();
      this._showToast('missed!', true);
    }

    // brief slow-mo hold so the splat reads, then restore
    this.btImpact = (impact || p.pos).clone();
    this.poop = null;
    this.btHold = this.btActive ? 0.5 : 0;
    if (this.btHold <= 0) {
      // no slow-mo (e.g. a clean miss): reset immediately
      this.targetTimeScale = 1;
      this.btImpact = null;
      if (this.state === 'playing') this.input.setEnabled(true);
    }
  }

  _showToast(text, miss = false) {
    const t = this.dom.toast;
    t.textContent = text;
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

    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _idleCamera(dt) {
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

    // ---- flight ----
    // Manual steering always wins. The moment the player lets go of the stick,
    // an auto-pilot gently banks the bird toward the nearest target so they can
    // focus on lining up the bomb drop.
    const steering = Math.abs(this.input.steerX) > 0.05 || Math.abs(this.input.steerY) > 0.05;
    let effSteerX = this.input.steerX;
    if (steering) {
      this.yaw += this.input.steerX * YAW_RATE * dt;
    } else {
      // Only chase targets that are ahead of us — see nearestAhead(). Aiming the
      // bird's nose at the target lines up the landing reticle's *direction*
      // (the reticle sits straight ahead along the heading); the player charges
      // to dial in the *range*. The old code chased the raw nearest target,
      // including ones already behind/below, so it kept yanking into U-turns.
      const near = this.targets.nearestAhead(this.pos, this.yaw);
      if (near) {
        const tp = near.target.group.position;
        const toTarget = Math.atan2(tp.x - this.pos.x, tp.z - this.pos.z);
        const diff = wrapPi(toTarget - this.yaw);
        // normalized turn intent: full turn when well off-heading, eases to 0 as
        // we line up so the bird settles over the target instead of wobbling.
        const intent = Math.max(-1, Math.min(1, diff / 0.6));
        this.yaw += intent * AUTO_YAW_RATE * dt;
        effSteerX = intent; // bank visually into the assisted turn
      }
    }
    // soft turn back inside boundary
    const flat = new THREE.Vector2(this.pos.x - CENTER.x, this.pos.z - CENTER.z);
    if (flat.length() > WORLD_RADIUS - 12) {
      const toCenter = Math.atan2(CENTER.x - this.pos.x, CENTER.z - this.pos.z);
      const diff = wrapPi(toCenter - this.yaw);
      this.yaw += diff * Math.min(1, dt * 1.4);
    }
    // Keep yaw bounded so the steering math (and everything else) stays sane
    // over a full round; every consumer reads it through sin/cos so this is safe.
    this.yaw = wrapPi(this.yaw);

    // pitch toward steer target; roll for banking
    const targetPitch = this.input.steerY * 0.5;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);
    this.roll += (-effSteerX * 0.5 - this.roll) * Math.min(1, dtReal * 6);

    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(fwd, BIRD_SPEED * dt);
    this.pos.y += Math.sin(this.pitch) * BIRD_SPEED * dt;
    if (this.pos.y < MIN_ALT) { this.pos.y = MIN_ALT; if (this.pitch < 0) this.pitch = 0; }
    if (this.pos.y > MAX_ALT) { this.pos.y = MAX_ALT; if (this.pitch > 0) this.pitch = 0; }

    this._placeBird();
    const flapInt = 0.6 + Math.abs(this.input.steerY) * 0.6 + this.input.charge * 0.3;
    this.birdModel.flap(this.clock.elapsedTime * (this.timeScale * 0.5 + 0.5), flapInt);

    // ---- targets ----
    this.targets.update(dt, this.clock.elapsedTime);

    // ---- fire poop? ----
    const fired = this.input.consumeFire();
    if (fired !== null && !this.poop) this.firePoop(fired);

    // charge audio
    if (this.input.charging) {
      this.audio.startCharge();
      this.audio.setCharge(this.input.charge);
    } else {
      this.audio.stopCharge();
    }
    // charge ring
    const C = 339.3;
    this.dom.chargeFg.style.strokeDashoffset = C * (1 - this.input.charge);
    this.dom.chargeFg.style.stroke = this.input.charge > 0.8 ? '#ff2e4d' : (this.input.charge > 0.4 ? '#ff9f1c' : '#ff4d6d');

    // ---- reticle (predicted landing) ----
    this._updateReticle();

    // ---- poop physics ----
    if (this.poop) this._updatePoop(dt);

    // ---- bullet-time hold after impact ----
    if (this.btHold > 0) {
      this.btHold -= dtReal;
      if (this.btHold <= 0) {
        this.targetTimeScale = 1;
        this.btActive = false;
        this.btImpact = null;
        if (this.state === 'playing') this.input.setEnabled(true);
      }
    }

    // ---- camera ----
    this._chaseCamera(dtReal, this.btActive);

    // ---- timer (paused during bullet time) ----
    if (!this.btActive && this.btHold <= 0) {
      this.timeLeft -= dtReal;
      if (this.timeLeft <= 1e-4) { this.timeLeft = 0; this.endRound(); }
      const shown = Math.ceil(this.timeLeft);
      if (this.dom.timer.textContent != shown) this.dom.timer.textContent = shown;
      this.dom.timerPill.classList.toggle('warn', this.timeLeft <= 5);
    }
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
    if (this.poop) { this.reticle.visible = false; return; }
    const power = this.input.charging ? this.input.charge : 0;
    const p0 = this.pos.clone().add(new THREE.Vector3(0, -0.8, 0));
    const v0 = this._launchVel(power);
    const land = this._predictLanding(p0, v0);
    if (!land) { this.reticle.visible = false; return; }
    this.reticle.visible = true;
    this.reticle.position.set(land.x, 0.16, land.z);
    const near = this.targets.nearest(land, 4);
    const onTarget = near && near.dist < near.target.radius + 0.6;
    const scale = 1 + this.input.charge * 0.3;
    this.reticle.scale.setScalar(scale);
    const col = onTarget ? 0x35e06b : 0xffffff;
    this.reticle.userData.ring.material.color.setHex(col);
    this.reticle.userData.ring.material.opacity = 0.4 + (onTarget ? 0.5 : 0.25) + Math.sin(this.clock.elapsedTime * 6) * 0.1;
  }

  _updatePoop(dt) {
    const p = this.poop;
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
    p.group.rotation.x = p.spin;
    p.group.rotation.z = p.spin * 0.7;

    // engage slow-mo a fixed lead-time before impact with the doomed target
    if (!this.btActive && p.btTarget && p.btTarget.alive && p.vel.y < 0 &&
        (p.tImpact - p.t) <= BT_LEAD) {
      this.btActive = true;
      this.targetTimeScale = 0.16;
      this.btTarget = p.btTarget;
      this.audio.slowmo();
    }

    // Collision uses the poop's predicted GROUND landing vs the target's ground
    // position, so accuracy matches exactly what the reticle showed the player.
    // We trigger the impact once the poop has descended to the target's height.
    if (p.vel.y < 0) {
      let best = null, bestD = Infinity;
      for (const tg of this.targets.targets) {
        if (!tg.alive) continue;
        if (p.pos.y > tg.hitY + 0.4) continue; // not down to their level yet
        const dx = p.landing.x - tg.group.position.x;
        const dz = p.landing.z - tg.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d <= tg.radius + 0.3 && d < bestD) { bestD = d; best = tg; }
      }
      if (best) {
        const acc = THREE.MathUtils.clamp(1 - bestD / (best.radius + 0.15), 0, 1);
        const impact = best.group.position.clone(); impact.y = best.hitY;
        p.pos.copy(impact);
        this.resolvePoop(true, best, acc, impact);
        return;
      }
    }

    // hit the ground => miss
    if (p.pos.y <= 0.15) {
      p.pos.y = 0.12;
      this.resolvePoop(false, null, 0, p.pos.clone());
    }
  }

  _chaseCamera(dt, bulletTime) {
    let desired, lookAt;
    if (bulletTime && (this.poop || this.btImpact)) {
      // cinematic: a 3/4 angle framing the whole column from the falling poop
      // down to the doomed target, so you see exactly where it lands.
      const tg = this.btTarget;
      const focus = tg && tg.group ? tg.group.position.clone().setY(tg.hitY)
        : (this.btImpact ? this.btImpact.clone() : new THREE.Vector3());
      const poopPos = this.poop ? this.poop.pos.clone()
        : (this.btImpact ? this.btImpact.clone() : focus.clone());
      const span = Math.max(2, poopPos.y - focus.y);
      const anchor = focus.clone().lerp(poopPos, 0.5);          // middle of the drop
      // 3/4 view: mostly to the side, a touch behind the bird's heading
      const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const back = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const dir = side.multiplyScalar(0.85).add(back.multiplyScalar(0.45)).normalize();
      const dist = THREE.MathUtils.clamp(span * 0.85 + 6, 9, 24);
      desired = anchor.clone().add(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, span * 0.18 + 2.5, 0));
      lookAt = anchor;
      this.camera.position.lerp(desired, Math.min(1, dt * 9));
      this._camLookAt = this._camLookAt || lookAt.clone();
      this._camLookAt.lerp(lookAt, Math.min(1, dt * 11));
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
