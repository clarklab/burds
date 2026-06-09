import * as THREE from 'three';
import { mat } from './models.js';

// ---------------------------------------------------------------------------
// Particle splats + lingering poop decals on the ground.
// ---------------------------------------------------------------------------
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.bursts = [];
    this.decals = [];
    this.splashes = [];
    this.embers = [];
  }

  // A juicy splat of blobs at a point, plus the lingering flat ground decal.
  // `scale` tracks turd size; `fire` swaps in molten-lava colours.
  splat(pos, big = false, scale = 1, fire = false) {
    const blobA = fire ? 0xff4500 : 0x6b4626;
    const blobB = fire ? 0xff7a18 : 0x7a5230;
    const group = new THREE.Group();
    const n = big ? 16 : 10;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const r = (0.12 + Math.random() * 0.22) * scale;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 5), mat(i % 3 === 0 ? blobA : blobB));
      const ang = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 8;
      m.position.copy(pos);
      group.add(m);
      parts.push({
        m,
        v: new THREE.Vector3(Math.cos(ang) * sp, 3 + Math.random() * 6, Math.sin(ang) * sp),
      });
    }
    this.scene.add(group);
    this.bursts.push({ group, parts, t: 0, life: 1.2 });

    // flat decal on the ground (a charred scorch for fireballs)
    const decal = new THREE.Mesh(
      new THREE.CircleGeometry((big ? 1.4 : 0.9) * scale, 12),
      new THREE.MeshLambertMaterial({ color: fire ? 0x5a1500 : 0x6b4626, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(pos.x, 0.12, pos.z);
    decal.scale.setScalar(0.2);
    this.scene.add(decal);
    this.decals.push({ m: decal, t: 0, grow: true });
    // cap decals
    if (this.decals.length > 30) {
      const old = this.decals.shift();
      this.scene.remove(old.m);
    }
  }

  // An extra burst that fires only when a *target* gets hit: an expanding shock
  // ring at the point of impact plus a spray of droplets kicked up and out. This
  // rides on top of the flat splat for a satisfying "direct hit" pop.
  splash(pos, scale = 1, fire = false) {
    // expanding shock ring (its own material so opacity fades per-splash)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.75, 22),
      new THREE.MeshBasicMaterial({ color: fire ? 0xff5a00 : 0x9c6b3f, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, (pos.y || 0) + 0.15, pos.z);
    ring.scale.setScalar(0.4 * scale);
    this.scene.add(ring);
    this.splashes.push({ m: ring, t: 0, life: 0.55, base: scale });

    // droplets kicked upward and outward — splashier (faster, lighter) than the
    // splat blobs, and reusing the gravity-driven burst path.
    const dropA = fire ? 0xff7a18 : 0x7a5230;
    const dropB = fire ? 0xffd24a : 0x9c6b3f;
    const group = new THREE.Group();
    const parts = [];
    const n = Math.round(12 * scale);
    for (let i = 0; i < n; i++) {
      const r = (0.08 + Math.random() * 0.14) * scale;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 5), mat(i % 2 === 0 ? dropA : dropB));
      m.position.copy(pos);
      group.add(m);
      const ang = Math.random() * Math.PI * 2;
      const sp = 5 + Math.random() * 9;
      parts.push({
        m,
        v: new THREE.Vector3(Math.cos(ang) * sp, 7 + Math.random() * 8, Math.sin(ang) * sp),
      });
    }
    this.scene.add(group);
    this.bursts.push({ group, parts, t: 0, life: 0.9 });
  }

  // A single glowing ember left behind a falling fireball — spawn one per frame
  // while a TURD FIRE comet is in flight to draw the streaking lava trail.
  ember(pos, scale = 1) {
    const r = (0.12 + Math.random() * 0.18) * Math.min(2.5, scale);
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 6, 6),
      new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xff7a18 : 0xffd24a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.position.set(pos.x + (Math.random() - 0.5) * 0.4, pos.y + (Math.random() - 0.5) * 0.3, pos.z + (Math.random() - 0.5) * 0.4);
    this.scene.add(m);
    this.embers.push({ m, t: 0, life: 0.4 + Math.random() * 0.25, vy: 1 + Math.random() * 2 });
  }

  update(dt) {
    // bursts
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      for (const p of b.parts) {
        p.v.y -= 22 * dt;
        p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y < 0.1) { p.m.position.y = 0.1; p.v.multiplyScalar(0); }
      }
      const k = b.t / b.life;
      b.group.scale.setScalar(Math.max(0.01, 1 - k * 0.4));
      if (b.t > b.life) {
        this.scene.remove(b.group);
        this.bursts.splice(i, 1);
      }
    }
    // decal grow-in
    for (const d of this.decals) {
      if (d.grow) {
        d.t += dt;
        const k = Math.min(1, d.t / 0.25);
        d.m.scale.setScalar(0.2 + k * 0.8);
        if (k >= 1) d.grow = false;
      }
    }
    // splash shock-rings: grow outward and fade
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const sp = this.splashes[i];
      sp.t += dt;
      const k = sp.t / sp.life;
      sp.m.scale.setScalar((0.4 + k * 2.4) * sp.base);
      sp.m.material.opacity = 0.85 * (1 - k);
      if (sp.t > sp.life) {
        this.scene.remove(sp.m);
        this.splashes.splice(i, 1);
      }
    }
    // fireball trail embers: drift up, shrink and fade fast
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.t += dt;
      const k = e.t / e.life;
      e.m.position.y += e.vy * dt;
      e.m.material.opacity = 0.9 * (1 - k);
      e.m.scale.setScalar(Math.max(0.05, 1 - k));
      if (e.t > e.life) {
        this.scene.remove(e.m);
        this.embers.splice(i, 1);
      }
    }
  }

  clearDecals() {
    for (const d of this.decals) this.scene.remove(d.m);
    this.decals = [];
    for (const b of this.bursts) this.scene.remove(b.group);
    this.bursts = [];
    for (const s of this.splashes) this.scene.remove(s.m);
    this.splashes = [];
    for (const e of this.embers) this.scene.remove(e.m);
    this.embers = [];
  }
}

// A ground reticle showing predicted poop landing spot.
export function buildReticle() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  const inner = new THREE.Mesh(
    new THREE.RingGeometry(0.25, 0.4, 16),
    new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  );
  inner.rotation.x = -Math.PI / 2;
  g.add(inner);
  // Soft halo that lights up as the predicted shot homes in, and pulses hard at
  // the bullseye window — the visual half of the "release NOW" cue.
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(1.25, 2.1, 28),
    new THREE.MeshBasicMaterial({ color: 0x35ff7a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.01;
  glow.visible = false;
  g.add(glow);
  g.position.y = 0.15;
  g.userData.ring = ring;
  g.userData.inner = inner;
  g.userData.glow = glow;
  return g;
}

// The super-Saiyan aura: a pulsing golden energy shell, an upward flame, and a
// crackle of lightning bolts. Returned as a group meant to be parented to the
// bird; call update(dt, intensity) each frame while it's visible.
export function buildSuperAura() {
  const group = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.4, 1),
    new THREE.MeshBasicMaterial({ color: 0xffe24a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(shell);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 6, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
  );
  flame.position.y = 2.0;
  group.add(flame);

  const SEG = 6, BOLTS = 7;
  const bolts = [];
  for (let i = 0; i < BOLTS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(line);
    bolts.push(line);
  }

  // Re-jag every bolt into a fresh forking arc around the bird.
  function regen() {
    for (const line of bolts) {
      const pos = line.geometry.attributes.position;
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.2 + Math.random() * 1.3;
      const top = 2 + Math.random() * 4;
      for (let s = 0; s <= SEG; s++) {
        const f = s / SEG;
        const r = rad * (1 - f * 0.3);
        pos.setXYZ(s,
          Math.cos(ang) * r + (Math.random() - 0.5) * 0.7,
          -1 + f * top + (Math.random() - 0.5) * 0.5,
          Math.sin(ang) * r + (Math.random() - 0.5) * 0.7,
        );
      }
      pos.needsUpdate = true;
    }
  }
  regen();

  let t = 0, flick = 0;
  function update(dt, intensity = 1) {
    t += dt; flick += dt;
    const pulse = 0.5 + 0.5 * Math.sin(t * 22);
    shell.material.opacity = (0.12 + 0.2 * intensity) * (0.5 + 0.5 * pulse);
    shell.scale.setScalar(1 + 0.06 * pulse * intensity);
    flame.material.opacity = (0.1 + 0.18 * intensity) * pulse;
    flame.rotation.y += dt * 3;
    if (flick > 0.045) {
      flick = 0;
      regen();
      const showN = Math.round(bolts.length * (0.4 + 0.6 * intensity));
      bolts.forEach((b, i) => { b.visible = i < showN && Math.random() < 0.85; });
    }
    const bo = 0.6 + 0.4 * intensity;
    for (const b of bolts) b.material.opacity = bo * (0.6 + 0.4 * Math.random());
  }

  group.visible = false;
  return { group, update };
}

// The TURD FIRE aura: a ring of flickering flame licks and a red-hot energy
// shell engulfing the bird. Parent to the bird; call update(dt, intensity).
export function buildFireAura() {
  const group = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.5, 1),
    new THREE.MeshBasicMaterial({ color: 0xff3b00, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(shell);

  const cols = [0xff2b00, 0xff6a00, 0xffb02e];
  const flames = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const fl = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 2.6, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: cols[i % cols.length], transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
    );
    const r = 1.3 + Math.random() * 0.9;
    fl.position.set(Math.cos(a) * r, 1.1 + Math.random() * 0.9, Math.sin(a) * r);
    group.add(fl);
    flames.push(fl);
  }

  let t = 0;
  function update(dt, intensity = 1) {
    t += dt;
    const pulse = 0.5 + 0.5 * Math.sin(t * 26);
    shell.material.opacity = (0.14 + 0.2 * intensity) * (0.5 + 0.5 * pulse);
    shell.scale.setScalar(1 + 0.05 * pulse);
    for (let i = 0; i < flames.length; i++) {
      const fl = flames[i];
      fl.scale.y = 0.6 + 0.6 * Math.abs(Math.sin(t * 18 + i));
      fl.material.opacity = (0.45 + 0.4 * intensity) * (0.55 + 0.45 * Math.sin(t * 22 + i * 1.7));
    }
    group.rotation.y += dt * 1.6;
  }

  group.visible = false;
  return { group, update };
}

// A soft round shadow that follows the bird.
export function buildBirdShadow() {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.14;
  return m;
}
