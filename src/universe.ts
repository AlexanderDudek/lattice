import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Instrument } from './engine/Instrument';
import { getAudioCtx } from './engine/audio';
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

// Collapse config — based on spatial density, not per-organism count
const DENSITY_CHECK_RADIUS = 2.0;     // radius of the sampling sphere
const DENSITY_COLLAPSE_THRESHOLD = 30; // nodes within that radius to trigger collapse
const DENSITY_CHECK_INTERVAL = 0.5;    // seconds between density checks (perf)
let lastDensityCheck = 0;

// ─── Morphology picker — avoids repeating ────────────────────────────────────

let lastMorphIndex = -1;
function pickMorphology(): number {
  let idx: number;
  do {
    idx = Math.floor(Math.random() * morphologies.length);
  } while (idx === lastMorphIndex && morphologies.length > 1);
  lastMorphIndex = idx;
  return idx;
}

// ─── Spawn an organism ──────────────────────────────────────────────────────

function spawnOrganism(origin: THREE.Vector3) {
  const morphIdx = pickMorphology();
  const morphology = morphologies[morphIdx];

  const inst = Instrument.headless(morphology);

  // Move its world into the shared scene
  inst.state.scene.remove(inst.worldGroup);
  inst.worldGroup.position.copy(origin);
  scene.add(inst.worldGroup);

  if (audioReady) inst.initAudio();

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
  if (holdMouse) holdMouse = mouseToNDC(e);
});
canvas.addEventListener('mouseup', () => { holdMouse = null; });
canvas.addEventListener('mouseleave', () => { holdMouse = null; });

// ─── Audio init handled in mousedown above ──────────────────────────────────

// ─── Camera ─────────────────────────────────────────────────────────────────

function updateCamera(dt: number) {
  // Slowly orbit, and track center of all organisms
  const com = new THREE.Vector3();
  let total = 0;
  for (const org of organisms) {
    if (org.collapsed) continue;
    com.add(org.origin);
    total++;
  }
  if (total > 0) com.divideScalar(total);

  // Zoom based on total nodes — start tight, ease out as universe grows
  const totalNodes = organisms.reduce((s, o) => s + (o.collapsed ? 0 : o.instrument.state.nodes.length), 0);
  const targetFrustum = Math.max(1.5, 1.8 + Math.sqrt(Math.max(0, totalNodes - 1)) * 0.6 + organisms.length * 1.0 + zoomOffset);
  const orbitRadius = 10 + targetFrustum * 0.5;
  const orbitSpeed = 0.08 - Math.min(0.04, organisms.length * 0.005);
  const orbitAngle = time * orbitSpeed;
  camera.position.set(
    com.x + Math.cos(orbitAngle) * orbitRadius,
    8 + targetFrustum * 0.3 + Math.sin(time * 0.05) * 1.5,
    com.z + Math.sin(orbitAngle) * orbitRadius
  );
  camera.lookAt(com.x, 0, com.z);

  const aspect = window.innerWidth / window.innerHeight;
  // Smooth lerp toward target zoom
  // Very slow zoom lerp — camera eases out gently
  camera.left += (-targetFrustum * aspect - camera.left) * dt * 0.15;
  camera.right += (targetFrustum * aspect - camera.right) * dt * 0.15;
  camera.top += (targetFrustum - camera.top) * dt * 0.15;
  camera.bottom += (-targetFrustum - camera.bottom) * dt * 0.15;
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

  updateCollapses(dt);
  updateInteractions(dt);
  updateCamera(dt);
  updateHint();

  composer.render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
