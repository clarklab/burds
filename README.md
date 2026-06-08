# 🐦💩 Burds — a game about bird turds

A mobile-first, browser-based 3D game where **you are a seagull** cruising the
boardwalk, dropping bombs on unsuspecting beachgoers. Tap to poop, hold to poop
*harder*, and watch the slow-mo **bullet time** as your payload zeroes in on the
target. Quick to pick up, ~30 seconds a round.

Built with **[Three.js](https://threejs.org/)** and real projectile physics.
No build step, no frameworks — just open it and play.

## Play

Serve the folder with any static server and open it in a browser (works great on
a phone):

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Three.js is vendored locally in `vendor/` so the game runs with no external
network calls.

## How to play

- **Drag anywhere** on the screen to fly and steer (a virtual joystick). Drag
  up to climb, down to dive, left/right to bank.
- **Let go** and an auto-pilot gently banks the bird toward the nearest target,
  so you can focus on charging and dropping the bomb. Grab the stick again any
  time to take back full control.
- **Hold the 💩 button** to charge power, then **release** to drop. A quick tap
  drops almost straight down; a full charge flings it far ahead.
- A **reticle** on the ground shows exactly where your poop will land — it turns
  green when you're lined up on a target.
- Land near a target and the game drops into **bullet time**, swinging the
  camera around to show precisely where you splat.
- Dead-center hits are **BULLSEYES** (3×). Chain hits without missing to build a
  **combo multiplier**. You've got 30 seconds — rack up the score.

Targets: beachgoers, kids, picnics, cyclists, and cars (cyclists and cars move,
so you'll need to lead them).

## Tech notes

- **Procedural low-poly models** — the bird, people, kid, biker, picnic, car,
  palms and umbrellas are all generated from primitives with flat shading. No
  external FBX/OBJ assets to download or break.
- **Analytic projectile motion** — the poop integrates position in closed form,
  so the predicted-landing reticle is always truthful.
- **WebAudio synth** — all sound effects are generated at runtime; no audio
  files.

## Project layout

```
index.html        # entry, import map, HUD + menu markup
styles.css        # mobile-first UI
vendor/           # vendored three.module.js
src/
  main.js         # game loop, flight, physics, bullet time, scoring
  world.js        # beach scene + target manager
  models.js       # procedural low-poly model builders
  input.js        # touch joystick + poop button + keyboard
  effects.js      # splats, decals, reticle, bird shadow
  audio.js        # WebAudio sound effects
test/
  smoke.mjs       # headless Playwright smoke test
```

## Dev: run the smoke test

The smoke test boots a static server, loads the game in headless Chromium,
flies the bird, fires aimed poops, and asserts that scoring + bullet time work
with no console errors:

```bash
npm i -D playwright   # or use a global install
node test/smoke.mjs
```
