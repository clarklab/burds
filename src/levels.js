// ---------------------------------------------------------------------------
// Level registry. Three picks at game start, each tracking its own high score:
//
//   beach   — the original infinite-runner: strafe + dive down an endless lane.
//   wedding — a fixed garden ceremony the bird auto-loops over (vertical-only).
//   concert — a fixed gig the bird auto-loops over (vertical-only).
//
// The two "circuit" levels share a flight model: the bird flies itself back and
// forth along the venue (past the couple/band, turn, back past the crowd,
// turn…), and the player only controls altitude + when/how-big to drop. Targets
// are packed tight so a big, fully-charged turd splashes many at once.
// ---------------------------------------------------------------------------
import { buildWorld, buildWeddingWorld, buildConcertWorld } from './world.js';
import {
  buildSeatedGuest, buildGroom, buildBride, buildPriest, buildBandMember, buildFan,
} from './models.js';

// ---- wedding: guests in chairs in rows, aisle down the centre, couple/priest
//      at the head of the aisle (worth double) ------------------------------
function weddingLayout() {
  const slots = [];
  const VIP = 200, GUEST = 100;
  // couple + officiant at the head of the aisle, facing the guests (+Z)
  slots.push({ kind: 'groom',  build: buildGroom,  x: -1.8, z: -47, faceY: Math.PI, value: VIP, scale: 1.2, radius: 1.4, vip: true, bull: true });
  slots.push({ kind: 'bride',  build: buildBride,  x: 1.8,  z: -47, faceY: Math.PI, value: VIP, scale: 1.2, radius: 1.4, vip: true, bull: true });
  slots.push({ kind: 'priest', build: buildPriest, x: 0,    z: -50, faceY: Math.PI, value: VIP, scale: 1.2, radius: 1.4, vip: true, bull: true });
  // guests packed into chairs on both sides of the aisle, facing the altar (-Z)
  const rows = 12, seatX = [2.0, 3.6, 5.2, 6.8, 8.4];
  for (let r = 0; r < rows; r++) {
    const z = -38 + r * 4.0;
    for (const sx of [-1, 1]) for (const x of seatX) {
      slots.push({ kind: 'guest', build: buildSeatedGuest, x: sx * x, z, faceY: 0, value: GUEST, scale: 1.0, radius: 1.2, vip: false, bull: false });
    }
  }
  return slots;
}

// ---- concert: a throng between barriers (no aisle), band up on the stage
//      (worth double) -------------------------------------------------------
function concertLayout() {
  const slots = [];
  const BAND = 200, FAN = 100;
  const stageY = 1.8, stageZ = -50;
  slots.push({ kind: 'singer', build: () => buildBandMember('mic'),    x: 0,  z: stageZ,     y: stageY, faceY: Math.PI, value: BAND, scale: 1.2, radius: 1.4, vip: true, bull: true });
  slots.push({ kind: 'guitar', build: () => buildBandMember('guitar'), x: -7, z: stageZ + 1, y: stageY, faceY: Math.PI, value: BAND, scale: 1.2, radius: 1.4, vip: true, bull: true });
  slots.push({ kind: 'bass',   build: () => buildBandMember('bass'),   x: 7,  z: stageZ + 1, y: stageY, faceY: Math.PI, value: BAND, scale: 1.2, radius: 1.4, vip: true, bull: true });
  slots.push({ kind: 'drums',  build: () => buildBandMember('drums'),  x: 0,  z: stageZ - 3, y: stageY, faceY: Math.PI, value: BAND, scale: 1.2, radius: 1.4, vip: true, bull: true });
  // a dense, packed throng of fans facing the stage (-Z)
  const rows = 14, cols = [-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10];
  for (let r = 0; r < rows; r++) {
    const z = -42 + r * 4.2;
    for (const x of cols) {
      slots.push({
        kind: 'fan', build: buildFan,
        x: x + (Math.random() - 0.5) * 0.9, z: z + (Math.random() - 0.5) * 1.1,
        faceY: 0, value: FAN, scale: 1.0, radius: 1.2, vip: false, bull: false,
      });
    }
  }
  return slots;
}

export const LEVELS = [
  {
    id: 'beach',
    name: 'Beach',
    emoji: '🏖️',
    mode: 'runner',
    controls: 'Strafe + dive',
    build: buildWorld,
    howto: [
      { icon: '👆', html: 'Drag left/right to <b>strafe</b> down the lane (up/down to dive)' },
      { icon: '🎯', html: 'Line up under a target — the <b>reticle hones</b> from big to tight' },
      { icon: '💩', html: '<b>Release</b> when it’s tight to splat. Hold longer = <b>bigger turd</b>' },
      { icon: '⭐', html: 'Dead-center = <b>bullseye</b>, big points' },
      { icon: '⚡', html: 'Bomb the gold <b>SUPER TURD</b> for 15s of giant turds' },
    ],
  },
  {
    id: 'wedding',
    name: 'Wedding',
    emoji: '💒',
    mode: 'circuit',
    controls: 'Steer + dive',
    build: buildWeddingWorld,
    circuit: { startZ: 40, frontTurnZ: -64, backTurnZ: 44, halfWidth: 10 },
    layout: weddingLayout,
    howto: [
      { icon: '👆', html: 'You loop the aisle on <b>auto-pilot</b> — <b>steer</b> left/right &amp; dive to aim' },
      { icon: '💩', html: '<b>Hold</b> to grow a huge turd; big ones <b>splash whole rows</b>' },
      { icon: '💒', html: 'The <b>couple &amp; priest</b> up front are worth <b>double</b>' },
      { icon: '🔁', html: 'You loop past the crowd again and again — chain combos' },
      { icon: '⚡', html: 'Gold <b>SUPER TURD</b>s keep popping up for giant turds' },
    ],
  },
  {
    id: 'concert',
    name: 'Concert',
    emoji: '🎸',
    mode: 'circuit',
    controls: 'Steer + dive',
    build: buildConcertWorld,
    circuit: { startZ: 46, frontTurnZ: -66, backTurnZ: 50, halfWidth: 13 },
    mosh: true,
    layout: concertLayout,
    howto: [
      { icon: '👆', html: 'Auto-pilot over the pit — <b>steer</b> left/right &amp; dive to aim' },
      { icon: '💩', html: '<b>Hold</b> for a giant turd that <b>splashes a mosh of fans</b>' },
      { icon: '🎸', html: '<b>Band members</b> on the stage are worth <b>double</b>' },
      { icon: '🔁', html: 'Loop the pit over and over — chain massive combos' },
      { icon: '⚡', html: 'Gold <b>SUPER TURD</b>s keep dropping for total mayhem' },
    ],
  },
];

export const LEVELS_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
export const DEFAULT_LEVEL = 'beach';
