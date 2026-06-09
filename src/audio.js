// ---------------------------------------------------------------------------
// Tiny WebAudio synth — no audio files. Sounds are generated on the fly.
// Must be unlocked by a user gesture (handled by main on first tap).
// ---------------------------------------------------------------------------
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._chargeOsc = null;
    this._chargeGain = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  _tone(freq, dur, type = 'sine', vol = 0.4, slideTo = null) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, vol = 0.5, filterFreq = 1200) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  startCharge() {
    if (!this.enabled || !this.ctx || this._chargeOsc) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    o.connect(g); g.connect(this.master);
    o.start(t);
    this._chargeOsc = o;
    this._chargeGain = g;
  }

  setCharge(p) {
    if (this._chargeOsc) {
      this._chargeOsc.frequency.setTargetAtTime(120 + p * 520, this.ctx.currentTime, 0.05);
    }
  }

  stopCharge() {
    if (this._chargeOsc) {
      const t = this.ctx.currentTime;
      this._chargeGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      this._chargeOsc.stop(t + 0.1);
      this._chargeOsc = null;
      this._chargeGain = null;
    }
  }

  poop() { this._tone(420, 0.25, 'square', 0.25, 110); this._noise(0.15, 0.25, 800); }
  whoosh() { this._noise(0.4, 0.3, 2500); }
  splat(big) { this._noise(big ? 0.45 : 0.3, 0.6, 700); this._tone(big ? 90 : 130, 0.2, 'sine', 0.4, 50); }
  miss() { this._noise(0.25, 0.25, 500); }
  bullseye() {
    this._tone(660, 0.12, 'triangle', 0.4);
    setTimeout(() => this._tone(880, 0.12, 'triangle', 0.4), 90);
    setTimeout(() => this._tone(1320, 0.2, 'triangle', 0.4), 180);
  }
  slowmo() { this._tone(300, 0.5, 'sine', 0.25, 140); }
  whistle() { this._tone(700, 0.6, 'sine', 0.3, 1200); }
  // crisp two-note "locked on" ding when the shot enters the bullseye window
  lock() {
    this._tone(990, 0.05, 'triangle', 0.32);
    setTimeout(() => this._tone(1480, 0.09, 'triangle', 0.32), 55);
  }

  // A loud, triumphant seagull "elation" yell for SUPER TURD MODE: a rising
  // whoop, a flurry of descending gull squawks (the classic gull laugh), then a
  // long victorious cry.
  seagullYell() {
    if (!this.enabled || !this.ctx) return;
    this._tone(420, 0.2, 'sawtooth', 0.55, 1100);          // rising whoop
    const notes = [1400, 1240, 1080, 940, 820, 720, 640];  // descending laugh
    notes.forEach((f, i) => setTimeout(() => {
      this._tone(f, 0.09, 'sawtooth', 0.5, f * 0.78);
      this._noise(0.04, 0.2, 2600);
    }, 180 + i * 95));
    setTimeout(() => {                                       // long final cry
      this._tone(900, 0.55, 'square', 0.55, 1350);
      this._tone(1350, 0.5, 'sawtooth', 0.35, 1500);
    }, 180 + notes.length * 95 + 40);
  }

  // Electric crackle/sweep under the transformation.
  superZap() {
    if (!this.enabled || !this.ctx) return;
    this._tone(160, 0.55, 'sawtooth', 0.4, 1500);
    this._noise(0.55, 0.32, 3200);
  }

  // A bright rising arpeggio when a super turd stacks the mode higher.
  superStack() {
    if (!this.enabled || !this.ctx) return;
    const notes = [660, 880, 1100, 1320];
    notes.forEach((f, i) => setTimeout(() => this._tone(f, 0.1, 'triangle', 0.4), i * 60));
  }

  // A roaring whoosh + crackle when the bird bursts into TURD FIRE mode.
  fireRoar() {
    if (!this.enabled || !this.ctx) return;
    this._tone(70, 0.8, 'sawtooth', 0.45, 180);
    this._tone(120, 0.7, 'square', 0.3, 60);
    this._noise(0.8, 0.45, 1600);
  }
}
