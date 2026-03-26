import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Instrument } from './engine/Instrument';
import { getAudioCtx } from './engine/audio';
import { getNodesAtHop } from './engine/graph';
import { morphologies } from './morphologies/registry';

// ─── Shared scene ───────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setClearColor(0x010103);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0x111122, 0.3));

const startFrustum = 1.8; // start very close
const camera = new THREE.OrthographicCamera(-startFrustum, startFrustum, startFrustum, -startFrustum, -50, 100);
const cameraBase = new THREE.Vector3(14, 10, 14);
camera.position.copy(cameraBase);
camera.lookAt(0, 0, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.5, 0.85);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(w, h);
  const aspect = w / h;
  // Use current camera bounds (updateCamera lerps these per frame)
  const f = Math.max(Math.abs(camera.top), startFrustum);
  camera.left = -f * aspect;
  camera.right = f * aspect;
  camera.top = f;
  camera.bottom = -f;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

// ─── Universe state ─────────────────────────────────────────────────────────

interface Organism {
  instrument: Instrument;
  origin: THREE.Vector3;
  morphIndex: number;
  age: number;
  collapsed: boolean;
}

const organisms: Organism[] = [];
let totalCollapses = 0;
let audioReady = false;
let time = 0;

// ─── Morphology gating — unlock by cumulative node count ───────────────────

let totalNodesEver = 0;    // cumulative across all organisms, including collapsed
let lastNodeSnapshot = 0;  // for delta tracking

// Thresholds: index into morphologies[] → minimum totalNodesEver to unlock
// Order matches registry: pluck(0), drone(1), sequencer(2), bells(3), fm(4), string(5), furnace(6), beats(7)
const MORPH_UNLOCK_THRESHOLDS: number[] = [0, 5, 8, 12, 16, 20, 24, 28];
const unlockedMorphs = new Set<number>([0]); // pluck always available
const usedMorphs = new Set<number>();         // track which have been spawned (for bloom pulse)

function updateUnlocks(): void {
  for (let i = 0; i < morphologies.length; i++) {
    if (!unlockedMorphs.has(i) && totalNodesEver >= (MORPH_UNLOCK_THRESHOLDS[i] ?? Infinity)) {
      unlockedMorphs.add(i);
    }
  }
}

/** Count total living nodes and update totalNodesEver */
function updateNodeCount(): void {
  let currentTotal = 0;
  for (const org of organisms) {
    if (!org.collapsed) currentTotal += org.instrument.state.nodes.length;
  }
  // Only add the delta (new nodes since last snapshot)
  if (currentTotal > lastNodeSnapshot) {
    totalNodesEver += currentTotal - lastNodeSnapshot;
  }
  lastNodeSnapshot = currentTotal;
  updateUnlocks();
}

// Collapse config — based on spatial density, not per-organism count
const DENSITY_CHECK_RADIUS = 2.0;     // radius of the sampling sphere
const DENSITY_COLLAPSE_THRESHOLD = 30; // nodes within that radius to trigger collapse
const DENSITY_CHECK_INTERVAL = 0.5;    // seconds between density checks (perf)
let lastDensityCheck = 0;

// ─── Morphology picker — only picks from unlocked, avoids repeating ──────────

let lastMorphIndex = -1;
function pickMorphology(): number {
  const available = Array.from(unlockedMorphs);
  if (available.length === 0) return 0; // fallback to pluck
  let idx: number;
  do {
    idx = available[Math.floor(Math.random() * available.length)];
  } while (idx === lastMorphIndex && available.length > 1);
  lastMorphIndex = idx;
  return idx;
}

// ─── Spawn an organism ──────────────────────────────────────────────────────

function spawnOrganism(origin: THREE.Vector3) {
  const morphIdx = pickMorphology();
  const morphology = morphologies[morphIdx];
  const isFirstUse = !usedMorphs.has(morphIdx);
  usedMorphs.add(morphIdx);

  const inst = Instrument.headless(morphology);

  // Move its world into the shared scene
  inst.state.scene.remove(inst.worldGroup);
  inst.worldGroup.position.copy(origin);
  scene.add(inst.worldGroup);

  if (audioReady) inst.initAudio();

  // First time this morphology appears — bloom pulse to celebrate
  if (isFirstUse && morphIdx > 0) {
    bloomPass.strength = Math.max(bloomPass.strength, 2.0);
    // Give the initial node extra visual pop
    if (inst.state.nodes[0]) {
      inst.state.nodes[0].ripple = 1.0;
      inst.state.nodes[0].bounce = 0.8;
    }
  }

  const org: Organism = {
    instrument: inst,
    origin: origin.clone(),
    morphIndex: morphIdx,
    age: 0,
    collapsed: false,
  };
  organisms.push(org);
  return org;
}

// ─── First organism — appears after a moment ────────────────────────────────

let firstSpawned = false;
let introTimer = 0;
const hintEl = document.getElementById('hint')!;

function spawnFirst() {
  if (firstSpawned) return;
  firstSpawned = true;
  const org = spawnOrganism(new THREE.Vector3(0, 0, 0));
  // Bloom pulse to reveal the node
  bloomPass.strength = 1.5;
  // Give the initial node some energy so it glows
  if (org.instrument.state.nodes[0]) {
    org.instrument.state.nodes[0].ripple = 0.8;
    org.instrument.state.nodes[0].bounce = 0.5;
  }
  // Fade hint in after a beat
  setTimeout(() => {
    hintEl.textContent = 'tap';
    hintEl.style.color = '#333';
  }, 800);
}

// ─── Collapse mechanic — spatial density based ──────────────────────────────

/** Collect all node world positions across all organisms */
function allWorldNodes(): { org: Organism; node: LatticeNode; world: THREE.Vector3 }[] {
  const result: { org: Organism; node: LatticeNode; world: THREE.Vector3 }[] = [];
  for (const org of organisms) {
    if (org.collapsed) continue;
    for (const node of org.instrument.state.nodes) {
      result.push({ org, node, world: node.position.clone().add(org.origin) });
    }
  }
  return result;
}

/** Find the densest point and trigger collapse if threshold exceeded */
function checkDensityCollapse() {
  const all = allWorldNodes();
  if (all.length < DENSITY_COLLAPSE_THRESHOLD) return;

  let bestCenter: THREE.Vector3 | null = null;
  let bestCount = 0;

  // Sample density around each node's position
  for (const entry of all) {
    let count = 0;
    for (const other of all) {
      if (entry.world.distanceTo(other.world) < DENSITY_CHECK_RADIUS) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestCenter = entry.world.clone();
    }
  }

  if (bestCount >= DENSITY_COLLAPSE_THRESHOLD && bestCenter) {
    triggerSpatialCollapse(bestCenter, all);
  }
}

interface ConsumedNode {
  org: Organism;
  node: LatticeNode;
  world: THREE.Vector3;
  originalLocal: THREE.Vector3; // position before animation
}

interface CollapseAnim {
  center: THREE.Vector3;
  consumed: ConsumedNode[];   // only the nodes being swallowed
  startTime: number;
  duration: number;
  phase: 'implode' | 'flash' | 'birth';
  newOrigin: THREE.Vector3;
}

const collapseAnims: CollapseAnim[] = [];

/** Black hole sound — descending sub-bass with noise wash */
function playCollapseSound() {
  if (!audioReady) return;
  const ctx = getAudioCtx();
  const t = ctx.currentTime;

  // Sub-bass sweep: 80Hz → 20Hz over 2s
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, t);
  sub.frequency.exponentialRampToValueAtTime(20, t + 2.0);
  subGain.gain.setValueAtTime(0.2, t);
  subGain.gain.setValueAtTime(0.2, t + 0.5);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
  sub.connect(subGain).connect(ctx.destination);
  sub.start(t);
  sub.stop(t + 2.6);

  // Filtered noise wash — sucking sound
  const bufSize = Math.floor(ctx.sampleRate * 0.1);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(800, t);
  noiseFilter.frequency.exponentialRampToValueAtTime(60, t + 1.8);
  noiseFilter.Q.value = 3;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.08, t);
  noiseGain.gain.setValueAtTime(0.12, t + 0.8);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
  noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noise.start(t);
  noise.stop(t + 2.3);

  // Low thud on impact
  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.value = 35;
  thudGain.gain.setValueAtTime(0, t + 1.0);
  thudGain.gain.linearRampToValueAtTime(0.3, t + 1.05);
  thudGain.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
  thud.connect(thudGain).connect(ctx.destination);
  thud.start(t + 1.0);
  thud.stop(t + 1.9);
}

/** Surgically remove a single node from its organism */
function removeNodeFromOrganism(org: Organism, node: LatticeNode) {
  const s = org.instrument.state;

  // Remove edges involving this node
  for (let i = s.edges.length - 1; i >= 0; i--) {
    const edge = s.edges[i];
    if (edge.from === node.id || edge.to === node.id) {
      s.edgeGroup.remove(edge.line);
      edge.line.geometry.dispose();
      (edge.line.material as THREE.Material).dispose();
      s.edges.splice(i, 1);
    }
  }

  // Remove packets involving this node
  for (let i = s.packets.length - 1; i >= 0; i--) {
    const pkt = s.packets[i];
    if (pkt.from === node.id || pkt.to === node.id) {
      if (pkt.mesh) s.packetGroup.remove(pkt.mesh);
      s.packets.splice(i, 1);
    }
  }

  // Remove node meshes
  if (node.mesh) {
    s.nodeGroup.remove(node.mesh);
    node.mesh.geometry.dispose();
    (node.mesh.material as THREE.Material).dispose();
  }
  if (node.ringMesh) {
    s.nodeGroup.remove(node.ringMesh);
    node.ringMesh.geometry.dispose();
    (node.ringMesh.material as THREE.Material).dispose();
  }

  // Remove from nodes array
  const idx = s.nodes.indexOf(node);
  if (idx !== -1) s.nodes.splice(idx, 1);
}

function triggerSpatialCollapse(
  center: THREE.Vector3,
  all: { org: Organism; node: LatticeNode; world: THREE.Vector3 }[],
) {
  const collapseRadius = DENSITY_CHECK_RADIUS * 1.5;

  // Collect only the nodes within the collapse zone
  const consumed: ConsumedNode[] = [];
  for (const entry of all) {
    if (entry.world.distanceTo(center) < collapseRadius) {
      consumed.push({
        org: entry.org,
        node: entry.node,
        world: entry.world.clone(),
        originalLocal: entry.node.position.clone(),
      });
    }
  }

  if (consumed.length === 0) return;

  // New organism spawns near the collapse center
  const angle = Math.random() * Math.PI * 2;
  const dist = 0.5 + totalCollapses * 0.2;
  const newOrigin = center.clone().add(
    new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
  );

  collapseAnims.push({
    center,
    consumed,
    startTime: time,
    duration: 2.2,
    phase: 'implode',
    newOrigin,
  });

  playCollapseSound();
}

function updateCollapses(dt: number) {
  for (let i = collapseAnims.length - 1; i >= 0; i--) {
    const anim = collapseAnims[i];
    const elapsed = time - anim.startTime;
    const t = elapsed / anim.duration;

    if (anim.phase === 'implode' && t < 0.5) {
      const pull = t * 2;
      const eased = pull * pull;

      // Only animate the consumed nodes toward center
      for (const c of anim.consumed) {
        const localCenter = anim.center.clone().sub(c.org.origin);
        if (c.node.mesh) {
          c.node.mesh.position.lerpVectors(c.originalLocal, localCenter, eased);
          c.node.mesh.scale.setScalar(c.org.instrument.state.profile.nodeScale * (1 - eased * 0.85));
        }
        if (c.node.ringMesh) {
          c.node.ringMesh.scale.setScalar(1 - eased);
        }
      }
      bloomPass.strength = 0.8 + eased * 2;
    }

    if (anim.phase === 'implode' && t >= 0.5 && t < 0.65) {
      anim.phase = 'flash';
      bloomPass.strength = 3.0;

      // Surgically remove only the consumed nodes
      for (const c of anim.consumed) {
        removeNodeFromOrganism(c.org, c.node);
      }

      // If any organism has zero nodes left, remove it entirely
      for (let oi = organisms.length - 1; oi >= 0; oi--) {
        const org = organisms[oi];
        if (org.instrument.state.nodes.length === 0) {
          scene.remove(org.instrument.worldGroup);
          organisms.splice(oi, 1);
        }
      }
    }

    if (anim.phase === 'flash' && t >= 0.65) {
      anim.phase = 'birth';
      bloomPass.strength = 1.5;
      totalCollapses++;

      // Spawn new organism at collapse site
      const newOrg = spawnOrganism(anim.newOrigin);
      newOrg.age = 0;
    }

    if (t >= 1.0) {
      bloomPass.strength = Math.max(0.6, bloomPass.strength - dt * 2);
      collapseAnims.splice(i, 1);
    }
  }

  // Decay bloom back to base
  if (collapseAnims.length === 0) {
    const targetBloom = 0.4 + Math.min(0.6, organisms.length * 0.15);
    bloomPass.strength += (targetBloom - bloomPass.strength) * dt * 2;
  }
}

// ─── Tap handling — deliberate, not frantic ──────────────────────────────────

import { LatticeNode } from './engine/types';

const raycaster = new THREE.Raycaster();

function handleTap(mouse: THREE.Vector2) {
  raycaster.setFromCamera(mouse, camera);

  // Find closest node across all organisms using ray distance in world space
  let bestOrg: Organism | null = null;
  let bestNode: LatticeNode | null = null;
  let bestDist = 1.5;

  for (const org of organisms) {
    if (org.collapsed) continue;
    for (const node of org.instrument.state.nodes) {
      // Node world position = local position + organism origin
      const worldPos = node.position.clone().add(org.origin);
      const dist = raycaster.ray.distanceToPoint(worldPos);
      if (dist < bestDist) {
        bestDist = dist;
        bestOrg = org;
        bestNode = node;
      }
    }
  }

  if (bestOrg && bestNode) {
    bestOrg.instrument.tapNode(bestNode);
  }
}

// ─── Death handling — right-click = Touch of Death ──────────────────────────

interface DeathSite {
  position: THREE.Vector3;
  time: number;
  morphId: string;
}

const deathSites: DeathSite[] = [];

function handleRightTap(mouse: THREE.Vector2) {
  raycaster.setFromCamera(mouse, camera);

  // Find closest node across all organisms
  let bestOrg: Organism | null = null;
  let bestNode: LatticeNode | null = null;
  let bestDist = 1.5;

  for (const org of organisms) {
    if (org.collapsed) continue;
    for (const node of org.instrument.state.nodes) {
      if (node.death !== undefined) continue;
      const worldPos = node.position.clone().add(org.origin);
      const dist = raycaster.ray.distanceToPoint(worldPos);
      if (dist < bestDist) {
        bestDist = dist;
        bestOrg = org;
        bestNode = node;
      }
    }
  }

  if (bestOrg && bestNode) {
    // Record death site for later use (Phase 5)
    deathSites.push({
      position: bestNode.position.clone().add(bestOrg.origin),
      time,
      morphId: bestOrg.instrument.morphology.id,
    });
    // Kill the node
    bestOrg.instrument.killNode(bestNode);

    // Clean up organisms with zero living nodes
    for (let oi = organisms.length - 1; oi >= 0; oi--) {
      const org = organisms[oi];
      if (org.instrument.state.nodes.length === 0) {
        scene.remove(org.instrument.worldGroup);
        organisms.splice(oi, 1);
      }
    }
  }
}

function handleRightHoldDrain(mouse: THREE.Vector2, dt: number) {
  raycaster.setFromCamera(mouse, camera);

  // Find closest living node across all organisms
  let bestOrg: Organism | null = null;
  let bestNode: LatticeNode | null = null;
  let bestDist = 1.5;

  for (const org of organisms) {
    if (org.collapsed) continue;
    for (const node of org.instrument.state.nodes) {
      if (node.death !== undefined) continue;
      const worldPos = node.position.clone().add(org.origin);
      const dist = raycaster.ray.distanceToPoint(worldPos);
      if (dist < bestDist) {
        bestDist = dist;
        bestOrg = org;
        bestNode = node;
      }
    }
  }

  if (!bestOrg || !bestNode) return;

  // Drain the target node: -0.3/s
  bestNode.energy = Math.max(0, bestNode.energy - 0.3 * dt);
  if (bestNode.energy <= 0) {
    bestOrg.instrument.killNode(bestNode);
    return;
  }

  // Drain 1-hop neighbors: -0.15/s
  const hop1 = getNodesAtHop(bestOrg.instrument.state, bestNode.id, 1);
  for (const n of hop1) {
    if (n.death !== undefined) continue;
    n.energy = Math.max(0, n.energy - 0.15 * dt);
    if (n.energy <= 0) bestOrg.instrument.killNode(n);
  }

  // Drain 2-hop neighbors: -0.075/s
  const hop2 = getNodesAtHop(bestOrg.instrument.state, bestNode.id, 2);
  for (const n of hop2) {
    if (n.death !== undefined) continue;
    n.energy = Math.max(0, n.energy - 0.075 * dt);
    if (n.energy <= 0) bestOrg.instrument.killNode(n);
  }
}

let rightHoldMouse: THREE.Vector2 | null = null;

function mouseToNDC(e: MouseEvent): THREE.Vector2 {
  return new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
}

// Manual zoom via scroll — multiplier on the auto-zoom
let zoomOffset = 0; // added to targetFrustum

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomOffset += e.deltaY * 0.005;
  zoomOffset = Math.max(-2.5, zoomOffset); // can't zoom in past a floor
}, { passive: false });

// Deliberate tapping — hold autotaps at ~30 BPM (slow, meditative)
let holdMouse: THREE.Vector2 | null = null;
let holdAccum = 0;

// Prevent default context menu
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Right-click: Touch of Death
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2) {
    if (!firstSpawned) return;
    const mouse = mouseToNDC(e);
    handleRightTap(mouse);
    rightHoldMouse = mouse;
    return;
  }
});
canvas.addEventListener('mouseup', (e) => {
  if (e.button === 2) rightHoldMouse = null;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  // First click: init audio + spawn first organism
  if (!audioReady) {
    getAudioCtx();
    audioReady = true;
    const audioHint = document.getElementById('audio-hint');
    if (audioHint) { audioHint.style.opacity = '0'; setTimeout(() => audioHint.remove(), 1000); }
  }
  if (!firstSpawned) {
    spawnFirst();
    // Don't tap yet — let the node appear first
    return;
  }
  holdMouse = mouseToNDC(e);
  holdAccum = 99; // fire first tap immediately
});
canvas.addEventListener('mousemove', (e) => {
  const m = mouseToNDC(e);
  if (holdMouse) holdMouse = m;
  if (rightHoldMouse) rightHoldMouse = m;
});
canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) holdMouse = null;
  // button 2 already handled above
});
canvas.addEventListener('mouseleave', () => {
  holdMouse = null;
  rightHoldMouse = null;
});

// ─── Audio init handled in mousedown above ──────────────────────────────────

// ─── Camera ─────────────────────────────────────────────────────────────────

// Camera focus — drifts on its own, completely decoupled from collapse events
const cameraFocus = new THREE.Vector3(0, 0, 0);
let smoothFrustum = startFrustum;

function updateCamera(dt: number) {
  // Target = center of mass of living organisms (or last known position)
  const com = new THREE.Vector3();
  let total = 0;
  for (const org of organisms) {
    if (org.collapsed) continue;
    com.add(org.origin);
    total++;
  }
  if (total > 0) com.divideScalar(total);

  // Very slow drift toward target — camera is unbothered
  cameraFocus.lerp(com, dt * 0.12);

  // Zoom based on total nodes
  const totalNodes = organisms.reduce((s, o) => s + (o.collapsed ? 0 : o.instrument.state.nodes.length), 0);
  const targetFrustum = Math.max(1.5, 1.8 + Math.sqrt(Math.max(0, totalNodes - 1)) * 0.6 + organisms.length * 1.0 + zoomOffset);
  // Smooth the frustum too — never snaps
  smoothFrustum += (targetFrustum - smoothFrustum) * dt * 0.1;

  const orbitRadius = 10 + smoothFrustum * 0.5;
  const orbitSpeed = 0.08 - Math.min(0.04, organisms.length * 0.005);
  const orbitAngle = time * orbitSpeed;
  camera.position.set(
    cameraFocus.x + Math.cos(orbitAngle) * orbitRadius,
    8 + smoothFrustum * 0.3 + Math.sin(time * 0.05) * 1.5,
    cameraFocus.z + Math.sin(orbitAngle) * orbitRadius
  );
  camera.lookAt(cameraFocus.x, 0, cameraFocus.z);

  const aspect = window.innerWidth / window.innerHeight;
  // Smooth lerp toward target zoom
  // Apply smoothed frustum directly
  camera.left = -smoothFrustum * aspect;
  camera.right = smoothFrustum * aspect;
  camera.top = smoothFrustum;
  camera.bottom = -smoothFrustum;
  camera.updateProjectionMatrix();
}

// ─── Cross-organism interaction (simplified CA-like) ─────────────────────────

function updateInteractions(dt: number) {
  if (organisms.length < 2) return;

  // Check proximity between organisms' nodes
  for (let a = 0; a < organisms.length; a++) {
    if (organisms[a].collapsed) continue;
    for (let b = a + 1; b < organisms.length; b++) {
      if (organisms[b].collapsed) continue;

      const orgA = organisms[a];
      const orgB = organisms[b];

      // Check closest node pair between organisms
      let minDist = Infinity;
      for (const nA of orgA.instrument.state.nodes) {
        const worldA = nA.position.clone().add(orgA.origin);
        for (const nB of orgB.instrument.state.nodes) {
          const worldB = nB.position.clone().add(orgB.origin);
          const d = worldA.distanceTo(worldB);
          if (d < minDist) minDist = d;
        }
      }

      // Proximity interaction: when close, exchange energy via ripples
      if (minDist < 3.0) {
        const strength = (3.0 - minDist) / 3.0;

        // Both organisms' border nodes get energy and visual excitement
        for (const nA of orgA.instrument.state.nodes) {
          const worldA = nA.position.clone().add(orgA.origin);
          for (const nB of orgB.instrument.state.nodes) {
            const worldB = nB.position.clone().add(orgB.origin);
            if (worldA.distanceTo(worldB) < 3.0) {
              // Mutual stimulation — small energy transfer
              nA.energy = Math.min(1, nA.energy + strength * 0.005 * dt);
              nB.energy = Math.min(1, nB.energy + strength * 0.005 * dt);
              // Visual ripple on proximity
              if (Math.random() < strength * 0.1 * dt) {
                nA.ripple = Math.max(nA.ripple, strength * 0.3);
                nB.ripple = Math.max(nB.ripple, strength * 0.3);
              }
            }
          }
        }
      }
    }
  }
}

// ─── Hint updates ───────────────────────────────────────────────────────────

function updateHint() {
  if (!firstSpawned) return;
  if (totalCollapses === 0 && organisms.length === 1) {
    const nodes = organisms[0]?.instrument.state.nodes.length ?? 0;
    if (nodes === 1 && organisms[0]?.instrument.state.totalTaps === 0) {
      hintEl.textContent = 'tap';
      hintEl.style.color = '#333';
    } else if (nodes === 1) {
      hintEl.textContent = '';
    } else {
      hintEl.style.opacity = '0';
    }
  } else if (totalCollapses === 1) {
    hintEl.style.opacity = '1';
    hintEl.textContent = '';
  } else {
    hintEl.style.opacity = '0';
  }
}

// ─── Cosmic dust — ambient particles attracted to organisms ──────────────────

interface Mote {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

const motes: Mote[] = [];
const MAX_MOTES = 60;
const moteGeo = new THREE.SphereGeometry(0.02, 4, 3);

function spawnMote() {
  // Spawn at random position in a wide area around the universe
  const range = smoothFrustum * 2 + 5;
  const pos = new THREE.Vector3(
    (Math.random() - 0.5) * range + cameraFocus.x,
    (Math.random() - 0.5) * 3,
    (Math.random() - 0.5) * range + cameraFocus.z,
  );
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.15 + Math.random() * 0.15,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(moteGeo, mat);
  mesh.position.copy(pos);
  mesh.scale.setScalar(0.5 + Math.random() * 1.5);
  scene.add(mesh);

  const angle = Math.random() * Math.PI * 2;
  const speed = 0.1 + Math.random() * 0.3;
  motes.push({
    mesh,
    velocity: new THREE.Vector3(Math.cos(angle) * speed, (Math.random() - 0.5) * 0.05, Math.sin(angle) * speed),
    life: 0,
    maxLife: 8 + Math.random() * 15,
  });
}

function updateMotes(dt: number) {
  // Spawn new motes
  if (firstSpawned && motes.length < MAX_MOTES && Math.random() < 0.3 * dt) {
    spawnMote();
  }

  for (let i = motes.length - 1; i >= 0; i--) {
    const m = motes[i];
    m.life += dt;

    // Gentle attraction toward nearest organism
    let nearestDist = Infinity;
    const attract = new THREE.Vector3();
    for (const org of organisms) {
      if (org.collapsed) continue;
      for (const node of org.instrument.state.nodes) {
        const worldPos = node.position.clone().add(org.origin);
        const d = m.mesh.position.distanceTo(worldPos);
        if (d < nearestDist && d > 0.3) {
          nearestDist = d;
          attract.copy(worldPos).sub(m.mesh.position);
        }
      }
    }
    // Weak gravity: force proportional to 1/dist²
    if (nearestDist < 10 && nearestDist > 0.3) {
      const force = 0.1 / (nearestDist * nearestDist);
      attract.normalize().multiplyScalar(force);
      m.velocity.add(attract.multiplyScalar(dt));
    }

    // Drag
    m.velocity.multiplyScalar(1 - 0.3 * dt);

    // Move
    m.mesh.position.add(m.velocity.clone().multiplyScalar(dt));

    // Fade
    const lifeFrac = m.life / m.maxLife;
    const fade = lifeFrac < 0.1 ? lifeFrac * 10 : lifeFrac > 0.8 ? (1 - lifeFrac) * 5 : 1;
    (m.mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.2;

    // Remove dead motes
    if (m.life >= m.maxLife) {
      scene.remove(m.mesh);
      motes.splice(i, 1);
    }
  }
}

// ─── Escaped packets — excited packets that fly off into space ──────────────

interface EscapedPacket {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

const escapedPackets: EscapedPacket[] = [];
const MAX_ESCAPED = 30;

function checkPacketEscapes() {
  for (const org of organisms) {
    if (org.collapsed) continue;
    const s = org.instrument.state;
    // Only when packet traffic is high
    if (s.packets.length < 6) continue;

    const escapeChance = (s.packets.length - 5) * 0.002;
    for (let i = s.packets.length - 1; i >= 0; i--) {
      if (escapedPackets.length >= MAX_ESCAPED) break;
      if (Math.random() > escapeChance) continue;

      const pkt = s.packets[i];
      if (!pkt.mesh) continue;

      // Yeet the packet into space
      const worldPos = pkt.mesh.position.clone().add(org.origin);
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.5 + 0.2, // bias upward
        Math.random() - 0.5,
      ).normalize();
      const speed = 1.5 + Math.random() * 3;

      // Create a new mesh for the escaped packet (detach from instrument)
      const geo = new THREE.SphereGeometry(0.04, 4, 3);
      const mat = new THREE.MeshBasicMaterial({
        color: s.profile.nodeColor,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(worldPos);
      scene.add(mesh);

      escapedPackets.push({
        mesh,
        velocity: dir.multiplyScalar(speed),
        life: 0,
      });

      // Remove from the instrument's packet list
      if (pkt.mesh) s.packetGroup.remove(pkt.mesh);
      s.packets.splice(i, 1);
      break; // max one escape per organism per frame
    }
  }
}

function updateEscapedPackets(dt: number) {
  checkPacketEscapes();

  for (let i = escapedPackets.length - 1; i >= 0; i--) {
    const ep = escapedPackets[i];
    ep.life += dt;

    // Slight drag
    ep.velocity.multiplyScalar(1 - 0.15 * dt);
    ep.mesh.position.add(ep.velocity.clone().multiplyScalar(dt));

    // Fade out over 3 seconds
    const alpha = Math.max(0, 1 - ep.life / 3);
    (ep.mesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.8;
    ep.mesh.scale.setScalar(1 + ep.life * 0.5); // grow as it fades

    if (ep.life > 3) {
      scene.remove(ep.mesh);
      escapedPackets.splice(i, 1);
    }
  }
}

// ─── Main loop ──────────────────────────────────────────────────────────────

let lastTime = performance.now();

function loop(now: number) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  time += dt;

  // Intro — stay dark, wait for click
  if (!firstSpawned) {
    introTimer += dt;
    renderer.setClearColor(0x010103);
  }

  // Update all organisms
  for (const org of organisms) {
    if (org.collapsed) continue;
    org.age += dt;
    org.instrument.update(dt);
  }

  // Track cumulative nodes for morphology gating
  updateNodeCount();

  // Spatial density check — collapse where too many nodes are packed together
  lastDensityCheck += dt;
  if (lastDensityCheck >= DENSITY_CHECK_INTERVAL && collapseAnims.length === 0) {
    lastDensityCheck = 0;
    checkDensityCollapse();
  }

  // Hold-to-tap — slow, 55 BPM base
  if (holdMouse) {
    const totalNodes = organisms.reduce((s, o) => s + (o.collapsed ? 0 : o.instrument.state.nodes.length), 0);
    const bpm = 30 - Math.min(12, totalNodes * 0.2);
    const interval = 60 / bpm;
    holdAccum += dt;
    if (holdAccum >= interval) {
      holdAccum -= interval;
      handleTap(holdMouse);
    }
  }

  // Right-hold drain — continuous energy drain near cursor
  if (rightHoldMouse) {
    handleRightHoldDrain(rightHoldMouse, dt);
  }

  updateCollapses(dt);
  updateInteractions(dt);
  updateMotes(dt);
  updateEscapedPackets(dt);
  updateCamera(dt);
  updateHint();

  composer.render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
