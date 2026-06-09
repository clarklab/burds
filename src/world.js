import * as THREE from 'three';
import {
  buildPerson, buildKid, buildBiker, buildPicnic, buildCar,
  buildUmbrella, buildPalm, buildCypress, buildPine, buildRock,
  buildSuperTurd, mat,
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
  scene.add(sky);

  // The sun billboard (kept at a fixed offset from the bird).
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(28, 24), new THREE.MeshBasicMaterial({ color: 0xfff7cf }));
  const sunOffset = new THREE.Vector3(150, 180, -260);
  sunDisc.position.copy(sunOffset);
  scene.add(sunDisc);

  // Ground: big sand disc that re-centres on the bird (a circle looks identical
  // from any centre, so the slide is seamless).
  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD_RADIUS + 40, 48),
    mat(0xf2d79b),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.receiveShadow = true;
  scene.add(sand);

  // Sea: a long plane running along the lane on the far left side.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 1200), mat(0x2aa3d6, { transparent: true, opacity: 0.92 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-200, 0.05, 0);
  scene.add(sea);
  // Wet shoreline band between the sea and the sand.
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(60, 1200), mat(0x7fd0e0, { transparent: true, opacity: 0.6 }));
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(-92, 0.06, 0);
  scene.add(shore);

  // Courseway: a boardwalk strip running ALONG the lane (down -Z), with dashes
  // marching down the middle. Snapping its z to the dash pitch keeps the dashes
  // from visibly sliding as it scrolls with the bird.
  const DASH_PITCH = 12;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(COURSE_HALF * 2 + 6, 1200), mat(0x6d6f78));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.08, 0);
  scene.add(road);
  const dashes = new THREE.Group();
  for (let i = -50; i < 50; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 5), mat(0xffe066));
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.1, i * DASH_PITCH);
    dashes.add(dash);
  }
  scene.add(dashes);

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
  scene.add(decorGroup);

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
  scene.add(rocksGroup);

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
  }

  reset(birdPos) {
    for (const t of this.targets) this.scene.remove(t.group);
    this.targets = [];
    const baseZ = birdPos ? birdPos.z : 0;
    this._frontZ = baseZ - SPAWN_AHEAD + SPAWN_GAP; // first _advanceFront lands at -SPAWN_AHEAD
    for (let i = 0; i < this.maxTargets; i++) this.spawn(null, this._advanceFront());
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
    // Occasionally roll the rare golden SUPER TURD instead of a normal target.
    const makeSuper = !typeKey && !this._hasSuper() && Math.random() < SUPER_CHANCE;
    let key, cfg, group, special = null;
    if (makeSuper) {
      special = 'super';
      key = 'superturd';
      cfg = SUPER_CFG;
      group = buildSuperTurd();
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
      alive: true,
      dying: 0,
    };
    this.targets.push(t);
    return t;
  }

  update(dt, t, birdPos) {
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
