// ---------------------------------------------------------------------------
// Input: a virtual "joystick" for flight (drag anywhere on the canvas) plus the
// poop button (tap = quick drop, hold = charge power). Also keyboard for desktop.
// ---------------------------------------------------------------------------
export class Input {
  constructor(canvas, poopBtn) {
    this.canvas = canvas;
    this.poopBtn = poopBtn;

    // steering, range roughly [-1, 1]
    this.steerX = 0; // yaw: + = right
    this.steerY = 0; // pitch: + = climb

    // poop charging
    this.charging = false;
    this.charge = 0;            // 0..1
    this.releasedPower = null;  // set on release, consumed by game
    this.enabled = true;        // can we poop right now?

    this._steerTouchId = null;
    this._anchor = { x: 0, y: 0 };
    // While the poop button is held to charge, the SAME finger can swipe to
    // steer — we anchor at the press point and steer off horizontal/vertical drag.
    this._btnTouchId = null;
    this._btnAnchor = { x: 0, y: 0 };
    this._keys = {};

    this._bind();
  }

  _bind() {
    const c = this.canvas;

    // Set steering from a drag offset relative to an anchor. `maxR` is the swipe
    // distance for full deflection (smaller = more sensitive).
    const steerFrom = (x, y, anchor, maxR) => {
      const dx = Math.max(-1, Math.min(1, (x - anchor.x) / maxR));
      const dy = Math.max(-1, Math.min(1, (y - anchor.y) / maxR));
      this.steerX = dx;
      this.steerY = -dy; // drag up => climb
    };

    const start = (id, x, y) => {
      if (this._steerTouchId !== null) return;
      this._steerTouchId = id;
      this._anchor.x = x;
      this._anchor.y = y;
    };
    const move = (x, y) => {
      steerFrom(x, y, this._anchor, Math.min(window.innerWidth, window.innerHeight) * 0.28);
    };
    const end = () => {
      this._steerTouchId = null;
      this.steerX = 0;
      this.steerY = 0;
    };

    // Touch
    c.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) start(t.identifier, t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._steerTouchId) move(t.clientX, t.clientY);
      }
      e.preventDefault();
    }, { passive: false });
    const touchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._steerTouchId) end();
      }
      e.preventDefault();
    };
    c.addEventListener('touchend', touchEnd, { passive: false });
    c.addEventListener('touchcancel', touchEnd, { passive: false });

    // Mouse (desktop testing)
    c.addEventListener('mousedown', (e) => { start('mouse', e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => { if (this._steerTouchId === 'mouse') move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (this._steerTouchId === 'mouse') end(); });

    // Poop button. Holding it charges; while held, the same finger can swipe to
    // steer (id `null` = keyboard, which never steers). We anchor at the press
    // point and steer off the drag, using a smaller radius so a thumb pinned to
    // the corner button can still reach full deflection.
    const pb = this.poopBtn;
    const startCharge = (id, x, y, e) => {
      if (e) e.preventDefault();
      if (!this.enabled || this.charging) return;
      this.charging = true;
      this.charge = 0;
      this._btnTouchId = id;
      this._btnAnchor.x = x;
      this._btnAnchor.y = y;
      pb.classList.add('charging');
    };
    const btnSteer = (x, y) => {
      steerFrom(x, y, this._btnAnchor, Math.min(window.innerWidth, window.innerHeight) * 0.16);
    };
    const stopCharge = (e) => {
      if (e) e.preventDefault();
      this._btnTouchId = null;
      // releasing the charge finger straightens out — unless a canvas joystick
      // touch is also active and owns the steering.
      if (this._steerTouchId === null) { this.steerX = 0; this.steerY = 0; }
      if (!this.charging) return;
      this.charging = false;
      this.releasedPower = this.charge;
      pb.classList.remove('charging');
    };
    pb.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (t) startCharge(t.identifier, t.clientX, t.clientY, e);
    }, { passive: false });
    pb.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._btnTouchId) btnSteer(t.clientX, t.clientY);
      }
      e.preventDefault();
    }, { passive: false });
    pb.addEventListener('touchend', stopCharge, { passive: false });
    pb.addEventListener('touchcancel', stopCharge, { passive: false });
    pb.addEventListener('mousedown', (e) => startCharge('mouse', e.clientX, e.clientY, e));
    window.addEventListener('mousemove', (e) => { if (this._btnTouchId === 'mouse') btnSteer(e.clientX, e.clientY); });
    window.addEventListener('mouseup', (e) => { if (this.charging || this._btnTouchId === 'mouse') stopCharge(e); });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      this._keys[e.code] = true;
      if (e.code === 'Space') { startCharge(null, 0, 0); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      this._keys[e.code] = false;
      if (e.code === 'Space') stopCharge();
    });
  }

  // Per-frame charge accumulation. Returns nothing; game reads .charge.
  update(dt) {
    if (this.charging) {
      this.charge = Math.min(1, this.charge + dt / 1.1); // ~1.1s to full
    }
    // keyboard steering overrides if pressed
    let kx = 0, ky = 0;
    if (this._keys['ArrowLeft'] || this._keys['KeyA']) kx -= 1;
    if (this._keys['ArrowRight'] || this._keys['KeyD']) kx += 1;
    if (this._keys['ArrowUp'] || this._keys['KeyW']) ky += 1;
    if (this._keys['ArrowDown'] || this._keys['KeyS']) ky -= 1;
    if (kx || ky) { this.steerX = kx; this.steerY = ky; }
  }

  // Game calls this to grab a fired poop (or null). Single-shot.
  consumeFire() {
    if (this.releasedPower !== null) {
      const p = this.releasedPower;
      this.releasedPower = null;
      return p;
    }
    return null;
  }

  setEnabled(v) {
    this.enabled = v;
    this.poopBtn.classList.toggle('disabled', !v);
    if (!v && this.charging) {
      // cancel any in-progress charge (and its finger-steering)
      this.charging = false;
      this.charge = 0;
      this.releasedPower = null;
      this.poopBtn.classList.remove('charging');
      this._btnTouchId = null;
      if (this._steerTouchId === null) { this.steerX = 0; this.steerY = 0; }
    }
  }
}
