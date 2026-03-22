import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState } from '../engine/types';
import { BaseAudio } from '../engine/audio';
import { spawnPacket } from '../engine/graph';

// ─── Audio ───────────────────────────────────────────────────────────────────

class StringAudio extends BaseAudio {
  private pluckString(
    pos: THREE.Vector3,
    gen: number,
    baseFreq: number,
    burstMs: number,
    feedback: number,
    volume: number,
    pitchBend?: { startMultiplier: number; duration: number },
  ) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen, baseFreq);
    const delayTime = 1 / freq;

    // Noise burst excitation
    const burstSamples = Math.ceil(this.ctx.sampleRate * burstMs / 1000);
    const buffer = this.ctx.createBuffer(1, burstSamples, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < burstSamples; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    // Delay line — determines pitch
    const delay = this.ctx.createDelay(1 / 20); // max delay for ~20 Hz
    if (pitchBend) {
      delay.delayTime.setValueAtTime(delayTime * pitchBend.startMultiplier, t);
      delay.delayTime.linearRampToValueAtTime(delayTime, t + pitchBend.duration);
    } else {
      delay.delayTime.value = delayTime;
    }

    // Lowpass filter — string brightness / damping
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 2;
    filter.Q.value = 0.5;

    // Feedback gain — sustain control
    const feedbackGain = this.ctx.createGain();
    feedbackGain.gain.value = feedback;

    // Output gain
    const outputGain = this.ctx.createGain();
    outputGain.gain.value = volume;

    // Signal path:
    // noise -> delay -> filter -> feedbackGain -> delay (loop)
    //               \-> outputGain -> master
    noise.connect(delay);
    delay.connect(filter);
    filter.connect(feedbackGain);
    feedbackGain.connect(delay); // feedback loop

    delay.connect(outputGain);   // audible output
    outputGain.connect(this.master);

    noise.start(t);
    noise.stop(t + burstMs / 1000);

    // Let ring then clean up — schedule output fade
    const ringTime = 4;
    outputGain.gain.setValueAtTime(volume, t);
    outputGain.gain.exponentialRampToValueAtTime(0.001, t + ringTime);

    // Disconnect after ring dies
    setTimeout(() => {
      try {
        feedbackGain.disconnect();
        outputGain.disconnect();
        delay.disconnect();
        filter.disconnect();
      } catch (_) { /* already disconnected */ }
    }, (ringTime + 0.5) * 1000);
  }

  onTap(pos: THREE.Vector3, _energy: number, gen: number, intensity: number) {
    this.pluckString(pos, gen, 110, 3, 0.985, intensity * 0.3);
  }

  onSplit(pos: THREE.Vector3, gen: number, _isFirst: boolean) {
    this.pluckString(pos, gen, 55, 8, 0.992, 0.4, {
      startMultiplier: 1.5,
      duration: 2,
    });
  }

  onPacketArrive(pos: THREE.Vector3, _energy: number, gen: number) {
    this.pluckString(pos, gen, 110, 1, 0.975, 0.1);
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
    postSplit: 'strings ring for seconds · feel the sympathetic resonance',
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
      // Ready glow animation
      node.readyGlow = node.ready
        ? Math.min(1, node.readyGlow + dt * 1.5)
        : Math.max(0, node.readyGlow - dt * 4);
    }

    // Very sparse ambient packets — strings resonate quietly
    if (state.edges.length > 0 && Math.random() < state.edges.length * 0.005 * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      spawnPacket(state, edge.from, edge.to, 0.15 + Math.random() * 0.2, 0.05, string);
    }
  },
};
