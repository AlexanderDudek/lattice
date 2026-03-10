import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ─── Audio Engine (per-quadrant instance, shared AudioContext) ────────────────

type SoundMode = 'pluck' | 'drone' | 'sequencer' | 'bells';

let sharedCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

const pentatonic = [0, 2, 4, 7, 9];

class QuadAudio {
  mode: SoundMode;
  private ctx!: AudioContext;
  private master!: GainNode;
  private ready = false;

  // Drone state
  private droneOscs: OscillatorNode[] = [];
  private droneGains: GainNode[] = [];
  private droneFilter: BiquadFilterNode | null = null;

  constructor(mode: SoundMode) {
    this.mode = mode;
  }

  init() {
    if (this.ready) return;
    this.ctx = getAudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
    this.ready = true;
    if (this.mode === 'drone') this.startDrone();
  }

  private posToFreq(pos: THREE.Vector3, gen: number): number {
    const idx = Math.abs(Math.round(pos.x * 2 + pos.z)) % pentatonic.length;
    const semi = pentatonic[idx];
    const oct = Math.min(3, gen);
    const base = this.mode === 'drone' ? 110 : this.mode === 'bells' ? 180 : 220;
    return base * Math.pow(2, (semi + oct * 12) / 12);
  }

  // ── Events ──

  onTap(pos: THREE.Vector3, energy: number, gen: number, intensity: number) {
    if (!this.ready) return;
    switch (this.mode) {
      case 'pluck': this.playHarmonic(pos, gen, intensity); break;
      case 'drone': this.nudgeDrone(); this.playDroneTap(intensity); break;
      case 'sequencer': this.playClick(energy, intensity); break;
      case 'bells': this.playChime(pos, gen, intensity); break;
    }
  }

  onSplit(pos: THREE.Vector3, gen: number, isFirst: boolean) {
    if (!this.ready) return;
    switch (this.mode) {
      case 'pluck': this.playPluck(pos, gen, 0.5, 1.5); break;
      case 'drone': this.addDroneVoice(pos); break;
      case 'sequencer': this.playPluck(pos, gen, 0.3, 0.6); break;
      case 'bells': this.playBell(pos, gen, isFirst); break;
    }
  }

  onPacketArrive(pos: THREE.Vector3, energy: number, gen: number) {
    if (!this.ready) return;
    switch (this.mode) {
      case 'pluck': this.playPluck(pos, gen, 0.12, 0.35); break;
      case 'drone': break; // drone evolves via update
      case 'sequencer': this.playSeqNote(pos, energy, gen); break;
      case 'bells': this.playTick(0.03); break;
    }
  }

  onUpdate(nodeCount: number, packetCount: number, totalEnergy: number, time: number) {
    if (!this.ready) return;
    if (this.mode === 'drone') this.updateDrone(nodeCount, packetCount, totalEnergy, time);
  }

  // ── Tap feedback ──

  // Pluck tap: soft harmonic ping — like touching a string lightly
  private playHarmonic(pos: THREE.Vector3, gen: number, intensity: number) {
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen) * 2; // higher octave, subtle
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

  // Drone tap: filtered noise thump — like tapping the body of an instrument
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

  // Sequencer tap: tight filtered noise hit — like a muted hi-hat
  private playClick(energy: number, intensity: number) {
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

  // ── Pluck ──
  private playPluck(pos: THREE.Vector3, gen: number, vol: number, dur: number) {
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 8;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 5, t);
    filter.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    gain.gain.setValueAtTime(vol * 0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ── Drone ──
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
  private nudgeDrone() {
    if (!this.droneFilter) return;
    const t = this.ctx.currentTime;
    const boost = Math.min(2500, this.droneFilter.frequency.value + 150);
    this.droneFilter.frequency.setValueAtTime(boost, t);
    this.droneFilter.frequency.exponentialRampToValueAtTime(Math.max(200, boost * 0.5), t + 1.2);
  }
  private addDroneVoice(pos: THREE.Vector3) {
    const freq = this.posToFreq(pos, 0) * 0.25;
    this.addDroneOsc(freq, 0.05);
    while (this.droneOscs.length > 8) {
      const old = this.droneOscs.shift()!;
      const oldG = this.droneGains.shift()!;
      oldG.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
      setTimeout(() => { try { old.stop(); } catch {} }, 600);
    }
  }
  private updateDrone(nodeCount: number, packetCount: number, totalEnergy: number, time: number) {
    if (!this.droneFilter) return;
    const target = 180 + packetCount * 60 + totalEnergy * 250;
    const cur = this.droneFilter.frequency.value;
    this.droneFilter.frequency.value = cur + (Math.min(3000, target) - cur) * 0.02;
    for (let i = 0; i < this.droneGains.length; i++) {
      const lfo = Math.sin(time * (0.25 + i * 0.08)) * 0.5 + 0.5;
      this.droneGains[i].gain.value = (0.04 + (i === 0 ? 0.06 : 0)) * (0.4 + lfo * 0.6);
    }
  }

  // ── Sequencer ──
  private playSeqNote(pos: THREE.Vector3, energy: number, gen: number) {
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen);
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

  // ── Bells ──
  private playChime(pos: THREE.Vector3, gen: number, intensity: number) {
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen);
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
  private playBell(pos: THREE.Vector3, gen: number, isFirst: boolean) {
    const t = this.ctx.currentTime;
    const freq = this.posToFreq(pos, gen) * 0.5;
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
  private playTick(vol: number) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 2500 + Math.random() * 2000;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.03);
  }
}

// Init audio on first click
document.addEventListener('click', () => {
  getAudioCtx();
  quadStates.forEach(q => q.audio.init());
  const hint = document.getElementById('audio-hint');
  if (hint) { hint.style.opacity = '0'; setTimeout(() => hint.remove(), 1000); }
}, { once: true });

// ─── Visual Profiles ──────────────────────────────────────────────────────────

interface VisualProfile {
  sound: SoundMode;
  nodeColor: THREE.Color;
  edgeColor: number;
  bgHueBase: number;
  nodeGeometry: () => THREE.BufferGeometry;
  nodeScale: number;
  bloomStrength: number;
  edgeStyle: 'thin' | 'thick' | 'sharp' | 'shimmer';
  colorShiftRate: number;  // hue shift per generation
  colorSat: number;
  colorLit: number;
  hueBase: number;
}

const profiles: Record<Mode, VisualProfile> = {
  // A — PLUCK: crystalline, sharp, cyan/teal
  a: {
    sound: 'pluck',
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
  },
  // B — DRONE: organic, smooth, amber/warm
  b: {
    sound: 'drone',
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
  },
  // C — SEQUENCER: mechanical, precise, neon green
  c: {
    sound: 'sequencer',
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
  },
  // D — BELLS: resonant, metallic, golden
  d: {
    sound: 'bells',
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
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'a' | 'b' | 'c' | 'd';

interface LatticeNode {
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
}

interface Packet {
  from: number;
  to: number;
  progress: number;
  speed: number;
  mesh: THREE.Mesh | null;
  size: number;
}

interface Attractor {
  position: THREE.Vector3;
  life: number;
  mesh: THREE.Mesh | null;
}

interface QuadState {
  mode: Mode;
  profile: VisualProfile;
  audio: QuadAudio;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  cameraBase: THREE.Vector3;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
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
  counterEl: HTMLElement;
  hint: HTMLElement;
  time: number;
  splitFlash: number;
  screenShake: number;
  nodeGroup: THREE.Group;
  edgeGroup: THREE.Group;
  packetGroup: THREE.Group;
  attractorGroup: THREE.Group;
  cascadeWaves: { origin: number; hop: number; time: number; strength: number }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_SPLIT_COST = 4;

// ─── Shaders ──────────────────────────────────────────────────────────────────

const nodeVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vPos;

  uniform float uTime;
  uniform float uRipple;
  uniform float uRipplePhase;
  uniform float uReadyGlow;
  uniform float uBounce;

  void main() {
    vNormal = normalMatrix * normal;
    vPos = position;
    float rippleWave = sin(length(position.xz) * 15.0 - uRipplePhase * 10.0) * 0.5 + 0.5;
    float rippleDisplace = rippleWave * uRipple * 0.12;
    float readyPulse = sin(uTime * 4.0) * 0.04 * uReadyGlow;
    float bounce = 1.0 + uBounce * 0.4;
    vec3 displaced = position * bounce * (1.0 + rippleDisplace + readyPulse);
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const nodeFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vPos;

  uniform vec3 uColor;
  uniform float uRipple;
  uniform float uRipplePhase;
  uniform float uEmissive;
  uniform float uReadyGlow;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uBounce;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float rim = 1.0 - max(0.0, dot(normal, viewDir));
    rim = pow(rim, 2.0);

    float rippleWave = sin(length(vPos.xz) * 15.0 - uRipplePhase * 10.0) * 0.5 + 0.5;
    float rippleGlow = rippleWave * uRipple;

    vec3 color = uColor * (0.25 + 0.75 * max(0.0, dot(normal, normalize(vec3(0.3, 0.8, 0.4)))));
    color += uColor * rim * (0.4 + uEnergy * 0.8);
    color += uColor * uEmissive * 0.5;
    color += vec3(1.0) * rippleGlow * 2.0;
    color += vec3(1.0) * uBounce * 0.8;

    float readyPulse = sin(uTime * 4.0) * 0.3 + 0.7;
    color += vec3(1.0, 0.85, 0.3) * uReadyGlow * readyPulse * 0.8;
    color *= (0.6 + uEnergy * 0.6);

    gl_FragColor = vec4(color, 0.95);
  }
`;

const ringVertexShader = `
  attribute float aAngle;
  varying float vAngle;

  void main() {
    vAngle = aAngle;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = 2.5;
  }
`;

const ringFragmentShader = `
  varying float vAngle;
  uniform float uEnergy;
  uniform vec3 uColor;
  uniform float uTime;

  void main() {
    float fill = step(vAngle, uEnergy * 6.2832);
    float pulse = sin(uTime * 3.0 + vAngle * 2.0) * 0.15 + 0.85;
    vec3 color = uColor * fill * pulse;
    color += uColor * (1.0 - fill) * 0.08;
    float alpha = fill * 0.9 + (1.0 - fill) * 0.15;
    gl_FragColor = vec4(color, alpha);
  }
`;

// ─── Setup helpers ────────────────────────────────────────────────────────────

function createNodeMesh(node: LatticeNode, group: THREE.Group, profile: VisualProfile): void {
  const geo = profile.nodeGeometry();
  const mat = new THREE.ShaderMaterial({
    vertexShader: nodeVertexShader,
    fragmentShader: nodeFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: node.color.clone() },
      uRipple: { value: 0 },
      uRipplePhase: { value: 0 },
      uEmissive: { value: 0.15 },
      uReadyGlow: { value: 0 },
      uEnergy: { value: 0 },
      uBounce: { value: 0 },
    },
    transparent: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(node.position);
  mesh.scale.setScalar(0.01);
  group.add(mesh);
  node.mesh = mesh;

  // Energy ring
  const ringPoints = 64;
  const ringRadius = profile.nodeScale * 1.5;
  const positions = new Float32Array(ringPoints * 3);
  const angles = new Float32Array(ringPoints);
  for (let i = 0; i < ringPoints; i++) {
    const a = (i / ringPoints) * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * ringRadius;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(a) * ringRadius;
    angles[i] = a;
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ringGeo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: ringVertexShader,
    fragmentShader: ringFragmentShader,
    uniforms: {
      uEnergy: { value: 0 },
      uColor: { value: node.color.clone() },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ringMesh = new THREE.Points(ringGeo, ringMat);
  ringMesh.position.copy(node.position);
  ringMesh.rotation.x = -Math.PI * 0.35;
  ringMesh.rotation.y = Math.PI * 0.25;
  group.add(ringMesh);
  node.ringMesh = ringMesh;
}

function createEdgeLine(from: THREE.Vector3, to: THREE.Vector3, group: THREE.Group, style: string): THREE.Line {
  const points = [];
  const segments = style === 'sharp' ? 2 : 24; // sharp = straight line
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = from.clone().lerp(to, t);
    if (style !== 'sharp') {
      const curve = style === 'thick' ? 0.15 : 0.08;
      p.y += Math.sin(t * Math.PI) * from.distanceTo(to) * curve;
    }
    points.push(p);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    linewidth: 1,
  });
  const line = new THREE.Line(geo, mat);
  group.add(line);
  return line;
}

function createPacketMesh(color: THREE.Color, group: THREE.Group, size: number, mode: Mode): THREE.Mesh {
  let geo: THREE.BufferGeometry;
  switch (mode) {
    case 'a': geo = new THREE.OctahedronGeometry(size, 0); break;     // crystalline
    case 'b': geo = new THREE.SphereGeometry(size, 8, 6); break;      // smooth
    case 'c': geo = new THREE.BoxGeometry(size * 1.4, size * 1.4, size * 1.4); break; // cubic
    case 'd': geo = new THREE.DodecahedronGeometry(size, 0); break;   // faceted
  }
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);
  return mesh;
}

function createAttractorMesh(pos: THREE.Vector3, group: THREE.Group): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.15, 0.25, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xdaa520,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.rotation.x = -Math.PI * 0.35;
  mesh.rotation.y = Math.PI * 0.25;
  group.add(mesh);
  return mesh;
}

// ─── Quad creation ────────────────────────────────────────────────────────────

function createQuad(mode: Mode): QuadState {
  const profile = profiles[mode];
  const canvas = document.getElementById(`canvas-${mode}`) as HTMLCanvasElement;
  const container = canvas.parentElement!;
  const w = container.clientWidth;
  const h = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x050508);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const frustum = 5;
  const aspect = w / h;
  const camera = new THREE.OrthographicCamera(
    -frustum * aspect / 2, frustum * aspect / 2,
    frustum / 2, -frustum / 2, -50, 100
  );
  const cameraBase = new THREE.Vector3(10, 10, 10);
  camera.position.copy(cameraBase);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), profile.bloomStrength, 0.4, 0.75);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  const nodeGroup = new THREE.Group();
  const edgeGroup = new THREE.Group();
  const packetGroup = new THREE.Group();
  const attractorGroup = new THREE.Group();
  scene.add(nodeGroup, edgeGroup, packetGroup, attractorGroup);
  scene.add(new THREE.AmbientLight(0x222244, 0.4));

  const initialNode: LatticeNode = {
    id: 0,
    position: new THREE.Vector3(0, 0, 0),
    energy: 0,
    tapCount: 0,
    splitCost: INITIAL_SPLIT_COST,
    ripple: 0,
    ripplePhase: 0,
    color: profile.nodeColor.clone(),
    born: 0,
    ready: false,
    readyGlow: 0,
    mesh: null,
    ringMesh: null,
    generation: 0,
    bounce: 0,
    lastTapTime: -10,
  };

  const state: QuadState = {
    mode,
    profile,
    audio: new QuadAudio(profile.sound),
    canvas,
    renderer,
    scene,
    camera,
    cameraBase,
    composer,
    bloomPass,
    nodes: [initialNode],
    packets: [],
    edges: [],
    attractors: [],
    nextId: 1,
    totalTaps: 0,
    phaseChanged: false,
    bgHue: profile.bgHueBase,
    bgTarget: profile.bgHueBase,
    tension: 0,
    counterEl: document.getElementById(`counter-${mode}`)!,
    hint: document.getElementById(`hint-${mode}`)!,
    time: 0,
    splitFlash: 0,
    screenShake: 0,
    nodeGroup,
    edgeGroup,
    packetGroup,
    attractorGroup,
    cascadeWaves: [],
  };

  createNodeMesh(initialNode, nodeGroup, profile);
  canvas.addEventListener('click', (e) => handleTap(state, e));
  return state;
}

// ─── Tap handling ─────────────────────────────────────────────────────────────

function handleTap(state: QuadState, e: MouseEvent) {
  const rect = state.canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, state.camera);

  let closest: LatticeNode | null = null;
  let minDist = 1.0;
  for (const node of state.nodes) {
    const dist = raycaster.ray.distanceToPoint(node.position);
    if (dist < minDist) { minDist = dist; closest = node; }
  }

  // Bells mode (D): tap empty space for attractor
  if (state.mode === 'd' && !closest && state.phaseChanged) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, point);
    if (point) {
      state.attractors.push({ position: point.clone(), life: 6, mesh: createAttractorMesh(point, state.attractorGroup) });
      state.screenShake = 0.15;
    }
    return;
  }

  if (!closest) return;
  state.totalTaps++;
  state.screenShake = Math.max(state.screenShake, 0.08 + closest.energy * 0.15);
  closest.bounce = 1;
  closest.lastTapTime = state.time;

  // Sound
  state.audio.onTap(closest.position, closest.energy, closest.generation, 0.3 + closest.energy * 0.7);

  // C/D: ready = one-tap split
  if ((state.mode === 'c' || state.mode === 'd') && closest.ready && state.phaseChanged) {
    closest.ready = false;
    closest.readyGlow = 0;
    state.screenShake = 0.5;
    splitNode(state, closest);
    return;
  }

  const energyPerTap = 1 / closest.splitCost;
  closest.energy = Math.min(1, closest.energy + energyPerTap);
  closest.tapCount++;
  closest.ripple = Math.min(1, closest.ripple + 0.9);
  closest.ripplePhase = 0;

  if (!state.phaseChanged) {
    state.tension = Math.min(1, state.totalTaps / INITIAL_SPLIT_COST);
    state.bgTarget = state.profile.bgHueBase + state.tension * 0.1;
    state.bloomPass.strength = state.profile.bloomStrength + state.tension * 0.6;
  }

  // Mode-specific tap
  if (state.phaseChanged) {
    if (state.mode === 'a') tapModeA(state, closest);
    if (state.mode === 'b') tapModeB(state, closest);
  }

  if (closest.energy >= 1) splitNode(state, closest);
}

function tapModeA(state: QuadState, node: LatticeNode) {
  for (const nid of getNeighborIds(state, node.id)) {
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      setTimeout(() => spawnPacket(state, node.id, nid, 0.6 + Math.random() * 0.8, 0.08), i * 80);
    }
  }
}

function tapModeB(state: QuadState, node: LatticeNode) {
  state.cascadeWaves.push({ origin: node.id, hop: 0, time: state.time, strength: 0.8 });
}

// ─── Node splitting ───────────────────────────────────────────────────────────

function splitNode(state: QuadState, node: LatticeNode) {
  const isFirstSplit = !state.phaseChanged;
  state.phaseChanged = true;
  state.splitFlash = 1;
  state.screenShake = isFirstSplit ? 0.8 : 0.4;

  node.energy = 0;
  node.tapCount = 0;

  const gen = node.generation + 1;
  const spacing = 1.0 + gen * 0.2;

  let dir = new THREE.Vector3(1, 0.2, 0.3).normalize();
  if (state.nodes.length > 1) {
    const com = new THREE.Vector3();
    state.nodes.forEach(n => com.add(n.position));
    com.divideScalar(state.nodes.length);
    dir = node.position.clone().sub(com);
    if (dir.length() < 0.1) dir.set(Math.random() - 0.5, 0.1, Math.random() - 0.5);
    dir.normalize();
    dir.x += (Math.random() - 0.5) * 0.6;
    dir.z += (Math.random() - 0.5) * 0.6;
    dir.y = 0.05 + Math.random() * 0.2;
    dir.normalize();
  }
  const newPos = node.position.clone().add(dir.multiplyScalar(spacing));

  // Cost scaling — powers of 2: 4, 8, 16, 32, 64...
  const newCost = INITIAL_SPLIT_COST * Math.pow(2, gen);

  // Color from profile
  const p = state.profile;
  const hue = p.hueBase + gen * p.colorShiftRate;
  const newColor = new THREE.Color().setHSL(hue, p.colorSat, p.colorLit);

  const newNode: LatticeNode = {
    id: state.nextId++,
    position: newPos,
    energy: 0,
    tapCount: 0,
    splitCost: newCost,
    ripple: 1,
    ripplePhase: 0,
    color: newColor,
    born: state.time,
    ready: false,
    readyGlow: 0,
    mesh: null,
    ringMesh: null,
    generation: gen,
    bounce: 0.5,
    lastTapTime: -10,
  };

  state.nodes.push(newNode);
  createNodeMesh(newNode, state.nodeGroup, state.profile);

  const line = createEdgeLine(node.position, newPos, state.edgeGroup, state.profile.edgeStyle);
  state.edges.push({ from: node.id, to: newNode.id, line });

  node.splitCost = newCost;
  node.ripple = 1;
  node.bounce = 0.8;

  // Sound
  state.audio.onSplit(newPos, gen, isFirstSplit);

  if (isFirstSplit) {
    const hints: Record<Mode, string> = {
      a: 'tap nodes → packet flood → chain reaction',
      b: 'tap → shockwave cascades through network',
      c: 'cost too high. wait for the golden glow. then tap once.',
      d: 'tap empty space to place attractor beacons',
    };
    state.hint.textContent = hints[state.mode];
    state.hint.style.color = '#666';
  }

  // Initial packets
  if (state.mode === 'a') {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        spawnPacket(state, node.id, newNode.id, 0.5 + Math.random() * 0.5, 0.09);
        spawnPacket(state, newNode.id, node.id, 0.4 + Math.random() * 0.4, 0.09);
      }, i * 150);
    }
  } else {
    spawnPacket(state, node.id, newNode.id, 0.3 + Math.random() * 0.3, 0.07);
  }
}

// ─── Packets ──────────────────────────────────────────────────────────────────

function spawnPacket(state: QuadState, fromId: number, toId: number, speed: number, size: number) {
  const from = state.nodes.find(n => n.id === fromId);
  const to = state.nodes.find(n => n.id === toId);
  if (!from || !to) return;
  const color = from.color.clone().lerp(to.color, 0.5).offsetHSL(0, 0, 0.15);
  const mesh = createPacketMesh(color, state.packetGroup, size, state.mode);
  state.packets.push({ from: fromId, to: toId, progress: 0, speed, mesh, size });
}

// ─── Mode-specific updates ────────────────────────────────────────────────────

function updateModeA(state: QuadState, dt: number) {
  if (!state.phaseChanged) return;
  const rate = state.edges.length * state.edges.length * 0.03;
  if (Math.random() < rate * dt) {
    const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
    const dir = Math.random() > 0.5;
    spawnPacket(state, dir ? edge.from : edge.to, dir ? edge.to : edge.from,
      0.5 + Math.random() * 1.0, 0.05 + Math.random() * 0.06);
  }
}

function updateModeB(state: QuadState, dt: number) {
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
            spawnPacket(state, node.id, nid, 0.8, 0.05 * wave.strength);
          }
        }
      }
    }
    if (wave.strength < 0.1 || elapsed > 3) state.cascadeWaves.splice(i, 1);
  }
  // Ambient
  if (Math.random() < state.edges.length * 0.003 * dt) {
    const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
    spawnPacket(state, edge.from, edge.to, 0.2 + Math.random() * 0.3, 0.04);
  }
  // Synchronized pulse
  if (Math.sin(state.time * 1.5) > 0.98 && Math.random() < 0.3) {
    for (const node of state.nodes) node.ripple = Math.max(node.ripple, 0.15);
  }
}

function updateModeC(state: QuadState, dt: number) {
  if (!state.phaseChanged) return;
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
  if (state.edges.length > 0 && Math.random() < 0.4 * dt) {
    const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
    spawnPacket(state, edge.from, edge.to, 0.08 + Math.random() * 0.1, 0.04);
  }
}

function updateModeD(state: QuadState, dt: number) {
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
  if (state.edges.length > 0 && Math.random() < state.edges.length * 0.01 * dt) {
    const edge = state.edges[Math.floor(Math.random() * state.edges.length)];
    spawnPacket(state, edge.from, edge.to, 0.2 + Math.random() * 0.3, 0.06);
  }
}

function getNeighborIds(state: QuadState, nodeId: number): number[] {
  const ids: number[] = [];
  for (const edge of state.edges) {
    if (edge.from === nodeId) ids.push(edge.to);
    if (edge.to === nodeId) ids.push(edge.from);
  }
  return ids;
}

function getNodesAtHop(state: QuadState, originId: number, targetHop: number): LatticeNode[] {
  if (targetHop === 0) return state.nodes.filter(n => n.id === originId);
  const visited = new Set<number>([originId]);
  let frontier = [originId];
  for (let hop = 0; hop < targetHop; hop++) {
    const next: number[] = [];
    for (const nid of frontier) {
      for (const neighbor of getNeighborIds(state, nid)) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return frontier.map(id => state.nodes.find(n => n.id === id)!).filter(Boolean);
}

// ─── Main update ──────────────────────────────────────────────────────────────

function updateQuad(state: QuadState, dt: number) {
  state.time += dt;
  const t = state.time;

  // Background
  state.bgHue += (state.bgTarget - state.bgHue) * dt * 2;
  state.renderer.setClearColor(new THREE.Color().setHSL(state.bgHue, 0.12, 0.018 + state.tension * 0.012));

  // Orbit
  const orbitRadius = 17;
  const orbitAngle = t * 0.15;
  state.cameraBase.set(
    Math.cos(orbitAngle) * orbitRadius,
    10 + Math.sin(t * 0.1) * 1.5,
    Math.sin(orbitAngle) * orbitRadius
  );
  state.camera.position.copy(state.cameraBase);
  state.camera.lookAt(0, 0, 0);

  // Screen shake
  if (state.screenShake > 0.001) {
    const sx = (Math.random() - 0.5) * state.screenShake * 0.5;
    const sy = (Math.random() - 0.5) * state.screenShake * 0.5;
    state.camera.position.x += sx;
    state.camera.position.y += sy;
    state.camera.position.z += sx * 0.5;
    state.screenShake *= Math.pow(0.05, dt);
  } else {
    state.screenShake = 0;
  }

  // Split flash
  if (state.splitFlash > 0) {
    state.splitFlash = Math.max(0, state.splitFlash - dt * 4);
    state.bloomPass.strength = state.profile.bloomStrength + state.splitFlash * 2.5;
  } else if (state.phaseChanged) {
    state.bloomPass.strength = state.profile.bloomStrength;
  }

  // Nodes
  for (const node of state.nodes) {
    const age = t - node.born;
    const spawnT = Math.min(1, age * 5);
    const spawnScale = spawnT * spawnT * (3 - 2 * spawnT);
    if (node.bounce > 0.01) node.bounce *= Math.pow(0.02, dt);
    else node.bounce = 0;

    if (node.mesh) {
      node.mesh.scale.setScalar(state.profile.nodeScale * spawnScale);
      const mat = node.mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uRipple.value = node.ripple;
      mat.uniforms.uRipplePhase.value = node.ripplePhase;
      mat.uniforms.uEmissive.value = 0.15 + node.energy * 0.7;
      mat.uniforms.uReadyGlow.value = node.readyGlow;
      mat.uniforms.uEnergy.value = node.energy;
      mat.uniforms.uBounce.value = node.bounce;
    }
    if (node.ringMesh) {
      const rm = node.ringMesh.material as THREE.ShaderMaterial;
      rm.uniforms.uEnergy.value = node.energy;
      rm.uniforms.uTime.value = t;
      node.ringMesh.scale.setScalar(spawnScale);
    }
    if (node.ripple > 0.01) {
      node.ripplePhase += dt * 8;
      node.ripple *= Math.pow(0.88, dt * 60);
      if (node.ripple < 0.01) node.ripple = 0;
    }
  }

  // Edges — style-dependent coloring
  const edgeBaseColor = new THREE.Color(state.profile.edgeColor);
  for (const edge of state.edges) {
    const mat = edge.line.material as THREE.LineBasicMaterial;
    const activePackets = state.packets.filter(
      p => (p.from === edge.from && p.to === edge.to) || (p.from === edge.to && p.to === edge.from)
    ).length;
    const targetOpacity = Math.min(0.85, 0.12 + activePackets * 0.2);
    mat.opacity += (targetOpacity - mat.opacity) * dt * 5;

    switch (state.profile.edgeStyle) {
      case 'thin':
        mat.color.copy(edgeBaseColor).offsetHSL(0, 0, mat.opacity * 0.3);
        break;
      case 'thick':
        mat.color.copy(edgeBaseColor).offsetHSL(Math.sin(t * 0.2) * 0.02, 0, mat.opacity * 0.2);
        break;
      case 'sharp':
        mat.color.copy(edgeBaseColor).offsetHSL(0, 0, activePackets > 0 ? 0.3 : 0);
        break;
      case 'shimmer':
        mat.color.copy(edgeBaseColor).offsetHSL(Math.sin(t * 2 + edge.from) * 0.03, 0, mat.opacity * 0.25);
        break;
    }
  }

  // Packets
  for (let i = state.packets.length - 1; i >= 0; i--) {
    const pkt = state.packets[i];
    pkt.progress += pkt.speed * dt;

    if (pkt.progress >= 1) {
      const target = state.nodes.find(n => n.id === pkt.to);
      if (target) {
        state.audio.onPacketArrive(target.position, target.energy, target.generation);

        const energyGain = (1 / target.splitCost) * 0.4;
        target.energy = Math.min(1, target.energy + energyGain);
        target.ripple = Math.min(1, target.ripple + 0.2);
        target.ripplePhase = 0;
        target.bounce = Math.min(0.3, target.bounce + 0.15);

        if ((state.mode === 'a' || state.mode === 'b') && target.energy >= 1) {
          splitNode(state, target);
        }

        const bounceChance = state.mode === 'a' ? 0.4 : 0.2;
        if (Math.random() < bounceChance) {
          spawnPacket(state, pkt.to, pkt.from, 0.2 + Math.random() * 0.4, pkt.size * 0.85);
        }
      }
      if (pkt.mesh) state.packetGroup.remove(pkt.mesh);
      state.packets.splice(i, 1);
      continue;
    }

    const from = state.nodes.find(n => n.id === pkt.from);
    const to = state.nodes.find(n => n.id === pkt.to);
    if (from && to && pkt.mesh) {
      const p = pkt.progress;
      const pos = from.position.clone().lerp(to.position, p);
      const curveAmt = state.profile.edgeStyle === 'thick' ? 0.15 :
                        state.profile.edgeStyle === 'sharp' ? 0 : 0.1;
      pos.y += Math.sin(p * Math.PI) * from.position.distanceTo(to.position) * curveAmt;
      pkt.mesh.position.copy(pos);
      // Spin packets for visual variety
      if (state.mode === 'a') pkt.mesh.rotation.y += dt * 8;
      if (state.mode === 'c') pkt.mesh.rotation.z += dt * 4;
      if (state.mode === 'd') { pkt.mesh.rotation.x += dt * 3; pkt.mesh.rotation.y += dt * 2; }
      const fade = Math.sin(p * Math.PI);
      (pkt.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 + fade * 0.5;
      pkt.mesh.scale.setScalar(0.7 + fade * 0.5);
    }
  }

  // Mode-specific
  switch (state.mode) {
    case 'a': updateModeA(state, dt); break;
    case 'b': updateModeB(state, dt); break;
    case 'c': updateModeC(state, dt); break;
    case 'd': updateModeD(state, dt); break;
  }

  // Audio update
  const totalEnergy = state.nodes.reduce((sum, n) => sum + n.energy, 0);
  state.audio.onUpdate(state.nodes.length, state.packets.length, totalEnergy, t);

  // Counter
  updateCounter(state);

  // Render
  state.composer.render();
}

function updateCounter(state: QuadState) {
  const el = state.counterEl;
  if (!el) return;
  const nodeCount = state.nodes.length;
  const bestNode = state.nodes.reduce((a, b) => a.energy > b.energy ? a : b);
  const energyPct = Math.floor(bestNode.energy * 100);
  const accentColor = state.profile.nodeColor.getHexString();

  let modeInfo = '';
  switch (state.mode) {
    case 'a': modeInfo = `<span style="color:#${accentColor}">packets: ${state.packets.length}</span>`; break;
    case 'b': modeInfo = `<span style="color:#${accentColor}">waves: ${state.cascadeWaves.length}</span>`; break;
    case 'c': modeInfo = `<span style="color:#${accentColor}">ready: ${state.nodes.filter(n => n.ready).length}</span>`; break;
    case 'd': modeInfo = `<span style="color:#${accentColor}">beacons: ${state.attractors.length}</span>`; break;
  }

  el.innerHTML =
    `<span style="color:#888">nodes</span> <span style="color:#fff;font-size:16px">${nodeCount}</span><br>` +
    `<span style="color:#888">energy</span> <span style="color:#${energyPct > 80 ? 'ff4' : energyPct > 50 ? 'aaf' : '888'};font-size:14px">${energyPct}%</span><br>` +
    `<span style="color:#555">taps ${state.totalTaps}</span><br>` +
    modeInfo;
}

// ─── Main loop ────────────────────────────────────────────────────────────────

const quadStates: QuadState[] = [];
let lastTime = 0;

function init() {
  for (const mode of ['a', 'b', 'c', 'd'] as Mode[]) {
    quadStates.push(createQuad(mode));
  }

  window.addEventListener('resize', () => {
    for (const q of quadStates) {
      const container = q.canvas.parentElement!;
      const w = container.clientWidth;
      const h = container.clientHeight;
      q.renderer.setSize(w, h);
      q.composer.setSize(w, h);
      const aspect = w / h;
      const frustum = 5;
      q.camera.left = -frustum * aspect / 2;
      q.camera.right = frustum * aspect / 2;
      q.camera.top = frustum / 2;
      q.camera.bottom = -frustum / 2;
      q.camera.updateProjectionMatrix();
    }
  });

  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function loop(now: number) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  for (const q of quadStates) updateQuad(q, dt);
  requestAnimationFrame(loop);
}

init();
