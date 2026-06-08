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

## Offline & updates

The game ships a service worker (`sw.js`) and a web app manifest, so it's a
proper installable PWA:

- **Plays offline.** Load it once over the network and the service worker
  precaches every asset (HTML, CSS, all of `src/`, and the vendored Three.js).
  After that first play it boots from cache — no connection required — and you
  can add it to your home screen for a fullscreen, tap-to-launch experience.
- **Auto-updates ("JS buster").** When you ship changes, bump `CACHE_VERSION`
  in `sw.js`. The next time a player has internet (the page re-checks on focus
  and on the `online` event), the new worker precaches the fresh files, drops
  the old cache, takes over, and reloads onto the new build — no stale
  JavaScript left behind.

> Service workers require a secure context, so they're active over `https://`
> and on `http://localhost` (handy for local testing).

## How to play

- **Drag anywhere** on the screen to fly and steer (a virtual joystick). Drag
  up to climb, down to dive, left/right to bank.
- **Let go** and an auto-pilot banks the bird onto the nearest target *ahead*
  of you — lining up the drop direction so you only have to charge for range.
  Grab the stick again any time to take back full control.
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
index.html        # entry, import map, HUD + menu markup, SW registration
styles.css        # mobile-first UI
sw.js             # service worker: offline cache + version-based buster
manifest.webmanifest  # PWA manifest (installable, fullscreen)
icon.svg          # app / home-screen icon
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
