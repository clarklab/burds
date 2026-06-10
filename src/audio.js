// ---------------------------------------------------------------------------
// WebAudio engine: a tiny synth for the moment-to-moment blips (charge,
// splat, bullseye…) plus recorded samples — per-level ambience loops, crowd
// reactions and a real seagull — fetched lazily after the first user gesture.
// Sounds are royalty-free recordings from pixabay.com (Pixabay Content
// License). Every sample is optional: if a file is missing or fails to
// decode, the synth fallbacks keep the game fully scored.
// ---------------------------------------------------------------------------

const SAMPLES = {
  ambBeach: './audio/amb-beach.mp3',     // surf + gulls
  ambWedding: './audio/amb-wedding.mp3', // slow wedding processional
  ambMurmur: './audio/amb-murmur.mp3',   // light guest murmur (layered)
  ambConcert: './audio/amb-concert.mp3', // heavy metal riffing
  gull1: './audio/gull1.mp3',
  gull2: './audio/gull2.mp3',
  react1: './audio/react1.mp3',          // "oh no!"
  react2: './audio/react2.mp3',          // deep "oh no"
  react3: './audio/react3.mp3',          // gasp
  react4: './audio/react4.mp3',          // crowd shocked reaction
  react5: './audio/react5.mp3',          // funny scream
  react6: './audio/react6.mp3',          // hysteric scream
  react7: './audio/react7.mp3',          // wilhelm-style scream
  react8: './audio/react8.mp3',          // short "ah!"
};
// Looping ambience layers per level id, with per-layer mix volume.
const AMBIENCE = {
  beach: [{ key: 'ambBeach', vol: 0.55 }],
  wedding: [{ key: 'ambWedding', vol: 0.4 }, { key: 'ambMurmur', vol: 0.22 }],
  concert: [{ key: 'ambConcert', vol: 0.5 }],
};
const REACTS = ['react1', 'react2', 'react3', 'react4', 'react5', 'react6', 'react7', 'react8'];

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._chargeOsc = null;
    this._chargeGain = null;
    this.buffers = {};
    this._loading = false;
    this._ambLevel = null;  // which level's ambience should be playing
    this._ambNodes = [];    // live looping layers
    this._lastReact = 0;
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
    this._loadSamples();
  }

  // Fetch + decode every sample in the background. Each one that lands may
  // immediately join the ambience if its level is already playing.
  _loadSamples() {
    if (this._loading) return;
    this._loading = true;
    for (const [key, url] of Object.entries(SAMPLES)) {
      fetch(url)
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
        .then((buf) => {
          this.buffers[key] = buf;
          if (this._ambLevel) this._refreshAmbience();
        })
        .catch(() => {}); // missing file → the synth fallback covers it
    }
  }

  _playBuf(key, vol = 1, rate = 1) {
    const buf = this.buffers[key];
    if (!this.enabled || !this.ctx || !buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.master);
    src.start();
    return true;
  }

  // ---- per-level ambience ------------------------------------------------
  // setAmbience('beach' | 'wedding' | 'concert') starts that venue's loops
  // (fading in); stopAmbience() fades everything out. Loops whose buffers
  // haven't decoded yet join automatically the moment they land.
  setAmbience(level) {
    this._ambLevel = level;
    this._refreshAmbience();
  }

  stopAmbience() {
    this._ambLevel = null;
    this._refreshAmbience();
  }

  _refreshAmbience() {
    if (!this.ctx) return;
    const want = (this._ambLevel && AMBIENCE[this._ambLevel]) || [];
    const t = this.ctx.currentTime;
    // fade out layers that no longer belong
    for (const n of this._ambNodes) {
      if (!want.some((w) => w.key === n.key)) {
        n.gain.gain.setTargetAtTime(0.0001, t, 0.35);
        try { n.src.stop(t + 1.5); } catch (e) {}
        n.dead = true;
      }
    }
    this._ambNodes = this._ambNodes.filter((n) => !n.dead);
    // start any missing layers whose buffers are ready
    for (const w of want) {
      if (this._ambNodes.some((n) => n.key === w.key)) continue;
      const buf = this.buffers[w.key];
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setTargetAtTime(w.vol, t, 0.7);
      src.connect(g);
      g.connect(this.master);
      src.start(t);
      this._ambNodes.push({ key: w.key, src, gain: g });
    }
  }

  // ---- crowd reactions -----------------------------------------------------
  // An "oh no!" / gasp / scream from whoever is getting splatted, with random
  // pitch so repeats don't sound canned. Multi-hits pile on a second voice.
  crowdScream(count = 1) {
    if (!this.enabled || !this.ctx) return;
    const now = (typeof performance !== 'undefined' ? performance : Date).now();
    if (now - this._lastReact < 120) return; // don't shred during volleys
    this._lastReact = now;
    const key = REACTS[(Math.random() * REACTS.length) | 0];
    this._playBuf(key, 0.9, 0.92 + Math.random() * 0.2);
    if (count >= 3) {
      const k2 = REACTS[(Math.random() * REACTS.length) | 0];
      setTimeout(() => this._playBuf(k2, 0.7, 0.9 + Math.random() * 0.25), 140);
    }
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

  // A loud, triumphant seagull yell for SUPER TURD MODE: a real recorded gull
  // call (two takes, random pitch) — with the old synth squawk as fallback if
  // the sample hasn't loaded.
  seagullYell() {
    if (!this.enabled || !this.ctx) return;
    const key = Math.random() < 0.5 ? 'gull1' : 'gull2';
    if (this._playBuf(key, 1.1, 0.95 + Math.random() * 0.12)) return;
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
