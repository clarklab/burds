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
    this._keys = {};

    this._bind();
  }

  _bind() {
    const c = this.canvas;

    const start = (id, x, y) => {
      if (this._steerTouchId !== null) return;
      this._steerTouchId = id;
      this._anchor.x = x;
      this._anchor.y = y;
    };
    const move = (x, y) => {
      const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.28;
      let dx = (x - this._anchor.x) / maxR;
      let dy = (y - this._anchor.y) / maxR;
      dx = Math.max(-1, Math.min(1, dx));
      dy = Math.max(-1, Math.min(1, dy));
      this.steerX = dx;
      this.steerY = -dy; // drag up => climb
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

    // Poop button
    const pb = this.poopBtn;
    const startCharge = (e) => {
      if (e) e.preventDefault();
      if (!this.enabled || this.charging) return;
      this.charging = true;
      this.charge = 0;
      pb.classList.add('charging');
    };
    const stopCharge = (e) => {
      if (e) e.preventDefault();
      if (!this.charging) return;
      this.charging = false;
      this.releasedPower = this.charge;
      pb.classList.remove('charging');
    };
    pb.addEventListener('touchstart', startCharge, { passive: false });
    pb.addEventListener('touchend', stopCharge, { passive: false });
    pb.addEventListener('touchcancel', stopCharge, { passive: false });
    pb.addEventListener('mousedown', startCharge);
    window.addEventListener('mouseup', (e) => { if (this.charging) stopCharge(e); });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      this._keys[e.code] = true;
      if (e.code === 'Space') { startCharge(); e.preventDefault(); }
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
      // cancel any in-progress charge
      this.charging = false;
      this.charge = 0;
      this.releasedPower = null;
      this.poopBtn.classList.remove('charging');
    }
  }
}
