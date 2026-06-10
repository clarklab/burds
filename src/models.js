import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural model builders, PS2-era style: smooth-shaded rounded bodies
// (capsules, lathes, spheres) wearing canvas-painted textures, gouraud-lit.
// Still zero external asset files — every texture is drawn to a canvas at
// runtime, so the game stays a fully-offline, no-build PWA.
// ---------------------------------------------------------------------------

const mats = new Map();
// Cached smooth-shaded materials keyed by color. (Polyhedron primitives like
// the rocks' dodecahedrons are non-indexed, so they keep their faceted look
// automatically; spheres/capsules/cylinders now shade smooth.)
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshLambertMaterial({ color, ...opts });
  mats.set(key, m);
  return m;
}

// Draw a texture to an offscreen canvas. The workhorse behind every "painted"
// surface in the game — cloth, wood, water sparkle, glows.
export function makeCanvasTexture(size, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = opts.w || size;
  c.height = opts.h || size;
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  return t;
}

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
// Lighten/darken a hex color by k (-1..1) for painted shading.
function shade(c, k) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

// Cached cloth materials: a base color with a painted pattern (solid weave,
// hoops, dots) plus a baked vertical shade gradient — the PS2 "textured
// gouraud" look. Bounded key space, shared across the whole crowd.
const cloths = new Map();
function clothMat(color, pattern = 'solid') {
  const key = color + ':' + pattern;
  if (cloths.has(key)) return cloths.get(key);
  const tex = makeCanvasTexture(64, (ctx, w, h) => {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, w, h);
    // soft weave noise
    ctx.fillStyle = hex(shade(color, 0.12));
    for (let i = 0; i < 90; i++) ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 1);
    ctx.fillStyle = hex(shade(color, -0.12));
    for (let i = 0; i < 90; i++) ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 1);
    if (pattern === 'hoops') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let y = 4; y < h; y += 16) ctx.fillRect(0, y, w, 6);
    } else if (pattern === 'dots') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let y = 6; y < h; y += 14) for (let x = ((y / 14) | 0) % 2 ? 4 : 11; x < w; x += 14) {
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill();
      }
    }
    // baked top-light / bottom-shade gradient (fake AO)
    const gr = ctx.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.16)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
  });
  const m = new THREE.MeshLambertMaterial({ map: tex });
  cloths.set(key, m);
  return m;
}
const CLOTH_PATTERNS = ['solid', 'solid', 'hoops', 'dots'];

// Cached primitive geometries. The crowds stamp out hundreds of identically
// sized parts (126 fans share one torso geometry, etc.), so sharing the
// buffers is a big GPU-memory and upload win on phones. Keys quantize to 3
// decimals; never mutate a geometry returned from these helpers.
const geos = new Map();
function geo(kind, ...args) {
  const key = kind + ':' + args.map((a) => (+a).toFixed(3)).join(',');
  if (!geos.has(key)) {
    const G = { box: THREE.BoxGeometry, cyl: THREE.CylinderGeometry, sphere: THREE.SphereGeometry, cone: THREE.ConeGeometry, capsule: THREE.CapsuleGeometry }[kind];
    geos.set(key, new G(...args));
  }
  return geos.get(key);
}

// Freeze every static mesh in a subtree: stop per-frame local-matrix composes
// for parts that never move relative to their parent (groups stay dynamic, so
// rigs — arm pivots, wheels via `skip` — keep animating). With ~1500 crowd
// meshes in a venue this trims real per-frame CPU on phones. Call it LAST in
// a builder, after every mesh transform is final.
function freeze(root, skip = null) {
  root.traverse((o) => {
    if (o.isMesh && (!skip || !skip.includes(o))) { o.matrixAutoUpdate = false; o.updateMatrix(); }
  });
  return root;
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo('box', w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, color, seg = 8) {
  const m = new THREE.Mesh(geo('cyl', rt, rb, h, seg), mat(color));
  m.castShadow = true;
  return m;
}
function sphere(r, color, seg = 8) {
  const m = new THREE.Mesh(geo('sphere', r, seg, seg), mat(color));
  m.castShadow = true;
  return m;
}
function cone(r, h, color, seg = 8) {
  const m = new THREE.Mesh(geo('cone', r, h, seg), mat(color));
  m.castShadow = true;
  return m;
}
// A rounded capsule limb/body segment — `len` is the straight middle section;
// total height = len + 2r. `material` may be a color or a Material (cloth).
function capsule(r, len, material, x = 0, y = 0, z = 0, radial = 8) {
  const m = new THREE.Mesh(
    geo('capsule', r, len, 3, radial),
    material && material.isMaterial ? material : mat(material),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
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
const HAIR = [0x2a1a0a, 0x4a3120, 0x1a1a1a, 0x6b4a2a, 0xc4a35a, 0x8a8a8a];
const HATS = [0xfff3d6, 0xff6b6b, 0x4ecdc4, 0xffe66d, 0xf7f7fb, 0x6a8eff, 0xff9f1c];
const pick = (a) => a[(Math.random() * a.length) | 0];

// ---------------------------------------------------------------------------
// Faces. A character's face is a single textured plane stuck on the front of
// the head: one shared "normal" expression and a handful of "shocked" ones.
// The textures + materials are built once and shared across every character
// (the concert packs ~125 of them), so a face costs one extra mesh and an
// expression swap is just `plane.material = …`. buildFace() returns
// { setShocked } and is reusable on any boxy-headed model.
// ---------------------------------------------------------------------------
function drawFace(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
const ink = (ctx) => { ctx.fillStyle = '#15110f'; ctx.strokeStyle = '#15110f'; };
const dot = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
const oval = (ctx, x, y, rx, ry, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); };
const brows = (ctx, raise) => {
  ctx.lineWidth = 7; ink(ctx);
  ctx.beginPath(); ctx.moveTo(30, 34 + raise); ctx.lineTo(54, 26); ctx.stroke();   // \ over left eye
  ctx.beginPath(); ctx.moveTo(98, 34 + raise); ctx.lineTo(74, 26); ctx.stroke();   // / over right eye
};
// neutral: two dot eyes + a small calm mouth
function faceNormal(ctx) {
  ink(ctx);
  dot(ctx, 46, 52, 6.5); dot(ctx, 82, 52, 6.5);
  ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(54, 84); ctx.lineTo(74, 84); ctx.stroke();
}
// five distinct "about to get splatted" expressions
const SHOCKED = [
  // 0 — round O-face
  (ctx) => {
    oval(ctx, 46, 50, 16, 16, '#fff'); oval(ctx, 82, 50, 16, 16, '#fff');
    ink(ctx); dot(ctx, 46, 51, 7.5); dot(ctx, 82, 51, 7.5);
    oval(ctx, 64, 92, 11, 15, '#3a1216');
  },
  // 1 — square scream, eyebrows + teeth
  (ctx) => {
    brows(ctx, 4);
    oval(ctx, 46, 54, 14, 14, '#fff'); oval(ctx, 82, 54, 14, 14, '#fff');
    ink(ctx); dot(ctx, 46, 56, 6); dot(ctx, 82, 56, 6);
    ctx.fillStyle = '#3a1216'; ctx.fillRect(44, 78, 40, 30);
    ctx.fillStyle = '#fff'; ctx.fillRect(44, 78, 40, 6);
  },
  // 2 — tall gasp
  (ctx) => {
    oval(ctx, 46, 50, 15, 15, '#fff'); oval(ctx, 82, 50, 15, 15, '#fff');
    ink(ctx); dot(ctx, 46, 51, 6.5); dot(ctx, 82, 51, 6.5);
    oval(ctx, 64, 94, 9, 18, '#3a1216');
  },
  // 3 — saucer eyes, tiny pupils up
  (ctx) => {
    oval(ctx, 46, 50, 20, 20, '#fff'); oval(ctx, 82, 50, 20, 20, '#fff');
    ink(ctx); dot(ctx, 46, 44, 5); dot(ctx, 82, 44, 5);
    oval(ctx, 64, 90, 8, 10, '#3a1216');
  },
  // 4 — wide brows + oval howl
  (ctx) => {
    brows(ctx, 0);
    oval(ctx, 46, 54, 14, 14, '#fff'); oval(ctx, 82, 54, 14, 14, '#fff');
    ink(ctx); dot(ctx, 46, 55, 6); dot(ctx, 82, 55, 6);
    oval(ctx, 64, 92, 18, 11, '#3a1216');
  },
];

let FACE_MATS = null;
function faceMaterials() {
  if (FACE_MATS) return FACE_MATS;
  const make = (draw) => new THREE.MeshBasicMaterial({ map: drawFace(draw), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  FACE_MATS = { normal: make(faceNormal), shocked: SHOCKED.map(make) };
  return FACE_MATS;
}

// Stick a face on the front (-Z) of a head mesh. `z` is the plane's local
// offset to sit just proud of the face; `w`/`h` size it to the head. Returns a
// controller whose setShocked(true) swaps to a random shocked expression.
export function buildFace(head, { w = 0.58, h = 0.58, z = -0.31 } = {}) {
  const M = faceMaterials();
  const variant = (Math.random() * M.shocked.length) | 0;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.normal);
  plane.position.set(0, 0.02, z);
  plane.rotation.y = Math.PI;          // face outward (-Z), texture upright
  plane.castShadow = false; plane.receiveShadow = false;
  plane.matrixAutoUpdate = false; plane.updateMatrix();
  head.add(plane);
  return { setShocked(on) { plane.material = on ? M.shocked[variant] : M.normal; } };
}

// ---------------------------------------------------------------------------
// THE STAR: the seagull the player controls.
// Returns { group, flap(t), bank(angle) } so main can animate it.
// ---------------------------------------------------------------------------
export function buildSeagull() {
  const g = new THREE.Group();

  const bodyColor = 0xf7f7fb;   // clean gull white
  const mantle = 0xc9ced6;      // pale gray saddle across the back (real gulls!)
  const tipColor = 0x2b2b30;    // near-black wingtips
  const beakColor = 0xffa322;   // orange beak/feet

  // Body: a smooth lathe-turned torpedo with a full chest tapering to the
  // tail — an actual gull silhouette, gouraud-shaded.
  const profile = [
    [0.02, -1.65], [0.2, -1.25], [0.4, -0.62], [0.58, 0.0],
    [0.66, 0.52], [0.63, 0.95], [0.46, 1.25], [0.2, 1.45], [0.02, 1.52],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), mat(bodyColor));
  body.rotation.x = -Math.PI / 2;     // lathe axis (+Y) becomes forward (-Z)
  body.scale.set(0.95, 1, 0.96);
  body.position.y = 0.05;
  body.castShadow = true;
  g.add(body);

  // Gray mantle laid over the back so the bird reads "seagull", not "dove".
  const saddle = sphere(0.62, mantle, 10);
  saddle.scale.set(0.78, 0.5, 1.85);
  saddle.position.set(0, 0.34, 0.12);
  g.add(saddle);

  // Neck flowing up from the chest to a smooth round head set forward.
  const neck = capsule(0.24, 0.3, bodyColor, 0, 0.22, -1.1, 10);
  neck.rotation.x = 0.55;
  g.add(neck);
  const head = sphere(0.38, bodyColor, 12);
  head.scale.set(0.92, 0.95, 1.1);
  head.position.set(0, 0.5, -1.45);
  g.add(head);

  // Short orange beak pointing forward (-Z), with the herring gull's red spot.
  const beak = cone(0.15, 0.52, beakColor, 5);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.46, -1.92);
  g.add(beak);
  const spot = sphere(0.045, 0xd62828, 5);
  spot.position.set(0, 0.38, -1.98);
  g.add(spot);

  // Eyes.
  for (const sx of [-1, 1]) {
    const eye = sphere(0.08, 0x14140f, 5);
    eye.position.set(0.21 * sx, 0.58, -1.56);
    g.add(eye);
  }

  // Pointed delta tail (white) with a dark tip, drooping slightly. Grouped so
  // it can flutter gently with the wingbeat.
  const tail = new THREE.Group();
  tail.add(poly([[-0.34, 0.12, 1.4], [0.34, 0.12, 1.4], [0, 0.0, 2.55]], bodyColor));
  tail.add(poly([[-0.17, 0.05, 2.0], [0.17, 0.05, 2.0], [0, 0.0, 2.6]], tipColor));
  g.add(tail);

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
    // gray covert layer riding on top of the inner wing for feathered depth
    const covert = poly([
      [0.1 * sx, 0.02, -0.3],
      [1.5 * sx, 0.02, -0.08],
      [1.5 * sx, 0.02, 0.34],
      [0.12 * sx, 0.02, 0.55],
    ], mantle);
    shoulder.add(covert);

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
    // tail flutters a touch out of phase with the downstroke
    tail.rotation.x = Math.sin(w - 1.6) * 0.07 * intensity;
  }

  flap(0, 1);
  freeze(g);   // groups (shoulders/elbows/tail) stay live; meshes are static
  return { group: g, flap, wings };
}

// ---------------------------------------------------------------------------
// A standing person (adult). scale param lets us make kids. Arms are hinged at
// the shoulder (userData.arms) so they can swing while walking, pump at a gig,
// and fly up in panic when a turd bears down. The torso/arms/head hang from
// a waist pivot (userData.upper) so panic can also fold the body — every
// shock rolls a random pose: arms to the sky, hands clutching the face,
// duck-and-cover, or a sideways flinch.
//
// Options:
//   hat    — headwear by chance: true = random beach hat, 'cap'/'sun' = style
//   shoes  — add shoes + maybe swap pants for shorts (beach casual)
//   tank   — allow a sleeveless top by chance (off for suits/gowns)
//   jitter — per-person build variation (height/width); off for the biker,
//            whose helmet is fitted to an exact head height
// ---------------------------------------------------------------------------
export function buildPerson({ scale = 1, shirt = pick(SHIRTS), skin = pick(SKIN), pants = 0x394a59, hat = false, shoes = false, tank = true, jitter = true } = {}) {
  const g = new THREE.Group();
  const legH = 0.9;
  const formal = tank === false;
  const cloth = clothMat(shirt, formal ? 'solid' : pick(CLOTH_PATTERNS));
  const pantsM = clothMat(pants, 'solid');
  // sleeves: suits get full sleeves, beach tops are short-sleeved, and some
  // casual tops are sleeveless tanks
  const tankTop = !formal && Math.random() < 0.28;
  const upperArmM = tankTop ? mat(skin) : cloth;
  const foreArmM = formal ? cloth : mat(skin);
  const shorts = shoes && Math.random() < 0.45;

  // legs — hip-hinged groups (userData.legs) so they stride in the walk cycle
  const legs = [];
  const shoeC = pick([0xffffff, 0x2a2a30, 0xff6b6b, 0x6a8eff]);
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.22 * sx, legH + 0.05, 0);
    hip.add(capsule(0.17, 0.32, pantsM, 0, -0.27, 0));                       // thigh (or shorts)
    hip.add(capsule(0.135, 0.3, shorts ? skin : pantsM, 0, -0.64, 0.01));    // calf: bare if shorts
    const foot = sphere(0.16, shoes ? shoeC : skin, 7);
    foot.scale.set(1, 0.55, 1.55);
    foot.position.set(0, -0.92, -0.08);
    hip.add(foot);
    hip.userData.side = sx;
    g.add(hip);
    legs.push(hip);
  }

  // everything above the waist hangs from this pivot so panic can fold the
  // body (duck/flinch); add-on builders (suits, guitars…) attach here too
  const upper = new THREE.Group();
  upper.position.y = legH;
  g.add(upper);

  // torso: a rounded capsule wearing the painted cloth
  const torso = capsule(0.42, 0.42, cloth, 0, 0.54, 0, 10);
  torso.scale.set(1.12, 1, 0.62);
  upper.add(torso);

  // arms — shoulder pivots (userData.arms) with a baked elbow bend
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.6 * sx, 1.02, 0);
    shoulder.add(capsule(0.135, 0.3, upperArmM, 0, -0.22, 0));
    const fore = capsule(0.11, 0.28, foreArmM, 0.02 * sx, -0.62, -0.05);
    fore.rotation.x = 0.22;
    shoulder.add(fore);
    const hand = sphere(0.13, skin, 7);
    hand.position.set(0.03 * sx, -0.9, -0.12);
    shoulder.add(hand);
    shoulder.rotation.z = 0.08 * sx;
    shoulder.userData.side = sx;
    upper.add(shoulder);
    arms.push(shoulder);
  }

  // neck + smooth round head with the shared painted face
  upper.add(capsule(0.12, 0.12, skin, 0, 1.14, 0));
  const head = sphere(0.34, skin, 10);
  head.position.set(0, 1.5, 0);
  upper.add(head);
  const face = buildFace(head, { w: 0.5, h: 0.5, z: -0.33 });

  // hair: smooth crown + a long-back or top-bun variant for variety
  const hairC = pick(HAIR);
  const crown = sphere(0.365, hairC, 10);
  crown.scale.set(1.04, 0.78, 1.04);
  crown.position.set(0, 1.63, 0.05);
  upper.add(crown);
  const wearsHat = hat && Math.random() < 0.55;
  const hairStyle = Math.random();
  if (hairStyle < 0.25) {
    const back = sphere(0.3, hairC, 8);
    back.scale.set(1, 1.35, 0.6);
    back.position.set(0, 1.42, 0.27);
    upper.add(back);
  } else if (hairStyle < 0.37 && !wearsHat) {
    const bun = sphere(0.15, hairC, 7);
    bun.position.set(0, 1.9, 0.1);
    upper.add(bun);
  }
  // optional headwear (sun hat or baseball cap) for beachy variety
  if (wearsHat) {
    const style = hat === true ? (Math.random() < 0.5 ? 'sun' : 'cap') : hat;
    const hc = pick(HATS);
    if (style === 'sun') {
      const brim = cyl(0.58, 0.62, 0.06, hc, 14); brim.position.set(0, 1.74, 0); upper.add(brim);
      const dome = sphere(0.33, hc, 9); dome.scale.set(1.1, 0.65, 1.1); dome.position.set(0, 1.8, 0); upper.add(dome);
    } else {
      const capDome = sphere(0.36, hc, 9); capDome.scale.set(1.03, 0.66, 1.03); capDome.position.set(0, 1.7, 0.02); upper.add(capDome);
      const peak = sphere(0.24, hc, 8); peak.scale.set(1.3, 0.14, 1.5); peak.position.set(0, 1.72, -0.42); upper.add(peak);
    }
  }
  // panic: shocked face + a random full-body pose
  g.userData.arms = arms;
  g.userData.legs = legs;
  g.userData.upper = upper;
  g.userData.setShocked = (on) => {
    face.setShocked(on);
    if (!on) {
      for (const a of arms) a.rotation.set(0, 0, 0.08 * a.userData.side);
      upper.rotation.set(0, 0, 0);
      return;
    }
    const r = Math.random();
    if (r < 0.32) {
      // arms thrown to the sky
      for (const a of arms) a.rotation.set((Math.random() - 0.5) * 0.5, 0, a.userData.side * (2.3 + Math.random() * 0.45));
    } else if (r < 0.58) {
      // hands fly to the face (arms cross inward past vertical so the hands
      // land on the cheeks, head tipped slightly into them)
      for (const a of arms) a.rotation.set(-0.75 - Math.random() * 0.2, 0, a.userData.side * 3.45);
      upper.rotation.x = 0.14;
    } else if (r < 0.82) {
      // duck and cover: fold at the waist, arms wrapped over the head
      upper.rotation.x = 0.55 + Math.random() * 0.25;
      for (const a of arms) a.rotation.set(-1.1, 0, a.userData.side * 2.7);
    } else {
      // sideways flinch: one arm shields the face, the other flails skyward
      arms[0].rotation.set(-0.9, 0, arms[0].userData.side * 2.5);
      arms[1].rotation.set((Math.random() - 0.5) * 0.4, 0, arms[1].userData.side * (2.2 + Math.random() * 0.4));
      upper.rotation.set(0.18, 0, (Math.random() < 0.5 ? -1 : 1) * 0.22);
    }
  };

  // per-person build: a touch taller/shorter, broader/slighter
  const wj = jitter ? 0.9 + Math.random() * 0.2 : 1;
  const hj = jitter ? 0.94 + Math.random() * 0.14 : 1;
  g.scale.set(scale * wj, scale * hj, scale * wj);
  g.userData.headHeight = (legH + 1.85) * scale * hj;
  freeze(g);
  return g;
}

export function buildKid() {
  const p = buildPerson({ scale: 0.62, shirt: pick(SHIRTS), hat: 'cap', shoes: true });
  // some kids tow a balloon on a string
  if (Math.random() < 0.4) {
    const bg = new THREE.Group();
    const str = cyl(0.02, 0.02, 1.7, 0xd8d8e0, 4);
    str.position.y = 0.85;
    bg.add(str);
    const ball = sphere(0.36, pick([0xff4d6d, 0xffd23f, 0x4ecdc4, 0x6a8eff, 0xff9f1c]), 7);
    ball.scale.y = 1.15;
    ball.position.y = 1.9;
    bg.add(ball);
    bg.position.set(0.72, 0.95, 0.15); // tied at one hand
    bg.rotation.z = -0.18;
    p.add(bg);
    freeze(bg);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Biker = person leaning forward on a bicycle. The whole thing rolls.
// ---------------------------------------------------------------------------
export function buildBiker() {
  const g = new THREE.Group();

  // bicycle — wheels are pivot groups (tire ring + spokes + hub) so they
  // genuinely roll; the frame gets a fork, seatpost and pedals.
  const bike = new THREE.Group();
  const wheelGeo = new THREE.TorusGeometry(0.5, 0.07, 6, 14);
  const wheels = [];
  for (const wz of [-0.75, 0.75]) {
    const wheel = new THREE.Group();
    wheel.position.set(0, 0.5, wz);
    const tire = new THREE.Mesh(wheelGeo, mat(0x222228));
    tire.rotation.y = Math.PI / 2; // ring upright in the rolling plane
    tire.castShadow = true;
    wheel.add(tire);
    for (let s = 0; s < 3; s++) {
      const spoke = box(0.03, 0.92, 0.03, 0xb8bcc4);
      spoke.rotation.x = (s / 3) * Math.PI;
      wheel.add(spoke);
    }
    wheel.add(sphere(0.07, 0x44444c, 5)); // hub
    bike.add(wheel);
    wheels.push(wheel);
  }
  // frame
  const frameColor = pick([0xff4d4d, 0x33cc66, 0x3399ff, 0xffcc00]);
  const bar1 = cyl(0.05, 0.05, 1.3, frameColor); bar1.rotation.z = Math.PI / 2; bar1.position.set(0, 0.85, 0); bike.add(bar1);
  const bar2 = cyl(0.05, 0.05, 0.9, frameColor); bar2.position.set(0, 0.65, 0.4); bar2.rotation.x = 0.5; bike.add(bar2);
  const fork = cyl(0.04, 0.04, 0.66, frameColor); fork.position.set(0, 0.8, -0.72); fork.rotation.x = -0.18; bike.add(fork);
  const post = cyl(0.04, 0.04, 0.4, 0x44444c); post.position.set(0, 0.88, 0.55); bike.add(post);
  const seat = box(0.3, 0.12, 0.18, 0x111111, 0, 1.0, 0.55); bike.add(seat);
  const handle = box(0.5, 0.1, 0.12, 0x111111, 0, 1.08, -0.7); bike.add(handle);
  for (const sx of [-1, 1]) bike.add(box(0.1, 0.05, 0.2, 0x111111, 0.2 * sx, 0.5 + 0.1 * sx, 0.1)); // pedals
  g.add(bike);

  // rider, leaned forward (no build jitter — the helmet is fitted to the head)
  const rider = buildPerson({ scale: 0.92, shirt: pick([0xff3b3b, 0x00b894, 0x0984e3, 0xfdcb6e]), jitter: false });
  rider.position.set(0, 0.55, 0.1);
  rider.rotation.x = 0.45;
  g.add(rider);
  // arms reach forward to the handlebars; restore that pose when a shock ends
  // (the person's own setShocked resets arms to hanging-at-sides)
  const reachBars = () => { for (const a of rider.userData.arms) a.rotation.set(0.95, 0, 0.12 * a.userData.side); };
  reachBars();
  // legs bent onto the pedals (one up, one down)
  rider.userData.legs[0].rotation.x = -0.9;
  rider.userData.legs[1].rotation.x = -0.45;
  const riderShock = rider.userData.setShocked;
  g.userData.setShocked = (on) => { riderShock(on); if (!on) reachBars(); };

  // helmet
  const helmet = box(0.66, 0.34, 0.62, pick(SHIRTS), 0, 2.55, -0.55);
  helmet.rotation.x = 0.45;
  g.add(helmet);

  g.userData.headHeight = 2.6;
  g.userData.wheels = wheels; // groups: rotation.x rolls tire + spokes together
  freeze(g);
  return g;
}

// ---------------------------------------------------------------------------
// Picnic: checkered blanket (one textured plane, not 36 tiles), basket, food,
// and two seated picnickers who gasp when a turd bears down.
// ---------------------------------------------------------------------------
const blanketMats = new Map();
function blanketMat(c1, c2) {
  const key = c1 + ':' + c2;
  if (blanketMats.has(key)) return blanketMats.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const hx = (c) => '#' + c.toString(16).padStart(6, '0');
  const ts = 64 / 6;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    ctx.fillStyle = (i + j) % 2 === 0 ? hx(c1) : hx(c2);
    ctx.fillRect(i * ts, j * ts, ts + 1, ts + 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; // crisp checker edges
  const m = new THREE.MeshLambertMaterial({ map: t });
  blanketMats.set(key, m);
  return m;
}

// A cross-legged sitter for the picnic blanket (compact, smooth-shaded).
function buildSitter(shirt = pick(SHIRTS), skin = pick(SKIN)) {
  const g = new THREE.Group();
  const folded = sphere(0.42, 0x394a59, 8);              // folded legs
  folded.scale.set(1.25, 0.5, 1.0);
  folded.position.set(0, 0.2, -0.1);
  g.add(folded);
  const torso = capsule(0.3, 0.34, clothMat(shirt, pick(CLOTH_PATTERNS)), 0, 0.66, 0.06, 10);
  torso.scale.set(1.1, 1, 0.7);
  g.add(torso);
  const head = sphere(0.26, skin, 10);
  head.position.set(0, 1.24, 0.06);
  g.add(head);
  const crown = sphere(0.28, pick(HAIR), 9);
  crown.scale.set(1.04, 0.76, 1.04);
  crown.position.set(0, 1.34, 0.1);
  g.add(crown);
  const face = buildFace(head, { w: 0.4, h: 0.4, z: -0.25 });
  g.userData.face = face;
  return g;
}

export function buildPicnic() {
  const g = new THREE.Group();
  const [c1, c2] = pick([[0xff5b5b, 0xfff0f0], [0x3a6ea5, 0xeaf2ff], [0x2ec4b6, 0xf0fffa]]);
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), blanketMat(c1, c2));
  blanket.rotation.x = -Math.PI / 2;
  blanket.position.y = 0.04;
  blanket.receiveShadow = true;
  g.add(blanket);
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
  // two picnickers facing each other across the spread
  const a = buildSitter(); a.position.set(-1.05, 0.06, 0.75); a.rotation.y = -2.2; g.add(a);
  const b = buildSitter(); b.position.set(1.1, 0.06, 0.9); b.rotation.y = 2.4; g.add(b);
  g.userData.setShocked = (on) => { a.userData.face.setShocked(on); b.userData.face.setShocked(on); };

  g.userData.headHeight = 1.6;
  freeze(g);
  return g;
}

// ---------------------------------------------------------------------------
// Car (open-top convertible, low poly) with a visible driver who panics when a
// turd bears down. Rolls along the road; the front is +Z (headlights end).
// ---------------------------------------------------------------------------
export function buildCar() {
  const g = new THREE.Group();
  const color = pick([0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1, 0xe67e22]);
  const body = box(2.0, 0.7, 4.2, color, 0, 0.85, 0);
  g.add(body);
  // open cockpit tub + seat backs instead of the old solid roof box
  g.add(box(1.8, 0.35, 2.0, 0x222831, 0, 1.32, -0.2));
  g.add(box(1.7, 0.55, 0.22, 0x3a2f2a, 0, 1.6, -1.05)); // rear seat back
  g.add(box(1.7, 0.5, 0.2, 0x3a2f2a, 0, 1.58, 0.05));   // front seat back
  // windshield
  const shield = box(1.7, 0.55, 0.1, 0x9bd1ff, 0, 1.62, 0.85);
  shield.rotation.x = 0.18;
  g.add(shield);
  // driver behind the wheel, facing the front (+Z)
  const driver = new THREE.Group();
  const dskin = pick(SKIN);
  driver.add(box(0.66, 0.6, 0.42, pick(SHIRTS), 0, 1.62, 0));
  const dhead = box(0.46, 0.44, 0.42, dskin, 0, 2.1, 0);
  driver.add(dhead);
  driver.add(box(0.5, 0.16, 0.46, pick(HAIR), 0, 2.36, 0));
  const dface = buildFace(dhead, { w: 0.42, h: 0.4, z: -0.23 });
  driver.position.set(0.42, 0, -0.35);
  driver.rotation.y = Math.PI; // face plane sits on -Z of the head; spin to face +Z
  g.add(driver);
  g.userData.setShocked = dface.setShocked;
  // steering wheel
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 6, 12), mat(0x1a1a1a));
  wheelRim.position.set(0.42, 1.5, 0.45);
  wheelRim.rotation.x = -0.5;
  g.add(wheelRim);
  // wheels with hubcaps, tucked under rounded fenders
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 14);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.37, 10);
  for (const sx of [-1, 1]) {
    for (const sz of [-1.3, 1.3]) {
      const w = new THREE.Mesh(wheelGeo, mat(0x1a1a1a));
      w.rotation.z = Math.PI / 2;
      w.position.set(1.0 * sx, 0.45, sz);
      w.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, mat(0xd8d8e0));
      w.add(hub);
      g.add(w);
      wheels.push(w);
      const fender = sphere(0.55, color, 10);
      fender.scale.set(0.55, 0.6, 1.1);
      fender.position.set(1.0 * sx, 0.72, sz);
      g.add(fender);
    }
  }
  // headlights + bumpers
  for (const sx of [-1, 1]) g.add(box(0.3, 0.2, 0.1, 0xffffcc, 0.6 * sx, 0.85, 2.1));
  g.add(box(2.1, 0.18, 0.18, 0xd8d8e0, 0, 0.62, 2.12));
  g.add(box(2.1, 0.18, 0.18, 0xd8d8e0, 0, 0.62, -2.12));
  g.userData.headHeight = 2.2;
  g.userData.wheels = wheels;
  freeze(g, wheels);
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
  g.rotation.z = (Math.random() - 0.5) * 0.22; // jaunty beach lean
  freeze(g);
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
  // fronds: two hinged segments per leaf so each one arcs and droops at the tip
  // (meshes offset inside pivot groups — cached geometries must not be mutated)
  for (let i = 0; i < 7; i++) {
    const green = pick([0x2ecc71, 0x27ae60, 0x57d68d]);
    const frond = new THREE.Group();
    frond.add(box(1.5, 0.12, 0.85, green, 0.75, 0, 0));
    const tip = new THREE.Group();
    tip.position.set(1.45, 0, 0);
    tip.rotation.z = -0.55 - Math.random() * 0.2;
    tip.add(box(1.4, 0.09, 0.55, green, 0.7, 0, 0));
    frond.add(tip);
    frond.position.set(0, h, 0);
    frond.rotation.y = (i / 7) * Math.PI * 2;
    frond.rotation.z = -0.25 - Math.random() * 0.2;
    g.add(frond);
  }
  // coconuts
  for (let i = 0; i < 3; i++) g.add(sphere(0.22, 0x5b3a1a, 6).translateX((Math.random()-0.5)*0.6).translateY(h-0.3).translateZ((Math.random()-0.5)*0.6));
  freeze(g);
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
  freeze(g);
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
  freeze(g);
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
  freeze(g);
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
  freeze(g);
  return g;
}

// ---------------------------------------------------------------------------
// POOP PROJECTILES. Four interchangeable turd shapes that all fly the SAME
// physics arc — buildPoop(type) just swaps the mesh, and main.js cycles the
// type on every drop so a different one falls each time. Each variant also
// carries a `splatStyle` tag (read by effects.js) so its ground/target impact
// looks unique. Browns are shared; the splatter mixes in seabird white.
// ---------------------------------------------------------------------------
const TURD_BROWN = [0x7a5230, 0x6b4626, 0x5e3c1f];
const TURD_WHITE = [0xf2ede0, 0xe6dcc6];

// 1) The classic 💩 swirl — the original coil that tapers to a curl.
function buildPoopNormal() {
  const g = new THREE.Group();
  const s1 = sphere(0.42, 0x7a5230, 7); s1.position.y = -0.1; s1.scale.set(1.2, 0.7, 1.2);
  const s2 = sphere(0.32, 0x6b4626, 7); s2.position.y = 0.18; s2.scale.set(1, 0.75, 1);
  const s3 = sphere(0.2, 0x5e3c1f, 7); s3.position.y = 0.42;
  const tip = cone(0.12, 0.3, 0x5e3c1f, 6); tip.position.y = 0.68;
  g.add(s1, s2, s3, tip);
  g.userData.spinnable = [s1, s2, s3, tip];
  return g;
}

// 2) The "turd log" — a long, gently arced, segmented Mr. Hanky sausage that
// tapers to a point at each end, built along a shallow banana curve so it reads
// as a log however it tumbles.
function buildPoopLog() {
  const g = new THREE.Group();
  const parts = [];
  const N = 7, len = 1.5;
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);                 // 0..1 along the log
    const taper = Math.sin(f * Math.PI);   // fat in the middle, slim at the ends
    const s = sphere(0.1 + taper * 0.19, TURD_BROWN[i % 3], 7);
    s.position.set((f - 0.5) * len, taper * 0.16, 0); // gentle upward arc
    s.scale.set(1.05, 0.9, 0.95);
    g.add(s); parts.push(s);
  }
  // pointed tips poking straight out of each end
  const tipR = cone(0.1, 0.34, 0x5e3c1f, 6); tipR.position.x = len / 2; tipR.rotation.z = -Math.PI / 2;
  const tipL = cone(0.1, 0.34, 0x5e3c1f, 6); tipL.position.x = -len / 2; tipL.rotation.z = Math.PI / 2;
  g.add(tipR, tipL); parts.push(tipR, tipL);
  g.userData.spinnable = parts;
  return g;
}

// 3) The "BBs" — a tight clump of little pellets bunched into one clammy group,
// laid out on a golden-angle spiral so they pack evenly with no seams.
function buildPoopBBs() {
  const g = new THREE.Group();
  const parts = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const a = i * 2.39996;                            // golden angle
    const rad = 0.04 + 0.27 * Math.sqrt(i / N);
    const s = sphere(0.12 + Math.random() * 0.05, TURD_BROWN[i % 3], 6);
    s.position.set(Math.cos(a) * rad, (Math.random() - 0.5) * 0.4, Math.sin(a) * rad);
    g.add(s); parts.push(s);
  }
  g.userData.spinnable = parts;
  return g;
}

// 4) The "splatter" — a white-and-brown liquidy mess shaped like a jagged
// lightning bolt that stabs straight down. Held upright in flight (see
// _updatePoop) so the zig-zag reads vertically as it streaks at the ground.
function buildPoopSplatter() {
  const g = new THREE.Group();
  const parts = [];
  // a zig-zagging column of wet blobs from a fat head down to a sharp drip
  const steps = [
    [0.00, 0.60, 0.25, TURD_WHITE[0]],
    [0.11, 0.38, 0.22, TURD_BROWN[0]],
    [-0.13, 0.16, 0.20, TURD_WHITE[1]],
    [0.11, -0.05, 0.16, TURD_BROWN[1]],
    [-0.08, -0.27, 0.13, TURD_WHITE[0]],
    [0.05, -0.46, 0.10, TURD_BROWN[2]],
  ];
  for (const [x, y, r, col] of steps) {
    const s = sphere(r, col, 7); s.position.set(x, y, 0); s.scale.set(1.1, 0.95, 1.1);
    g.add(s); parts.push(s);
  }
  const tip = cone(0.1, 0.42, TURD_BROWN[2], 6); // the bolt's dripping point
  tip.position.set(0.05, -0.74, 0); tip.rotation.z = Math.PI;
  g.add(tip); parts.push(tip);
  // a couple of flung side droplets to sell the wet splat
  for (const sx of [-1, 1]) {
    const d = sphere(0.09, sx < 0 ? TURD_WHITE[0] : TURD_BROWN[0], 6);
    d.position.set(sx * 0.27, 0.1 + sx * 0.1, 0.05);
    g.add(d); parts.push(d);
  }
  g.userData.spinnable = parts;
  return g;
}

// The four turd variants, in cycle order. `splatStyle` is read by effects.js to
// pick the matching impact burst; `upright` keeps the bolt pointing down.
export const POOP_TYPES = ['normal', 'log', 'bbs', 'splatter'];
const POOP_BUILDERS = { normal: buildPoopNormal, log: buildPoopLog, bbs: buildPoopBBs, splatter: buildPoopSplatter };

// A poop projectile mesh of the given variant (defaults to the classic swirl).
export function buildPoop(type = 'normal') {
  const g = (POOP_BUILDERS[type] || buildPoopNormal)();
  g.userData.poopType = type;
  freeze(g); // the whole group tumbles; the blobs are static within it
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
  freeze(g);
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

const WED_PANTS = [0x394a59, 0x2a2a3a, 0x5a4a6a, 0x6a3a3a, 0x335a45];

// A wedding guest sitting on a folding chair, facing -Z (toward the altar).
export function buildSeatedGuest({ shirt = pick(SHIRTS), skin = pick(SKIN), pants = pick(WED_PANTS), chair = 0xe8e0d2 } = {}) {
  const g = new THREE.Group();
  const seatY = 0.55;
  const cloth = clothMat(shirt, pick(CLOTH_PATTERNS));
  const pantsM = clothMat(pants, 'solid');
  g.add(box(0.64, 0.1, 0.58, chair, 0, seatY, 0));            // seat
  g.add(box(0.64, 0.6, 0.1, chair, 0, seatY + 0.35, 0.26));   // backrest
  g.add(box(0.6, seatY, 0.1, chair, 0, seatY / 2, 0.24));     // back legs
  g.add(box(0.6, seatY, 0.1, chair, 0, seatY / 2, -0.24));    // front legs
  for (const sx of [-1, 1]) {
    const thigh = capsule(0.15, 0.26, pantsM, 0.16 * sx, seatY + 0.16, -0.1);
    thigh.rotation.x = Math.PI / 2;   // horizontal, knees forward
    g.add(thigh);
    g.add(capsule(0.12, 0.28, pantsM, 0.16 * sx, seatY - 0.14, -0.34)); // shin
    const foot = sphere(0.13, 0x3a2f2a, 7);
    foot.scale.set(1, 0.55, 1.5);
    foot.position.set(0.16 * sx, seatY - 0.42, -0.4);
    g.add(foot);
  }
  const torso = capsule(0.34, 0.36, cloth, 0, seatY + 0.6, 0.04, 10); // torso
  torso.scale.set(1.1, 1, 0.68);
  g.add(torso);
  // arms hinged at the shoulder, resting toward the lap — they fly up in panic
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.44 * sx, seatY + 0.94, 0.04);
    shoulder.add(capsule(0.11, 0.32, cloth, 0, -0.26, 0));
    const hand = sphere(0.11, skin, 7);
    hand.position.set(0, -0.56, -0.02);
    shoulder.add(hand);
    shoulder.rotation.x = 0.4;
    shoulder.userData.side = sx;
    g.add(shoulder);
    arms.push(shoulder);
  }
  g.add(capsule(0.1, 0.1, skin, 0, seatY + 1.0, 0.04));
  const head = sphere(0.27, skin, 10);
  head.position.set(0, seatY + 1.2, 0.04);
  g.add(head);
  const face = buildFace(head, { w: 0.4, h: 0.4, z: -0.26 });
  const crown = sphere(0.29, pick(HAIR), 9);
  crown.scale.set(1.04, 0.76, 1.04);
  crown.position.set(0, seatY + 1.31, 0.08);
  g.add(crown);
  // some guests dress up with a pastel occasion hat
  if (Math.random() < 0.3) {
    const hc = pick([0xffd1dc, 0xfff3d6, 0xd9c8f0, 0xc8e8d9, 0xf7f7fb]);
    const brim = cyl(0.42, 0.46, 0.05, hc, 14); brim.position.set(0, seatY + 1.4, 0.06); g.add(brim);
    const dome = sphere(0.26, hc, 9); dome.scale.set(1.1, 0.62, 1.1); dome.position.set(0, seatY + 1.44, 0.06); g.add(dome);
  }
  g.userData.arms = arms;
  g.userData.setShocked = (on) => {
    face.setShocked(on);
    if (!on) {
      for (const a of arms) a.rotation.set(0.4, 0, 0);
      return;
    }
    const r = Math.random();
    if (r < 0.4) {
      // arms thrown to the sky
      for (const a of arms) a.rotation.set((Math.random() - 0.5) * 0.4, 0, a.userData.side * (2.25 + Math.random() * 0.5));
    } else if (r < 0.72) {
      // hands fly to the face
      for (const a of arms) a.rotation.set(-0.7 - Math.random() * 0.2, 0, a.userData.side * 3.4);
    } else {
      // brace: arms clamp in front of the chest, hunkering down
      for (const a of arms) a.rotation.set(-1.35 - Math.random() * 0.25, 0, a.userData.side * 0.5);
    }
  };
  g.userData.headHeight = seatY + 1.52;
  freeze(g);
  return g;
}

// The groom: dark suit, white shirt front, bowtie, boutonniere + top hat.
export function buildGroom() {
  const suit = pick([0x2b2b3a, 0x1c1c28, 0x33333f]);
  const g = buildPerson({ scale: 1.0, shirt: suit, pants: suit, skin: pick(SKIN), tank: false, jitter: false });
  const up = g.userData.upper; // suit details fold with the body in a panic
  up.add(box(0.34, 0.7, 0.12, 0xffffff, 0, 0.7, -0.26)); // shirt front
  up.add(box(0.22, 0.1, 0.1, 0x111111, 0, 0.82, -0.32)); // bowtie
  up.add(sphere(0.1, 0xff5d8f, 6).translateX(0.3).translateY(0.8).translateZ(-0.26)); // boutonniere
  const brim = cyl(0.5, 0.5, 0.06, 0x16161c, 12); brim.position.set(0, 1.94, 0); up.add(brim);
  const crown = cyl(0.34, 0.34, 0.42, 0x16161c, 10); crown.position.set(0, 2.16, 0); up.add(crown);
  freeze(g);
  return g;
}

// The bride: white gown (cone skirt), veil, tiara, bouquet.
export function buildBride() {
  const white = 0xffffff;
  const g = buildPerson({ scale: 1.0, shirt: white, pants: white, skin: pick(SKIN), tank: false, jitter: false });
  const skirt = cone(0.85, 1.3, white, 12); skirt.position.y = 0.78; g.add(skirt);
  const up = g.userData.upper;
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 1.2), mat(0xffffff, { transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  veil.position.set(0, 1.15, 0.34); up.add(veil);
  const tiara = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 6, 12), mat(0xffd23f));
  tiara.rotation.x = Math.PI / 2 - 0.15; tiara.position.set(0, 1.88, 0); up.add(tiara);
  for (let i = 0; i < 6; i++) {
    up.add(sphere(0.11, pick([0xff8fab, 0xffd1dc, 0xffffff, 0xffe066]), 6)
      .translateX(0.5 + (Math.random() - 0.5) * 0.3).translateY(0.4 + (Math.random() - 0.5) * 0.3).translateZ(-0.3));
  }
  g.userData.headHeight = 2.75;
  freeze(g);
  return g;
}

// The priest: dark cassock + white collar, holding a book.
export function buildPriest() {
  const robe = 0x1c1c22;
  const g = buildPerson({ scale: 1.0, shirt: robe, pants: robe, skin: pick(SKIN), tank: false, jitter: false });
  const cassock = cone(0.7, 1.4, robe, 10); cassock.position.y = 0.78; g.add(cassock);
  const up = g.userData.upper;
  up.add(box(0.4, 0.16, 0.12, 0xffffff, 0, 1.06, -0.27)); // collar
  up.add(box(0.3, 0.4, 0.1, 0x7a2d2d, 0.42, 0.5, -0.3));  // book
  g.userData.headHeight = 2.75;
  freeze(g);
  return g;
}

// A rock band member. role: 'mic' | 'guitar' | 'bass' | 'drums'.
export function buildBandMember(role = 'guitar') {
  const shirt = pick([0x1a1a1a, 0x2a2a3a, 0x4a1f2f, 0x1f2f4a, 0x3a1f4a]);
  const g = buildPerson({ scale: 1.0, shirt, pants: 0x14141a, skin: pick(SKIN), jitter: false });
  // stage presence: a bright mohawk on most of the band
  if (Math.random() < 0.6) {
    g.userData.upper.add(box(0.14, 0.34, 0.62, pick([0xff2e4d, 0x35ff7a, 0x3bdcff, 0xffd23f]), 0, 1.65, 0));
  }
  if (role === 'drums') {
    const kit = new THREE.Group();
    for (const [dx, dz, r, c] of [[-0.95, 0.95, 0.42, 0xcc2222], [0, 1.05, 0.5, 0xeeeeee], [0.95, 0.95, 0.42, 0x2266cc]]) {
      const drum = cyl(r, r, 0.42, c, 12); drum.position.set(dx, 1.0, dz); kit.add(drum);
    }
    const kick = cyl(0.55, 0.55, 0.5, 0x101014, 14); kick.rotation.x = Math.PI / 2; kick.position.set(0, 0.55, 1.55); kit.add(kick);
    const cym = cyl(0.5, 0.5, 0.04, 0xd4af37, 14); cym.position.set(1.2, 1.7, 0.5); kit.add(cym);
    const hat = cyl(0.36, 0.36, 0.04, 0xd4af37, 12); hat.position.set(-1.25, 1.5, 0.5); kit.add(hat);
    g.add(kit);
  } else if (role === 'mic') {
    // frontman: mic in a raised fist (the pose survives shock round-trips)
    const armUp = g.userData.arms[1];
    const mic = cyl(0.05, 0.07, 0.34, 0x222228, 6); mic.position.set(0.04, -1.0, 0); armUp.add(mic);
    const micTip = sphere(0.11, 0x44444c, 7); micTip.position.set(0.04, -1.2, 0); armUp.add(micTip);
    const strike = () => armUp.rotation.set(0, 0, 2.75);
    strike();
    const baseShock = g.userData.setShocked;
    g.userData.setShocked = (on) => { baseShock(on); if (!on) strike(); };
  } else {
    const up = g.userData.upper;
    const body = box(0.5, 0.74, 0.16, role === 'bass' ? 0x202024 : 0xcc3322, 0.32, 0.3, -0.32);
    body.rotation.z = 0.5; up.add(body);
    const neck = box(0.12, 1.2, 0.1, 0x6b4a2a, -0.22, 0.6, -0.32);
    neck.rotation.z = 0.5; up.add(neck);
    // strap across the chest
    const strap = box(0.16, 1.1, 0.06, 0x3a2a1a, 0, 0.55, -0.3);
    strap.rotation.z = -0.7; up.add(strap);
  }
  g.userData.headHeight = 2.75;
  freeze(g);
  return g;
}

// A standing concert-goer in the throng (reuses the beach person model).
// Arms start raised — the mosh-pit animation pumps them to the beat. A few
// fans hold up glowing phones, so the pit twinkles from the air at night.
export function buildFan() {
  const p = buildPerson({ scale: 0.95, shirt: pick(SHIRTS), skin: pick(SKIN), pants: pick([0x222228, 0x394a59, 0x14141a, 0x4a2f3a]), hat: 'cap' });
  for (const a of p.userData.arms) a.rotation.z = a.userData.side * 2.5;
  if (Math.random() < 0.25) {
    const arm = p.userData.arms[Math.random() < 0.5 ? 0 : 1];
    const phone = box(0.16, 0.3, 0.05, 0x16161c, 0.04 * arm.userData.side, -1.1, 0);
    arm.add(phone);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.36),
      new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.position.set(0.04 * arm.userData.side, -1.1, -0.04);
    glow.rotation.y = Math.PI;
    arm.add(glow);
    freeze(arm);
  }
  return p;
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
  freeze(g);
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
  freeze(g);
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
  freeze(g);
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
  freeze(g);
  return g;
}

// ---- sky / sea / sand scenery props --------------------------------------

// A classic red-and-white lifeguard tower up on stilts (beach decoration).
export function buildLifeguardTower() {
  const g = new THREE.Group();
  const red = 0xe84a4a, white = 0xfaf6ee;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = cyl(0.09, 0.11, 2.4, white, 6);
    leg.position.set(sx * 1.05, 1.2, sz * 0.85);
    g.add(leg);
  }
  g.add(box(2.7, 0.16, 2.3, white, 0, 2.45, 0));        // deck
  g.add(box(2.3, 1.5, 1.9, red, 0, 3.3, 0));            // cabin
  g.add(box(2.1, 0.7, 0.2, 0x9bd1ff, 0, 3.45, -0.98));  // window front
  g.add(box(2.9, 0.14, 2.5, white, 0, 4.18, 0));        // roof
  const ramp = box(0.8, 0.1, 2.8, white, 0, 1.45, 1.9);
  ramp.rotation.x = -0.6;
  g.add(ramp);
  const pole = cyl(0.04, 0.04, 1.2, white, 5); pole.position.set(1.25, 4.8, 0.9); g.add(pole);
  g.add(poly([[1.25, 5.4, 0.9], [1.25, 5.05, 0.9], [1.85, 5.22, 0.9]], red)); // pennant
  freeze(g);
  return g;
}

// A sandcastle with corner turrets, cone roofs and a tiny flag.
export function buildSandcastle() {
  const g = new THREE.Group();
  const sand1 = 0xe6c98a, sand2 = 0xdaba76;
  g.add(box(1.7, 0.55, 1.7, sand1, 0, 0.28, 0)); // base keep
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const turret = cyl(0.3, 0.34, 1.0, sand2, 7);
    turret.position.set(sx * 0.85, 0.5, sz * 0.85);
    g.add(turret);
    const roof = cone(0.34, 0.42, pick([0xff5b5b, 0x3a6ea5, 0xffd23f]), 7);
    roof.position.set(sx * 0.85, 1.2, sz * 0.85);
    g.add(roof);
  }
  const keep = cyl(0.42, 0.48, 1.3, sand1, 8); keep.position.set(0, 0.95, 0); g.add(keep);
  const keepRoof = cone(0.5, 0.5, sand2, 8); keepRoof.position.set(0, 1.85, 0); g.add(keepRoof);
  const mast = cyl(0.025, 0.025, 0.5, 0x8a6a4a, 4); mast.position.set(0, 2.3, 0); g.add(mast);
  g.add(poly([[0, 2.55, 0], [0, 2.38, 0], [0.3, 2.47, 0]], 0xff2e4d)); // flag
  g.scale.setScalar(0.8 + Math.random() * 0.5);
  freeze(g);
  return g;
}

// A puffy low-poly cloud (a few squashed faceted spheres). Drifts in the sky.
export function buildCloud() {
  const g = new THREE.Group();
  const n = 3 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const r = 1.7 + Math.random() * 2.1;
    const s = sphere(r, 0xffffff, 7);
    s.castShadow = false;
    s.position.set((i - (n - 1) / 2) * 2.3, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 2.2);
    s.scale.y = 0.5 + Math.random() * 0.2;
    g.add(s);
  }
  g.scale.setScalar(1.2 + Math.random() * 1.4);
  freeze(g);
  return g;
}

// A little sailboat for the bay. Bobbed/heeled by the world's update loop.
export function buildBoat() {
  const g = new THREE.Group();
  const hull = box(1.6, 0.7, 4.6, pick([0xf7f7fb, 0xff6b6b, 0x4ecdc4, 0x3a6ea5]), 0, 0.5, 0);
  g.add(hull);
  g.add(box(1.3, 0.16, 4.0, 0xf2e3c2, 0, 0.92, 0)); // deck
  const mast = cyl(0.06, 0.08, 3.6, 0x8a6a4a, 6);
  mast.position.set(0, 2.6, -0.3);
  g.add(mast);
  g.add(poly([[0.04, 4.3, -0.3], [0.04, 1.2, -0.3], [1.8, 1.2, -0.3]], 0xffffff));            // mainsail
  g.add(poly([[-0.04, 3.6, -0.45], [-0.04, 1.3, -0.45], [-1.2, 1.3, -0.45]], 0xffe8c2));      // jib
  freeze(g);
  return g;
}

// A beach towel laid flat on the sand (pure decoration).
export function buildTowel() {
  const g = new THREE.Group();
  const c = pick(SHIRTS);
  const t = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.8), mat(c, { side: THREE.DoubleSide }));
  t.rotation.x = -Math.PI / 2;
  t.position.y = 0.04;
  t.receiveShadow = true;
  g.add(t);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.5), mat(0xffffff, { side: THREE.DoubleSide }));
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.05, -0.9);
  g.add(stripe);
  freeze(g);
  return g;
}

// A crowd-barrier rail segment running along Z.
export function buildBarrier(len = 10) {
  const g = new THREE.Group();
  g.add(box(0.15, 0.15, len, 0x3a3a42, 0, 1.0, 0));
  g.add(box(0.15, 0.15, len, 0x3a3a42, 0, 0.55, 0));
  const n = Math.max(2, Math.round(len / 2.5));
  for (let i = 0; i <= n; i++) g.add(box(0.12, 1.1, 0.12, 0x4a4a52, 0, 0.55, -len / 2 + i * (len / n)));
  freeze(g);
  return g;
}

export { SHIRTS, SKIN };
