// 절차적 효과음 (WebAudio). 외부 음원 파일 없이 합성합니다.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.noiseBuf = null;
    this.ambient = null;
    this.lastPlay = new Map();
  }

  /** 사용자 입력 이후에 호출해야 소리가 납니다 */
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  /** 같은 소리가 너무 자주 겹치지 않게 */
  throttle(key, ms) {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? 0;
    if (now - last < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  out(vol, pan) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan ?? 0));
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  noise(dest, { start = 0, dur = 0.2, type = "lowpass", freq = 1200, q = 0.7, freqEnd = null, attack = 0.002, gain = 1 }) {
    const t = this.ctx.currentTime + start;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    filter.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, { start = 0, dur = 0.15, type = "sine", freq = 440, freqEnd = null, gain = 0.5, attack = 0.003 }) {
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ── 게임 효과음 ─────────────────────────────────────

  gunshot(wclass, distance = 0, pan = 0) {
    if (!this.ready) return;
    const far = Math.min(1, distance / 1600);
    const vol = (1 - far * 0.85) * (distance < 1 ? 0.9 : 0.75);
    if (vol < 0.03) return;
    const out = this.out(vol, pan);
    const profile = {
      pistol: { freq: 2600, dur: 0.16, thump: 150 },
      smg: { freq: 2400, dur: 0.12, thump: 140 },
      shotgun: { freq: 1500, dur: 0.32, thump: 90 },
      rifle: { freq: 2000, dur: 0.22, thump: 110 },
      dmr: { freq: 1700, dur: 0.38, thump: 80 },
      lmg: { freq: 1900, dur: 0.22, thump: 100 },
    }[wclass] ?? { freq: 2000, dur: 0.2, thump: 120 };
    const cutoff = profile.freq * (1 - far * 0.8);
    this.noise(out, { dur: profile.dur * (1 + far), freq: cutoff, freqEnd: cutoff * 0.3, gain: 1 });
    this.tone(out, { dur: 0.12 + far * 0.1, freq: profile.thump, freqEnd: 40, gain: 0.9 });
    if (far > 0.35) this.noise(out, { start: 0.05, dur: 0.5, freq: 400, freqEnd: 150, gain: 0.25 });
  }

  click(pan = 0, vol = 0.4) {
    if (!this.ready) return;
    const out = this.out(vol, pan);
    this.noise(out, { dur: 0.04, type: "highpass", freq: 2500, gain: 0.8 });
  }

  dryFire() {
    if (!this.ready) return;
    const out = this.out(0.35, 0);
    this.tone(out, { dur: 0.05, type: "square", freq: 1800, freqEnd: 1200, gain: 0.3 });
  }

  reload(phase = 0) {
    if (!this.ready) return;
    const out = this.out(0.45, 0);
    if (phase === 0) {
      this.noise(out, { dur: 0.06, type: "bandpass", freq: 1800, q: 2, gain: 0.8 });
      this.tone(out, { dur: 0.05, type: "triangle", freq: 600, gain: 0.3 });
    } else {
      this.noise(out, { dur: 0.05, type: "highpass", freq: 3000, gain: 0.9 });
      this.noise(out, { start: 0.08, dur: 0.07, type: "bandpass", freq: 1400, q: 3, gain: 0.9 });
    }
  }

  footstep(distance = 0, pan = 0, soft = false) {
    if (!this.ready) return;
    const vol = (soft ? 0.12 : 0.22) * (1 - Math.min(1, distance / 700));
    if (vol < 0.02) return;
    const out = this.out(vol, pan);
    this.noise(out, { dur: 0.07, freq: 500 + Math.random() * 300, gain: 0.8 });
  }

  hitFlesh(pan = 0) {
    if (!this.ready || !this.throttle("flesh", 30)) return;
    const out = this.out(0.5, pan);
    this.tone(out, { dur: 0.12, freq: 180, freqEnd: 60, gain: 0.8 });
    this.noise(out, { dur: 0.08, freq: 900, gain: 0.5 });
  }

  hitArmor(pan = 0) {
    if (!this.ready || !this.throttle("armor", 30)) return;
    const out = this.out(0.35, pan);
    this.tone(out, { dur: 0.18, type: "triangle", freq: 2400 + Math.random() * 600, freqEnd: 1800, gain: 0.5 });
    this.noise(out, { dur: 0.05, type: "highpass", freq: 4000, gain: 0.5 });
  }

  hitmarker() {
    if (!this.ready || !this.throttle("hm", 40)) return;
    const out = this.out(0.25, 0);
    this.tone(out, { dur: 0.05, type: "square", freq: 2200, gain: 0.25 });
  }

  impact(distance = 0, pan = 0) {
    if (!this.ready || !this.throttle("impact", 25)) return;
    const vol = 0.25 * (1 - Math.min(1, distance / 900));
    if (vol < 0.02) return;
    const out = this.out(vol, pan);
    this.noise(out, { dur: 0.06, type: "bandpass", freq: 1500 + Math.random() * 1500, q: 1.5, gain: 0.8 });
  }

  explosion(distance = 0, pan = 0) {
    if (!this.ready) return;
    const far = Math.min(1, distance / 2000);
    const out = this.out(1 - far * 0.8, pan);
    this.noise(out, { dur: 1.4, freq: 1400 * (1 - far * 0.7), freqEnd: 80, gain: 1, attack: 0.005 });
    this.tone(out, { dur: 0.6, freq: 70, freqEnd: 25, gain: 1 });
  }

  /** 오리 울음. pitch 1 = 보통 */
  quack(distance = 0, pan = 0, pitch = 1, times = 1) {
    if (!this.ready || !this.throttle("quack", 120)) return;
    const vol = 0.5 * (1 - Math.min(1, distance / 1100));
    if (vol < 0.03) return;
    const out = this.out(vol, pan);
    for (let i = 0; i < times; i++) {
      const start = i * 0.17;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1100 * pitch;
      filter.Q.value = 3;
      filter.connect(out);
      const f0 = (420 + Math.random() * 40) * pitch;
      this.tone(filter, { start, dur: 0.16, type: "sawtooth", freq: f0, freqEnd: f0 * 0.72, gain: 0.9, attack: 0.01 });
      this.tone(filter, { start, dur: 0.16, type: "sawtooth", freq: f0 * 1.02, freqEnd: f0 * 0.7, gain: 0.6, attack: 0.01 });
    }
  }

  honk(distance = 0, pan = 0) {
    if (!this.ready || !this.throttle("honk", 300)) return;
    const vol = 0.65 * (1 - Math.min(1, distance / 1400));
    if (vol < 0.03) return;
    const out = this.out(vol, pan);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    filter.Q.value = 2;
    filter.connect(out);
    this.tone(filter, { dur: 0.42, type: "square", freq: 330, freqEnd: 260, gain: 0.8, attack: 0.02 });
    this.tone(filter, { start: 0.45, dur: 0.3, type: "square", freq: 300, freqEnd: 240, gain: 0.7, attack: 0.02 });
  }

  pickup() {
    if (!this.ready) return;
    const out = this.out(0.25, 0);
    this.tone(out, { dur: 0.08, type: "triangle", freq: 700, freqEnd: 1100, gain: 0.5 });
  }

  ui() {
    if (!this.ready || !this.throttle("ui", 40)) return;
    const out = this.out(0.18, 0);
    this.tone(out, { dur: 0.04, type: "triangle", freq: 1200, gain: 0.5 });
  }

  door(pan = 0, distance = 0) {
    if (!this.ready) return;
    const vol = 0.35 * (1 - Math.min(1, distance / 800));
    if (vol < 0.02) return;
    const out = this.out(vol, pan);
    this.noise(out, { dur: 0.3, type: "bandpass", freq: 500, freqEnd: 300, q: 4, gain: 0.7, attack: 0.02 });
    this.tone(out, { dur: 0.25, type: "sawtooth", freq: 160, freqEnd: 120, gain: 0.08 });
  }

  searchTick() {
    if (!this.ready || !this.throttle("search", 90)) return;
    const out = this.out(0.12, 0);
    this.noise(out, { dur: 0.05, type: "bandpass", freq: 2200, q: 2, gain: 0.6 });
  }

  reveal(rarity = 0) {
    if (!this.ready) return;
    const out = this.out(0.18 + rarity * 0.06, 0);
    const base = 600 + rarity * 180;
    this.tone(out, { dur: 0.12, type: "triangle", freq: base, freqEnd: base * 1.5, gain: 0.5 });
    if (rarity >= 3) this.tone(out, { start: 0.1, dur: 0.25, type: "sine", freq: base * 2, gain: 0.35 });
  }

  beep(high = false) {
    if (!this.ready) return;
    const out = this.out(0.3, 0);
    this.tone(out, { dur: 0.12, type: "sine", freq: high ? 1320 : 880, gain: 0.6 });
  }

  heal() {
    if (!this.ready) return;
    const out = this.out(0.3, 0);
    this.tone(out, { dur: 0.25, type: "sine", freq: 520, freqEnd: 780, gain: 0.4 });
  }

  eat() {
    if (!this.ready) return;
    const out = this.out(0.3, 0);
    for (let i = 0; i < 3; i++) this.noise(out, { start: i * 0.12, dur: 0.07, type: "bandpass", freq: 900, q: 2, gain: 0.7 });
  }

  hurt() {
    if (!this.ready || !this.throttle("hurt", 150)) return;
    const out = this.out(0.5, 0);
    this.tone(out, { dur: 0.2, type: "sawtooth", freq: 300, freqEnd: 150, gain: 0.3 });
    this.noise(out, { dur: 0.15, freq: 700, gain: 0.6 });
  }

  heartbeat() {
    if (!this.ready || !this.throttle("heart", 700)) return;
    const out = this.out(0.5, 0);
    this.tone(out, { dur: 0.12, freq: 60, freqEnd: 40, gain: 0.9 });
    this.tone(out, { start: 0.18, dur: 0.1, freq: 55, freqEnd: 40, gain: 0.7 });
  }

  startAmbient(night = false) {
    if (!this.ready || this.ambient) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = night ? 220 : 380;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.06;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    lfo.start();
    this.ambient = { src, lfo };
  }

  stopAmbient() {
    if (!this.ambient) return;
    try {
      this.ambient.src.stop();
      this.ambient.lfo.stop();
    } catch {
      // 이미 정지됨
    }
    this.ambient = null;
  }
}

export const audio = new AudioEngine();
