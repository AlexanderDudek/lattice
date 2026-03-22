import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState } from '../engine/types';
import { BaseAudio } from '../engine/audio';
import { spawnPacket } from '../engine/graph';

// ─── Audio ───────────────────────────────────────────────────────────────────

class SequencerAudio extends BaseAudio {
  onTap(_pos: THREE.Vector3, energy: number, _gen: number, intensity: number) {
    if (!this.ready) return;
    // Tight filtered noise hit — like a muted hi-hat
    const t = this.ctx.currentTime;
    const bufSize = this.ctx.sampleRate * 0.04;
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 6);
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 4000 + energy * 3000;
    filter.Q.value = 1.5;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(intensity * 0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t);
  }

  onSplit(pos: THREE.Vector3, gen: number, _isFirst: boolean) {
    if (!this.ready) return;
    this.playPluck(pos, gen, 0.3, 0.6);
  }

  onPacketArrive(pos: THREE.Vector3, energy: number, gen: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen, 220);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'square';
    osc.frequency.value = freq;
    const vol = 0.06 + energy * 0.08;
    const dur = 0.05 + energy * 0.08;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.linearRampToValueAtTime(vol, t + dur * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    filter.type = 'bandpass';
    filter.frequency.value = freq * 2;
    filter.Q.value = 6;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile: VisualProfile = {
  nodeColor: new THREE.Color(0.2, 0.95, 0.4),
  edgeColor: 0x226633,
  bgHueBase: 0.38,
  nodeGeometry: () => new THREE.BoxGeometry(0.38, 0.38, 0.38),
  nodeScale: 0.28,
  bloomStrength: 1.1,
  edgeStyle: 'sharp',
  colorShiftRate: 0.04,
  colorSat: 0.8,
  colorLit: 0.55,
  hueBase: 0.35,
};

// ─── Morphology ──────────────────────────────────────────────────────────────

export const sequencer: Morphology = {
  id: 'sequencer',
  name: 'SEQUENCER',
  description: 'mechanical \u00b7 packets are playheads',
  accentHex: '#50fa7b',

  profile,

  createAudio: () => new SequencerAudio(),

  packetGeometry: (size) => new THREE.BoxGeometry(size * 1.4, size * 1.4, size * 1.4),

  updatePacket(mesh, dt) {
    mesh.rotation.z += dt * 4;
  },

  usesReadySplit: true,
  packetBounceChance: 0.2,

  hints: {
    initial: 'tap the node',
    postSplit: 'cost too high. wait for the golden glow. then tap once.',
  },

  counterInfo(state) {
    return `<span style="color:#${profile.nodeColor.getHexString()}">ready: ${state.nodes.filter(n => n.ready).length}</span>`;
  },

  update(state: InstrumentState, dt: number) {
    if (!state.phaseChanged) return;
    // Zen: passive energy charge + ready glow
    for (const node of state.nodes) {
      if (node.energy < 1 && !node.ready) {
        node.energy = Math.min(1, node.energy + 0.008 * (1 + state.nodes.length * 0.02) * dt);
        if (node.energy >= 1) {
          node.ready = true;
          node.ripple = 1;
          state.splitFlash = 0.4;
          state.screenShake = 0.15;
        }
      }
      node.readyGlow = node.ready
        ? Math.min(1, node.readyGlow + dt * 1.5)
        : Math.max(0, node.readyGlow - dt * 4);
    }
    // Ambient packets
    if (state.edges.length > 0 && Math.random() < 0.4 * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      spawnPacket(state, edge.from, edge.to, 0.08 + Math.random() * 0.1, 0.04, sequencer);
    }
  },
};
