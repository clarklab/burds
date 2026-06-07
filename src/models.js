import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Low-poly procedural model builders. Everything is built from primitives with
// flat shading so it gets that faceted, papercraft look without any external
// asset files (no FBX/OBJ to download or break).
// ---------------------------------------------------------------------------

const mats = new Map();
// Cached flat-shaded materials keyed by color so we don't make thousands.
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  mats.set(key, m);
  return m;
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, color, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.castShadow = true;
  return m;
}
function sphere(r, color, seg = 8) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat(color));
  m.castShadow = true;
  return m;
}
function cone(r, h, color, seg = 8) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color));
  m.castShadow = true;
  return m;
}

const SKIN = [0xf2c9a0, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac];
const SHIRTS = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x6a8eff, 0xa06bff, 0xff9f1c, 0x2ec4b6, 0xff5d8f];
const pick = (a) => a[(Math.random() * a.length) | 0];

// ---------------------------------------------------------------------------
// THE STAR: the seagull the player controls.
// Returns { group, flap(t), bank(angle) } so main can animate it.
// ---------------------------------------------------------------------------
export function buildSeagull() {
  const g = new THREE.Group();

  const bodyColor = 0xf7f7fb;
  const body = sphere(1, bodyColor, 10);
  body.scale.set(1.1, 0.95, 1.7);
  g.add(body);

  // tail
  const tail = box(0.9, 0.18, 0.9, bodyColor, 0, 0.1, 1.5);
  tail.rotation.x = -0.25;
  g.add(tail);
  const tailTip = box(0.9, 0.16, 0.5, 0x444450, 0, 0.04, 2.0);
  tailTip.rotation.x = -0.25;
  g.add(tailTip);

  // neck + head
  const head = sphere(0.62, bodyColor, 10);
  head.position.set(0, 0.55, -1.45);
  g.add(head);

  // beak
  const beak = cone(0.22, 0.7, 0xffa726, 6);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.5, -2.05);
  g.add(beak);

  // eyes
  for (const sx of [-1, 1]) {
    const eye = sphere(0.12, 0x1a1a1a, 6);
    eye.position.set(0.28 * sx, 0.72, -1.78);
    g.add(eye);
  }

  // wings — pivot groups so they can flap around the shoulder
  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.55 * sx, 0.25, -0.1);
    const inner = box(2.2, 0.14, 1.5, bodyColor, 1.1 * sx, 0, 0);
    const tip = box(1.6, 0.12, 0.9, 0x3a3a44, 2.6 * sx, -0.05, 0.15);
    pivot.add(inner, tip);
    g.add(pivot);
    wings.push({ pivot, side: sx });
  }

  // gray back patch for that gull look
  const back = box(1.4, 0.2, 2.0, 0xaeb4c0, 0, 0.55, -0.1);
  back.rotation.x = 0.02;
  g.add(back);

  // legs (tucked) — little orange nubs
  for (const sx of [-1, 1]) {
    const leg = box(0.14, 0.5, 0.14, 0xffa726, 0.25 * sx, -0.75, 0.4);
    g.add(leg);
  }

  g.scale.setScalar(1.0);

  function flap(t, intensity = 1) {
    // t is seconds; flap speed scales a bit with intensity
    const a = Math.sin(t * 9) * 0.7 * intensity + 0.12;
    for (const w of wings) {
      w.pivot.rotation.z = -a * w.side;
      w.pivot.rotation.x = Math.cos(t * 9) * 0.08;
    }
  }

  return { group: g, flap, wings };
}

// ---------------------------------------------------------------------------
// A standing person (adult). scale param lets us make kids.
// ---------------------------------------------------------------------------
export function buildPerson({ scale = 1, shirt = pick(SHIRTS), skin = pick(SKIN), pants = 0x394a59 } = {}) {
  const g = new THREE.Group();
  const legH = 0.9;
  for (const sx of [-1, 1]) {
    g.add(box(0.34, legH, 0.34, pants, 0.22 * sx, legH / 2, 0));
  }
  const torso = box(0.95, 1.05, 0.55, shirt, 0, legH + 0.52, 0);
  g.add(torso);
  // arms
  for (const sx of [-1, 1]) {
    const arm = box(0.26, 0.95, 0.28, shirt, 0.62 * sx, legH + 0.55, 0);
    arm.rotation.z = 0.06 * sx;
    g.add(arm);
    g.add(box(0.24, 0.24, 0.26, skin, 0.66 * sx, legH + 0.08, 0)); // hand
  }
  const neck = box(0.26, 0.18, 0.26, skin, 0, legH + 1.12, 0);
  g.add(neck);
  const head = box(0.62, 0.62, 0.6, skin, 0, legH + 1.5, 0);
  g.add(head);
  // hair cap
  const hair = box(0.66, 0.26, 0.64, pick([0x2a1a0a, 0x4a3120, 0x1a1a1a, 0x6b4a2a, 0xc4a35a]), 0, legH + 1.78, 0);
  g.add(hair);

  g.scale.setScalar(scale);
  g.userData.headHeight = (legH + 1.85) * scale;
  return g;
}

export function buildKid() {
  const p = buildPerson({ scale: 0.62, shirt: pick(SHIRTS) });
  return p;
}

// ---------------------------------------------------------------------------
// Biker = person leaning forward on a bicycle. The whole thing rolls.
// ---------------------------------------------------------------------------
export function buildBiker() {
  const g = new THREE.Group();

  // bicycle
  const bike = new THREE.Group();
  const wheelGeo = new THREE.TorusGeometry(0.5, 0.08, 6, 14);
  const wheelMat = mat(0x222228);
  for (const wz of [-0.75, 0.75]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(0, 0.5, wz);
    w.castShadow = true;
    bike.add(w);
  }
  // frame
  const frameColor = pick([0xff4d4d, 0x33cc66, 0x3399ff, 0xffcc00]);
  const bar1 = cyl(0.05, 0.05, 1.3, frameColor); bar1.rotation.z = Math.PI / 2; bar1.position.set(0, 0.85, 0); bike.add(bar1);
  const bar2 = cyl(0.05, 0.05, 0.9, frameColor); bar2.position.set(0, 0.65, 0.4); bar2.rotation.x = 0.5; bike.add(bar2);
  const seat = box(0.3, 0.12, 0.18, 0x111111, 0, 1.0, 0.55); bike.add(seat);
  const handle = box(0.5, 0.1, 0.12, 0x111111, 0, 1.08, -0.7); bike.add(handle);
  g.add(bike);

  // rider, leaned forward
  const rider = buildPerson({ scale: 0.92, shirt: pick([0xff3b3b, 0x00b894, 0x0984e3, 0xfdcb6e]) });
  rider.position.set(0, 0.55, 0.1);
  rider.rotation.x = 0.45;
  g.add(rider);

  // helmet
  const helmet = box(0.66, 0.34, 0.62, pick(SHIRTS), 0, 2.55, -0.55);
  helmet.rotation.x = 0.45;
  g.add(helmet);

  g.userData.headHeight = 2.6;
  g.userData.wheels = bike.children.filter((c) => c.geometry === wheelGeo);
  return g;
}

// ---------------------------------------------------------------------------
// Picnic: checkered blanket + basket + food.
// ---------------------------------------------------------------------------
export function buildPicnic() {
  const g = new THREE.Group();
  const size = 3.4;
  // checkered blanket built from tiles
  const tiles = 6;
  const ts = size / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const c = (i + j) % 2 === 0 ? 0xff5b5b : 0xfff0f0;
      const t = box(ts, 0.06, ts, c, (i - tiles / 2 + 0.5) * ts, 0.03, (j - tiles / 2 + 0.5) * ts);
      t.receiveShadow = true;
      g.add(t);
    }
  }
  // basket
  const basket = cyl(0.5, 0.42, 0.5, 0x9c6b3f, 10);
  basket.position.set(-0.7, 0.28, -0.6);
  g.add(basket);
  g.add(box(0.95, 0.1, 0.5, 0xc98a4f, -0.7, 0.5, -0.6)); // lid handle area
  // food blobs
  g.add(sphere(0.28, 0xffcf3f, 6).translateX(0.7).translateY(0.25).translateZ(0.5)); // melon
  const cake = cyl(0.3, 0.3, 0.25, 0xfff5e1, 8); cake.position.set(0.9, 0.18, -0.5); g.add(cake);
  g.add(sphere(0.12, 0xff4d6d, 6).translateX(0.9).translateY(0.36).translateZ(-0.5));
  // bottle
  const bottle = cyl(0.1, 0.12, 0.6, 0x2ecc71, 7); bottle.position.set(0.1, 0.32, 0.9); g.add(bottle);

  g.userData.headHeight = 0.7;
  return g;
}

// ---------------------------------------------------------------------------
// Car (convertible-ish low poly). Rolls along the road.
// ---------------------------------------------------------------------------
export function buildCar() {
  const g = new THREE.Group();
  const color = pick([0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1, 0xe67e22]);
  const body = box(2.0, 0.7, 4.2, color, 0, 0.85, 0);
  g.add(body);
  const cabin = box(1.8, 0.7, 2.0, 0x222831, 0, 1.45, -0.2);
  g.add(cabin);
  // windshield hint
  g.add(box(1.7, 0.5, 0.12, 0x9bd1ff, 0, 1.5, 0.85));
  // wheels
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 10);
  for (const sx of [-1, 1]) {
    for (const sz of [-1.3, 1.3]) {
      const w = new THREE.Mesh(wheelGeo, mat(0x1a1a1a));
      w.rotation.z = Math.PI / 2;
      w.position.set(1.0 * sx, 0.45, sz);
      w.castShadow = true;
      g.add(w);
      wheels.push(w);
    }
  }
  // headlights
  for (const sx of [-1, 1]) g.add(box(0.3, 0.2, 0.1, 0xffffcc, 0.6 * sx, 0.85, 2.1));
  g.userData.headHeight = 1.9;
  g.userData.wheels = wheels;
  return g;
}

// A beach umbrella (decoration, no target).
export function buildUmbrella() {
  const g = new THREE.Group();
  const pole = cyl(0.06, 0.06, 3, 0xdddddd, 6);
  pole.position.y = 1.5;
  g.add(pole);
  const canopyColor = pick([0xff5b5b, 0x2ecc71, 0x3498db, 0xf1c40f, 0xff8fab]);
  const canopy = cone(2.0, 0.9, canopyColor, 10);
  canopy.position.y = 3.1;
  g.add(canopy);
  // stripes
  const c2 = cone(1.4, 0.65, 0xffffff, 10);
  c2.position.y = 3.25;
  c2.scale.y = 0.6;
  g.add(c2);
  return g;
}

// Palm tree.
export function buildPalm() {
  const g = new THREE.Group();
  const h = 5 + Math.random() * 2;
  const trunk = cyl(0.22, 0.4, h, 0x9c6b3f, 7);
  trunk.position.y = h / 2;
  trunk.rotation.z = (Math.random() - 0.5) * 0.25;
  g.add(trunk);
  const top = trunk.position.clone();
  top.y = h;
  for (let i = 0; i < 7; i++) {
    const leaf = box(2.6, 0.12, 0.9, pick([0x2ecc71, 0x27ae60, 0x57d68d]), 0, 0, 0);
    leaf.geometry.translate(1.3, 0, 0);
    leaf.position.set(0, h, 0);
    leaf.rotation.y = (i / 7) * Math.PI * 2;
    leaf.rotation.z = -0.35 - Math.random() * 0.15;
    g.add(leaf);
  }
  // coconuts
  for (let i = 0; i < 3; i++) g.add(sphere(0.22, 0x5b3a1a, 6).translateX((Math.random()-0.5)*0.6).translateY(h-0.3).translateZ((Math.random()-0.5)*0.6));
  return g;
}

// A poop projectile mesh.
export function buildPoop() {
  const g = new THREE.Group();
  const s1 = sphere(0.42, 0x7a5230, 7); s1.position.y = -0.1; s1.scale.set(1.2, 0.7, 1.2);
  const s2 = sphere(0.32, 0x6b4626, 7); s2.position.y = 0.18; s2.scale.set(1, 0.75, 1);
  const s3 = sphere(0.2, 0x5e3c1f, 7); s3.position.y = 0.42;
  const tip = cone(0.12, 0.3, 0x5e3c1f, 6); tip.position.y = 0.68;
  g.add(s1, s2, s3, tip);
  g.userData.spinnable = [s1, s2, s3, tip];
  return g;
}

export { SHIRTS, SKIN };
