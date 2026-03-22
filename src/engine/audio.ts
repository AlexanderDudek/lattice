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
  onUpdate(nodeCount: number, packetCount: number, totalEnergy: number, time: number): void;
}

// ─── Base audio class with shared helpers ────────────────────────────────────

export abstract class BaseAudio implements MorphologyAudio {
  protected ctx!: AudioContext;
  protected master!: GainNode;
  protected ready = false;

  init() {
    if (this.ready) return;
    this.ctx = getAudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
    this.ready = true;
    this.onInit();
  }

  protected onInit() {}

  abstract onTap(pos: THREE.Vector3, energy: number, gen: number, intensity: number): void;
  abstract onSplit(pos: THREE.Vector3, gen: number, isFirst: boolean): void;
  abstract onPacketArrive(pos: THREE.Vector3, energy: number, gen: number): void;
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
