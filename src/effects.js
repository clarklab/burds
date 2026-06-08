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
  }

  // A juicy splat of brown blobs at a point.
  splat(pos, big = false) {
    const group = new THREE.Group();
    const n = big ? 16 : 10;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const r = 0.12 + Math.random() * 0.22;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 5), mat(i % 3 === 0 ? 0x6b4626 : 0x7a5230));
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

    // flat decal on the ground
    const decal = new THREE.Mesh(
      new THREE.CircleGeometry(big ? 1.4 : 0.9, 12),
      new THREE.MeshLambertMaterial({ color: 0x6b4626, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }),
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
  }

  clearDecals() {
    for (const d of this.decals) this.scene.remove(d.m);
    this.decals = [];
    for (const b of this.bursts) this.scene.remove(b.group);
    this.bursts = [];
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
