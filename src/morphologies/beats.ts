import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState, LatticeNode } from '../engine/types';
import { BaseAudio } from '../engine/audio';
import { getNeighborIds, spawnPacket } from '../engine/graph';

// ─── Audio ───────────────────────────────────────────────────────────────────

class BeatsAudio extends BaseAudio {
  /**
   * Two pure sines slightly detuned — creates beating/wobble.
   * The beat frequency = difference between the two tones.
   * Lower beat freq = slow throb. Higher = faster shimmer.
   */
  private beatPair(
    freq: number,
    detuneHz: number,
    volume: number,
    dur: number,
    attack: number,
  ) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      // One at freq, one slightly off — the gap creates the beat
      osc.frequency.value = i === 0 ? freq : freq + detuneHz;

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(volume, t + attack);
      gain.gain.setValueAtTime(volume, t + dur * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  onTap(pos: THREE.Vector3, _energy: number, gen: number, intensity: number) {
    if (!this.ready) return;
    const freq = this.posToFreq(pos, gen, 220);
    // Detune 2-5 Hz — slow wobble, gentle. Scales slightly with intensity.
    const detune = 1.5 + intensity * 3;
    this.beatPair(freq, detune, intensity * 0.12, 1.2, 0.02);
  }

  onSplit(pos: THREE.Vector3, gen: number, isFirst: boolean) {
    if (!this.ready) return;
    const freq = this.posToFreq(pos, gen, 110);
    // Wider detune on split — more dramatic throb
    const detune = isFirst ? 1.5 : 2 + gen * 0.8;
    this.beatPair(freq, detune, isFirst ? 0.25 : 0.18, isFirst ? 4 : 2.5, 0.05);
    // Add a quiet octave pair for richness
    if (gen > 0) {
      this.beatPair(freq * 2, detune * 1.3, 0.06, 2, 0.1);
    }
  }

  onPacketArrive(pos: THREE.Vector3, _energy: number, gen: number) {
    if (!this.ready) return;
    const freq = this.posToFreq(pos, gen, 330);
    // Very subtle — just a hint of wobble
    this.beatPair(freq, 2, 0.03, 0.4, 0.01);
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile: VisualProfile = {
  nodeColor: new THREE.Color(0.4, 0.85, 0.75),  // teal/cyan-green
  edgeColor: 0x226655,
  bgHueBase: 0.45,
  nodeGeometry: () => new THREE.TorusGeometry(0.18, 0.06, 8, 16),
  nodeScale: 0.30,
  bloomStrength: 0.95,
  edgeStyle: 'shimmer',
  colorShiftRate: 0.015,
  colorSat: 0.6,
  colorLit: 0.6,
  hueBase: 0.45,
  indicator: 'orbit',         // orbital rings — resonance/interference
  indicatorPointSize: 2.0,
  indicatorSpeed: 1.0,
};

// ─── Morphology ──────────────────────────────────────────────────────────────

export const beats: Morphology = {
  id: 'beats',
  name: 'BEATS',
  description: 'hypnotic · detuned pairs create wobbling interference',
  accentHex: '#66d9c0',

  profile,

  createAudio: () => new BeatsAudio(),

  packetGeometry: (size) => new THREE.TorusGeometry(size * 0.8, size * 0.3, 6, 12),

  updatePacket(mesh, dt) {
    mesh.rotation.x += dt * 3;
    mesh.rotation.z += dt * 2;
  },

  autoSplitOnPacketArrival: true,
  packetBounceChance: 0.25,

  hints: {
    initial: 'tap the node',
    postSplit: 'pure tones wobble · feel the interference pattern',
  },

  counterInfo(state) {
    return `<span style="color:#${profile.nodeColor.getHexString()}">waves: ${state.packets.length}</span>`;
  },

  onTap(state: InstrumentState, node: LatticeNode) {
    // Moderate packet spawning — between pluck and drone
    for (const nid of getNeighborIds(state, node.id)) {
      if (Math.random() < 0.6) {
        spawnPacket(state, node.id, nid, 0.4 + Math.random() * 0.6, 0.06, beats);
      }
    }
  },

  update(state: InstrumentState, dt: number) {
    if (!state.phaseChanged) return;
    // Ambient packets at moderate rate
    if (state.edges.length > 0 && Math.random() < state.edges.length * 0.012 * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      spawnPacket(state, edge.from, edge.to, 0.3 + Math.random() * 0.5, 0.05, beats);
    }
  },
};
