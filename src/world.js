import * as THREE from 'three';
import {
  buildPerson, buildKid, buildBiker, buildPicnic, buildCar,
  buildUmbrella, buildPalm, mat,
} from './models.js';

export const WORLD_RADIUS = 130;     // playable radius

// ---------------------------------------------------------------------------
// The "circuit": targets live evenly spaced around one smooth elliptical ring
// centred on the beach, rather than scattered at random. This is the whole
// trick to a pure loop-and-swoop feel — every target the bird's auto-aim
// commits to is the *next gentle step* around the oval, so the flight path is a
// flowing orbit with no hairpins or back-and-forth zig-zags. The oval is wide
// and shallow to match the beach, and its gentlest curvature still sits well
// inside the bird's turn radius, so it can always trace it smoothly.
// ---------------------------------------------------------------------------
const RING_CENTER = new THREE.Vector3(0, 0, 36);
const RING_RX = 52;          // half-width of the oval (x)
const RING_RZ = 36;          // half-depth of the oval (z) — kept close to RX so the
                             // curvature is even and there are no flat spots to cut across
const ORBIT_SPEED = 3;       // m/s drift for moving targets: gentle, so even spacing holds
const ORBIT_DIR = 1;         // every mover circulates the ring the same way
const ORBIT_OMEGA = ORBIT_SPEED / ((RING_RX + RING_RZ) / 2);

// World-space point on the ring at a given angle.
function ringPos(angle) {
  return new THREE.Vector3(
    RING_CENTER.x + Math.cos(angle) * RING_RX,
    0,
    RING_CENTER.z + Math.sin(angle) * RING_RZ,
  );
}
// Heading (rotation.y) facing along the ring's tangent at `angle`, so movers
// point the way they travel. forward = (sin y, cos y) ⇒ y = atan2(vx, vz).
function ringHeading(angle, dir) {
  const vx = -Math.sin(angle) * RING_RX * dir;
  const vz = Math.cos(angle) * RING_RZ * dir;
  return Math.atan2(vx, vz);
}

// ---------------------------------------------------------------------------
// Build the static beach world: sky, sun, sand, sea, boardwalk, palms, etc.
// ---------------------------------------------------------------------------
export function buildWorld(scene, renderer) {
  scene.background = new THREE.Color(0x8fd6ee);
  scene.fog = new THREE.Fog(0xbfe6ee, 240, 620);

  // Lights
  const hemi = new THREE.HemisphereLight(0xcdeffc, 0xe8d9a8, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.5);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); // modest for mobile GPUs
  const s = 160;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Sky dome (gradient)
  const skyGeo = new THREE.SphereGeometry(500, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(0x3aa6e0) },
      bottom: { value: new THREE.Color(0xcdeffc) },
    },
    vertexShader: `varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vp; uniform vec3 top; uniform vec3 bottom;
      void main(){ float h = clamp((normalize(vp).y*0.5+0.5),0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)),1.0);} `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // The sun billboard
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(28, 24), new THREE.MeshBasicMaterial({ color: 0xfff7cf }));
  sunDisc.position.set(150, 180, -260);
  scene.add(sunDisc);

  // Ground: big sand disc
  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD_RADIUS + 40, 48),
    mat(0xf2d79b),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.receiveShadow = true;
  scene.add(sand);

  // Sea: a big plane on the far side (negative Z)
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 500), mat(0x2aa3d6, { transparent: true, opacity: 0.92 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.05, -260);
  scene.add(sea);

  // Wet shoreline band
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(900, 60), mat(0x7fd0e0, { transparent: true, opacity: 0.6 }));
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(0, 0.06, -28);
  scene.add(shore);

  // Boardwalk / road strip across the sand (where cars + bikers go)
  const road = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 80, 16), mat(0x6d6f78));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.08, 70);
  scene.add(road);
  // road dashes
  for (let x = -WORLD_RADIUS; x < WORLD_RADIUS; x += 12) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.7), mat(0xffe066));
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.1, 70);
    scene.add(dash);
  }

  // Decorations: palms, umbrellas (no targets)
  const decor = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 40 + Math.random() * (WORLD_RADIUS - 30);
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad * 0.7 + 20;
    if (z < -10) continue; // keep palms out of the sea
    const item = Math.random() < 0.5 ? buildPalm() : buildUmbrella();
    item.position.set(x, 0, z);
    item.rotation.y = Math.random() * Math.PI * 2;
    decor.add(item);
  }
  scene.add(decor);

  return { sun, sunDisc, sea };
}

// ---------------------------------------------------------------------------
// Target types config
// ---------------------------------------------------------------------------
const TYPES = {
  person:  { build: buildPerson, value: 100, radius: 1.5, moving: false, label: 'Beachgoer' },
  kid:     { build: buildKid,    value: 150, radius: 1.0, moving: false, label: 'Kid' },
  picnic:  { build: buildPicnic, value: 120, radius: 2.1, moving: false, label: 'Picnic' },
  biker:   { build: buildBiker,  value: 200, radius: 1.3, moving: true,  label: 'Cyclist' },
  car:     { build: buildCar,    value: 175, radius: 2.2, moving: true,  label: 'Car' },
};
const TYPE_KEYS = Object.keys(TYPES);

function buildBullseye() {
  const g = new THREE.Group();
  const ringSpecs = [
    [1.5, 0xff2e4d], [1.05, 0xffffff], [0.6, 0xff2e4d],
  ];
  for (const [r, c] of ringSpecs) {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = (1.6 - r) * 0.01; // tiny stagger to avoid z-fight
    g.add(ring);
  }
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide }));
  dot.rotation.x = -Math.PI / 2; dot.position.y = 0.02;
  g.add(dot);

  // faint beam to make it pop from above
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 0.2, 8, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 4;
  g.add(beam);
  return g;
}

// ---------------------------------------------------------------------------
// Manages a pool of live targets.
// ---------------------------------------------------------------------------
export class TargetManager {
  constructor(scene) {
    this.scene = scene;
    this.targets = [];
    this.maxTargets = 8;
  }

  reset() {
    for (const t of this.targets) this.scene.remove(t.group);
    this.targets = [];
    // One target per evenly-spaced slot around the ring.
    for (let i = 0; i < this.maxTargets; i++) this.spawn(null, i);
  }

  // Spawn a target into ring `slot`. Each slot owns a fixed angle around the
  // oval, and respawns reuse the same slot, so the even spacing of the circuit
  // is preserved for the whole round no matter what gets bombed.
  spawn(typeKey, slot = 0) {
    const key = typeKey || TYPE_KEYS[(Math.random() * TYPE_KEYS.length) | 0];
    const cfg = TYPES[key];
    const group = cfg.build();

    const orbit = !!cfg.moving;
    const angle = (slot / this.maxTargets) * Math.PI * 2;
    group.position.copy(ringPos(angle));
    if (orbit) {
      // movers face (and drift) along the ring tangent
      group.rotation.y = ringHeading(angle, ORBIT_DIR);
    } else {
      // statics face inward toward the centre of the circuit — tidy + deterministic
      group.rotation.y = angle + Math.PI / 2;
    }

    const bullseye = buildBullseye();
    const topH = group.userData.headHeight || 2;
    bullseye.position.y = topH + 1.4;
    group.add(bullseye);

    this.scene.add(group);

    const t = {
      key, group, bullseye,
      cfg, value: cfg.value, radius: cfg.radius,
      hitY: topH,
      slot, orbit, angle,
      bobT: Math.random() * 10,
      alive: true,
      dying: 0,
    };
    this.targets.push(t);
    return t;
  }

  update(dt, t) {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const tg = this.targets[i];

      // death animation
      if (!tg.alive) {
        tg.dying += dt;
        const k = tg.dying / 0.6;
        tg.group.scale.setScalar(Math.max(0.001, 1 - k));
        tg.group.position.y = k * 1.5;
        tg.group.rotation.z += dt * 6;
        if (tg.dying > 0.6) {
          this.scene.remove(tg.group);
          this.targets.splice(i, 1);
          this.spawn(null, tg.slot); // refill the same ring slot to keep spacing even
        }
        continue;
      }

      // bobbing bullseye
      tg.bobT += dt;
      tg.bullseye.position.y = tg.hitY + 1.4 + Math.sin(tg.bobT * 2) * 0.25;
      tg.bullseye.rotation.y += dt * 0.8;

      // movers (cars/bikers) drift slowly *along* the ring, all the same way, so
      // the bird overtakes them on a smooth arc instead of intercepting across.
      if (tg.orbit) {
        tg.angle += ORBIT_OMEGA * ORBIT_DIR * dt;
        const p = ringPos(tg.angle);
        tg.group.position.x = p.x;
        tg.group.position.z = p.z;
        tg.group.rotation.y = ringHeading(tg.angle, ORBIT_DIR);
        if (tg.group.userData.wheels) {
          for (const w of tg.group.userData.wheels) w.rotation.x -= dt * ORBIT_SPEED * 1.5;
        }
      }
    }
  }

  // Returns the nearest *alive* target to a world position (horizontal dist).
  nearest(pos, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const dx = tg.group.position.x - pos.x;
      const dz = tg.group.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = tg; }
    }
    return best ? { target: best, dist: bd } : null;
  }

  // Pick the best target to line up a bombing run on. Unlike nearest(), this
  // only considers targets *ahead* of the bird (within a forward cone), beyond a
  // minimum distance, and — crucially for the ring — *within reach* (about one
  // ring-step). The maxDist cap is what keeps the bird flowing around the
  // circuit: without it, a target on the far side sits dead-ahead and the bird
  // darts straight across the middle; with it, only the next neighbour qualifies
  // so the path stays a clean orbit. If nothing's within reach we still turn the
  // short way toward the most head-on target ahead to re-acquire the ring, and
  // only as a last resort fall back to the global nearest.
  nearestAhead(pos, yaw, { maxAngle = Math.PI * 0.55, minDist = 14, maxDist = 55 } = {}) {
    let best = null, bestScore = Infinity, bestDist = 0;
    let reacquire = null, reAbs = Infinity, reDist = 0; // most head-on in-cone target, any distance
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const dx = tg.group.position.x - pos.x;
      const dz = tg.group.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < minDist) continue; // basically underneath / just passed
      // bearing of the target relative to the current heading, in [-PI, PI]
      const rel = Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw),
                             Math.cos(Math.atan2(dx, dz) - yaw));
      const a = Math.abs(rel);
      if (a > maxAngle) continue; // behind us / too far to the side
      if (a < reAbs) { reAbs = a; reacquire = tg; reDist = d; } // remember for re-acquire
      if (d > maxDist) continue; // don't commit across the ring — take the neighbour
      // Prefer closer and more head-on targets so we commit to one run.
      const score = d * (1 + a * 0.9);
      if (score < bestScore) { bestScore = score; best = tg; bestDist = d; }
    }
    if (best) return { target: best, dist: bestDist };
    if (reacquire) return { target: reacquire, dist: reDist };
    return this.nearest(pos);
  }

  kill(tg) {
    tg.alive = false;
    tg.dying = 0;
    if (tg.bullseye) tg.bullseye.visible = false;
  }
}
