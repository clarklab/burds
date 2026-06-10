import * as THREE from 'three';
import { mat } from './models.js';

// ---------------------------------------------------------------------------
// Particle splats + lingering poop decals on the ground.
// ---------------------------------------------------------------------------

// Shared resources for the high-churn bits (satellite stains, sticky blobs),
// so machine-gun volleys don't allocate fresh GPU buffers per impact.
const SAT_GEO = new THREE.CircleGeometry(1, 8);
const BLOB_GEO = new THREE.SphereGeometry(1, 6, 6);
const decalMats = new Map();
function decalMat(color) {
  if (!decalMats.has(color)) {
    decalMats.set(color, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
  }
  return decalMats.get(color);
}

// Per-shape impact "signature" for the chunk burst (effects.splat / .splash).
// n: [min,max] chunk count · r: [min,max] radius (×turd scale) · up/out:
// [min,max] launch speed (vertical / horizontal) · cols: chunk palette ·
// elong: [x, yz] stretch for log segments · life: burst seconds.
const SPLAT_STYLE = {
  // the classic round pop — unchanged from the original splat
  normal:   { n: [12, 18], r: [0.12, 0.34], up: [3.5, 10.5], out: [5, 14], cols: [0x6b4626, 0x6b4626, 0x7a5230], life: 1.35 },
  // fireball lava (only ever reached via fire mode)
  fire:     { n: [12, 18], r: [0.12, 0.34], up: [3.5, 10.5], out: [5, 14], cols: [0xff4500, 0xff4500, 0xff7a18], life: 1.35 },
  // a few fat segments that split off low and skid
  log:      { n: [5, 8],   r: [0.18, 0.4],  up: [1.2, 4.0],  out: [3, 9],  cols: [0x5e3c1f, 0x6b4626, 0x7a5230], elong: [1.9, 0.65], life: 1.5 },
  // a swarm of tiny pellets pinging fast and wide
  bbs:      { n: [16, 24], r: [0.07, 0.15], up: [2.5, 6.0],  out: [8, 15], cols: [0x5e3c1f, 0x6b4626, 0x7a5230], life: 1.3 },
  // a wet white-brown explosion thrown high and far
  splatter: { n: [16, 22], r: [0.09, 0.2],  up: [6, 12],     out: [6, 13], cols: [0xf2ede0, 0x7a5230, 0xe6dcc6, 0x6b4626], life: 1.0 },
};

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.bursts = [];
    this.decals = [];
    this.splashes = [];
    this.embers = [];
  }

  // --- shared impact machinery -------------------------------------------------
  // A gravity-driven shower of blob chunks. `spec` (see SPLAT_STYLE) tunes how
  // many fly, their size/colours, how hard they're flung up and out, whether
  // they're stretched into log segments, and how long they live. The generic
  // update() loop bounces + settles them.
  _burst(pos, scale, spec) {
    const group = new THREE.Group();
    const parts = [];
    const n = spec.n[0] + ((Math.random() * (spec.n[1] - spec.n[0] + 1)) | 0);
    for (let i = 0; i < n; i++) {
      const r = (spec.r[0] + Math.random() * (spec.r[1] - spec.r[0])) * scale;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 5), mat(spec.cols[i % spec.cols.length]));
      // log chunks are stretched into stubby segments, spun to random headings
      if (spec.elong) { m.scale.set(spec.elong[0], spec.elong[1], spec.elong[1]); m.rotation.y = Math.random() * Math.PI; }
      const ang = Math.random() * Math.PI * 2;
      const sp = spec.out[0] + Math.random() * (spec.out[1] - spec.out[0]);
      const vy = spec.up[0] + Math.random() * (spec.up[1] - spec.up[0]);
      m.position.copy(pos);
      group.add(m);
      parts.push({ m, v: new THREE.Vector3(Math.cos(ang) * sp, vy, Math.sin(ang) * sp) });
    }
    this.scene.add(group);
    this.bursts.push({ group, parts, t: 0, life: spec.life });
  }

  // A flat ground stain. `grow` decals animate open from a dot; static sats use
  // the shared unit-circle geo. `ax`/`ay` stretch the disc (world X / world Z)
  // into a smear; `r` is the radius (grow) or scale factor (sat).
  _decal(pos, color, r, { grow = false, ax = 1, ay = 1, y = 0.11 } = {}) {
    const m = new THREE.Mesh(grow ? new THREE.CircleGeometry(r, 12) : SAT_GEO, decalMat(color));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, grow ? 0.12 : y, pos.z);
    if (grow) { m.scale.set(0.2 * ax, 0.2 * ay, 0.2); this.decals.push({ m, t: 0, grow: true, ax, ay }); }
    else { m.scale.set(r * ax, r * ay, r); this.decals.push({ m, t: 0, grow: false }); }
    this.scene.add(m);
    return m;
  }

  _capDecals() {
    while (this.decals.length > 80) {
      const old = this.decals.shift();
      this.scene.remove(old.m);
    }
  }

  // A juicy splat at the impact point: a shower of chunks plus the lingering flat
  // ground decal. Each turd shape lands with its OWN signature — the swirl bursts
  // round, the log splits and skids, the BBs ping wide, the splatter throws a wet
  // white-brown starburst. `fire` overrides with molten-lava colours.
  splat(pos, big = false, scale = 1, fire = false, type = 'normal') {
    if (fire) type = 'fire';
    const spec = SPLAT_STYLE[type] || SPLAT_STYLE.normal;
    // bigger chunk count on a clean (bullseye) hit
    const bspec = big ? { ...spec, n: [spec.n[0] + 4, spec.n[1] + 6] } : spec;
    this._burst(pos, scale, bspec);

    switch (type) {
      case 'log': {
        // a long brown smear stretched along the lane, with a couple of skid
        // streaks trailing off it
        this._decal(pos, 0x6b4626, (big ? 1.0 : 0.78) * scale, { grow: true, ax: 0.62, ay: 1.85 });
        for (let i = 0; i < 3; i++) {
          const dz = (0.9 + Math.random() * 1.7) * scale * (Math.random() < 0.5 ? 1 : -1);
          this._decal({ x: pos.x + (Math.random() - 0.5) * 0.5 * scale, z: pos.z + dz }, 0x5e3c1f,
            (0.3 + Math.random() * 0.25) * scale, { ax: 0.5, ay: 1.5 });
        }
        break;
      }
      case 'bbs': {
        // no single big stain — a wide spray of little pellet dots
        this._decal(pos, 0x6b4626, (big ? 0.6 : 0.45) * scale, { grow: true });
        const sats = 8 + ((Math.random() * 4) | 0);
        for (let i = 0; i < sats; i++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = (0.8 + Math.random() * 1.9) * scale * (big ? 1.25 : 1);
          this._decal({ x: pos.x + Math.cos(ang) * dist, z: pos.z + Math.sin(ang) * dist },
            SPLAT_STYLE.bbs.cols[(Math.random() * 3) | 0], (0.1 + Math.random() * 0.14) * scale);
        }
        break;
      }
      case 'splatter': {
        // an irregular white-brown splash with thin radial "lightning" fingers
        // dotted outward from the centre
        this._decal(pos, 0x7a5230, (big ? 1.1 : 0.85) * scale, { grow: true, ax: 1.15, ay: 0.9 });
        this._decal(pos, 0xd8cfb8, (big ? 0.7 : 0.55) * scale, { grow: true, ax: 0.95, ay: 1.2 });
        const fingers = 6 + ((Math.random() * 3) | 0);
        for (let i = 0; i < fingers; i++) {
          const ang = (i / fingers) * Math.PI * 2 + Math.random() * 0.5;
          const dx = Math.cos(ang), dz = Math.sin(ang);
          for (let s = 1; s <= 3; s++) {
            const dist = (0.5 + s * 0.55) * scale * (0.8 + Math.random() * 0.4);
            this._decal({ x: pos.x + dx * dist, z: pos.z + dz * dist },
              s % 2 ? 0xd8cfb8 : 0x6b4626, (0.18 - s * 0.035) * scale);
          }
        }
        break;
      }
      default: {
        // the classic round splat: one disc + a few irregular satellite spatters
        const stain = fire ? 0x5a1500 : 0x6b4626;
        this._decal(pos, stain, (big ? 1.4 : 0.9) * scale, { grow: true });
        const sats = 3 + ((Math.random() * 3) | 0);
        for (let i = 0; i < sats; i++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = (0.9 + Math.random() * 1.4) * scale * (big ? 1.2 : 0.95);
          this._decal({ x: pos.x + Math.cos(ang) * dist, z: pos.z + Math.sin(ang) * dist },
            stain, (0.14 + Math.random() * 0.24) * scale);
        }
      }
    }
    this._capDecals();
  }

  // Splat gunk onto a victim: flattened blobs parented to the target so they
  // ride its panic flail and death tumble (and vanish along with it). The gunk
  // colour matches the turd shape — the splatter smears on white-and-brown, the
  // BBs stick as little dark pellets.
  stickTo(group, n = 5, fire = false, type = 'normal') {
    const cols = fire ? [0xff7a18, 0x5a1500, 0xff4500]
      : type === 'splatter' ? [0xf2ede0, 0x6b4626, 0xe6dcc6, 0x5e3c1f]
      : [0x6b4626, 0x7a5230, 0x5e3c1f];
    const pellet = type === 'bbs'; // tight little balls instead of smears
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(BLOB_GEO, mat(cols[i % cols.length]));
      const r = 0.1 + Math.random() * 0.13;
      if (pellet) m.scale.setScalar(r * 0.7); else m.scale.set(r, r * 0.5, r); // squashed flat against the body
      m.position.set((Math.random() - 0.5) * 0.85, 0.4 + Math.random() * 1.4, (Math.random() - 0.5) * 0.85);
      m.rotation.set(Math.random() * 0.8 - 0.4, 0, Math.random() * 0.8 - 0.4);
      m.castShadow = false;
      group.add(m);
    }
  }

  // An expanding shock ring at an impact point (its own material so the opacity
  // can fade per-ring).
  _ring(pos, scale, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.75, 22),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, (pos.y || 0) + 0.15, pos.z);
    ring.scale.setScalar(0.4 * scale);
    this.scene.add(ring);
    this.splashes.push({ m: ring, t: 0, life: 0.55, base: scale });
  }

  // The extra burst that fires only when a *target* gets hit, riding on top of
  // the flat splat for a satisfying "right when it hits the person" pop. Each
  // turd shape reacts differently: the swirl bursts round, the log skids low and
  // wide, the BBs spray a pellet cloud, and the splatter erupts in a tall wet
  // white-brown geyser under a double shock ring.
  splash(pos, scale = 1, fire = false, type = 'normal') {
    if (fire) type = 'fire';

    const ringCol = { fire: 0xff5a00, log: 0x6b4626, bbs: 0x8a6038, splatter: 0xe9dec6 }[type] || 0x9c6b3f;
    this._ring(pos, scale, ringCol);
    if (type === 'splatter') this._ring(pos, scale * 1.5, 0x9c6b3f); // wet double-ring

    // droplet kit per shape: count, size, and how hard they're flung up vs. out
    const D = ({
      normal:   { cols: [0x7a5230, 0x9c6b3f],          n: 12, r: [0.08, 0.22], up: [7, 15],  out: [5, 14], life: 0.9 },
      fire:     { cols: [0xff7a18, 0xffd24a],          n: 12, r: [0.08, 0.22], up: [7, 15],  out: [5, 14], life: 0.9 },
      log:      { cols: [0x6b4626, 0x5e3c1f],          n: 9,  r: [0.12, 0.26], up: [3, 7],   out: [8, 17], life: 0.9 },
      bbs:      { cols: [0x5e3c1f, 0x6b4626, 0x7a5230], n: 22, r: [0.06, 0.12], up: [4, 9],   out: [9, 18], life: 0.8 },
      splatter: { cols: [0xf2ede0, 0x7a5230, 0xe6dcc6], n: 20, r: [0.07, 0.16], up: [13, 21], out: [3, 8],  life: 1.0 },
    })[type] || null;
    const kit = D || { cols: [0x7a5230, 0x9c6b3f], n: 12, r: [0.08, 0.22], up: [7, 15], out: [5, 14], life: 0.9 };

    const group = new THREE.Group();
    const parts = [];
    const n = Math.round(kit.n * scale);
    for (let i = 0; i < n; i++) {
      const r = (kit.r[0] + Math.random() * (kit.r[1] - kit.r[0])) * scale;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 5), mat(kit.cols[i % kit.cols.length]));
      m.position.copy(pos);
      group.add(m);
      const ang = Math.random() * Math.PI * 2;
      const sp = kit.out[0] + Math.random() * (kit.out[1] - kit.out[0]);
      const vy = kit.up[0] + Math.random() * (kit.up[1] - kit.up[0]);
      parts.push({ m, v: new THREE.Vector3(Math.cos(ang) * sp, vy, Math.sin(ang) * sp) });
    }
    this.scene.add(group);
    this.bursts.push({ group, parts, t: 0, life: kit.life });
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
        if (p.settled) continue;
        p.v.y -= 26 * dt;
        p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y < 0.1) {
          if (!p.bounced && p.v.y < -4) {
            // chunks pop back off the ground once, scattering outward
            p.bounced = true;
            p.m.position.y = 0.1;
            p.v.y *= -(0.3 + Math.random() * 0.25);
            p.v.x *= 0.65;
            p.v.z *= 0.65;
          } else {
            // settle as a flattened little splat
            p.settled = true;
            p.m.position.y = 0.07;
            p.v.set(0, 0, 0);
            p.m.scale.y = 0.35;
          }
        }
      }
      const k = b.t / b.life;
      b.group.scale.setScalar(Math.max(0.01, 1 - k * 0.4));
      if (b.t > b.life) {
        this.scene.remove(b.group);
        this.bursts.splice(i, 1);
      }
    }
    // decal grow-in (ax/ay keep stretched smears from snapping back to a circle)
    for (const d of this.decals) {
      if (d.grow) {
        d.t += dt;
        const k = Math.min(1, d.t / 0.25);
        const s = 0.2 + k * 0.8;
        d.m.scale.set(s * (d.ax || 1), s * (d.ay || 1), s);
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

// ---------------------------------------------------------------------------
// Power-up auras (super-Saiyan lightning + TURD FIRE). Both lean on the same
// two tricks: a redrawable canvas texture that flickers like real lightning /
// fire, shown on a "curtain" of crossed planes so it reads as a 3D volume from
// any angle without needing the camera, layered over sharper 3D detail.
// ---------------------------------------------------------------------------

// A small canvas texture that gets repainted on every flicker. `draw(ctx, w, h,
// intensity)` runs on each redraw — cheap enough to re-roll ~15×/sec.
function animTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  return { tex, redraw(intensity) { draw(ctx, w, h, intensity); tex.needsUpdate = true; } };
}

// Crossed vertical planes (double-sided, additive) all sharing one animated
// texture + material, so the effect looks volumetric from every angle.
function auraCurtain(tex, { count = 3, w = 7.5, h = 9, y = 1.4, color = 0xffffff } = {}) {
  const geo = new THREE.PlaneGeometry(w, h);
  const material = new THREE.MeshBasicMaterial({
    map: tex, color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const planes = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, material);
    m.rotation.y = (i / count) * Math.PI;
    m.position.y = y;
    planes.push(m);
  }
  return { planes, material };
}

// Paint glowing, forking lightning down a transparent canvas (white core inside
// a fat electric-blue glow).
function drawLightning(ctx, w, h, intensity) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const bolts = 2 + Math.round(intensity * 3);
  for (let b = 0; b < bolts; b++) {
    const pts = [];
    let x = w * (0.15 + Math.random() * 0.7), y = 0;
    const segs = 8;
    for (let s = 0; s <= segs; s++) { pts.push([x, y]); y += h / segs; x += (Math.random() - 0.5) * w * 0.26; }
    const trace = (lw, col) => {
      ctx.lineWidth = lw; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    };
    trace(9, 'rgba(110,180,255,0.45)');   // fat blue glow
    trace(4, 'rgba(185,225,255,0.85)');   // mid
    trace(1.6, 'rgba(255,255,255,1)');    // white core
    // a couple of forks branching off the main channel
    for (let f = 0; f < 2; f++) {
      const i0 = 2 + ((Math.random() * (pts.length - 3)) | 0);
      let [fx, fy] = pts[i0];
      ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(210,235,255,0.8)';
      ctx.beginPath(); ctx.moveTo(fx, fy);
      const fs = 2 + ((Math.random() * 2) | 0);
      for (let s = 0; s < fs; s++) { fx += (Math.random() - 0.5) * w * 0.34; fy += h * 0.1; ctx.lineTo(fx, fy); }
      ctx.stroke();
    }
  }
}

// Paint a field of additive flame tongues (hot white-yellow base → red tips).
function drawFire(ctx, w, h, intensity) {
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const tongues = 6 + Math.round(intensity * 3);
  for (let i = 0; i < tongues; i++) {
    const x = (w * (i + 0.5)) / tongues + (Math.random() - 0.5) * w * 0.12;
    const fh = h * (0.5 + Math.random() * 0.45);
    const fw = (w / tongues) * (0.9 + Math.random() * 0.8);
    const g = ctx.createLinearGradient(0, h, 0, h - fh);
    g.addColorStop(0, 'rgba(255,255,225,0.95)');
    g.addColorStop(0.22, 'rgba(255,205,70,0.9)');
    g.addColorStop(0.55, 'rgba(255,95,15,0.65)');
    g.addColorStop(1, 'rgba(180,15,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - fw / 2, h);
    ctx.quadraticCurveTo(x - fw * 0.4 + (Math.random() - 0.5) * fw, h - fh * 0.55, x + (Math.random() - 0.5) * fw * 0.4, h - fh);
    ctx.quadraticCurveTo(x + fw * 0.4 + (Math.random() - 0.5) * fw, h - fh * 0.55, x + fw / 2, h);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// The super-Saiyan aura: an electric energy shell + golden updraft, a strobing
// curtain of glowing forked lightning, sharp 3D crackle bolts arcing around the
// bird, a spinning energy ring, a core flash that pops on every strike, and
// scattering sparks. Parent to the bird; call update(dt, intensity).
export function buildSuperAura() {
  const group = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.4, 1),
    new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(shell);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 6.5, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe79a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
  );
  flame.position.y = 2.2;
  group.add(flame);

  // bright core flash that pops white on every lightning strike
  const flashCore = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(flashCore);

  // fast-spinning electric ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.06, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // glowing forked-lightning curtain (the headline upgrade)
  const lt = animTexture(128, 256, drawLightning);
  const curtain = auraCurtain(lt.tex, { count: 3, w: 7.5, h: 9, y: 1.4, color: 0xcdeaff });
  for (const p of curtain.planes) group.add(p);

  // sharp 3D crackle bolts arcing around the bird
  const SEG = 7, BOLTS = 9;
  const bolts = [];
  for (let i = 0; i < BOLTS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xdfefff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(line);
    bolts.push(line);
  }
  function regenBolts() {
    for (const line of bolts) {
      const pos = line.geometry.attributes.position;
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.1 + Math.random() * 1.6;
      const top = 2.5 + Math.random() * 4;
      for (let s = 0; s <= SEG; s++) {
        const f = s / SEG;
        const r = rad * (1 - f * 0.25);
        pos.setXYZ(s,
          Math.cos(ang) * r + (Math.random() - 0.5) * 0.9,
          -1.2 + f * top + (Math.random() - 0.5) * 0.6,
          Math.sin(ang) * r + (Math.random() - 0.5) * 0.9,
        );
      }
      pos.needsUpdate = true;
    }
  }
  regenBolts();
  lt.redraw(1);

  // popping spark points scattered on the shell
  const sparks = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    group.add(s);
    sparks.push(s);
  }

  let t = 0, flick = 0, flash = 0;
  function update(dt, intensity = 1) {
    t += dt; flick += dt;
    flash = Math.max(0, flash - dt * 7);   // strobe decay between strikes
    const pulse = 0.5 + 0.5 * Math.sin(t * 22);
    shell.material.opacity = (0.12 + 0.22 * intensity) * (0.5 + 0.5 * pulse);
    shell.scale.setScalar(1 + 0.07 * pulse * intensity);
    flame.material.opacity = (0.1 + 0.2 * intensity) * pulse;
    flame.rotation.y += dt * 3;
    ring.material.opacity = (0.25 + 0.5 * intensity) * (0.4 + 0.6 * pulse);
    ring.rotation.z += dt * 7;
    ring.scale.setScalar(1 + 0.08 * Math.sin(t * 9));
    // fresh strike: re-jag bolts, repaint the lightning, flash, re-scatter sparks
    if (flick > 0.05) {
      flick = 0; flash = 1;
      regenBolts();
      lt.redraw(intensity);
      const showN = Math.round(bolts.length * (0.4 + 0.6 * intensity));
      bolts.forEach((b, i) => { b.visible = i < showN && Math.random() < 0.85; });
      for (const s of sparks) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, r = 2.4 + Math.random() * 0.9;
        s.position.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r + 0.5, Math.sin(a) * Math.cos(e) * r);
        s.visible = Math.random() < 0.7;
      }
    }
    const bo = 0.6 + 0.4 * intensity;
    for (const b of bolts) b.material.opacity = bo * (0.6 + 0.4 * Math.random());
    curtain.material.opacity = (0.25 + 0.5 * intensity) * (0.35 + 0.65 * flash);
    flashCore.material.opacity = 0.7 * intensity * flash;
    flashCore.scale.setScalar(0.8 + 0.6 * flash);
    for (const s of sparks) s.material.opacity = intensity * (0.5 + 0.5 * flash);
  }

  group.visible = false;
  return { group, update };
}

// The TURD FIRE aura: a red-hot energy shell, a roaring volumetric flame
// curtain, two tiers of flickering flame licks (tall red outer + short hot
// inner), and a stream of rising, recycling embers. Parent to the bird; call
// update(dt, intensity).
export function buildFireAura() {
  const group = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.5, 1),
    new THREE.MeshBasicMaterial({ color: 0xff4a00, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(shell);

  // roaring volumetric flame body
  const ft = animTexture(128, 256, drawFire);
  const curtain = auraCurtain(ft.tex, { count: 3, w: 7.5, h: 9, y: 1.6, color: 0xffffff });
  for (const p of curtain.planes) group.add(p);

  // two tiers of flame-lick cones: tall red outer ring + short hot inner ring
  const mkFlame = (col, height, baseR) => new THREE.Mesh(
    new THREE.ConeGeometry(baseR, height, 7, 1, true),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
  );
  const flames = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const fl = mkFlame(0xff5a12, 3.0, 0.55);
    const r = 1.4 + Math.random() * 0.9;
    fl.position.set(Math.cos(a) * r, 1.3 + Math.random() * 0.9, Math.sin(a) * r);
    group.add(fl);
    flames.push({ m: fl, ph: Math.random() * 6, sp: 16 + Math.random() * 8, hi: 0.8 });
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const fl = mkFlame(0xffd24a, 2.0, 0.4);
    const r = 0.7 + Math.random() * 0.5;
    fl.position.set(Math.cos(a) * r, 1.0 + Math.random() * 0.6, Math.sin(a) * r);
    group.add(fl);
    flames.push({ m: fl, ph: Math.random() * 6, sp: 20 + Math.random() * 8, hi: 1.0 });
  }

  // rising embers that recycle from the base
  const embers = [];
  for (let i = 0; i < 12; i++) {
    const e = new THREE.Mesh(
      new THREE.SphereGeometry(0.08 + Math.random() * 0.07, 6, 6),
      new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xffb02e : 0xff5a12, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    e.userData.reset = () => {
      e.position.set((Math.random() - 0.5) * 3, 0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 3);
      e.userData.vy = 1.5 + Math.random() * 2.2;
      e.userData.life = 0.6 + Math.random() * 0.8;
      e.userData.t = Math.random() * e.userData.life;
    };
    e.userData.reset();
    group.add(e);
    embers.push(e);
  }

  let t = 0, flick = 0;
  function update(dt, intensity = 1) {
    t += dt; flick += dt;
    const pulse = 0.5 + 0.5 * Math.sin(t * 26);
    shell.material.opacity = (0.14 + 0.22 * intensity) * (0.5 + 0.5 * pulse);
    shell.scale.setScalar(1 + 0.06 * pulse);
    if (flick > 0.06) { flick = 0; ft.redraw(intensity); }
    for (const f of flames) {
      f.m.scale.y = 0.55 + 0.7 * Math.abs(Math.sin(t * (f.sp * 0.06) + f.ph));
      f.m.material.opacity = (0.4 + 0.45 * intensity) * f.hi * (0.5 + 0.5 * Math.sin(t * (f.sp * 0.08) + f.ph * 1.7));
    }
    for (const e of embers) {
      e.userData.t += dt;
      e.position.y += e.userData.vy * dt;
      e.position.x += Math.sin(t * 3 + e.position.z) * dt * 0.3;
      const k = e.userData.t / e.userData.life;
      e.material.opacity = Math.max(0, 0.9 * (1 - k)) * intensity;
      e.scale.setScalar(Math.max(0.2, 1 - k * 0.7));
      if (k >= 1) e.userData.reset();
    }
    curtain.material.opacity = 0.35 + 0.45 * intensity;
    group.rotation.y += dt * 1.2;
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
