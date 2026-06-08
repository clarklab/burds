import * as THREE from 'three';
import {
  buildPerson, buildKid, buildBiker, buildPicnic, buildCar,
  buildUmbrella, buildPalm, mat,
} from './models.js';

export const WORLD_RADIUS = 130;     // playable radius
const SPAWN_RADIUS = 108;            // targets spawn within this
const SHORE_Z = 30;                  // z < SHORE_Z(ish) is water side

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
  biker:   { build: buildBiker,  value: 200, radius: 1.3, moving: true,  speed: 9,  label: 'Cyclist' },
  car:     { build: buildCar,    value: 175, radius: 2.2, moving: true,  speed: 13, label: 'Car' },
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
    for (let i = 0; i < this.maxTargets; i++) this.spawn();
  }

  randomPos(avoidRoad = true) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 25 + Math.random() * SPAWN_RADIUS;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad * 0.65 + 25;
      if (z < -6) continue; // not in the sea
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3((Math.random() - 0.5) * 120, 0, 40);
  }

  spawn(typeKey) {
    const key = typeKey || TYPE_KEYS[(Math.random() * TYPE_KEYS.length) | 0];
    const cfg = TYPES[key];
    const group = cfg.build();

    let pos, dir = null, speed = 0;
    if (cfg.moving) {
      // roll along the road strip (z ~ 70), pick a direction
      const goRight = Math.random() < 0.5;
      pos = new THREE.Vector3((goRight ? -1 : 1) * (WORLD_RADIUS + 10), 0, 70 + (Math.random() - 0.5) * 6);
      dir = new THREE.Vector3(goRight ? 1 : 0, 0, 0);
      dir.x = goRight ? 1 : -1;
      speed = cfg.speed;
      group.rotation.y = goRight ? Math.PI / 2 : -Math.PI / 2;
    } else {
      pos = this.randomPos();
      group.rotation.y = Math.random() * Math.PI * 2;
    }
    group.position.copy(pos);

    const bullseye = buildBullseye();
    const topH = group.userData.headHeight || 2;
    bullseye.position.y = topH + 1.4;
    group.add(bullseye);

    this.scene.add(group);

    const t = {
      key, group, bullseye,
      cfg, value: cfg.value, radius: cfg.radius,
      hitY: topH,
      dir, speed,
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
          this.spawn();
        }
        continue;
      }

      // bobbing bullseye
      tg.bobT += dt;
      tg.bullseye.position.y = tg.hitY + 1.4 + Math.sin(tg.bobT * 2) * 0.25;
      tg.bullseye.rotation.y += dt * 0.8;

      // movement for cars/bikers
      if (tg.dir) {
        tg.group.position.addScaledVector(tg.dir, tg.speed * dt);
        // wheels spin
        if (tg.group.userData.wheels) {
          for (const w of tg.group.userData.wheels) w.rotation.x -= dt * tg.speed * 1.5;
        }
        // wrap around when off the edge
        if (Math.abs(tg.group.position.x) > WORLD_RADIUS + 14) {
          tg.group.position.x = -Math.sign(tg.group.position.x) * (WORLD_RADIUS + 12);
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
  // only considers targets *ahead* of the bird (within a forward cone) and
  // beyond a minimum distance, so the autopilot stops trying to U-turn back
  // onto things it has already flown over. Falls back to the global nearest
  // when there's nothing ahead, so the bird will still come around to hunt.
  nearestAhead(pos, yaw, { maxAngle = Math.PI * 0.55, minDist = 14 } = {}) {
    let best = null, bestScore = Infinity, bestDist = 0;
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const dx = tg.group.position.x - pos.x;
      const dz = tg.group.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < minDist) continue; // basically underneath / just passed
      // bearing of the target relative to the current heading, in [-PI, PI]
      const rel = Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw),
                             Math.cos(Math.atan2(dx, dz) - yaw));
      if (Math.abs(rel) > maxAngle) continue; // behind us / too far to the side
      // Prefer closer and more head-on targets so we commit to one run.
      const score = d * (1 + Math.abs(rel) * 0.9);
      if (score < bestScore) { bestScore = score; best = tg; bestDist = d; }
    }
    return best ? { target: best, dist: bestDist } : this.nearest(pos);
  }

  kill(tg) {
    tg.alive = false;
    tg.dying = 0;
    if (tg.bullseye) tg.bullseye.visible = false;
  }
}
