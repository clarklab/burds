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

// A flat low-poly polygon (fan-triangulated) from a list of [x,y,z] points —
// handy for wings and tails. Double-sided so it reads from above and below.
function poly(points, color) {
  const geo = new THREE.BufferGeometry();
  const v = [];
  for (let i = 1; i < points.length - 1; i++) {
    v.push(...points[0], ...points[i], ...points[i + 1]);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(color, { side: THREE.DoubleSide }));
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

  const bodyColor = 0xf7f7fb;   // clean gull white
  const tipColor = 0x2b2b30;    // near-black wingtips
  const beakColor = 0xffa322;   // orange beak/feet

  // Body: a faceted low-poly torpedo (sleek, not a fat oval). Faceted via flat
  // shading on a 0-subdivision icosahedron.
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0), mat(bodyColor));
  body.scale.set(0.7, 0.74, 1.8);
  body.castShadow = true;
  g.add(body);

  // Fuller breast up front so the chest reads round, tapering to a slim tail.
  const breast = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), mat(bodyColor));
  breast.scale.set(0.82, 0.82, 1.05);
  breast.position.set(0, -0.08, -0.75);
  breast.castShadow = true;
  g.add(breast);

  // Small rounded head set forward and slightly raised.
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(bodyColor));
  head.position.set(0, 0.5, -1.42);
  head.castShadow = true;
  g.add(head);

  // Short orange beak pointing forward (-Z).
  const beak = cone(0.15, 0.52, beakColor, 5);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.46, -1.92);
  g.add(beak);

  // Eyes.
  for (const sx of [-1, 1]) {
    const eye = sphere(0.08, 0x14140f, 5);
    eye.position.set(0.21 * sx, 0.58, -1.56);
    g.add(eye);
  }

  // Pointed delta tail (white) with a dark tip, drooping slightly.
  g.add(poly([[-0.34, 0.12, 1.4], [0.34, 0.12, 1.4], [0, 0.0, 2.55]], bodyColor));
  g.add(poly([[-0.17, 0.05, 2.0], [0.17, 0.05, 2.0], [0, 0.0, 2.6]], tipColor));

  // Tucked orange feet under the rear.
  for (const sx of [-1, 1]) {
    const foot = box(0.16, 0.09, 0.5, beakColor, 0.16 * sx, -0.48, 0.55);
    foot.rotation.x = 0.25;
    g.add(foot);
  }

  // ---- Wings: a two-bone rig per side (shoulder + elbow) so the long gull wing
  // bends and the tip whips on the downstroke — white inner, black pointed tip.
  const wings = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.32 * sx, 0.16, -0.12);

    // inner wing (white): root -> elbow, swept gently back
    const inner = poly([
      [0.0 * sx, 0, -0.42],
      [1.75 * sx, 0, -0.16],
      [1.75 * sx, 0, 0.52],
      [0.05 * sx, 0, 0.8],
    ], bodyColor);
    shoulder.add(inner);

    // elbow joint at the mid of the wing
    const elbow = new THREE.Group();
    elbow.position.set(1.75 * sx, 0, 0.14);

    // outer wing tip (black): elbow -> a single swept-back point
    const outer = poly([
      [0.0 * sx, 0, -0.34],
      [1.4 * sx, 0, 0.5],
      [0.0 * sx, 0, 0.34],
    ], tipColor);
    elbow.add(outer);
    shoulder.add(elbow);

    g.add(shoulder);
    wings.push({ shoulder, elbow, side: sx });
  }

  g.scale.setScalar(1.0);

  // Flap: the shoulder sweeps the whole wing up/down while the elbow lags a beat
  // behind so the black tip trails and curls — a believable wingbeat, not a rigid
  // flap. Both wings stay symmetric (sign keyed off each side).
  function flap(t, intensity = 1) {
    const w = t * 9;
    const a = Math.sin(w) * 0.8 * intensity + 0.06;        // shoulder sweep
    const e = Math.sin(w - 1.0) * 0.55 * intensity + 0.05; // elbow lag/curl
    const fore = Math.cos(w) * 0.05;                        // slight fore-aft
    for (const wing of wings) {
      wing.shoulder.rotation.set(fore, 0, a * wing.side);
      wing.elbow.rotation.set(0, 0, e * wing.side);
    }
  }

  flap(0, 1);
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

// ---------------------------------------------------------------------------
// Croatia coastline flora: slender cypresses, umbrella pines, and seaside
// rocks — the look of the Dalmatian coast.
// ---------------------------------------------------------------------------

// Italian cypress: a tall, slender, dark-green column. The signature tree of
// the Adriatic coast.
export function buildCypress() {
  const g = new THREE.Group();
  const h = 6 + Math.random() * 3.5;
  const green = pick([0x2f5d3a, 0x27503a, 0x355f3d, 0x224a31]);
  const trunk = cyl(0.16, 0.24, h * 0.2, 0x6b4a2a, 6);
  trunk.position.y = h * 0.1;
  g.add(trunk);
  // a tall slender cone, with a thinner one stacked for a tapered tip
  const body = cone(0.72, h * 0.95, green, 8);
  body.position.y = h * 0.55;
  g.add(body);
  const tip = cone(0.42, h * 0.4, green, 7);
  tip.position.y = h * 0.92;
  g.add(tip);
  g.scale.setScalar(0.85 + Math.random() * 0.4);
  return g;
}

// Mediterranean stone pine: a bare trunk under a wide, flat umbrella canopy.
export function buildPine() {
  const g = new THREE.Group();
  const h = 5 + Math.random() * 2.5;
  const trunk = cyl(0.18, 0.32, h, 0x7a5230, 6);
  trunk.position.y = h / 2;
  trunk.rotation.z = (Math.random() - 0.5) * 0.12;
  g.add(trunk);
  const green = pick([0x3c7d4f, 0x356b46, 0x46915a, 0x2f6e44]);
  // wide flattened canopy built from a couple of squashed domes
  const canopy = sphere(2.5, green, 8); canopy.scale.set(1, 0.38, 1); canopy.position.y = h + 0.25;
  g.add(canopy);
  const c2 = sphere(1.7, green, 7); c2.scale.set(1, 0.5, 1);
  c2.position.set((Math.random() - 0.5) * 1.4, h + 0.7, (Math.random() - 0.5) * 1.4);
  g.add(c2);
  g.scale.setScalar(0.9 + Math.random() * 0.4);
  return g;
}

// A cluster of low-poly seaside boulders.
export function buildRock() {
  const g = new THREE.Group();
  const grays = [0x8a8d92, 0x9a9690, 0x7c7f84, 0xa6a29a, 0x6f7378];
  const n = 1 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const r = 0.6 + Math.random() * 1.5;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(pick(grays)));
    rock.position.set((Math.random() - 0.5) * 2.4, r * 0.42, (Math.random() - 0.5) * 2.4);
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    rock.scale.y = 0.65 + Math.random() * 0.3;
    rock.castShadow = true; rock.receiveShadow = true;
    g.add(rock);
  }
  return g;
}

// ---------------------------------------------------------------------------
// THE SUPER TURD: a rare, golden, glowing pickup. Bombing it triggers SUPER
// TURD MODE. Built to read as obviously special — gold poop swirl on a glowing
// pad, a spinning halo and floating sparkles.
// ---------------------------------------------------------------------------
export function buildSuperTurd() {
  const g = new THREE.Group();
  const gold1 = 0xffc107, gold2 = 0xffb300, gold3 = 0xffe082;

  // glowing ground pad
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe24a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  );
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.06;
  g.add(pad);

  // golden poop swirl (a fancier, bigger buildPoop)
  const s1 = sphere(0.62, gold1, 8); s1.position.y = 0.55; s1.scale.set(1.25, 0.7, 1.25); g.add(s1);
  const s2 = sphere(0.48, gold2, 8); s2.position.y = 1.0; s2.scale.set(1, 0.75, 1); g.add(s2);
  const s3 = sphere(0.32, gold3, 8); s3.position.y = 1.4; g.add(s3);
  const tip = cone(0.2, 0.55, gold2, 7); tip.position.y = 1.85; g.add(tip);

  // spinning halo
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.35, 0.09, 8, 22),
    new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  halo.rotation.x = Math.PI / 2; halo.position.y = 1.05;
  g.add(halo);

  // floating sparkles
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    spark.position.set(Math.cos(a) * 1.6, 0.9 + Math.sin(a * 2) * 0.4, Math.sin(a) * 1.6);
    g.add(spark);
  }

  g.userData.headHeight = 2.4;
  g.userData.halo = halo;
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

// A flaming-comet projectile for TURD FIRE mode: a molten core wrapped in an
// additive glow, with a tail cone (the comet streak is filled in by trailing
// embers spawned each frame).
export function buildFireball() {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xff2b00, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const mid = new THREE.Mesh(new THREE.SphereGeometry(0.55, 9, 9), new THREE.MeshBasicMaterial({ color: 0xff7a18 }));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.3, 7),
    new THREE.MeshBasicMaterial({ color: 0xff5a00, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  tail.position.y = 0.85; // points up = trails behind the falling comet
  g.add(glow, mid, core, tail);
  g.userData.spinnable = [core, mid];
  return g;
}

// ===========================================================================
// WEDDING + ROCK CONCERT cast & props.
//
// These deliberately lean on the SAME low-poly primitives and the SAME
// SKIN / SHIRTS palettes as the beach folk, so the crowds match the rest of
// the game's art. Crowd figures are kept lightweight (few meshes) because the
// venues pack dozens of them in tight rows.
// ===========================================================================

const HAIR = [0x2a1a0a, 0x4a3120, 0x1a1a1a, 0x6b4a2a, 0xc4a35a, 0x8a8a8a];
const WED_PANTS = [0x394a59, 0x2a2a3a, 0x5a4a6a, 0x6a3a3a, 0x335a45];

// A wedding guest sitting on a folding chair, facing -Z (toward the altar).
export function buildSeatedGuest({ shirt = pick(SHIRTS), skin = pick(SKIN), pants = pick(WED_PANTS), chair = 0xe8e0d2 } = {}) {
  const g = new THREE.Group();
  const seatY = 0.55;
  g.add(box(0.64, 0.1, 0.58, chair, 0, seatY, 0));            // seat
  g.add(box(0.64, 0.6, 0.1, chair, 0, seatY + 0.35, 0.26));   // backrest
  g.add(box(0.6, seatY, 0.1, chair, 0, seatY / 2, 0.24));     // back legs
  g.add(box(0.6, seatY, 0.1, chair, 0, seatY / 2, -0.24));    // front legs
  g.add(box(0.54, 0.22, 0.44, pants, 0, seatY + 0.16, -0.1)); // thighs
  g.add(box(0.44, 0.5, 0.22, pants, 0, seatY - 0.15, -0.32)); // shins
  g.add(box(0.72, 0.78, 0.44, shirt, 0, seatY + 0.62, 0.04)); // torso
  g.add(box(0.5, 0.48, 0.46, skin, 0, seatY + 1.2, 0.04));    // head
  g.add(box(0.54, 0.2, 0.5, pick(HAIR), 0, seatY + 1.42, 0.06)); // hair
  g.userData.headHeight = seatY + 1.52;
  return g;
}

// The groom: dark suit, white shirt front, bowtie + boutonniere.
export function buildGroom() {
  const suit = pick([0x2b2b3a, 0x1c1c28, 0x33333f]);
  const g = buildPerson({ scale: 1.0, shirt: suit, pants: suit, skin: pick(SKIN) });
  g.add(box(0.34, 0.7, 0.12, 0xffffff, 0, 1.6, -0.26)); // shirt front
  g.add(box(0.22, 0.1, 0.1, 0x111111, 0, 1.72, -0.32)); // bowtie
  g.add(sphere(0.1, 0xff5d8f, 6).translateX(0.3).translateY(1.7).translateZ(-0.26)); // boutonniere
  return g;
}

// The bride: white gown (cone skirt), veil, bouquet.
export function buildBride() {
  const white = 0xffffff;
  const g = buildPerson({ scale: 1.0, shirt: white, pants: white, skin: pick(SKIN) });
  const skirt = cone(0.85, 1.3, white, 12); skirt.position.y = 0.78; g.add(skirt);
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 1.2), mat(0xffffff, { transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  veil.position.set(0, 2.05, 0.34); g.add(veil);
  for (let i = 0; i < 6; i++) {
    g.add(sphere(0.11, pick([0xff8fab, 0xffd1dc, 0xffffff, 0xffe066]), 6)
      .translateX(0.5 + (Math.random() - 0.5) * 0.3).translateY(1.3 + (Math.random() - 0.5) * 0.3).translateZ(-0.3));
  }
  g.userData.headHeight = 2.75;
  return g;
}

// The priest: dark cassock + white collar, holding a book.
export function buildPriest() {
  const robe = 0x1c1c22;
  const g = buildPerson({ scale: 1.0, shirt: robe, pants: robe, skin: pick(SKIN) });
  const cassock = cone(0.7, 1.4, robe, 10); cassock.position.y = 0.78; g.add(cassock);
  g.add(box(0.4, 0.16, 0.12, 0xffffff, 0, 1.96, -0.27)); // collar
  g.add(box(0.3, 0.4, 0.1, 0x7a2d2d, 0.42, 1.4, -0.3));  // book
  g.userData.headHeight = 2.75;
  return g;
}

// A rock band member. role: 'mic' | 'guitar' | 'bass' | 'drums'.
export function buildBandMember(role = 'guitar') {
  const shirt = pick([0x1a1a1a, 0x2a2a3a, 0x4a1f2f, 0x1f2f4a, 0x3a1f4a]);
  const g = buildPerson({ scale: 1.0, shirt, pants: 0x14141a, skin: pick(SKIN) });
  if (role === 'drums') {
    const kit = new THREE.Group();
    for (const [dx, dz, r, c] of [[-0.95, 0.95, 0.42, 0xcc2222], [0, 1.05, 0.5, 0xeeeeee], [0.95, 0.95, 0.42, 0x2266cc]]) {
      const drum = cyl(r, r, 0.42, c, 12); drum.position.set(dx, 1.0, dz); kit.add(drum);
    }
    const cym = cyl(0.5, 0.5, 0.04, 0xd4af37, 14); cym.position.set(1.2, 1.7, 0.5); kit.add(cym);
    g.add(kit);
  } else if (role === 'mic') {
    const stand = cyl(0.04, 0.04, 1.7, 0x222222, 6); stand.position.set(0, 0.85, -0.55); g.add(stand);
    g.add(sphere(0.12, 0x333333, 7).translateY(1.8).translateZ(-0.55));
  } else {
    const body = box(0.5, 0.74, 0.16, role === 'bass' ? 0x202024 : 0xcc3322, 0.32, 1.2, -0.32);
    body.rotation.z = 0.5; g.add(body);
    const neck = box(0.12, 1.2, 0.1, 0x6b4a2a, -0.22, 1.5, -0.32);
    neck.rotation.z = 0.5; g.add(neck);
  }
  g.userData.headHeight = 2.75;
  return g;
}

// A standing concert-goer in the throng (reuses the beach person model).
export function buildFan() {
  return buildPerson({ scale: 0.95, shirt: pick(SHIRTS), skin: pick(SKIN), pants: pick([0x222228, 0x394a59, 0x14141a, 0x4a2f3a]) });
}

// ---- decor props (no targets) -------------------------------------------

// A flower-garlanded wedding arch at the head of the aisle.
export function buildArch() {
  const g = new THREE.Group();
  const white = 0xf7f4ef;
  const blooms = [0xff8fab, 0xffd1dc, 0xffffff, 0xffe066, 0x9d7bd8, 0xa6e3a1];
  for (const sx of [-1, 1]) {
    const post = cyl(0.16, 0.2, 5, white, 8); post.position.set(sx * 3.2, 2.5, 0); g.add(post);
    for (let i = 0; i < 6; i++) {
      g.add(sphere(0.2, pick(blooms), 6).translateX(sx * 3.2).translateY(0.7 + i * 0.8).translateZ(0));
    }
  }
  g.add(box(7.2, 0.3, 0.3, white, 0, 5, 0)); // top beam
  for (let i = 0; i < 22; i++) {
    const x = (-1 + 2 * (i / 21)) * 3.4;
    g.add(sphere(0.16 + Math.random() * 0.12, pick(blooms), 6).translateX(x).translateY(5).translateZ(0));
  }
  return g;
}

// A pedestal of flowers lining the aisle.
export function buildFlowerStand() {
  const g = new THREE.Group();
  const blooms = [0xff8fab, 0xffd1dc, 0xffffff, 0xffe066, 0x9d7bd8, 0xa6e3a1];
  const pole = cyl(0.06, 0.09, 1.4, 0xf0e9dd, 6); pole.position.y = 0.7; g.add(pole);
  const bowl = cyl(0.3, 0.18, 0.3, 0xf0e9dd, 8); bowl.position.y = 1.45; g.add(bowl);
  for (let i = 0; i < 9; i++) {
    g.add(sphere(0.16, pick(blooms), 6)
      .translateX((Math.random() - 0.5) * 0.5).translateY(1.6 + Math.random() * 0.3).translateZ((Math.random() - 0.5) * 0.5));
  }
  return g;
}

// The concert stage: a raised deck, backdrop, lighting truss and colored lamps.
export function buildStage(width = 30, depth = 12) {
  const g = new THREE.Group();
  g.add(box(width, 1.6, depth, 0x1a1a1f, 0, 0.8, 0));            // deck
  g.add(box(width, 0.2, depth, 0x35353d, 0, 1.7, 0));           // surface
  g.add(box(width, 9, 0.6, 0x101015, 0, 5, -depth / 2));        // backdrop
  g.add(box(width * 0.5, 3, 0.2, 0x6a1b2a, 0, 6, -depth / 2 + 0.4)); // banner
  for (const sx of [-1, 1]) g.add(box(0.4, 9, 0.4, 0x2a2a30, sx * (width / 2 - 0.5), 5, -depth / 2 + 0.5));
  g.add(box(width, 0.4, 0.4, 0x2a2a30, 0, 9.2, -depth / 2 + 0.5)); // top truss
  const lamps = [];
  for (let i = 0; i < 6; i++) {
    const c = [0xff3b6b, 0x3bdcff, 0xffe24a, 0x8a5bff, 0x4dff88, 0xff8a1e][i];
    const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 8), new THREE.MeshBasicMaterial({ color: c }));
    lamp.position.set(-width / 2 + 2.5 + i * (width - 5) / 5, 8.7, -depth / 2 + 0.8);
    lamp.rotation.x = Math.PI;
    g.add(lamp);
    lamps.push(lamp);
  }
  g.userData.lamps = lamps;
  return g;
}

// A stack of PA speakers flanking the stage.
export function buildSpeakerStack() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const y = 1.1 + i * 2.2;
    g.add(box(2.4, 2.2, 2.0, 0x0d0d10, 0, y, 0));
    const c1 = cyl(0.5, 0.7, 0.3, 0x1a1a1f, 12); c1.rotation.x = Math.PI / 2; c1.position.set(0, y + 0.4, 1.0); g.add(c1);
    const c2 = cyl(0.32, 0.46, 0.3, 0x1a1a1f, 12); c2.rotation.x = Math.PI / 2; c2.position.set(0, y - 0.5, 1.0); g.add(c2);
  }
  return g;
}

// A crowd-barrier rail segment running along Z.
export function buildBarrier(len = 10) {
  const g = new THREE.Group();
  g.add(box(0.15, 0.15, len, 0x3a3a42, 0, 1.0, 0));
  g.add(box(0.15, 0.15, len, 0x3a3a42, 0, 0.55, 0));
  const n = Math.max(2, Math.round(len / 2.5));
  for (let i = 0; i <= n; i++) g.add(box(0.12, 1.1, 0.12, 0x4a4a52, 0, 0.55, -len / 2 + i * (len / n)));
  return g;
}

export { SHIRTS, SKIN };
