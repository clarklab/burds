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

It's an **infinite runner**: the seagull always flies forward down a long,
straight beach lane (think Temple Run). You can't turn around — you line up the
drops as targets stream toward you.

- **Drag left/right** to strafe across the lane; **drag up/down** to climb or
  dive (altitude changes how far ahead the drop lands).
- The **throw is fixed** — the poop always lands the same distance ahead. Aiming
  is about strafing under an oncoming target and releasing on the beat.
- A **reticle** on the ground shows where the poop will land. It starts **3×
  oversized** and **hones down to the firing size** as a target lines up under
  it — when it's tight, the target will be hit, so that's your cue to **release**.
- **Hold the 💩 button longer** for a **bigger turd** (and a bigger splat). Hold
  time only changes the turd's size now, never the range.
- Every drop leaves a flat splat on the ground; a **direct hit** adds an extra
  **splash** burst.
- Land near a target and the game drops into **bullet time**, swinging the
  camera around to show precisely where you splat.
- Dead-center hits are **BULLSEYES** (3×). Chain hits without missing to build a
  **combo multiplier**. You've got 30 seconds — rack up the score.
- Keep an eye out for the rare golden **SUPER TURD**. Bomb it and the seagull
  powers up — super-Saiyan camera spin, crackling lightning, and an elated
  squawk — then drops **giant 2.5× turds for 15 seconds**. The huge turds splat
  over a much wider area, so they're far easier to land.
- **SUPER TURD MODE stacks.** Bomb another super turd while it's active and your
  turds grow *even bigger*, the timer extends, and a points multiplier climbs:
  **1.5× → 2× → 2.5×** and up. Stack **three** in a row and the bird bursts into
  **🔥 TURD FIRE**, raining down streaking lava-comet fireballs.

Targets: beachgoers, kids, picnics, cyclists, and cars (cyclists and cars sweep
across the lane like crossing traffic, so you'll need to lead them). They're all
sized up nice and big, so they're forgiving to hit.

The lane runs down a sun-drenched **Croatian coastline** — slender cypresses,
umbrella pines and palms stream past on the shoulders, with rocks lining the
shore.

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
