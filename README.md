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

## Levels

Pick a level at the start screen — each keeps its **own high score**:

- **🏖️ Beach** — the original infinite runner (below).
- **💒 Wedding** — a garden ceremony: guests in chairs in rows with an aisle
  down the centre, the **couple & priest** at the head of the aisle (worth
  **double**). The bird flies the aisle on **auto-pilot**, sweeps past the
  couple, banks around, and loops back over the crowd again and again — you only
  steer **altitude** and when/how-big to drop.
- **🎸 Rock Concert** — a packed pit between barriers with a **band** up on the
  stage (worth **double**). Same auto-looping flight, vertical control only.

The two venue levels pack the crowd in **tight**, so a big, fully-charged turd
(and especially a giant **SUPER TURD**) **splashes a whole cluster at once** —
chase the biggest multi-hit combos you can.

## How to play

The **Beach** is an **infinite runner**: the seagull always flies forward down a
long, straight beach lane (think Temple Run). You can't turn around — you line up
the drops as targets stream toward you.

- **Drag left/right** to strafe across the lane; **drag up/down** to climb or
  dive (altitude changes how far ahead the drop lands).
- The **throw is fixed** — the poop always lands the same distance ahead. Aiming
  is about strafing under an oncoming target and releasing on the beat.
- A **reticle** on the ground shows where the poop will land. It starts **3×
  oversized** and **hones down to the firing size** as a target lines up under
  it — when it's tight, the target will be hit, so that's your cue to **release**.
- **Hold the 💩 button longer** for a **bigger turd** (and a bigger splat). Hold
  time only changes the turd's size now, never the range.
- The bird **cycles through four turd shapes** as you drop — the classic 💩
  swirl, a long **Mr. Hanky log**, a tight clump of **BB pellets**, and a
  white-brown **liquidy splatter** that stabs down like a lightning bolt. They
  all fly the exact same physics arc; each just **splats differently** on impact
  (a round pop, a skidding smear, a wide pellet spray, or a wet starburst).
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
sized up nice and big, so they're forgiving to hit. The crowd is *alive*:
beachgoers stroll about with swinging arms, kids sprint circles towing
balloons, the convertible has a driver at the wheel, picnickers lounge on the
blanket — and anyone about to be splatted gasps, faces the incoming turd and
throws their arms up in panic.

The lane runs down a sun-drenched **Croatian coastline** — slender cypresses,
umbrella pines and palms stream past on the shoulders, with rocks, surf foam,
towels, sandcastles and lifeguard towers lining the shore, sailboats bobbing
out on the bay, clouds drifting overhead and hazy headlands on the horizon.

## Tech notes

- **Procedural PS2-style models** — the bird is a smooth lathe-turned gull and
  the whole cast is built from capsule limbs and painted canvas textures
  (cloth weaves, boardwalk planks, sand grain, animated water), all generated
  at runtime. No external FBX/OBJ/texture assets to download or break, and
  ACES filmic tone mapping grades the final frame.
- **Built for phones** — primitive geometries are cached and shared across the
  whole cast (a 125-person crowd shares one torso buffer), every static mesh
  has its matrix frozen so per-frame CPU stays low, render resolution steps
  down automatically on devices that can't hold frame rate, and a lost WebGL
  context recovers with a clean reload.
- **Analytic projectile motion** — the poop integrates position in closed form,
  so the predicted-landing reticle is always truthful.
- **WebAudio synth + sampled soundtrack** — moment-to-moment blips (charge,
  splat, bullseye) are synthesized at runtime, layered with recorded samples:
  per-level ambience (surf on the beach, a slow wedding march with guest
  murmurs, heavy metal at the gig), "oh no!" / gasp / scream crowd reactions
  on every hit, and a real seagull cry on power-ups. Samples are royalty-free
  recordings from [Pixabay](https://pixabay.com/) (Pixabay Content License,
  no attribution required), mastered to small mono MP3s in `audio/` and
  precached by the service worker; if any file is missing the synth fallbacks
  keep the game fully scored.

## Project layout

```
index.html        # entry, import map, HUD + menu markup, SW registration
styles.css        # mobile-first UI
sw.js             # service worker: offline cache + version-based buster
manifest.webmanifest  # PWA manifest (installable, fullscreen)
icon.svg          # app / home-screen icon
audio/            # ambience loops + SFX samples (Pixabay Content License)
vendor/           # vendored three.module.js
src/
  main.js         # game loop, flight (runner + circuit), physics, scoring
  world.js        # beach / wedding / concert venues + target manager
  levels.js       # level registry + wedding/concert crowd layouts
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

There's also a visual QA harness that boots all three venues on auto-pilot,
screenshots each one (`test/shot-*.png`) and fails on any console error:

```bash
node test/venues.mjs
```

…and a close-up character line-up portrait for art QA:

```bash
node test/lineup.mjs
```

…and a line-up of the four turd shapes with their ground splats and target
splashes, for tuning the poop art:

```bash
node test/poopshapes.mjs   # writes test/shot-poopshapes.png
```

…and a side-by-side of the two power-up auras (super-Saiyan lightning + TURD
FIRE) for tuning the VFX:

```bash
node test/auras.mjs        # writes test/shot-auras.png
```
