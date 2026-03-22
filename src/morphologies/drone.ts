import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState, LatticeNode } from '../engine/types';
import { BaseAudio, pentatonic } from '../engine/audio';
import { getNeighborIds, getNodesAtHop, spawnPacket } from '../engine/graph';

// ─── Audio ───────────────────────────────────────────────────────────────────

class DroneAudio extends BaseAudio {
  private droneOscs: OscillatorNode[] = [];
  private droneGains: GainNode[] = [];
  private droneFilter: BiquadFilterNode | null = null;

  protected onInit() {
    this.startDrone();
  }

  private startDrone() {
    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 250;
    this.droneFilter.Q.value = 2;
    this.droneFilter.connect(this.master);
    this.addDroneOsc(55, 0.12);
    this.addDroneOsc(55.3, 0.08);
  }

  private addDroneOsc(freq: number, vol: number) {
    if (!this.droneFilter) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain).connect(this.droneFilter);
    osc.start();
    this.droneOscs.push(osc);
    this.droneGains.push(gain);
  }

  onTap(_pos: THREE.Vector3, _energy: number, _gen: number, intensity: number) {
    if (!this.ready) return;
    this.nudgeDrone();
    this.playDroneTap(intensity);
  }

  private nudgeDrone() {
    if (!this.droneFilter) return;
    const t = this.ctx.currentTime;
    const boost = Math.min(2500, this.droneFilter.frequency.value + 150);
    this.droneFilter.frequency.setValueAtTime(boost, t);
    this.droneFilter.frequency.exponentialRampToValueAtTime(Math.max(200, boost * 0.5), t + 1.2);
  }

  private playDroneTap(intensity: number) {
    const t = this.ctx.currentTime;
    const bufSize = this.ctx.sampleRate * 0.05;
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 3);
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 3;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(intensity * 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t);
  }

  onSplit(pos: THREE.Vector3, _gen: number, _isFirst: boolean) {
    if (!this.ready) return;
    const idx = Math.abs(Math.round(pos.x * 2 + pos.z)) % pentatonic.length;
    const semi = pentatonic[idx];
    const freq = 110 * Math.pow(2, semi / 12) * 0.25;
    this.addDroneOsc(freq, 0.05);
    while (this.droneOscs.length > 8) {
      const old = this.droneOscs.shift()!;
      const oldG = this.droneGains.shift()!;
      oldG.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
      setTimeout(() => { try { old.stop(); } catch {} }, 600);
    }
  }

  onPacketArrive() {}

  onUpdate(nodeCount: number, packetCount: number, totalEnergy: number, time: number) {
    if (!this.ready || !this.droneFilter) return;
    const target = 180 + packetCount * 60 + totalEnergy * 250;
    const cur = this.droneFilter.frequency.value;
    this.droneFilter.frequency.value = cur + (Math.min(3000, target) - cur) * 0.02;
    for (let i = 0; i < this.droneGains.length; i++) {
      const lfo = Math.sin(time * (0.25 + i * 0.08)) * 0.5 + 0.5;
      this.droneGains[i].gain.value = (0.04 + (i === 0 ? 0.06 : 0)) * (0.4 + lfo * 0.6);
    }
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile: VisualProfile = {
  nodeColor: new THREE.Color(0.9, 0.55, 0.2),
  edgeColor: 0x664422,
  bgHueBase: 0.07,
  nodeGeometry: () => new THREE.SphereGeometry(0.26, 16, 12),
  nodeScale: 0.30,
  bloomStrength: 0.85,
  edgeStyle: 'thick',
  colorShiftRate: -0.015,
  colorSat: 0.65,
  colorLit: 0.52,
  hueBase: 0.08,
};

// ─── Morphology ──────────────────────────────────────────────────────────────

export const drone: Morphology = {
  id: 'drone',
  name: 'DRONE',
  description: 'organic \u00b7 continuous evolving tone',
  accentHex: '#e8934a',

  profile,

  createAudio: () => new DroneAudio(),

  packetGeometry: (size) => new THREE.SphereGeometry(size, 8, 6),

  autoSplitOnPacketArrival: true,
  packetBounceChance: 0.2,

  hints: {
    initial: 'tap the node',
    postSplit: 'tap \u2192 shockwave cascades through network',
  },

  counterInfo(state) {
    return `<span style="color:#${profile.nodeColor.getHexString()}">waves: ${state.cascadeWaves.length}</span>`;
  },

  onTap(state: InstrumentState, node: LatticeNode) {
    // Cascade wave from tapped node
    state.cascadeWaves.push({ origin: node.id, hop: 0, time: state.time, strength: 0.8 });
  },

  update(state: InstrumentState, dt: number) {
    if (!state.phaseChanged) return;

    // Cascade waves
    for (let i = state.cascadeWaves.length - 1; i >= 0; i--) {
      const wave = state.cascadeWaves[i];
      const elapsed = state.time - wave.time;
      const targetHop = Math.floor(elapsed / 0.15);
      if (targetHop > wave.hop && wave.strength > 0.1) {
        wave.hop = targetHop;
        wave.strength *= 0.65;
        for (const node of getNodesAtHop(state, wave.origin, wave.hop)) {
          node.ripple = Math.min(1, node.ripple + wave.strength);
          node.ripplePhase = 0;
          node.bounce = wave.strength * 0.6;
          node.energy = Math.min(1, node.energy + wave.strength * 0.15);
          if (wave.strength > 0.3) {
            for (const nid of getNeighborIds(state, node.id)) {
              spawnPacket(state, node.id, nid, 0.8, 0.05 * wave.strength, drone);
            }
          }
        }
      }
      if (wave.strength < 0.1 || elapsed > 3) state.cascadeWaves.splice(i, 1);
    }

    // Ambient
    if (Math.random() < state.edges.length * 0.003 * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      spawnPacket(state, edge.from, edge.to, 0.2 + Math.random() * 0.3, 0.04, drone);
    }

    // Synchronized pulse
    if (Math.sin(state.time * 1.5) > 0.98 && Math.random() < 0.3) {
      for (const node of state.nodes) node.ripple = Math.max(node.ripple, 0.15);
    }
  },
};
