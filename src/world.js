import * as THREE from 'three';
import {
  buildPerson, buildKid, buildBiker, buildPicnic, buildCar,
  buildUmbrella, buildPalm, buildCypress, buildPine, buildRock,
  buildSuperTurd, mat,
  buildArch, buildFlowerStand, buildStage, buildSpeakerStack, buildBarrier,
} from './models.js';

export const WORLD_RADIUS = 130;     // playable radius (ground disc)

// ---------------------------------------------------------------------------
// The course is now a long, straight "infinite runner" lane (à la Temple Run).
// The bird always flies forward down -Z; the player strafes left/right inside a
// fixed-width corridor and dives/climbs, but never turns around. Targets stream
// toward the bird from far ahead and recycle behind it, and the scenery scrolls
// with the bird so the beach never visibly ends.
// ---------------------------------------------------------------------------
export const COURSE_HALF = 16;       // lateral half-width of the playable lane
const SPAWN_AHEAD = 150;             // distance ahead (-Z) the frontmost target sits
const SPAWN_GAP = 30;                // z-spacing between targets in the stream
const RECYCLE_BEHIND = 24;           // recycle a target once it's this far behind (+Z)

// Targets are scaled up (and given a bigger catch radius) so they're easier to
// nail — see the request to make everything ~1.5x larger to hit.
const TARGET_SCALE = 1.5;

// Moving targets (cars / cyclists) gently sweep across the lane like crossing
// traffic. Kept slow so the lead you need to give them stays fair.
const DRIFT_AMP = 11;                // how far across the lane they sweep
const DRIFT_OMEGA = 0.5;             // sweep speed (rad/s)

// ---------------------------------------------------------------------------
// Build the static beach world: sky, sun, sand, sea, courseway, palms, etc.
// Returns a scroller whose `update(birdPos)` keeps the scenery centred on the
// bird so the straightaway reads as endless.
// ---------------------------------------------------------------------------
export function buildWorld(scene, renderer) {
  scene.background = new THREE.Color(0x8fd6ee);
  scene.fog = new THREE.Fog(0xbfe6ee, 200, 560);

  // Everything this builder adds lives under one root group, so switching
  // levels can tear the whole world down with a single removal.
  const root = new THREE.Group();
  scene.add(root);

  // Lights
  const hemi = new THREE.HemisphereLight(0xcdeffc, 0xe8d9a8, 0.95);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.5);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); // modest for mobile GPUs
  const s = 160;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0004;
  root.add(sun);

  // Sky dome (gradient) — follows the bird so its edge is never reached.
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
  const sky = new THREE.Mesh(skyGeo, skyMat);
  root.add(sky);

  // The sun billboard (kept at a fixed offset from the bird).
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(28, 24), new THREE.MeshBasicMaterial({ color: 0xfff7cf }));
  const sunOffset = new THREE.Vector3(150, 180, -260);
  sunDisc.position.copy(sunOffset);
  root.add(sunDisc);

  // Ground: big sand disc that re-centres on the bird (a circle looks identical
  // from any centre, so the slide is seamless).
  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD_RADIUS + 40, 48),
    mat(0xf2d79b),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.receiveShadow = true;
  root.add(sand);

  // Sea: a long plane running along the lane on the far left side.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 1200), mat(0x2aa3d6, { transparent: true, opacity: 0.92 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-200, 0.05, 0);
  root.add(sea);
  // Wet shoreline band between the sea and the sand.
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(60, 1200), mat(0x7fd0e0, { transparent: true, opacity: 0.6 }));
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(-92, 0.06, 0);
  root.add(shore);

  // Courseway: a boardwalk strip running ALONG the lane (down -Z), with dashes
  // marching down the middle. Snapping its z to the dash pitch keeps the dashes
  // from visibly sliding as it scrolls with the bird.
  const DASH_PITCH = 12;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(COURSE_HALF * 2 + 6, 1200), mat(0x6d6f78));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.08, 0);
  root.add(road);
  const dashes = new THREE.Group();
  for (let i = -50; i < 50; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 5), mat(0xffe066));
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.1, i * DASH_PITCH);
    dashes.add(dash);
  }
  root.add(dashes);

  // Decorations down BOTH shoulders of the lane — a Croatian-coast mix of
  // umbrella pines, slender cypresses and palms (with a few beach umbrellas),
  // recycling back-to-front so the scenery streams by forever. On the sea side
  // (-X) we keep the trees landward of the shoreline.
  const decor = [];
  const decorGroup = new THREE.Group();
  const buildFlora = () => {
    const r = Math.random();
    if (r < 0.4) return buildPine();
    if (r < 0.72) return buildCypress();
    if (r < 0.9) return buildPalm();
    return buildUmbrella();
  };
  const placeDecor = (item, z) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    // sea side stays between the lane edge and the shore (~x -80); land side runs out wide
    const maxOff = side < 0 ? 60 : WORLD_RADIUS - COURSE_HALF - 20;
    const off = COURSE_HALF + 6 + Math.random() * maxOff;
    item.position.set(side * off, 0, z);
    item.rotation.y = Math.random() * Math.PI * 2;
  };
  for (let i = 0; i < 36; i++) {
    const item = buildFlora();
    placeDecor(item, (i / 36) * (SPAWN_AHEAD + 60) - SPAWN_AHEAD);
    decorGroup.add(item);
    decor.push(item);
  }
  root.add(decorGroup);

  // Seaside rocks strung along the shoreline (just sea-ward of the path), also
  // recycling so the rocky coast never ends.
  const rocks = [];
  const rocksGroup = new THREE.Group();
  const placeRock = (item, z) => {
    item.position.set(-(70 + Math.random() * 22), 0, z); // along the shore band
    item.rotation.y = Math.random() * Math.PI * 2;
  };
  for (let i = 0; i < 16; i++) {
    const item = buildRock();
    placeRock(item, (i / 16) * (SPAWN_AHEAD + 60) - SPAWN_AHEAD);
    rocksGroup.add(item);
    rocks.push(item);
  }
  root.add(rocksGroup);

  return {
    // Keep the world centred on the bird as it runs down the straightaway.
    update(birdPos) {
      const bx = birdPos.x, bz = birdPos.z;
      sky.position.set(bx, 0, bz);
      sunDisc.position.set(bx + sunOffset.x, sunOffset.y, bz + sunOffset.z);
      sand.position.set(bx, 0, bz);
      sea.position.z = bz;
      shore.position.z = bz;
      road.position.z = bz;
      dashes.position.z = Math.round(bz / DASH_PITCH) * DASH_PITCH;
      // recycle scenery that has fallen behind to far ahead of the bird
      for (const item of decor) {
        if (item.position.z > bz + RECYCLE_BEHIND + 20) {
          placeDecor(item, bz - SPAWN_AHEAD - Math.random() * 60);
        }
      }
      for (const item of rocks) {
        if (item.position.z > bz + RECYCLE_BEHIND + 20) {
          placeRock(item, bz - SPAWN_AHEAD - Math.random() * 60);
        }
      }
    },
    dispose() { scene.remove(root); },
  };
}

// ---------------------------------------------------------------------------
// Shared sky dome used by the fixed-venue (circuit) levels. Unlike the beach
// dome it never needs to scroll — the venue doesn't move — but we still recentre
// it on the bird so its edge is never reached.
// ---------------------------------------------------------------------------
function gradientSky(topHex, bottomHex) {
  const mtl = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color(topHex) }, bottom: { value: new THREE.Color(bottomHex) } },
    vertexShader: `varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vp; uniform vec3 top; uniform vec3 bottom;
      void main(){ float h = clamp((normalize(vp).y*0.5+0.5),0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)),1.0);} `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), mtl);
}

// ---------------------------------------------------------------------------
// WEDDING venue — a garden ceremony: green lawn, white aisle runner, a floral
// arch at the head, flower pedestals lining the aisle. White-and-flowers, happy.
// The crowd (guests in chairs) and the couple/priest are spawned by the circuit
// TargetManager from the level's layout, not here.
// ---------------------------------------------------------------------------
export function buildWeddingWorld(scene, renderer) {
  scene.background = new THREE.Color(0xdbeffd);
  scene.fog = new THREE.Fog(0xeaf6ff, 160, 480);

  const root = new THREE.Group();
  scene.add(root);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8e8c8, 1.05);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
  sun.position.set(40, 120, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const s = 120;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.far = 360;
  sun.shadow.bias = -0.0004;
  root.add(sun);

  const sky = gradientSky(0x7fc6f0, 0xeaf6ff);
  root.add(sky);

  // Lawn
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(WORLD_RADIUS + 40, 48), mat(0x86c06a));
  lawn.rotation.x = -Math.PI / 2; lawn.receiveShadow = true;
  root.add(lawn);

  // White aisle runner down the centre (Z axis), couple end at -Z.
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 130), mat(0xfbf7f0));
  runner.rotation.x = -Math.PI / 2; runner.position.set(0, 0.05, -5);
  root.add(runner);
  // A low dais under the arch for the couple/priest.
  const dais = new THREE.Mesh(new THREE.CircleGeometry(8, 28), mat(0xf3ece0));
  dais.rotation.x = -Math.PI / 2; dais.position.set(0, 0.07, -50);
  root.add(dais);

  // Floral arch at the head of the aisle.
  const arch = buildArch(); arch.position.set(0, 0, -52); root.add(arch);

  // Flower pedestals marching down both sides of the aisle.
  for (let i = 0; i < 9; i++) {
    const z = -44 + i * 9;
    for (const sx of [-1, 1]) {
      const stand = buildFlowerStand();
      stand.position.set(sx * 3.0, 0, z);
      root.add(stand);
    }
  }
  // A ring of trees framing the garden.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const tree = (i % 2 ? buildCypress() : buildPine());
    tree.position.set(Math.cos(a) * 70, 0, -5 + Math.sin(a) * 70);
    root.add(tree);
  }

  return {
    update(birdPos) { sky.position.set(birdPos.x, 0, birdPos.z); },
    dispose() { scene.remove(root); },
  };
}

// ---------------------------------------------------------------------------
// ROCK CONCERT venue — dusk/night, a big stage at the -Z end with a lighting
// truss and PA speaker stacks, crowd barriers running down both sides. The
// throng of fans and the band are spawned by the circuit TargetManager.
// ---------------------------------------------------------------------------
export function buildConcertWorld(scene, renderer) {
  scene.background = new THREE.Color(0x14121f);
  scene.fog = new THREE.Fog(0x14121f, 140, 420);

  const root = new THREE.Group();
  scene.add(root);

  const hemi = new THREE.HemisphereLight(0x4a4470, 0x101018, 0.7);
  root.add(hemi);
  const key = new THREE.DirectionalLight(0xa6b6ff, 0.8);
  key.position.set(20, 90, 60);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const s = 120;
  key.shadow.camera.left = -s; key.shadow.camera.right = s;
  key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
  key.shadow.camera.far = 360;
  key.shadow.bias = -0.0004;
  root.add(key);
  // A couple of colored point lights wash the stage for concert mood.
  const stageLight1 = new THREE.PointLight(0xff3b6b, 0.9, 160); stageLight1.position.set(-16, 18, -46); root.add(stageLight1);
  const stageLight2 = new THREE.PointLight(0x3bdcff, 0.9, 160); stageLight2.position.set(16, 18, -46); root.add(stageLight2);

  const sky = gradientSky(0x0a0a14, 0x241f3a);
  root.add(sky);

  // Dark venue floor.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(WORLD_RADIUS + 40, 48), mat(0x1c1a26));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  root.add(floor);
  // Lit pit area between the barriers.
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(30, 120), mat(0x2a2740));
  pit.rotation.x = -Math.PI / 2; pit.position.set(0, 0.04, 0);
  root.add(pit);

  // The stage at the -Z end.
  const stage = buildStage(34, 14); stage.position.set(0, 0, -56); root.add(stage);
  // PA speaker stacks flanking it.
  for (const sx of [-1, 1]) { const sp = buildSpeakerStack(); sp.position.set(sx * 19, 0, -52); root.add(sp); }

  // Crowd barriers down both sides, repeated in segments.
  const barriers = [];
  for (let i = 0; i < 12; i++) {
    const z = -40 + i * 9;
    for (const sx of [-1, 1]) {
      const b = buildBarrier(9);
      b.position.set(sx * 14, 0, z);
      root.add(b);
      barriers.push(b);
    }
  }

  const lamps = stage.userData.lamps || [];
  let t = 0;
  return {
    update(birdPos) {
      sky.position.set(birdPos.x, 0, birdPos.z);
      // strobe/pulse the colored stage lamps + point lights for a gig feel
      t += 0.016;
      stageLight1.intensity = 0.7 + Math.sin(t * 6) * 0.4;
      stageLight2.intensity = 0.7 + Math.sin(t * 6 + 2) * 0.4;
      for (let i = 0; i < lamps.length; i++) {
        lamps[i].material.opacity = 1;
        lamps[i].visible = ((Math.sin(t * 5 + i) > -0.3));
      }
    },
    dispose() { scene.remove(root); },
  };
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

// The rare golden SUPER TURD pickup. Bombing it triggers SUPER TURD MODE.
const SUPER_CHANCE = 0.14;   // odds a fresh spawn rolls a super turd (max one alive)
const SUPER_CFG = { value: 250, radius: 2.2, moving: false };

// Circuit (wedding / concert) tuning.
const CIRCUIT_RESPAWN = 2.6;       // seconds before a downed target stands back up
const CIRCUIT_SUPER_CHANCE = 0.05; // odds a respawning crowd slot rolls a super turd
// Hard cap on the gap between SUPER TURDs (any level) — one is forced if none has
// appeared in this many seconds, so power-ups are never more than ~10s apart.
const SUPER_MAX_GAP = 8;

// ---- Concert mosh pit: a churning crowd that periodically pulls a WALL OF
// DEATH — the throng splits down the middle into two facing walls, then on the
// cue both halves charge across the open lane and slam together at the centre.
// The pit lane runs along z (where the bird flies in), so the two walls part
// left/right and collide right under the flight path.
const WOD = {
  WANDER: 9.5,   // base seconds of ordinary moshing between walls of death
  WANDER_RAND: 6,
  PART: 2.3,     // crowd peels apart, opening the lane
  BRACE: 1.0,    // walls hold, squaring up to face each other
  CHARGE: 0.55,  // both walls sprint to the centre
  CLASH: 0.8,    // bodies pile up and churn at the collision line
  RECOVER: 1.7,  // everyone melts back to their spot
  GAP: 4.2,      // how far each fan retreats from centre when the lane opens
  LEAN: 0.9,     // forward lean (toward centre) while bracing/charging
};
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
// Shortest signed angle from a to b, wrapped to [-π, π].
const angDelta = (b, a) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
// Extra reach (beyond the splat radius) for the "about to get hit" shocked face,
// so victims gasp a moment before the turd actually lands on them.
const SHOCK_MARGIN = 2.5;

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
// Manages a stream of live targets running down the lane toward the bird.
// ---------------------------------------------------------------------------
export class TargetManager {
  constructor(scene) {
    this.scene = scene;
    this.targets = [];
    // How many targets are in flight down the lane at once.
    this.maxTargets = 6;
    this._frontZ = -SPAWN_AHEAD; // z of the furthest-ahead target spawned so far
    // 'runner' = streaming beach lane; 'circuit' = a fixed venue layout the
    // bird loops over (wedding / concert).
    this.mode = 'runner';
    this.slots = [];
    this.level = null;
    // Power-up cadence: guarantee a SUPER TURD shows up at least every
    // SUPER_MAX_GAP seconds across every level (forces one if the clock runs out).
    this._sinceSuper = 0;
    this._forceSuper = false;
  }

  reset(birdPos, level) {
    for (const t of this.targets) this.scene.remove(t.group);
    this.targets = [];
    this.slots = [];
    this._sinceSuper = 0;
    this._forceSuper = false;
    this.mode = level && level.mode === 'circuit' ? 'circuit' : 'runner';
    this.level = level || null;
    // wall-of-death choreography clock (concert only); `event` is drained by the
    // game loop to fire the announcement toast + crowd roar at the right beats.
    this._mosh = { state: 'wander', t: 0, next: WOD.WANDER + Math.random() * WOD.WANDER_RAND, event: null };
    if (this.mode === 'circuit') {
      for (const slot of level.layout()) {
        slot.respawn = 0; slot.target = null;
        this.slots.push(slot);
        this._spawnSlot(slot);
      }
      return;
    }
    const baseZ = birdPos ? birdPos.z : 0;
    this._frontZ = baseZ - SPAWN_AHEAD + SPAWN_GAP; // first _advanceFront lands at -SPAWN_AHEAD
    for (let i = 0; i < this.maxTargets; i++) this.spawn(null, this._advanceFront());
  }

  // ---- circuit (fixed-venue) targets -------------------------------------
  // Each layout "slot" is a fixed spot in the venue (a chair, a band member,
  // the couple…). Killed targets respawn in place after a short delay so the
  // venue stays populated for the bird's repeated passes.
  _spawnSlot(slot, forceSuper = false) {
    let group, special = null, value = slot.value, scale = slot.scale, radius = slot.radius, bull = slot.bull;
    // float a golden SUPER TURD into a crowd slot (by chance, or forced by the
    // cadence timer); only one alive at a time.
    if (forceSuper || (!slot.vip && !this._hasSuper() && Math.random() < CIRCUIT_SUPER_CHANCE)) {
      special = 'super'; group = buildSuperTurd();
      value = SUPER_CFG.value; scale = 1.0; radius = SUPER_CFG.radius; bull = true;
      this._sinceSuper = 0;
    } else {
      group = slot.build();
    }
    const baseY = slot.y || 0;
    group.position.set(slot.x, baseY, slot.z);
    group.rotation.y = slot.faceY || 0;
    group.scale.setScalar(scale);
    // crowd figures don't cast shadows — keeps the dense scene cheap.
    if (!slot.vip && !special) group.traverse((o) => { if (o.isMesh) o.castShadow = false; });

    const localTop = group.userData.headHeight || 2;
    let bullseye = null;
    if (bull) {
      bullseye = buildBullseye();
      bullseye.position.y = localTop + 0.8;
      group.add(bullseye);
    }
    this.scene.add(group);
    const t = {
      key: slot.kind, group, bullseye,
      value, radius: radius * scale, hitY: localTop * scale + baseY, baseY,
      bullLocalY: localTop + 0.8,
      orbit: false, special, slot,
      driftPhase: 0, bobT: Math.random() * 10, sway: Math.random() * Math.PI * 2,
      // per-figure mosh motion (concert) — a jumping bounce + jostle
      moshFreq: 3.5 + Math.random() * 4, moshPhase: Math.random() * Math.PI * 2, moshAmp: 0.35 + Math.random() * 0.7,
      // wall-of-death bookkeeping: the spot this fan churns around, which side of
      // the lane it belongs to, and its live displacement from home.
      homeX: slot.x, homeZ: slot.z,
      side: slot.x < 0 ? -1 : slot.x > 0 ? 1 : (Math.round(slot.z) & 1 ? 1 : -1),
      wodX: 0,
      faces: !special,            // every crowd figure turns to face the turd
      faceCtl: group.userData.setShocked || null,  // swap to a shocked expression
      alive: true, dying: 0,
    };
    this.targets.push(t);
    slot.target = t;
    return t;
  }

  // Force a super turd into a random live crowd slot — used by the cadence timer
  // when none has appeared in a while and the player hasn't been killing anyone.
  _forceSuperCircuit() {
    const live = this.targets.filter((t) => t.alive && t.slot && !t.slot.vip && !t.special);
    if (!live.length) return;
    const t = live[(Math.random() * live.length) | 0];
    this.scene.remove(t.group);
    const idx = this.targets.indexOf(t);
    if (idx >= 0) this.targets.splice(idx, 1);
    t.slot.target = null;
    this._spawnSlot(t.slot, true);
  }

  _updateCircuit(dt) {
    this._sinceSuper += dt;
    const mosh = !!(this.level && this.level.mosh);
    const m = mosh ? this._stepMoshPit(dt) : null;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const tg = this.targets[i];
      if (!tg.alive) {
        tg.dying += dt;
        const k = tg.dying / 0.6;
        const sc = (tg.slot ? tg.slot.scale : 1);
        tg.group.scale.setScalar(Math.max(0.001, sc * (1 - k)));
        tg.group.position.y = (tg.baseY || 0) + k * 1.5;
        tg.group.rotation.z += dt * 6;
        if (tg.dying > 0.6) {
          this.scene.remove(tg.group);
          this.targets.splice(i, 1);
          if (tg.slot) { tg.slot.target = null; tg.slot.respawn = CIRCUIT_RESPAWN; }
        }
        continue;
      }
      if (tg.bullseye) {
        tg.bobT += dt;
        tg.bullseye.position.y = tg.bullLocalY + Math.sin(tg.bobT * 2) * 0.2;
        tg.bullseye.rotation.y += dt * 0.8;
      }
      if (tg.special) {
        tg.group.rotation.y += dt * 1.5;   // super turd spins
      } else if (mosh && tg.slot && !tg.slot.vip) {
        this._moshFan(tg, dt, m);
      } else {
        tg.sway += dt; tg.group.rotation.z = Math.sin(tg.sway * 2) * 0.04; // gentle sway
      }
      // every person turns to face the falling turd (timed to land in the face)
      if (tg.faces && !tg.special) {
        const wobble = Math.sin(tg.sway * 0.8 + tg.moshPhase) * 0.1;
        tg.group.rotation.y = this._orientToTurd(tg, dt, tg.slot.faceY || 0) + wobble;
        this._applyShock(tg);
      }
    }
    // refill empty slots whose respawn timer has elapsed
    for (const slot of this.slots) {
      if (slot.target) continue;
      slot.respawn -= dt;
      if (slot.respawn <= 0) this._spawnSlot(slot);
    }
    // cadence: never let the crowd go too long without a power-up
    if (!this._hasSuper() && this._sinceSuper > SUPER_MAX_GAP) this._forceSuperCircuit();
  }

  // Drained by the game loop so it can fire the announcement toast + crowd roar
  // on the beat a wall of death is called ('call') and on impact ('clash').
  consumeWodEvent() {
    if (!this._mosh || !this._mosh.event) return null;
    const e = this._mosh.event; this._mosh.event = null; return e;
  }

  // Advance the wall-of-death state machine one tick and derive the pit-wide
  // factors every fan reads: how wide the lane has opened (`gap`), how far the
  // walls have closed across it (`converge`), how squared-up they are to the
  // centre (`face`) and how hard they're leaning in (`lean`).
  _stepMoshPit(dt) {
    const m = this._mosh;
    m.clock = (m.clock || 0) + dt;
    m.t += dt;
    const advance = (next, dur) => { if (m.t >= dur) { m.state = next; m.t = 0; } };
    switch (m.state) {
      case 'wander':
        if (m.t >= m.next) { m.state = 'part'; m.t = 0; m.event = 'call'; }
        break;
      case 'part':  advance('brace', WOD.PART); break;
      case 'brace': advance('charge', WOD.BRACE); break;
      case 'charge':
        if (m.t >= WOD.CHARGE) { m.state = 'clash'; m.t = 0; m.event = 'clash'; }
        break;
      case 'clash': advance('recover', WOD.CLASH); break;
      case 'recover':
        if (m.t >= WOD.RECOVER) {
          m.state = 'wander'; m.t = 0;
          m.next = WOD.WANDER + Math.random() * WOD.WANDER_RAND;
        }
        break;
    }
    let gap = 0, converge = 0, face = 0, lean = 0;
    const p = m.t;
    switch (m.state) {
      case 'part':  { const k = smooth(p / WOD.PART); gap = k * WOD.GAP; face = k * 0.7; break; }
      case 'brace': gap = WOD.GAP; face = 1; lean = smooth(p / WOD.BRACE) * WOD.LEAN; break;
      case 'charge': { const k = smooth(p / WOD.CHARGE); gap = WOD.GAP * (1 - k); converge = k; face = 1; lean = WOD.LEAN; break; }
      case 'clash': { const k = smooth(p / WOD.CLASH); converge = 1; face = 1 - k * 0.5; lean = WOD.LEAN * (1 - k); break; }
      case 'recover': { const k = smooth(p / WOD.RECOVER); converge = 1 - k; face = (1 - k) * 0.5; break; }
    }
    m.gap = gap; m.converge = converge; m.face = face; m.lean = lean;
    return m;
  }

  // Position one moshing fan: an always-on churn (jump + swirl + a surge wave
  // rolling toward the stage) with the wall-of-death displacement layered on top
  // when one is running.
  _moshFan(tg, dt, m) {
    tg.sway += dt;
    const ph = tg.moshPhase;
    const jump = Math.abs(Math.sin(tg.sway * tg.moshFreq + ph)) * tg.moshAmp;
    const swirlX = Math.sin(tg.sway * 1.1 + ph) * 0.28 + Math.sin(tg.sway * 0.6 + ph * 1.7) * 0.16;
    const swirlZ = Math.cos(tg.sway * 0.9 + ph) * 0.22;
    const surge = Math.sin(m.clock * 1.3 - tg.homeZ * 0.22) * 0.5; // crowd pushes toward the stage (-z)

    // lane opens (gap) then the walls slam across it (converge), interleaving in
    // a churning pile at the centre line.
    const OVERSHOOT = 0.8;
    const gxOpen = tg.homeX + tg.side * m.gap;
    const churn = m.converge * Math.sin(tg.sway * 6 + ph) * 0.7;
    const gxCenter = tg.side * OVERSHOOT + churn;
    const gx = gxOpen + (gxCenter - gxOpen) * m.converge;

    tg.group.position.x = gx + swirlX * (1 - m.converge);
    tg.group.position.z = tg.homeZ + swirlZ + surge + churn * 0.5;
    tg.group.position.y = (tg.baseY || 0) + jump;

    // body lean (the brace/charge of a wall of death) + a little jostle; the
    // yaw (facing the falling turd) is handled centrally by _orientToTurd.
    tg.group.rotation.z = tg.side * m.lean + Math.sin(tg.sway * tg.moshFreq * 0.5 + ph) * 0.12 * (1 - m.face);
  }

  // Swivel one figure to face the incoming turd, paced so it finishes squaring
  // up just as the turd lands ("right in the face"). The model's front is -z at
  // yaw 0, hence atan2(-dx,-dz). With no turd in the air it eases back to its
  // resting heading. Returns the yaw to apply.
  _orientToTurd(tg, dt, idleYaw) {
    const drop = this._drop;
    if (drop) {
      // capture the heading held when this turd launched, so the whole turn is
      // spread across the fall rather than snapping toward a moving target
      if (tg._turdSeq !== drop.id) { tg._turdSeq = drop.id; tg._yaw0 = tg.faceYaw == null ? idleYaw : tg.faceYaw; }
      const aim = Math.atan2(-(drop.x - tg.group.position.x), -(drop.z - tg.group.position.z));
      const e = smooth(Math.min(1, (drop.t / drop.tFall) / 0.85)); // fully faced by ~85% of the fall
      tg.faceYaw = tg._yaw0 + angDelta(aim, tg._yaw0) * e;
    } else {
      const cur = tg.faceYaw == null ? idleYaw : tg.faceYaw;
      tg.faceYaw = cur + angDelta(idleYaw, cur) * Math.min(1, dt * 1.6);
    }
    return tg.faceYaw;
  }

  // Swap a figure to a shocked face while a turd is falling toward its splat
  // zone, back to normal once the threat's gone. Only fires on expression
  // changes, so it's cheap to call every frame.
  _applyShock(tg) {
    if (!tg.faceCtl) return;
    const d = this._drop;
    let shock = false;
    if (d && d.t < d.tFall) {
      const dx = d.lx - tg.group.position.x;
      const dz = d.lz - tg.group.position.z;
      shock = Math.hypot(dx, dz) <= tg.radius + (d.r || 0) + SHOCK_MARGIN;
    }
    if (shock !== tg._shocked) { tg._shocked = shock; tg.faceCtl(shock); }
  }

  // March the spawn cursor one gap further ahead and return the new z.
  _advanceFront() {
    this._frontZ -= SPAWN_GAP;
    return this._frontZ;
  }

  // Is a super turd currently live? (we only ever keep one in play at a time)
  _hasSuper() {
    return this.targets.some((t) => t.alive && t.special);
  }

  // Spawn a target at lane position z (random x within the corridor).
  spawn(typeKey, z) {
    // Roll the golden SUPER TURD instead of a normal target — either by chance
    // or because the cadence timer forced one (and only one alive at a time).
    const forced = this._forceSuper && !typeKey && !this._hasSuper();
    const makeSuper = forced || (!typeKey && !this._hasSuper() && Math.random() < SUPER_CHANCE);
    let key, cfg, group, special = null;
    if (makeSuper) {
      special = 'super';
      key = 'superturd';
      cfg = SUPER_CFG;
      group = buildSuperTurd();
      this._sinceSuper = 0;
      this._forceSuper = false;
    } else {
      key = typeKey || TYPE_KEYS[(Math.random() * TYPE_KEYS.length) | 0];
      cfg = TYPES[key];
      group = cfg.build();
    }

    const orbit = !!cfg.moving;
    const x = (Math.random() * 2 - 1) * COURSE_HALF;
    group.position.set(x, 0, z);
    // statics face up the lane toward the oncoming bird; movers face the way
    // they sweep across it (crossing traffic).
    group.rotation.y = orbit ? Math.PI / 2 : 0;
    group.scale.setScalar(TARGET_SCALE);

    const localTop = group.userData.headHeight || 2;
    const bullseye = buildBullseye();
    bullseye.position.y = localTop + 1.4; // local space (group is scaled)
    group.add(bullseye);

    this.scene.add(group);

    const t = {
      key, group, bullseye,
      cfg, value: cfg.value, radius: cfg.radius * TARGET_SCALE,
      hitY: localTop * TARGET_SCALE,   // world-space top, for collision
      bullLocalY: localTop + 1.4,      // local-space bob base for the bullseye
      orbit, special, baseX: x,
      driftPhase: Math.random() * Math.PI * 2,
      bobT: Math.random() * 10,
      // beachgoers, kids and cyclists turn to look up at the incoming turd
      faces: key === 'person' || key === 'kid' || key === 'biker',
      faceCtl: group.userData.setShocked || null,  // shocked face when about to be splatted
      alive: true,
      dying: 0,
    };
    this.targets.push(t);
    return t;
  }

  update(dt, t, birdPos, drop) {
    // The live falling turd (or null) every figure swivels to face.
    this._drop = drop || null;
    if (this.mode === 'circuit') { this._updateCircuit(dt); return; }
    this._sinceSuper += dt;
    if (!this._hasSuper() && this._sinceSuper > SUPER_MAX_GAP) this._forceSuper = true;
    const bz = birdPos ? birdPos.z : 0;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const tg = this.targets[i];

      // death animation
      if (!tg.alive) {
        tg.dying += dt;
        const k = tg.dying / 0.6;
        tg.group.scale.setScalar(Math.max(0.001, TARGET_SCALE * (1 - k)));
        tg.group.position.y = k * 1.5;
        tg.group.rotation.z += dt * 6;
        if (tg.dying > 0.6) {
          this.scene.remove(tg.group);
          this.targets.splice(i, 1);
          this.spawn(null, this._advanceFront()); // refill the stream up ahead
        }
        continue;
      }

      // recycle a target that the bird has flown well past
      if (tg.group.position.z > bz + RECYCLE_BEHIND) {
        this.scene.remove(tg.group);
        this.targets.splice(i, 1);
        this.spawn(null, this._advanceFront());
        continue;
      }

      // bobbing bullseye (local space; group scale carries it to world size)
      tg.bobT += dt;
      tg.bullseye.position.y = tg.bullLocalY + Math.sin(tg.bobT * 2) * 0.25;
      tg.bullseye.rotation.y += dt * 0.8;

      // the super turd slowly spins so its gold catches the eye
      if (tg.special) tg.group.rotation.y += dt * 1.5;

      // movers sweep across the lane like crossing traffic
      if (tg.orbit) {
        tg.driftPhase += DRIFT_OMEGA * dt;
        const x = tg.baseX + Math.sin(tg.driftPhase) * DRIFT_AMP;
        tg.group.position.x = THREE.MathUtils.clamp(x, -COURSE_HALF, COURSE_HALF);
        if (tg.group.userData.wheels) {
          for (const w of tg.group.userData.wheels) w.rotation.x -= dt * 3;
        }
      }

      // beachgoers turn to face the falling turd, timed to land in the face;
      // they relax back to their lane heading once it's gone
      if (tg.faces && !tg.special) {
        tg.sway = (tg.sway || 0) + dt;
        tg.group.rotation.y = this._orientToTurd(tg, dt, tg.orbit ? Math.PI / 2 : 0);
        this._applyShock(tg);
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

  kill(tg) {
    tg.alive = false;
    tg.dying = 0;
    if (tg.bullseye) tg.bullseye.visible = false;
  }
}
