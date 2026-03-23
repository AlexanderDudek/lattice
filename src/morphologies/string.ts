import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState } from '../engine/types';
import { BaseAudio } from '../engine/audio';
import { spawnPacket } from '../engine/graph';

// ─── Audio ───────────────────────────────────────────────────────────────────

class StringAudio extends BaseAudio {
  private activeVoices = 0;
  private static MAX_VOICES = 8;

  /**
   * Physical string model via harmonic series with differential decay.
   * Higher partials decay faster than lower ones — exactly how real strings
   * behave. Sounds metallic/bright on attack, warm as it fades.
   */
  private pluckString(
    pos: THREE.Vector3,
    gen: number,
    baseFreq: number,
    volume: number,
    brightness: number, // 0-1, how many harmonics and how bright
    sustain: number,    // seconds for fundamental to ring
  ) {
    if (!this.ready) return;
    if (this.activeVoices >= StringAudio.MAX_VOICES) return;
    this.activeVoices++;

    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen, baseFreq);

    // Number of partials based on brightness
    const numPartials = 3 + Math.floor(brightness * 5); // 3-8 partials

    for (let h = 1; h <= numPartials; h++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      // Alternate between sine and triangle for richer texture
      osc.type = h <= 2 ? 'triangle' : 'sine';
      osc.frequency.value = freq * h;
      // Slight inharmonicity — real strings are slightly sharp on upper partials
      osc.detune.value = h * h * 0.8;

      // Volume drops with partial number (1/h), brightness scales upper partials
      const partialVol = volume * (1 / h) * (h === 1 ? 1 : brightness * 0.7);
      // Decay time: fundamental rings longest, upper partials die fast
      const partialDecay = sustain / (1 + (h - 1) * 0.6);

      // Sharp pluck attack — instantaneous onset then immediate decay
      gain.gain.setValueAtTime(partialVol, t);
      gain.gain.setValueAtTime(partialVol * 0.85, t + 0.003); // tiny click transient
      gain.gain.exponentialRampToValueAtTime(0.001, t + partialDecay);

      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + partialDecay + 0.05);
    }

    // Transient noise burst — the "pick" sound
    const noiseDur = 0.004;
    const bufSize = Math.ceil(this.ctx.sampleRate * noiseDur);
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseHp = this.ctx.createBiquadFilter();
    noiseHp.type = 'highpass';
    noiseHp.frequency.value = 2000;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    noise.connect(noiseHp).connect(noiseGain).connect(this.master);
    noise.start(t);

    setTimeout(() => { this.activeVoices--; }, sustain * 1000);
  }

  onTap(pos: THREE.Vector3, _energy: number, gen: number, intensity: number) {
    // Bright pluck — short ring
    this.pluckString(pos, gen, 165, intensity * 0.25, 0.8, 1.8);
  }

  onSplit(pos: THREE.Vector3, gen: number, isFirst: boolean) {
    // Deep, rich pluck — long ring
    this.pluckString(pos, gen, 82, isFirst ? 0.4 : 0.3, 1.0, 3.5);
  }

  onPacketArrive(pos: THREE.Vector3, _energy: number, gen: number) {
    // Quiet harmonic ping — very short
    this.pluckString(pos, gen, 220, 0.06, 0.3, 0.5);
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile: VisualProfile = {
  nodeColor: new THREE.Color(0.85, 0.85, 0.9),
  edgeColor: 0x667788,
  bgHueBase: 0.6,
  nodeGeometry: () => new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8),
  nodeScale: 0.35,
  bloomStrength: 0.8,
  edgeStyle: 'thin',
  colorShiftRate: 0.01,
  colorSat: 0.2,
  colorLit: 0.75,
  hueBase: 0.6,
  indicator: 'column',       // vertical column — string vibration axis
  indicatorPointSize: 2.0,
  indicatorSpeed: 0.5,
};

// ─── Morphology ──────────────────────────────────────────────────────────────

export const string: Morphology = {
  id: 'string',
  name: 'STRING',
  description: 'resonant · packets pluck physical strings',
  accentHex: '#e0e0e0',

  profile,

  createAudio: () => new StringAudio(),

  packetGeometry: (size) => new THREE.CylinderGeometry(size * 0.3, size * 0.3, size * 2, 6),

  updatePacket(mesh, dt) {
    mesh.rotation.y += dt * 10;
  },

  usesReadySplit: true,
  packetBounceChance: 0.35,

  hints: {
    initial: 'tap the node',
    postSplit: 'strings ring and decay · higher harmonics die first',
  },

  counterInfo(state) {
    return `<span style="color:#${profile.nodeColor.getHexString()}">resonance: ${state.packets.length}</span>`;
  },

  update(state: InstrumentState, dt: number) {
    if (!state.phaseChanged) return;

    // Passive energy charge — slower than sequencer
    for (const node of state.nodes) {
      if (node.energy < 1 && !node.ready) {
        node.energy = Math.min(1, node.energy + 0.005 * (1 + state.nodes.length * 0.015) * dt);
        if (node.energy >= 1) {
          node.ready = true;
          node.ripple = 0.6;
          state.screenShake = 0.1;
        }
      }
      node.readyGlow = node.ready
        ? Math.min(1, node.readyGlow + dt * 1.5)
        : Math.max(0, node.readyGlow - dt * 4);
    }

    // Very sparse ambient packets
    if (state.edges.length > 0 && Math.random() < state.edges.length * 0.005 * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      spawnPacket(state, edge.from, edge.to, 0.15 + Math.random() * 0.2, 0.05, string);
    }
  },
};
