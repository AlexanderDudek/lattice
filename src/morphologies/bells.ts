import * as THREE from 'three';
import { Morphology } from './Morphology';
import { VisualProfile, InstrumentState } from '../engine/types';
import { BaseAudio } from '../engine/audio';
import { spawnPacket } from '../engine/graph';
import { createAttractorMesh } from '../engine/meshes';

// ─── Audio ───────────────────────────────────────────────────────────────────

class BellsAudio extends BaseAudio {
  onTap(pos: THREE.Vector3, _energy: number, gen: number, intensity: number) {
    if (!this.ready) return;
    // Chime — two detuned sines
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen, 180);
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * (i === 0 ? 1 : 2.003);
      gain.gain.setValueAtTime(intensity * 0.12 * (i === 0 ? 1 : 0.25), t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.4);
    }
  }

  onSplit(pos: THREE.Vector3, gen: number, isFirst: boolean) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen, 180) * 0.5;
    const partials = isFirst ? [1, 2.4, 5.1, 7.3] : [1, 2.4, 4.8];
    const dur = isFirst ? 4 : 2.5;
    for (const p of partials) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * p;
      const v = 0.18 / p;
      gain.gain.setValueAtTime(v, t);
      gain.gain.setValueAtTime(v * 0.8, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
  }

  onPacketArrive() {
    if (!this.ready) return;
    this.playTick(0.03);
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profile: VisualProfile = {
  nodeColor: new THREE.Color(0.85, 0.7, 0.15),
  edgeColor: 0x665522,
  bgHueBase: 0.12,
  nodeGeometry: () => new THREE.DodecahedronGeometry(0.27, 0),
  nodeScale: 0.30,
  bloomStrength: 0.9,
  edgeStyle: 'shimmer',
  colorShiftRate: -0.01,
  colorSat: 0.55,
  colorLit: 0.55,
  hueBase: 0.12,
};

// ─── Morphology ──────────────────────────────────────────────────────────────

export const bells: Morphology = {
  id: 'bells',
  name: 'BELLS',
  description: 'resonant \u00b7 splits ring harmonic partials',
  accentHex: '#daa520',

  profile,

  createAudio: () => new BellsAudio(),

  packetGeometry: (size) => new THREE.DodecahedronGeometry(size, 0),

  updatePacket(mesh, dt) {
    mesh.rotation.x += dt * 3;
    mesh.rotation.y += dt * 2;
  },

  usesReadySplit: true,
  packetBounceChance: 0.2,

  hints: {
    initial: 'tap the node',
    postSplit: 'tap empty space to place attractor beacons',
  },

  counterInfo(state) {
    return `<span style="color:#${profile.nodeColor.getHexString()}">beacons: ${state.attractors.length}</span>`;
  },

  onTapEmpty(state: InstrumentState, raycaster: THREE.Raycaster): boolean {
    if (!state.phaseChanged) return false;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, point);
    if (point) {
      state.attractors.push({
        position: point.clone(),
        life: 6,
        mesh: createAttractorMesh(point, state.attractorGroup),
      });
      state.screenShake = 0.15;
      return true;
    }
    return false;
  },

  update(state: InstrumentState, dt: number) {
    if (!state.phaseChanged) return;

    // Attractors
    for (let i = state.attractors.length - 1; i >= 0; i--) {
      const att = state.attractors[i];
      att.life -= dt;
      if (att.mesh) {
        att.mesh.scale.setScalar(1 + Math.sin(state.time * 5) * 0.2);
        (att.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.6, att.life * 0.3);
        for (const pkt of state.packets) {
          if (pkt.mesh) {
            const dist = pkt.mesh.position.distanceTo(att.position);
            if (dist < 2.0 && dist > 0.1) {
              pkt.mesh.position.add(att.position.clone().sub(pkt.mesh.position).normalize().multiplyScalar(dt * 0.3));
            }
          }
        }
        for (const node of state.nodes) {
          const dist = node.position.distanceTo(att.position);
          if (dist < 2.0) {
            node.energy = Math.min(1, node.energy + ((2.0 - dist) / 2.0) * 0.03 * dt);
            if (node.energy >= 1 && !node.ready) { node.ready = true; node.ripple = 0.7; }
          }
        }
      }
      if (att.life <= 0) {
        if (att.mesh) state.attractorGroup.remove(att.mesh);
        state.attractors.splice(i, 1);
      }
    }

    // Passive charge
    for (const node of state.nodes) {
      if (node.energy < 1 && !node.ready) {
        node.energy = Math.min(1, node.energy + 0.005 * (1 + state.nodes.length * 0.015) * dt);
        if (node.energy >= 1) { node.ready = true; node.ripple = 0.5; }
      }
      node.readyGlow = node.ready
        ? Math.min(1, node.readyGlow + dt * 2)
        : Math.max(0, node.readyGlow - dt * 3);
    }

    // Ambient packets
    if (state.edges.length > 0 && Math.random() < state.edges.length * 0.01 * dt) {
      const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
      spawnPacket(state, edge.from, edge.to, 0.2 + Math.random() * 0.3, 0.06, bells);
    }
  },
};
