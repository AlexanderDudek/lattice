import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState, LatticeNode } from '../engine/types';
import { BaseAudio } from '../engine/audio';
import { getNeighborIds, spawnPacket } from '../engine/graph';

// ─── Audio ───────────────────────────────────────────────────────────────────

class FurnaceAudio extends BaseAudio {
  onTap(_pos: THREE.Vector3, energy: number, _gen: number, intensity: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    // Aggressive sawtooth burst through highpass
    const osc = this.ctx.createOscillator();
    const hp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 200 + energy * 400;
    hp.type = 'highpass';
    hp.frequency.value = 1000 + energy * 2000;
    hp.Q.value = 1;
    gain.gain.setValueAtTime(intensity * 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(hp).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);

    // Sub-kick
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = 60;
    subGain.gain.setValueAtTime(0.1, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    sub.connect(subGain).connect(this.master);
    sub.start(t);
    sub.stop(t + 0.1);
  }

  onSplit(pos: THREE.Vector3, gen: number, _isFirst: boolean) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen, 110);

    // Two detuned sawtooth oscillators
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.value = freq;
    osc2.frequency.value = freq * 1.01;

    // Lowpass filter with decay
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 4, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.5), t + 1);
    lp.Q.value = 2;

    // Waveshaper distortion
    const shaper = this.ctx.createWaveShaper();
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * 2);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(shaper).connect(gain).connect(this.master);
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 1.3);
    osc2.stop(t + 1.3);
  }

  onPacketArrive(_pos: THREE.Vector3, _energy: number, _gen: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    // Crackling ember pop — very short noise burst
    const bufSize = Math.floor(this.ctx.sampleRate * 0.002);
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000 + Math.random() * 2000;
    bp.Q.value = 2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
    noise.connect(bp).connect(gain).connect(this.master);
    noise.start(t);
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile: VisualProfile = {
  nodeColor: new THREE.Color(0.95, 0.2, 0.1),
  edgeColor: 0x882200,
  bgHueBase: 0.02,
  nodeGeometry: () => new THREE.TetrahedronGeometry(0.3, 0),
  nodeScale: 0.32,
  bloomStrength: 1.3,
  edgeStyle: 'thick',
  colorShiftRate: -0.02,
  colorSat: 0.9,
  colorLit: 0.5,
  hueBase: 0.02,
};

// ─── Morphology ──────────────────────────────────────────────────────────────

export const furnace: Morphology = {
  id: 'furnace',
  name: 'FURNACE',
  description: 'volatile · sacrifice nodes to empower neighbors',
  accentHex: '#ff4444',

  profile,

  createAudio: () => new FurnaceAudio(),

  packetGeometry: (size) => new THREE.TetrahedronGeometry(size * 1.2, 0),

  updatePacket(mesh: THREE.Mesh, dt: number) {
    mesh.rotation.y += dt * 12;
  },

  autoSplitOnPacketArrival: true,
  packetBounceChance: 0.15,

  hints: {
    initial: 'tap the node',
    postSplit: 'tap full nodes to SACRIFICE · energy feeds neighbors',
  },

  counterInfo(state: InstrumentState) {
    const heat = Math.floor(state.nodes.reduce((s, n) => s + n.energy, 0) * 100);
    return `<span style="color:${this.accentHex}">heat: ${heat}%</span>`;
  },

  onTap(state: InstrumentState, node: LatticeNode) {
    // Sacrifice mechanic: destroy full nodes to empower neighbors
    if (node.energy >= 0.8 && state.nodes.length > 2 && node.generation !== 0) {
      const neighborIds = getNeighborIds(state, node.id);
      const share = node.energy / Math.max(1, neighborIds.length);

      // Feed neighbors
      for (const nid of neighborIds) {
        const neighbor = state.nodes.find(n => n.id === nid);
        if (!neighbor) continue;
        neighbor.energy = Math.min(1, neighbor.energy + share);
        neighbor.ripple = 1.0;
        neighbor.bounce = 0.8;

        // Energy explosion: spawn packets from each neighbor outward
        const theirNeighbors = getNeighborIds(state, nid);
        for (let p = 0; p < 3; p++) {
          for (const tnid of theirNeighbors) {
            spawnPacket(state, nid, tnid, 0.6 + Math.random() * 0.4, 0.06, furnace);
          }
        }
      }

      state.screenShake = 0.6;
      state.splitFlash = 0.8;

      // Remove edges involving this node
      for (let i = state.edges.length - 1; i >= 0; i--) {
        const edge = state.edges[i];
        if (edge.from === node.id || edge.to === node.id) {
          state.edgeGroup.remove(edge.line);
          edge.line.geometry.dispose();
          (edge.line.material as THREE.Material).dispose();
          state.edges.splice(i, 1);
        }
      }

      // Remove packets targeting this node
      for (let i = state.packets.length - 1; i >= 0; i--) {
        const pkt = state.packets[i];
        if (pkt.from === node.id || pkt.to === node.id) {
          if (pkt.mesh) state.packetGroup.remove(pkt.mesh);
          state.packets.splice(i, 1);
        }
      }

      // Remove node meshes
      if (node.mesh) {
        state.nodeGroup.remove(node.mesh);
        node.mesh.geometry.dispose();
        (node.mesh.material as THREE.Material).dispose();
      }
      if (node.ringMesh) {
        state.nodeGroup.remove(node.ringMesh);
        node.ringMesh.geometry.dispose();
        (node.ringMesh.material as THREE.Material).dispose();
      }

      // Remove from nodes array
      const idx = state.nodes.indexOf(node);
      if (idx !== -1) state.nodes.splice(idx, 1);
    }
  },

  update(state: InstrumentState, dt: number) {
    if (!state.phaseChanged) return;

    // Ambient energy buildup — furnace runs hot
    for (const node of state.nodes) {
      node.energy = Math.min(1, node.energy + 0.01 * dt);
    }

    // Ambient packets
    if (state.edges.length > 0 && Math.random() < state.edges.length * 0.015 * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      spawnPacket(state, edge.from, edge.to, 0.3 + Math.random() * 0.4, 0.04, furnace);
    }

    // Visual heat effect — nodes near sacrifice threshold simmer
    for (const node of state.nodes) {
      if (node.energy > 0.7) {
        node.ripple = Math.max(node.ripple, (node.energy - 0.7) * 0.3);
      }
    }
  },
};
