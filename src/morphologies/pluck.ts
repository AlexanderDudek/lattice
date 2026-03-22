import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState, LatticeNode } from '../engine/types';
import { BaseAudio } from '../engine/audio';
import { getNeighborIds, spawnPacket } from '../engine/graph';

// ─── Audio ───────────────────────────────────────────────────────────────────

class PluckAudio extends BaseAudio {
  onTap(pos: THREE.Vector3, _energy: number, gen: number, intensity: number) {
    if (!this.ready) return;
    // Soft harmonic ping — like touching a string lightly
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen, 220) * 2;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(intensity * 0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  onSplit(pos: THREE.Vector3, gen: number, _isFirst: boolean) {
    if (!this.ready) return;
    this.playPluck(pos, gen, 0.5, 1.5);
  }

  onPacketArrive(pos: THREE.Vector3, _energy: number, gen: number) {
    if (!this.ready) return;
    this.playPluck(pos, gen, 0.12, 0.35);
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile: VisualProfile = {
  nodeColor: new THREE.Color(0.18, 0.72, 0.92),
  edgeColor: 0x1a5577,
  bgHueBase: 0.55,
  nodeGeometry: () => new THREE.OctahedronGeometry(0.28, 0),
  nodeScale: 0.32,
  bloomStrength: 1.0,
  edgeStyle: 'thin',
  colorShiftRate: 0.025,
  colorSat: 0.7,
  colorLit: 0.58,
  hueBase: 0.52,
};

// ─── Morphology ──────────────────────────────────────────────────────────────

export const pluck: Morphology = {
  id: 'pluck',
  name: 'PLUCK',
  description: 'crystalline \u00b7 packets trigger tuned strings',
  accentHex: '#4cc9f0',

  profile,

  createAudio: () => new PluckAudio(),

  packetGeometry: (size) => new THREE.OctahedronGeometry(size, 0),

  updatePacket(mesh, dt) {
    mesh.rotation.y += dt * 8;
  },

  autoSplitOnPacketArrival: true,
  packetBounceChance: 0.4,

  hints: {
    initial: 'tap the node',
    postSplit: 'tap nodes \u2192 packet flood \u2192 chain reaction',
  },

  counterInfo(state) {
    return `<span style="color:#${profile.nodeColor.getHexString()}">packets: ${state.packets.length}</span>`;
  },

  onTap(state: InstrumentState, node: LatticeNode) {
    // Flood: spawn packets to all neighbors
    for (const nid of getNeighborIds(state, node.id)) {
      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnPacket(state, node.id, nid, 0.6 + Math.random() * 0.8, 0.08, pluck), i * 80);
      }
    }
  },

  update(state: InstrumentState, dt: number) {
    if (!state.phaseChanged) return;
    // Ambient packet spawning — rate scales with edge count
    const rate = state.edges.length * state.edges.length * 0.03;
    if (Math.random() < rate * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      const dir = Math.random() > 0.5;
      spawnPacket(state, dir ? edge.from : edge.to, dir ? edge.to : edge.from,
        0.5 + Math.random() * 1.0, 0.05 + Math.random() * 0.06, pluck);
    }
  },
};
