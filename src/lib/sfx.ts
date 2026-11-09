"use client";

type ToneOptions = {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  dur?: number;
  attack?: number;
  peak?: number;
  lowpass?: number;
  delay?: number;
};

type NoiseOptions = {
  dur?: number;
  lowpass?: number;
  highpass?: number;
  sweepTo?: number;
  peak?: number;
  attack?: number;
  delay?: number;
};

export type SfxEvent =
  | "kickoff"
  | "tick"
  | "whoosh"
  | "land"
  | "pick"
  | "pick-elite"
  | "pick-world"
  | "drum"
  | "reveal"
  | "win"
  | "draw"
  | "loss"
  | "champion"
  | "europe"
  | "relegated"
  | "midtable"
  | "quest"
  | "deny"
  | "click"
  | "hover";

const MUTE_KEY = "premillion:muted";
const LEGACY_MUTE_KEY = "frankenballer:muted";

class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(MUTE_KEY) ?? window.localStorage.getItem(LEGACY_MUTE_KEY);
      this.muted = stored === "1";
    }
  }

  private ensure() {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.7;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    if (this.out) this.out.gain.value = muted ? 0 : 0.7;
  }

  private envelope(gain: GainNode, start: number, attack: number, peak: number, dur: number) {
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + dur);
  }

  private tone({ type = "sine", f0, f1, dur = 0.2, attack = 0.005, peak = 0.3, lowpass, delay = 0 }: ToneOptions) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, start);
    if (f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), start + dur);
    const gain = ctx.createGain();
    this.envelope(gain, start, attack, peak, dur);
    let node: AudioNode = osc;
    if (lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lowpass;
      osc.connect(filter);
      node = filter;
    }
    node.connect(gain);
    gain.connect(this.out);
    osc.start(start);
    osc.stop(start + attack + dur + 0.05);
  }

  private noise({ dur = 0.3, lowpass = 1200, highpass, sweepTo, peak = 0.2, attack = 0.003, delay = 0 }: NoiseOptions) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const start = ctx.currentTime + delay;
    const length = Math.ceil(ctx.sampleRate * (dur + 0.1));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) channel[index] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(lowpass, start);
    if (sweepTo) low.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    source.connect(low);
    let node: AudioNode = low;
    if (highpass) {
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = highpass;
      low.connect(high);
      node = high;
    }
    const gain = ctx.createGain();
    this.envelope(gain, start, attack, peak, dur);
    node.connect(gain);
    gain.connect(this.out);
    source.start(start);
    source.stop(start + dur + 0.1);
  }

  private arp(notes: number[], step = 0.1, options: Partial<ToneOptions> = {}) {
    notes.forEach((note, index) => this.tone({ type: "triangle", dur: 0.4, peak: 0.13, lowpass: 3200, ...options, f0: note, delay: (options.delay ?? 0) + index * step }));
  }

  /** A referee's pea whistle: two detuned squares with a fast trill. */
  private whistle(delay = 0, dur = 0.5) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const start = ctx.currentTime + delay;
    for (const detune of [0, 14]) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 2650 + detune;
      const trill = ctx.createOscillator();
      trill.frequency.value = 38;
      const depth = ctx.createGain();
      depth.gain.value = 70;
      trill.connect(depth);
      depth.connect(osc.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2700;
      filter.Q.value = 3;
      const gain = ctx.createGain();
      this.envelope(gain, start, 0.01, 0.05, dur);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.out);
      osc.start(start);
      trill.start(start);
      osc.stop(start + dur + 0.1);
      trill.stop(start + dur + 0.1);
    }
  }

  play(event: SfxEvent, intensity = 1) {
    if (this.muted || !this.ensure()) return;
    switch (event) {
      case "kickoff":
        this.whistle(0, 0.18);
        this.whistle(0.24, 0.55);
        this.noise({ dur: 1.4, lowpass: 900, sweepTo: 2400, peak: 0.06, delay: 0.3 });
        break;
      case "tick":
        this.tone({ type: "square", f0: 1400 + Math.random() * 300, dur: 0.025, peak: 0.035, lowpass: 2600 });
        break;
      case "whoosh":
        this.noise({ dur: 0.45, lowpass: 600, sweepTo: 5200, highpass: 300, peak: 0.12 });
        break;
      case "land":
        this.tone({ f0: 150, f1: 70, dur: 0.22, peak: 0.26, lowpass: 700 });
        this.noise({ dur: 0.12, lowpass: 600, peak: 0.08 });
        this.tone({ type: "triangle", f0: 1175, dur: 0.12, peak: 0.06, delay: 0.04 });
        break;
      case "pick":
        this.tone({ type: "triangle", f0: 660, f1: 1320, dur: 0.08, peak: 0.12, lowpass: 3000 });
        this.tone({ f0: 1320, dur: 0.18, peak: 0.07, delay: 0.06 });
        break;
      case "pick-elite":
        this.arp([784, 988, 1319], 0.07, { dur: 0.3 });
        break;
      case "pick-world":
        this.tone({ f0: 70, f1: 45, dur: 0.8, peak: 0.3 });
        this.arp([784, 988, 1175, 1568], 0.09, { dur: 0.55, peak: 0.14 });
        this.noise({ dur: 1, lowpass: 2600, highpass: 1200, peak: 0.04, delay: 0.2 });
        break;
      case "drum":
        this.tone({ f0: 180 * intensity, f1: 90, dur: 0.07, peak: 0.12, lowpass: 900 });
        this.noise({ dur: 0.04, lowpass: 2200, highpass: 600, peak: 0.05 });
        break;
      case "reveal":
        this.tone({ f0: 80, f1: 45, dur: 0.6, peak: 0.36 });
        this.noise({ dur: 0.7, lowpass: 900, sweepTo: 200, peak: 0.16, delay: 0.02 });
        this.arp([523, 659, 784], 0.08, { dur: 0.35, delay: 0.1 });
        break;
      case "win":
        this.tone({ type: "triangle", f0: 988, dur: 0.07, peak: 0.07 });
        break;
      case "draw":
        this.tone({ type: "triangle", f0: 659, dur: 0.06, peak: 0.05 });
        break;
      case "loss":
        this.tone({ f0: 196, f1: 150, dur: 0.08, peak: 0.08, lowpass: 900 });
        break;
      case "champion":
        this.whistle(0, 0.9);
        this.tone({ f0: 60, f1: 40, dur: 1.4, peak: 0.34, delay: 0.2 });
        this.arp([523, 659, 784, 1047, 1319, 1568], 0.11, { dur: 0.8, peak: 0.14, delay: 0.25 });
        this.noise({ dur: 2.4, lowpass: 1400, sweepTo: 3600, peak: 0.12, delay: 0.25 });
        break;
      case "europe":
        this.whistle(0, 0.7);
        this.arp([523, 784, 1047], 0.1, { dur: 0.5, delay: 0.2 });
        this.noise({ dur: 1.4, lowpass: 1200, sweepTo: 2600, peak: 0.07, delay: 0.2 });
        break;
      case "midtable":
        this.whistle(0, 0.6);
        this.tone({ type: "triangle", f0: 659, dur: 0.4, peak: 0.08, delay: 0.25 });
        break;
      case "relegated":
        this.whistle(0, 0.6);
        this.tone({ f0: 220, f1: 52, dur: 0.9, peak: 0.24, delay: 0.2 });
        this.noise({ dur: 0.6, lowpass: 400, peak: 0.14, delay: 0.25 });
        break;
      case "quest":
        this.tone({ type: "square", f0: 988, dur: 0.06, peak: 0.05, lowpass: 3600 });
        this.tone({ type: "square", f0: 1319, dur: 0.22, peak: 0.05, lowpass: 3600, delay: 0.07 });
        this.arp([1568, 1976, 2637], 0.05, { dur: 0.25, peak: 0.06, delay: 0.16 });
        this.noise({ dur: 0.4, lowpass: 9000, highpass: 4000, peak: 0.03, delay: 0.16 });
        break;
      case "deny":
        this.tone({ f0: 150, f1: 62, dur: 0.25, peak: 0.16, lowpass: 700 });
        break;
      case "click":
        this.tone({ type: "square", f0: 920, dur: 0.035, peak: 0.045, lowpass: 4200 });
        this.tone({ type: "triangle", f0: 1480, dur: 0.07, peak: 0.03, delay: 0.018 });
        break;
      case "hover":
        this.tone({ type: "sine", f0: 1560, dur: 0.028, peak: 0.018, lowpass: 3600 });
        break;
    }
  }
}

let instance: Sfx | null = null;
export function sfx() {
  if (!instance) instance = new Sfx();
  return instance;
}

const listeners = new Set<() => void>();
export const muteStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => sfx().muted,
  getServer: () => false,
  toggle() {
    sfx().setMuted(!sfx().muted);
    listeners.forEach((listener) => listener());
  },
};
