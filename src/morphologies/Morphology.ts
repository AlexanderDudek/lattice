import * as THREE from 'three';
import { VisualProfile, InstrumentState, LatticeNode } from '../engine/types';
import { MorphologyAudio } from '../engine/audio';

export interface Morphology {
  id: string;
  name: string;
  description: string;
  accentHex: string;

  profile: VisualProfile;

  createAudio(): MorphologyAudio;

  packetGeometry(size: number): THREE.BufferGeometry;

  // Packet visual behavior per frame
  updatePacket?(mesh: THREE.Mesh, dt: number): void;

  // Growth/behavior update each frame
  update(state: InstrumentState, dt: number): void;

  // Mode-specific tap behavior (called after shared tap logic, only post-phase-change)
  onTap?(state: InstrumentState, node: LatticeNode): void;

  // Mode-specific tap on empty space
  onTapEmpty?(state: InstrumentState, raycaster: THREE.Raycaster): boolean;

  // Custom growth direction (default: outward from center of mass + 3D random)
  splitDirection?(state: InstrumentState, node: LatticeNode): THREE.Vector3;

  // Post-split hook — create cycle edges, extra connections, etc.
  onPostSplit?(state: InstrumentState, parent: LatticeNode, child: LatticeNode): void;

  // Death hook — called when a node is killed (right-click)
  onDeath?(state: InstrumentState, node: LatticeNode): void;

  // Whether this mode uses ready-to-split mechanics (C/D style)
  usesReadySplit?: boolean;

  // Hint text
  hints: { initial: string; postSplit: string };

  // Counter display
  counterInfo(state: InstrumentState): string;

  // Whether packets auto-split nodes on arrival (A/B style)
  autoSplitOnPacketArrival?: boolean;

  // Packet bounce chance on arrival
  packetBounceChance?: number;
}
