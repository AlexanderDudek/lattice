import * as THREE from 'three';

// ─── Shared AudioContext ─────────────────────────────────────────────────────

let sharedCtx: AudioContext | null = null;

export function getAudioCtx(): AudioContext {
  if (!sharedCtx) {
    sharedCtx = new AudioContext();
    // Mute when window loses focus
    document.addEventListener('visibilitychange', () => {
      if (!sharedCtx) return;
      if (document.hidden) sharedCtx.suspend();
      else sharedCtx.resume();
    });
  }
  return sharedCtx;
}

export const pentatonic = [0, 2, 4, 7, 9];

// ─── Morphology audio interface ──────────────────────────────────────────────

export interface MorphologyAudio {
  init(): void;
  onTap(pos: THREE.Vector3, energy: number, gen: number, intensity: number): void;
  onSplit(pos: THREE.Vector3, gen: number, isFirst: boolean): void;
  onPacketArrive(pos: THREE.Vector3, energy: number, gen: number): void;
  onDeath(pos: THREE.Vector3, energy: number, gen: number): void;
  onUpdate(nodeCount: number, packetCount: number, totalEnergy: number, time: number): void;
}

// ─── Base audio class with shared helpers ────────────────────────────────────

export abstract class BaseAudio implements MorphologyAudio {
  protected ctx!: AudioContext;
  protected master!: GainNode;
  protected ready = false;
  private _muted = false;

  init() {
    if (this.ready) return;
    this.ctx = getAudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
    this.ready = true;
    this.onInit();
  }

  get muted() { return this._muted; }
  set muted(v: boolean) {
    this._muted = v;
    if (this.ready) this.master.gain.value = v ? 0 : 0.25;
  }

  protected onInit() {}

  abstract onTap(pos: THREE.Vector3, energy: number, gen: number, intensity: number): void;
  abstract onSplit(pos: THREE.Vector3, gen: number, isFirst: boolean): void;
  abstract onPacketArrive(pos: THREE.Vector3, energy: number, gen: number): void;

  /**
   * 4-phase death audio cascade. Uses triangle oscillator by default.
   * Morphology audio subclasses can override for their own synthesis type.
   *
   * Phase 1 (0-200ms):   Filter close — lowpass sweep to 20 Hz
   * Phase 2 (0-500ms):   Pitch drop — detune -2400 cents (two octaves)
   * Phase 3 (200-1500ms): Granular dissolution — rapid gain gating 4-40 Hz
   * Phase 4 (500-3000ms): Ghost reverb tail — delay feedback
   */
  onDeath(pos: THREE.Vector3, energy: number, gen: number): void {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const baseFreq = this.posToFreq(pos, gen, 220);
    const vol = 0.15 + energy * 0.25;

    // Main oscillator — pitch drops two octaves
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.detune.setValueAtTime(0, t);
    osc.detune.linearRampToValueAtTime(-2400, t + 0.5);

    // Filter — closes from bright to subsonic
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(baseFreq * 4, t);
    filter.frequency.exponentialRampToValueAtTime(20, t + 0.2);
    filter.Q.value = 2;

    // Main gain — ramp down to avoid pops
    const mainGain = this.ctx.createGain();
    mainGain.gain.setValueAtTime(vol, t);
    mainGain.gain.setValueAtTime(vol * 0.8, t + 0.2);
    mainGain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);

    osc.connect(filter).connect(mainGain).connect(this.master);
    osc.start(t);
    osc.stop(t + 1.6);

    // Granular dissolution — rapid gain gating that accelerates
    const dissOsc = this.ctx.createOscillator();
    dissOsc.type = 'triangle';
    dissOsc.frequency.setValueAtTime(baseFreq * 0.5, t + 0.2);
    dissOsc.detune.setValueAtTime(-1200, t + 0.2);
    dissOsc.detune.linearRampToValueAtTime(-3600, t + 1.5);

    const dissFilter = this.ctx.createBiquadFilter();
    dissFilter.type = 'lowpass';
    dissFilter.frequency.setValueAtTime(baseFreq * 2, t + 0.2);
    dissFilter.frequency.exponentialRampToValueAtTime(40, t + 1.5);

    // LFO for granular gating effect
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(4, t + 0.2);
    lfo.frequency.exponentialRampToValueAtTime(40, t + 1.2);

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = vol * 0.3;

    const dissGain = this.ctx.createGain();
    dissGain.gain.setValueAtTime(0, t);
    dissGain.gain.linearRampToValueAtTime(vol * 0.3, t + 0.25);
    dissGain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);

    lfo.connect(lfoGain);
    lfoGain.connect(dissGain.gain);
    dissOsc.connect(dissFilter).connect(dissGain).connect(this.master);
    lfo.start(t + 0.2);
    lfo.stop(t + 1.5);
    dissOsc.start(t + 0.2);
    dissOsc.stop(t + 1.6);

    // Ghost reverb tail — delay-based feedback
    const ghostOsc = this.ctx.createOscillator();
    ghostOsc.type = 'sine';
    ghostOsc.frequency.setValueAtTime(baseFreq * 0.25, t + 0.5);
    ghostOsc.detune.value = -1200;

    const ghostFilter = this.ctx.createBiquadFilter();
    ghostFilter.type = 'lowpass';
    ghostFilter.frequency.setValueAtTime(400, t + 0.5);
    ghostFilter.frequency.exponentialRampToValueAtTime(60, t + 3.0);

    const ghostGain = this.ctx.createGain();
    ghostGain.gain.setValueAtTime(0, t + 0.4);
    ghostGain.gain.linearRampToValueAtTime(vol * 0.15, t + 0.6);
    ghostGain.gain.exponentialRampToValueAtTime(0.001, t + 3.0);

    // Delay for reverb-like effect
    const delay = this.ctx.createDelay(0.5);
    delay.delayTime.value = 0.12;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.4;

    ghostOsc.connect(ghostFilter).connect(ghostGain).connect(this.master);
    ghostGain.connect(delay).connect(feedback).connect(delay); // feedback loop
    delay.connect(this.master);
    ghostOsc.start(t + 0.5);
    ghostOsc.stop(t + 3.1);
  }

  onUpdate(_nodeCount: number, _packetCount: number, _totalEnergy: number, _time: number) {}

  protected posToFreq(pos: THREE.Vector3, gen: number, baseFreq: number): number {
    const idx = Math.abs(Math.round(pos.x * 2 + pos.z)) % pentatonic.length;
    const semi = pentatonic[idx];
    const oct = Math.min(3, gen);
    return baseFreq * Math.pow(2, (semi + oct * 12) / 12);
  }

  protected playPluck(pos: THREE.Vector3, gen: number, vol: number, dur: number, baseFreq = 220) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen, baseFreq);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 8;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 5, t);
    filter.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    gain.gain.setValueAtTime(vol * 0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  protected playTick(vol: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 2500 + Math.random() * 2000;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.03);
  }
}
