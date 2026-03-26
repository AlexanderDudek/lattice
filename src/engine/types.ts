import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ─── Core data types ─────────────────────────────────────────────────────────

export interface LatticeNode {
  id: number;
  position: THREE.Vector3;
  energy: number;
  tapCount: number;
  splitCost: number;
  ripple: number;
  ripplePhase: number;
  color: THREE.Color;
  born: number;
  ready: boolean;
  readyGlow: number;
  mesh: THREE.Mesh | null;
  ringMesh: THREE.Points | null;
  generation: number;
  bounce: number;
  lastTapTime: number;
  /** Death animation progress: 0 = alive, 0→1 = dying, removed at 1 */
  death?: number;
  /** Drift velocity for orphaned nodes after bridge kill */
  driftVelocity?: THREE.Vector3;
  /** Fade timer for orphaned nodes (seconds remaining) */
  orphanFade?: number;
}

export interface Packet {
  from: number;
  to: number;
  progress: number;
  speed: number;
  mesh: THREE.Mesh | null;
  size: number;
}

export interface Attractor {
  position: THREE.Vector3;
  life: number;
  mesh: THREE.Mesh | null;
}

export interface CascadeWave {
  origin: number;
  hop: number;
  time: number;
  strength: number;
}

// ─── Visual profile ──────────────────────────────────────────────────────────

export interface VisualProfile {
  nodeColor: THREE.Color;
  edgeColor: number;
  bgHueBase: number;
  nodeGeometry: () => THREE.BufferGeometry;
  nodeScale: number;
  bloomStrength: number;
  edgeStyle: 'thin' | 'thick' | 'sharp' | 'shimmer';
  colorShiftRate: number;
  colorSat: number;
  colorLit: number;
  hueBase: number;
  // Energy indicator — each morphology gets a fundamentally different shape
  indicator?: 'ring' | 'orbit' | 'column' | 'bars' | 'helix' | 'axes' | 'cloud';
  indicatorPointSize?: number;   // default 2.5
  indicatorSpeed?: number;       // animation speed multiplier, default 1
}

// ─── Instrument state ────────────────────────────────────────────────────────

export interface InstrumentState {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  cameraBase: THREE.Vector3;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  profile: VisualProfile;
  nodes: LatticeNode[];
  packets: Packet[];
  edges: { from: number; to: number; line: THREE.Line }[];
  attractors: Attractor[];
  nextId: number;
  totalTaps: number;
  phaseChanged: boolean;
  bgHue: number;
  bgTarget: number;
  tension: number;
  time: number;
  splitFlash: number;
  screenShake: number;
  nodeGroup: THREE.Group;
  edgeGroup: THREE.Group;
  packetGroup: THREE.Group;
  attractorGroup: THREE.Group;
  cascadeWaves: CascadeWave[];
  visualIntensity: number;
  firstSplitBloom: number;  // bloom spike on first split, decays over ~3s
}

export const INITIAL_SPLIT_COST = 4;
