import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Instrument } from './engine/Instrument';
import { getAudioCtx } from './engine/audio';
import { LatticeNode } from './engine/types';
import { morphologies } from './morphologies/registry';

// ─── Generate grid slots from registry ──────────────────────────────────────

const grid = document.getElementById('grid')!;
const count = morphologies.length;
const slots: string[] = [];

for (let i = 0; i < count; i++) {
  const m = morphologies[i];
  const slot = String.fromCharCode(97 + i); // a, b, c, ...
  slots.push(slot);
  const div = document.createElement('div');
  div.className = 'quadrant';
  div.id = `quad-${slot}`;
  div.innerHTML = `
    <div class="quad-label">
      <span class="mode-name" style="color:${m.accentHex}">${m.name}</span>
      ${m.description}
      <span class="audio-controls">
        <button class="btn-mute" id="mute-${slot}" title="Mute">M</button>
        <button class="btn-solo" id="solo-${slot}" title="Solo">S</button>
      </span>
    </div>
    <div class="quad-counter" id="counter-${slot}"></div>
    <div class="quad-hint" id="hint-${slot}">${m.hints.initial}</div>
    <canvas id="canvas-${slot}"></canvas>
  `;
  grid.appendChild(div);
}

// ─── Create instruments ──────────────────────────────────────────────────────

const instruments: Instrument[] = [];

for (let i = 0; i < count; i++) {
  const canvas = document.getElementById(`canvas-${slots[i]}`) as HTMLCanvasElement;
  const instrument = new Instrument(canvas, morphologies[i]);
  instrument.counterEl = document.getElementById(`counter-${slots[i]}`);
  instrument.hintEl = document.getElementById(`hint-${slots[i]}`);
  instruments.push(instrument);
}

// ─── Mute / Solo controls ────────────────────────────────────────────────────

import { BaseAudio } from './engine/audio';

let soloIndex = -1; // -1 = no solo active

function updateMuteState() {
  for (let i = 0; i < instruments.length; i++) {
    const audio = instruments[i].audio as BaseAudio;
    const muteBtn = document.getElementById(`mute-${slots[i]}`)!;
    const soloBtn = document.getElementById(`solo-${slots[i]}`)!;

    if (soloIndex >= 0) {
      // Solo mode: only the soloed instrument is audible
      audio.muted = i !== soloIndex;
    }
    // else respect individual mute state (already set)

    muteBtn.classList.toggle('active', audio.muted);
    soloBtn.classList.toggle('active', soloIndex === i);
  }
}

for (let i = 0; i < count; i++) {
  const muteBtn = document.getElementById(`mute-${slots[i]}`)!;
  const soloBtn = document.getElementById(`solo-${slots[i]}`)!;

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (soloIndex >= 0) return; // ignore mute while solo is active
    const audio = instruments[i].audio as BaseAudio;
    audio.muted = !audio.muted;
    updateMuteState();
  });

  soloBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soloIndex = soloIndex === i ? -1 : i;
    // When exiting solo, unmute all
    if (soloIndex === -1) {
      instruments.forEach(inst => (inst.audio as BaseAudio).muted = false);
    }
    updateMuteState();
  });
}

// ─── Audio init on first click ───────────────────────────────────────────────

document.addEventListener('click', () => {
  getAudioCtx();
  instruments.forEach(inst => inst.initAudio());
  updateMuteState();
  const hint = document.getElementById('audio-hint');
  if (hint) { hint.style.opacity = '0'; setTimeout(() => hint.remove(), 1000); }
}, { once: true });

// ─── Merged view setup ──────────────────────────────────────────────────────

const mergedCanvas = document.getElementById('merged-canvas') as HTMLCanvasElement;

const mergedRenderer = new THREE.WebGLRenderer({ canvas: mergedCanvas, antialias: true, alpha: false });
mergedRenderer.setClearColor(0x050508);
mergedRenderer.toneMapping = THREE.ACESFilmicToneMapping;
mergedRenderer.toneMappingExposure = 1.0;

const mergedScene = new THREE.Scene();
mergedScene.add(new THREE.AmbientLight(0x222244, 0.4));

const mergedFrustum = 7;
const mergedCamera = new THREE.OrthographicCamera(
  -mergedFrustum, mergedFrustum,
  mergedFrustum * 0.5625, -mergedFrustum * 0.5625,
  -50, 100
);

const mergedComposer = new EffectComposer(mergedRenderer);
mergedComposer.addPass(new RenderPass(mergedScene, mergedCamera));
mergedComposer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 1.2, 0.4, 0.75));
mergedComposer.addPass(new OutputPass());

// Generate offsets in a circle for any number of morphologies
const mergedOffsets: THREE.Vector3[] = [];
const offsetRadius = 2.5;
for (let i = 0; i < count; i++) {
  const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
  mergedOffsets.push(new THREE.Vector3(
    Math.cos(angle) * offsetRadius,
    (Math.random() - 0.5) * 0.5,
    Math.sin(angle) * offsetRadius,
  ));
}

function resizeMerged() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  mergedRenderer.setSize(w, h);
  mergedRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mergedComposer.setSize(w, h);
  const aspect = w / h;
  mergedCamera.left = -mergedFrustum * aspect;
  mergedCamera.right = mergedFrustum * aspect;
  mergedCamera.top = mergedFrustum;
  mergedCamera.bottom = -mergedFrustum;
  mergedCamera.updateProjectionMatrix();
}

// ─── Merged view hold-to-autotap ─────────────────────────────────────────────

let mergedHoldMouse: THREE.Vector2 | null = null;
let mergedHoldAccum = 0;

function mergedMouseFromEvent(e: MouseEvent): THREE.Vector2 {
  const rect = mergedCanvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
}

function mergedTapAt(mouse: THREE.Vector2) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, mergedCamera);

  let bestInst: Instrument | null = null;
  let bestDist = 1.0;
  let bestOffset = mergedOffsets[0];

  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    const offset = mergedOffsets[i];
    const localOrigin = raycaster.ray.origin.clone().sub(offset);
    const localRay = new THREE.Ray(localOrigin, raycaster.ray.direction.clone());
    for (const node of inst.state.nodes) {
      const dist = localRay.distanceToPoint(node.position);
      if (dist < bestDist) {
        bestDist = dist;
        bestInst = inst;
        bestOffset = offset;
      }
    }
  }

  if (bestInst) {
    bestInst.handleRaycast(raycaster, bestOffset);
  } else {
    for (let i = 0; i < instruments.length; i++) {
      instruments[i].handleRaycast(raycaster, mergedOffsets[i]);
    }
  }
}

mergedCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  mergedHoldMouse = mergedMouseFromEvent(e);
  mergedHoldAccum = 99; // fire first tap immediately
});
mergedCanvas.addEventListener('mousemove', (e) => {
  const m = mergedMouseFromEvent(e);
  if (mergedHoldMouse) mergedHoldMouse = m;
  if (mergedRightHoldMouse) mergedRightHoldMouse = m;
});
mergedCanvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) mergedHoldMouse = null;
  if (e.button === 2) mergedRightHoldMouse = null;
});
mergedCanvas.addEventListener('mouseleave', () => {
  mergedHoldMouse = null;
  mergedRightHoldMouse = null;
});

// ─── Merged view right-click — Touch of Death ────────────────────────────────

mergedCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

let mergedRightHoldMouse: THREE.Vector2 | null = null;

function mergedRightTapAt(mouse: THREE.Vector2) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, mergedCamera);

  let bestInst: Instrument | null = null;
  let bestDist = 1.0;
  let bestOffset = mergedOffsets[0];

  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    const offset = mergedOffsets[i];
    const localOrigin = raycaster.ray.origin.clone().sub(offset);
    const localRay = new THREE.Ray(localOrigin, raycaster.ray.direction.clone());
    for (const node of inst.state.nodes) {
      if (node.death !== undefined) continue;
      const dist = localRay.distanceToPoint(node.position);
      if (dist < bestDist) {
        bestDist = dist;
        bestInst = inst;
        bestOffset = offset;
      }
    }
  }

  if (bestInst) {
    bestInst.handleRightRaycast(raycaster, bestOffset);
  }
}

mergedCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 2) return;
  const mouse = mergedMouseFromEvent(e);
  mergedRightTapAt(mouse);
  mergedRightHoldMouse = mouse;
});

// ─── View state ─────────────────────────────────────────────────────────────

type ViewMode = 'grid' | 'merged' | 'solo';

const panel = document.getElementById('control-panel')!;
const btnView = document.getElementById('btn-view')!;
const btnFs = document.getElementById('btn-fs')!;

let viewMode: ViewMode = 'grid';
let expandedIndex = -1;

function triggerResize() {
  setTimeout(() => instruments.forEach(inst => inst.resize()), 50);
  setTimeout(() => instruments.forEach(inst => inst.resize()), 450);
}

function enterMerged() {
  viewMode = 'merged';
  expandedIndex = -1;

  grid.style.display = 'none';
  mergedCanvas.style.display = 'block';
  resizeMerged();

  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    inst.state.scene.remove(inst.worldGroup);
    inst.worldGroup.position.copy(mergedOffsets[i]);
    mergedScene.add(inst.worldGroup);
    inst.skipRender = true;
  }

  btnView.textContent = 'merged';
}

function exitMerged() {
  for (const inst of instruments) {
    mergedScene.remove(inst.worldGroup);
    inst.worldGroup.position.set(0, 0, 0);
    inst.state.scene.add(inst.worldGroup);
    inst.skipRender = false;
  }

  mergedCanvas.style.display = 'none';
}

function expandQuadrant(index: number) {
  if (viewMode === 'merged') exitMerged();
  viewMode = 'solo';
  expandedIndex = index;
  grid.style.display = '';
  grid.classList.add('fullscreen');
  for (let i = 0; i < slots.length; i++) {
    const quad = document.getElementById(`quad-${slots[i]}`)!;
    if (i === index) quad.classList.add('expanded');
    else quad.classList.remove('expanded');
  }
  btnView.textContent = morphologies[index].name;
  triggerResize();
}

function collapseToGrid() {
  if (viewMode === 'merged') exitMerged();
  viewMode = 'grid';
  expandedIndex = -1;
  grid.style.display = '';
  grid.classList.remove('fullscreen');
  for (const slot of slots) {
    document.getElementById(`quad-${slot}`)!.classList.remove('expanded');
  }
  btnView.textContent = 'grid';
  triggerResize();
}

// ─── View toggle button ─────────────────────────────────────────────────────

btnView.addEventListener('click', () => {
  if (viewMode === 'grid') {
    enterMerged();
  } else if (viewMode === 'merged') {
    expandQuadrant(0);
  } else {
    const next = expandedIndex + 1;
    if (next >= slots.length) collapseToGrid();
    else expandQuadrant(next);
  }
});

btnView.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (viewMode === 'grid') {
    expandQuadrant(slots.length - 1);
  } else if (viewMode === 'merged') {
    collapseToGrid();
  } else if (expandedIndex > 0) {
    expandQuadrant(expandedIndex - 1);
  } else {
    enterMerged();
  }
});

// ─── Fullscreen button ──────────────────────────────────────────────────────

btnFs.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  btnFs.textContent = document.fullscreenElement ? 'exit fs' : 'fullscreen';
  if (viewMode === 'merged') resizeMerged();
  triggerResize();
});

// ─── Click mode name to expand ──────────────────────────────────────────────

for (let i = 0; i < slots.length; i++) {
  const label = document.querySelector(`#quad-${slots[i]} .mode-name`) as HTMLElement;
  if (label) {
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expandedIndex === i) collapseToGrid();
      else expandQuadrant(i);
    });
  }
}

// ─── Keyboard shortcuts ─────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (viewMode !== 'grid') collapseToGrid();
  }
  const num = parseInt(e.key);
  if (num >= 1 && num <= count) {
    if (expandedIndex === num - 1) collapseToGrid();
    else expandQuadrant(num - 1);
  }
  if (e.key === 'm' && !e.ctrlKey && !e.metaKey) {
    if (viewMode === 'merged') collapseToGrid();
    else enterMerged();
  }
  if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
});

// ─── Panel auto-hide on mouse idle ──────────────────────────────────────────

let hideTimer: ReturnType<typeof setTimeout>;

function showPanel() {
  panel.classList.remove('hidden');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => panel.classList.add('hidden'), 2500);
}

document.addEventListener('mousemove', showPanel);
panel.addEventListener('mouseenter', () => {
  clearTimeout(hideTimer);
  panel.classList.remove('hidden');
});
panel.addEventListener('mouseleave', () => {
  hideTimer = setTimeout(() => panel.classList.add('hidden'), 1500);
});

hideTimer = setTimeout(() => panel.classList.add('hidden'), 3000);

// ─── Resize ──────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  instruments.forEach(inst => inst.resize());
  if (viewMode === 'merged') resizeMerged();
});

// ─── Counter / hint display ──────────────────────────────────────────────────

function updateUI(inst: Instrument) {
  const s = inst.state;
  const m = inst.morphology;

  if (!inst.counterEl) return;

  const nodeCount = s.nodes.length;
  const bestNode = s.nodes.length > 0
    ? s.nodes.reduce((a, b) => a.energy > b.energy ? a : b)
    : null;
  const energyPct = bestNode ? Math.floor(bestNode.energy * 100) : 0;

  inst.counterEl.innerHTML =
    `<span style="color:#888">nodes</span> <span style="color:#fff;font-size:16px">${nodeCount}</span><br>` +
    `<span style="color:#888">energy</span> <span style="color:#${energyPct > 80 ? 'ff4' : energyPct > 50 ? 'aaf' : '888'};font-size:14px">${energyPct}%</span><br>` +
    `<span style="color:#555">taps ${s.totalTaps}</span><br>` +
    m.counterInfo(s);

  if (s.phaseChanged && !inst.hintSet && inst.hintEl) {
    inst.hintSet = true;
    inst.hintEl.textContent = m.hints.postSplit;
    inst.hintEl.style.color = '#666';
  }
}

// ─── Main loop ───────────────────────────────────────────────────────────────

let mergedTime = 0;
let lastTime = performance.now();

function loop(now: number) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  for (const inst of instruments) {
    inst.update(dt);
    updateUI(inst);
  }

  if (viewMode === 'merged') {
    if (mergedHoldMouse) {
      const totalNodes = instruments.reduce((sum, inst) => sum + inst.state.nodes.length, 0);
      const bpm = 100 - Math.min(45, totalNodes * 0.4);
      const interval = 60 / bpm;
      mergedHoldAccum += dt;
      if (mergedHoldAccum >= interval) {
        mergedHoldAccum -= interval;
        mergedTapAt(mergedHoldMouse);
      }
    }

    // Right-hold drain in merged view
    if (mergedRightHoldMouse) {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mergedRightHoldMouse, mergedCamera);
      let bestInst: Instrument | null = null;
      let bestNode: LatticeNode | null = null;
      let bestDist = 1.5;
      for (let i = 0; i < instruments.length; i++) {
        const inst = instruments[i];
        const offset = mergedOffsets[i];
        const localOrigin = raycaster.ray.origin.clone().sub(offset);
        const localRay = new THREE.Ray(localOrigin, raycaster.ray.direction.clone());
        for (const node of inst.state.nodes) {
          if (node.death !== undefined) continue;
          const dist = localRay.distanceToPoint(node.position);
          if (dist < bestDist) { bestDist = dist; bestInst = inst; bestNode = node; }
        }
      }
      if (bestInst && bestNode) {
        bestInst.drainNode(bestNode, dt);
      }
    }

    mergedTime += dt;
    const orbitRadius = 16;
    const orbitAngle = mergedTime * 0.1;
    mergedCamera.position.set(
      Math.cos(orbitAngle) * orbitRadius,
      10 + Math.sin(mergedTime * 0.07) * 1.5,
      Math.sin(orbitAngle) * orbitRadius
    );
    mergedCamera.lookAt(0, 0, 0.5);

    mergedComposer.render();
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
