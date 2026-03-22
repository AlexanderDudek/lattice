import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState, LatticeNode } from '../engine/types';
import { BaseAudio } from '../engine/audio';
import { getNeighborIds, spawnPacket } from '../engine/graph';
import { createEdgeLine } from '../engine/meshes';

// ─── Audio ───────────────────────────────────────────────────────────────────

class FMAudio extends BaseAudio {
  onTap(pos: THREE.Vector3, _energy: number, gen: number, intensity: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const carrierFreq = this.posToFreq(pos, gen, 220);
    const modRatio = 2 + gen * 0.5;
    const modFreq = carrierFreq * modRatio;

    // Modulator oscillator
    const mod = this.ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = modFreq;

    // Modulation depth — FM "plonk" character
    const modGain = this.ctx.createGain();
    modGain.gain.setValueAtTime(intensity * 400, t);
    modGain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);

    // Carrier oscillator
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = carrierFreq;

    // FM routing: mod -> gain -> carrier.frequency
    mod.connect(modGain).connect(carrier.frequency);

    // Output gain envelope
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(intensity * 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    carrier.connect(gain).connect(this.master);
    mod.start(t);
    carrier.start(t);
    mod.stop(t + 0.45);
    carrier.stop(t + 0.45);
  }

  onSplit(pos: THREE.Vector3, gen: number, _isFirst: boolean) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const dur = 1.5;
    const carrierFreq = this.posToFreq(pos, gen, 220);
    const targetModFreq = carrierFreq * (2 + gen * 0.5);

    // Modulator — start at 1:1 ratio and sweep to target
    const mod = this.ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(carrierFreq, t);
    mod.frequency.linearRampToValueAtTime(targetModFreq, t + dur);

    const modGain = this.ctx.createGain();
    modGain.gain.setValueAtTime(300, t);
    modGain.gain.exponentialRampToValueAtTime(0.01, t + dur);

    // Carrier
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = carrierFreq;

    mod.connect(modGain).connect(carrier.frequency);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    carrier.connect(gain).connect(this.master);
    mod.start(t);
    carrier.start(t);
    mod.stop(t + dur + 0.05);
    carrier.stop(t + dur + 0.05);
  }

  onPacketArrive(pos: THREE.Vector3, _energy: number, gen: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const dur = 0.1;
    const carrierFreq = this.posToFreq(pos, gen, 220);

    const mod = this.ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = carrierFreq * 3;

    const modGain = this.ctx.createGain();
    modGain.gain.setValueAtTime(200, t);
    modGain.gain.exponentialRampToValueAtTime(0.01, t + dur);

    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = carrierFreq;

    mod.connect(modGain).connect(carrier.frequency);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    carrier.connect(gain).connect(this.master);
    mod.start(t);
    carrier.start(t);
    mod.stop(t + dur + 0.02);
    carrier.stop(t + dur + 0.02);
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile: VisualProfile = {
  nodeColor: new THREE.Color(0.6, 0.3, 0.95),
  edgeColor: 0x553388,
  bgHueBase: 0.75,
  nodeGeometry: () => new THREE.IcosahedronGeometry(0.25, 1),
  nodeScale: 0.30,
  bloomStrength: 1.15,
  edgeStyle: 'shimmer',
  colorShiftRate: 0.03,
  colorSat: 0.75,
  colorLit: 0.6,
  hueBase: 0.75,
};

// ─── Morphology ──────────────────────────────────────────────────────────────

export const fm: Morphology = {
  id: 'fm',
  name: 'FM',
  description: 'metallic · edges are modulation routes',
  accentHex: '#c77dff',

  profile,

  createAudio: () => new FMAudio(),

  packetGeometry: (size) => new THREE.IcosahedronGeometry(size, 0),

  updatePacket(mesh, dt) {
    mesh.rotation.x += dt * 6;
    mesh.rotation.z += dt * 6;
  },

  autoSplitOnPacketArrival: true,
  packetBounceChance: 0.3,

  hints: {
    initial: 'tap the node',
    postSplit: 'edges = modulation · more connections = richer spectrum',
  },

  counterInfo(state) {
    return `<span style="color:#${profile.nodeColor.getHexString()}">packets: ${state.packets.length}</span>`;
  },

  onTap(state: InstrumentState, node: LatticeNode) {
    // Spawn 1-2 packets to each neighbor — active but less flooding than pluck
    for (const nid of getNeighborIds(state, node.id)) {
      const count = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnPacket(state, node.id, nid, 0.6 + Math.random() * 0.8, 0.07, fm), i * 60);
      }
    }
  },

  onPostSplit(state: InstrumentState, _parent: LatticeNode, child: LatticeNode) {
    // Cycle-forming: after split, try to connect child to a nearby existing node
    for (const node of state.nodes) {
      if (node.id === _parent.id || node.id === child.id) continue;
      const dist = node.position.distanceTo(child.position);
      if (dist < 2.0 && Math.random() < 0.4) {
        // Check edge doesn't already exist
        const exists = state.edges.some(
          e => (e.from === child.id && e.to === node.id) ||
               (e.from === node.id && e.to === child.id)
        );
        if (!exists) {
          const line = createEdgeLine(child.position, node.position, state.edgeGroup, fm.profile.edgeStyle);
          state.edges.push({ from: child.id, to: node.id, line });
          break; // At most one cycle edge per split
        }
      }
    }
  },

  update(state: InstrumentState, dt: number) {
    if (!state.phaseChanged) return;
    // Ambient packet spawning — lower rate than pluck
    const rate = state.edges.length * 0.02;
    if (Math.random() < rate * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      if (edge) {
        const dir = Math.random() > 0.5;
        spawnPacket(state, dir ? edge.from : edge.to, dir ? edge.to : edge.from,
          0.5 + Math.random() * 1.0, 0.05 + Math.random() * 0.05, fm);
      }
    }
  },
};
