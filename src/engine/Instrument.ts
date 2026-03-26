import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { InstrumentState, LatticeNode, INITIAL_SPLIT_COST } from './types';
import { MorphologyAudio } from './audio';
import { createNodeMesh, createEdgeLine } from './meshes';
import { spawnPacket, removeNode, findBridges, findComponents, getNodesAtHop } from './graph';
import type { Morphology } from '../morphologies/Morphology';

export class Instrument {
  state: InstrumentState;
  morphology: Morphology;
  audio: MorphologyAudio;
  counterEl: HTMLElement | null = null;
  hintEl: HTMLElement | null = null;
  hintSet = false;
  skipRender = false;

  /** Parent group wrapping all scene content — set position to offset in merged view */
  worldGroup: THREE.Group;

  /** Autotap state — rhythmic tapping while mouse is held */
  private _holdMouse: THREE.Vector2 | null = null;
  private _holdAccum = 0;

  /** Right-click death drain state */
  private _rightHoldMouse: THREE.Vector2 | null = null;
  private _rightHoldActive = false;

  /** Nodes currently in death animation (dying but not yet removed) */
  private _dyingNodes: LatticeNode[] = [];

  /** Bloom anti-flash timer */
  private _bloomDip = 0;

  /**
   * Create a headless instrument (no renderer/composer/canvas listeners).
   * Used in universe mode where a shared scene handles rendering.
   */
  static headless(morphology: Morphology): Instrument {
    const inst = Object.create(Instrument.prototype) as Instrument;
    inst.morphology = morphology;
    inst.audio = morphology.createAudio();
    inst.counterEl = null;
    inst.hintEl = null;
    inst.hintSet = false;
    inst.skipRender = true;
    inst._holdMouse = null;
    inst._holdAccum = 0;
    inst._rightHoldMouse = null;
    inst._rightHoldActive = false;
    inst._dyingNodes = [];
    inst._bloomDip = 0;

    const profile = morphology.profile;
    const scene = new THREE.Scene();
    // Dummy renderer/composer/camera — never used, but state expects them
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 100);
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);

    const nodeGroup = new THREE.Group();
    const edgeGroup = new THREE.Group();
    const packetGroup = new THREE.Group();
    const attractorGroup = new THREE.Group();
    inst.worldGroup = new THREE.Group();
    inst.worldGroup.add(nodeGroup, edgeGroup, packetGroup, attractorGroup);
    scene.add(inst.worldGroup);

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

    inst.state = {
      canvas: null as any,
      renderer: null as any,
      scene,
      camera,
      cameraBase: new THREE.Vector3(10, 10, 10),
      composer: null as any,
      bloomPass: null as any,
      profile,
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
      time: 0,
      splitFlash: 0,
      screenShake: 0,
      nodeGroup,
      edgeGroup,
      packetGroup,
      attractorGroup,
      cascadeWaves: [],
      visualIntensity: 0.1,
      firstSplitBloom: 0,
    };

    createNodeMesh(initialNode, nodeGroup, profile);
    return inst;
  }

  constructor(canvas: HTMLCanvasElement, morphology: Morphology) {
    this.morphology = morphology;
    this.audio = morphology.createAudio();

    const profile = morphology.profile;
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
    this.worldGroup = new THREE.Group();
    this.worldGroup.add(nodeGroup, edgeGroup, packetGroup, attractorGroup);
    scene.add(this.worldGroup);
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

    this.state = {
      canvas,
      renderer,
      scene,
      camera,
      cameraBase,
      composer,
      bloomPass,
      profile,
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
      time: 0,
      splitFlash: 0,
      screenShake: 0,
      nodeGroup,
      edgeGroup,
      packetGroup,
      attractorGroup,
      cascadeWaves: [],
      visualIntensity: 0.1,
      firstSplitBloom: 0,
    };

    createNodeMesh(initialNode, nodeGroup, profile);

    // Start with bloom at near-zero — dramatic reveal on first split
    bloomPass.strength = profile.bloomStrength * 0.1;

    // Hold-to-autotap: track mouse state on canvas
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this._holdMouse = this._mouseFromEvent(e);
      this._holdAccum = 99; // fire first tap immediately
    });
    canvas.addEventListener('mousemove', (e) => {
      const m = this._mouseFromEvent(e);
      if (this._holdMouse) this._holdMouse = m;
      if (this._rightHoldMouse) this._rightHoldMouse = m;
    });
    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._holdMouse = null;
      if (e.button === 2) this._rightHoldMouse = null;
    });
    canvas.addEventListener('mouseleave', () => {
      this._holdMouse = null;
      this._rightHoldMouse = null;
    });

    // Right-click: instant kill on click, drain on hold
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      const mouse = this._mouseFromEvent(e);
      // Instant kill on right-click
      this.handleRightClick(mouse);
      // Start drain tracking
      this._rightHoldMouse = mouse;
      this._rightHoldActive = true;
    });
  }

  private _mouseFromEvent(e: MouseEvent): THREE.Vector2 {
    const rect = this.state.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  initAudio() {
    this.audio.init();
  }

  resize() {
    const container = this.state.canvas.parentElement!;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.state.renderer.setSize(w, h);
    this.state.composer.setSize(w, h);
    const aspect = w / h;
    const frustum = 5;
    this.state.camera.left = -frustum * aspect / 2;
    this.state.camera.right = frustum * aspect / 2;
    this.state.camera.top = frustum / 2;
    this.state.camera.bottom = -frustum / 2;
    this.state.camera.updateProjectionMatrix();
  }

  // ─── Tap handling ────────────────────────────────────────────────────────

  /** Directly tap a specific node — bypasses raycasting. */
  tapNode(node: LatticeNode) {
    const s = this.state;
    s.totalTaps++;
    s.screenShake = Math.max(s.screenShake, 0.08 + node.energy * 0.15);
    node.bounce = 1;
    node.lastTapTime = s.time;

    this.audio.onTap(node.position, node.energy, node.generation, 0.3 + node.energy * 0.7);

    if (this.morphology.usesReadySplit && node.ready && s.phaseChanged) {
      node.ready = false;
      node.readyGlow = 0;
      s.screenShake = 0.5;
      this.splitNode(node);
      return;
    }

    const energyPerTap = (1 / node.splitCost) * 0.4;
    node.energy = Math.min(1, node.energy + energyPerTap);
    node.tapCount++;
    node.ripple = Math.min(1, node.ripple + 0.9);
    node.ripplePhase = 0;

    if (!s.phaseChanged) {
      s.tension = Math.min(1, s.totalTaps / INITIAL_SPLIT_COST);
      s.bgTarget = s.profile.bgHueBase + s.tension * 0.1;
      // Bloom ramp is now handled by visualIntensity in update()
    }

    if (s.phaseChanged && this.morphology.onTap) {
      this.morphology.onTap(s, node);
    }

    if (node.energy >= 1) this.splitNode(node);
  }

  /**
   * Process a tap from a raycaster. The offset is subtracted from the ray
   * so that node positions (which are in local space) match correctly.
   */
  handleRaycast(raycaster: THREE.Raycaster, offset?: THREE.Vector3) {
    const s = this.state;

    // If we have an offset (merged view), shift the ray into local space
    let ray = raycaster.ray;
    if (offset && (offset.x !== 0 || offset.y !== 0 || offset.z !== 0)) {
      ray = new THREE.Ray(
        ray.origin.clone().sub(offset),
        ray.direction.clone()
      );
    }

    let closest: LatticeNode | null = null;
    let minDist = 1.0;
    for (const node of s.nodes) {
      const dist = ray.distanceToPoint(node.position);
      if (dist < minDist) { minDist = dist; closest = node; }
    }

    // Tap empty space — delegate to morphology
    if (!closest) {
      if (this.morphology.onTapEmpty) {
        // Create a shifted raycaster for the morphology
        const localRaycaster = new THREE.Raycaster();
        localRaycaster.ray.copy(ray);
        this.morphology.onTapEmpty(s, localRaycaster);
      }
      return;
    }

    s.totalTaps++;
    s.screenShake = Math.max(s.screenShake, 0.08 + closest.energy * 0.15);
    closest.bounce = 1;
    closest.lastTapTime = s.time;

    // Sound
    this.audio.onTap(closest.position, closest.energy, closest.generation, 0.3 + closest.energy * 0.7);

    // Ready-split modes: one-tap split
    if (this.morphology.usesReadySplit && closest.ready && s.phaseChanged) {
      closest.ready = false;
      closest.readyGlow = 0;
      s.screenShake = 0.5;
      this.splitNode(closest);
      return;
    }

    const energyPerTap = 1 / closest.splitCost;
    closest.energy = Math.min(1, closest.energy + energyPerTap);
    closest.tapCount++;
    closest.ripple = Math.min(1, closest.ripple + 0.9);
    closest.ripplePhase = 0;

    if (!s.phaseChanged) {
      s.tension = Math.min(1, s.totalTaps / INITIAL_SPLIT_COST);
      s.bgTarget = s.profile.bgHueBase + s.tension * 0.1;
      // Bloom ramp is now handled by visualIntensity in update()
    }

    // Mode-specific tap
    if (s.phaseChanged && this.morphology.onTap) {
      this.morphology.onTap(s, closest);
    }

    if (closest.energy >= 1) this.splitNode(closest);
  }

  // ─── Death mechanics ─────────────────────────────────────────────────────

  /** Right-click on a node — instant kill */
  handleRightClick(mouse: THREE.Vector2) {
    const s = this.state;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, s.camera);

    let closest: LatticeNode | null = null;
    let minDist = 1.0;
    for (const node of s.nodes) {
      if (node.death !== undefined) continue; // already dying
      const dist = raycaster.ray.distanceToPoint(node.position);
      if (dist < minDist) { minDist = dist; closest = node; }
    }

    if (closest) this.killNode(closest);
  }

  /**
   * Right-click raycast in merged/universe view — uses offset for local space.
   * Returns true if a node was hit.
   */
  handleRightRaycast(raycaster: THREE.Raycaster, offset?: THREE.Vector3): boolean {
    const s = this.state;
    let ray = raycaster.ray;
    if (offset && (offset.x !== 0 || offset.y !== 0 || offset.z !== 0)) {
      ray = new THREE.Ray(ray.origin.clone().sub(offset), ray.direction.clone());
    }

    let closest: LatticeNode | null = null;
    let minDist = 1.0;
    for (const node of s.nodes) {
      if (node.death !== undefined) continue;
      const dist = ray.distanceToPoint(node.position);
      if (dist < minDist) { minDist = dist; closest = node; }
    }

    if (closest) {
      this.killNode(closest);
      return true;
    }
    return false;
  }

  /**
   * Drain energy from nodes near the right-held cursor.
   * Called each frame while right mouse is held.
   */
  handleRightHold(mouse: THREE.Vector2, dt: number, offset?: THREE.Vector3) {
    const s = this.state;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, s.camera);

    let ray = raycaster.ray;
    if (offset && (offset.x !== 0 || offset.y !== 0 || offset.z !== 0)) {
      ray = new THREE.Ray(ray.origin.clone().sub(offset), ray.direction.clone());
    }

    // Find the closest living node to cursor
    let closest: LatticeNode | null = null;
    let minDist = 1.5; // wider radius for drain
    for (const node of s.nodes) {
      if (node.death !== undefined) continue;
      const dist = ray.distanceToPoint(node.position);
      if (dist < minDist) { minDist = dist; closest = node; }
    }

    if (!closest) return;

    // Drain target: -0.3/s
    closest.energy = Math.max(0, closest.energy - 0.3 * dt);
    if (closest.energy <= 0) {
      this.killNode(closest);
      return;
    }

    // Drain 1-hop neighbors: -0.15/s (50% falloff)
    const hop1 = getNodesAtHop(s, closest.id, 1);
    for (const n of hop1) {
      if (n.death !== undefined) continue;
      n.energy = Math.max(0, n.energy - 0.15 * dt);
      if (n.energy <= 0) this.killNode(n);
    }

    // Drain 2-hop neighbors: -0.075/s
    const hop2 = getNodesAtHop(s, closest.id, 2);
    for (const n of hop2) {
      if (n.death !== undefined) continue;
      n.energy = Math.max(0, n.energy - 0.075 * dt);
      if (n.energy <= 0) this.killNode(n);
    }
  }

  /**
   * Drain a specific node and its neighbors. For use by external callers
   * (universe/merged view) that have already identified the target node.
   */
  drainNode(node: LatticeNode, dt: number) {
    const s = this.state;
    if (node.death !== undefined) return;

    // Drain target: -0.3/s
    node.energy = Math.max(0, node.energy - 0.3 * dt);
    if (node.energy <= 0) {
      this.killNode(node);
      return;
    }

    // Drain 1-hop neighbors: -0.15/s
    const hop1 = getNodesAtHop(s, node.id, 1);
    for (const n of hop1) {
      if (n.death !== undefined) continue;
      n.energy = Math.max(0, n.energy - 0.15 * dt);
      if (n.energy <= 0) this.killNode(n);
    }

    // Drain 2-hop neighbors: -0.075/s
    const hop2 = getNodesAtHop(s, node.id, 2);
    for (const n of hop2) {
      if (n.death !== undefined) continue;
      n.energy = Math.max(0, n.energy - 0.075 * dt);
      if (n.energy <= 0) this.killNode(n);
    }
  }

  /** Kill a node — triggers death animation, energy burst, bridge detection */
  killNode(node: LatticeNode) {
    const s = this.state;

    // Don't kill if already dying or if it's the last node
    if (node.death !== undefined) return;
    if (s.nodes.length <= 1) return;

    // Check if this is a bridge node BEFORE we remove it
    const bridges = findBridges(s);
    const isBridge = bridges.has(node.id);

    // Death sound
    this.audio.onDeath(node.position, node.energy, node.generation);

    // Morphology death hook
    if (this.morphology.onDeath) {
      this.morphology.onDeath(s, node);
    }

    // Energy burst to neighbors within radius 2.0
    const burstEnergy = (INITIAL_SPLIT_COST * Math.pow(2, node.generation)) * 0.01;
    for (const other of s.nodes) {
      if (other.id === node.id || other.death !== undefined) continue;
      const dist = node.position.distanceTo(other.position);
      if (dist < 2.0) {
        const falloff = 1 - dist / 2.0;
        other.energy = Math.min(1, other.energy + burstEnergy * falloff);
        other.ripple = Math.min(1, other.ripple + 0.5 * falloff);
        other.ripplePhase = 0;
        other.bounce = Math.min(0.5, other.bounce + 0.3 * falloff);
      }
    }

    // Screen shake — lower magnitude, slower decay (rumble)
    s.screenShake = Math.max(s.screenShake, 0.15);

    // Bloom anti-flash — dip bloom briefly
    this._bloomDip = 0.2;

    // Start death animation
    node.death = 0.001; // just above 0 to indicate dying
    this._dyingNodes.push(node);

    // Set inward ripple
    node.ripple = 1;
    node.ripplePhase = 0;
    if (node.mesh) {
      const mat = node.mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uRippleDirection.value = -1; // inward ripple
    }

    // Actually remove the node from graph (edges, packets) immediately
    removeNode(s, node.id);

    // Bridge handling — detect orphaned subgraphs
    if (isBridge && s.nodes.length > 0) {
      const components = findComponents(s);
      if (components.length > 1) {
        // Find the largest component — that's the "main" one
        let largestIdx = 0;
        for (let i = 1; i < components.length; i++) {
          if (components[i].size > components[largestIdx].size) largestIdx = i;
        }

        // All other components are orphans — set them drifting
        for (let i = 0; i < components.length; i++) {
          if (i === largestIdx) continue;
          const orphanIds = components[i];
          // Compute center of orphan group
          const center = new THREE.Vector3();
          let count = 0;
          for (const id of orphanIds) {
            const n = s.nodes.find(nd => nd.id === id);
            if (n) { center.add(n.position); count++; }
          }
          if (count > 0) center.divideScalar(count);

          // Set drift velocity — outward from kill site
          const driftDir = center.clone().sub(node.position).normalize();
          if (driftDir.length() < 0.1) driftDir.set(Math.random() - 0.5, 0.2, Math.random() - 0.5).normalize();

          for (const id of orphanIds) {
            const n = s.nodes.find(nd => nd.id === id);
            if (n) {
              n.driftVelocity = driftDir.clone().multiplyScalar(0.3 + Math.random() * 0.2);
              n.orphanFade = 3.0; // 3 seconds to fade and remove
            }
          }
        }
      }
    }
  }

  /** Update death animations and orphan drift each frame */
  private _updateDeath(dt: number) {
    const s = this.state;

    // Update dying nodes (visual-only, already removed from graph)
    for (let i = this._dyingNodes.length - 1; i >= 0; i--) {
      const node = this._dyingNodes[i];
      if (node.death === undefined) { this._dyingNodes.splice(i, 1); continue; }

      node.death = Math.min(1, node.death + dt * 2.5); // ~400ms death animation

      // Update shader uniforms on the detached mesh
      if (node.mesh) {
        const mat = node.mesh.material as THREE.ShaderMaterial;
        mat.uniforms.uDeath.value = node.death;
        // Scale down with ease-in-cubic
        const scale = s.profile.nodeScale * (1 - node.death * node.death * node.death);
        node.mesh.scale.setScalar(Math.max(0.01, scale));
      }
      if (node.ringMesh) {
        const scale = 1 - node.death;
        node.ringMesh.scale.setScalar(Math.max(0.01, scale));
      }

      // Remove when animation complete
      if (node.death >= 1) {
        // Dispose the visual-only meshes
        if (node.mesh) {
          s.nodeGroup.remove(node.mesh);
          node.mesh.geometry.dispose();
          (node.mesh.material as THREE.Material).dispose();
          node.mesh = null;
        }
        if (node.ringMesh) {
          s.nodeGroup.remove(node.ringMesh);
          node.ringMesh.geometry.dispose();
          (node.ringMesh.material as THREE.Material).dispose();
          node.ringMesh = null;
        }
        this._dyingNodes.splice(i, 1);
      }
    }

    // Update orphan drift
    for (let i = s.nodes.length - 1; i >= 0; i--) {
      const node = s.nodes[i];
      if (node.orphanFade === undefined) continue;

      node.orphanFade -= dt;

      // Drift outward
      if (node.driftVelocity) {
        node.position.add(node.driftVelocity.clone().multiplyScalar(dt));
        if (node.mesh) node.mesh.position.copy(node.position);
        if (node.ringMesh) node.ringMesh.position.copy(node.position);
      }

      // Fade opacity
      const fadeT = Math.max(0, node.orphanFade / 3.0);
      if (node.mesh) {
        const mat = node.mesh.material as THREE.ShaderMaterial;
        mat.uniforms.uGlobalIntensity.value = fadeT;
        mat.opacity = fadeT;
      }

      // Play descending tone while fading
      if (node.orphanFade > 0 && node.orphanFade < 2.9 && Math.random() < 0.02) {
        this.audio.onDeath(node.position, node.energy * fadeT, node.generation);
      }

      // Remove when fully faded
      if (node.orphanFade <= 0) {
        removeNode(s, node.id);
      }
    }

    // Bloom anti-flash
    if (this._bloomDip > 0) {
      this._bloomDip = Math.max(0, this._bloomDip - dt * 5); // ~200ms
      if (s.bloomPass) {
        s.bloomPass.strength = Math.max(0, s.profile.bloomStrength - this._bloomDip * 2);
      }
    }
  }

  // ─── Node splitting ──────────────────────────────────────────────────────

  private splitNode(node: LatticeNode) {
    const s = this.state;
    const m = this.morphology;
    const isFirstSplit = !s.phaseChanged;
    s.phaseChanged = true;
    s.splitFlash = 1;
    s.screenShake = isFirstSplit ? 0.8 : 0.4;

    // First split: dramatic bloom spike — THE birth of the network
    if (isFirstSplit) {
      s.firstSplitBloom = 1.0;
    }

    node.energy = 0;
    node.tapCount = 0;

    const gen = node.generation + 1;
    // Small chance (~5%) of a long-reach split — promotes irregular, organic growth
    const reach = Math.random() < 0.05 ? 2.5 + Math.random() * 3.0 : 1.0;
    const spacing = (1.0 + gen * 0.2) * reach;

    // Growth direction — morphology can override via splitDirection
    let dir: THREE.Vector3;
    if (m.splitDirection) {
      dir = m.splitDirection(s, node);
    } else {
      // Default: biased away from center of mass with full 3D randomness
      dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize();

      if (s.nodes.length > 1) {
        const com = new THREE.Vector3();
        s.nodes.forEach(n => com.add(n.position));
        com.divideScalar(s.nodes.length);
        const outward = node.position.clone().sub(com);
        if (outward.length() > 0.1) {
          outward.normalize();
          // Blend: 40% outward bias, 60% random
          dir.lerp(outward, 0.4).normalize();
        }
      }
    }
    const newPos = node.position.clone().add(dir.multiplyScalar(spacing));

    const newCost = INITIAL_SPLIT_COST * Math.pow(2, gen);

    const p = s.profile;
    const hue = p.hueBase + gen * p.colorShiftRate;
    const newColor = new THREE.Color().setHSL(hue, p.colorSat, p.colorLit);

    const newNode: LatticeNode = {
      id: s.nextId++,
      position: newPos,
      energy: 0,
      tapCount: 0,
      splitCost: newCost,
      ripple: 1,
      ripplePhase: 0,
      color: newColor,
      born: s.time,
      ready: false,
      readyGlow: 0,
      mesh: null,
      ringMesh: null,
      generation: gen,
      bounce: 0.5,
      lastTapTime: -10,
    };

    s.nodes.push(newNode);
    createNodeMesh(newNode, s.nodeGroup, s.profile);

    const line = createEdgeLine(node.position, newPos, s.edgeGroup, s.profile.edgeStyle);
    s.edges.push({ from: node.id, to: newNode.id, line });

    node.splitCost = newCost;
    node.ripple = 1;
    node.bounce = 0.8;

    // Post-split hook — cycle edges, extra connections, etc.
    if (m.onPostSplit) m.onPostSplit(s, node, newNode);

    // Sound
    this.audio.onSplit(newPos, gen, isFirstSplit);

    // Initial packets — pluck floods, others get one
    if (m.id === 'pluck') {
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          spawnPacket(s, node.id, newNode.id, 0.5 + Math.random() * 0.5, 0.09, m);
          spawnPacket(s, newNode.id, node.id, 0.4 + Math.random() * 0.4, 0.09, m);
        }, i * 150);
      }
    } else {
      spawnPacket(s, node.id, newNode.id, 0.3 + Math.random() * 0.3, 0.07, m);
    }
  }

  // ─── Main update ─────────────────────────────────────────────────────────

  update(dt: number) {
    const s = this.state;
    const m = this.morphology;
    s.time += dt;
    const t = s.time;

    // ─── Visual intensity ramp ──────────────────────────────────────────
    const nodeCount = s.nodes.length;
    let targetIntensity: number;
    if (nodeCount <= 1 && !s.phaseChanged) {
      targetIntensity = 0.1;           // lone root node — dim and lonely
    } else if (nodeCount <= 2) {
      targetIntensity = 0.4;           // first split just happened
    } else if (nodeCount <= 8) {
      targetIntensity = 0.4 + (nodeCount - 2) / 6 * 0.2;  // ramp to ~0.6
    } else if (nodeCount <= 16) {
      targetIntensity = 0.6 + (nodeCount - 8) / 8 * 0.2;  // ramp to ~0.8
    } else if (nodeCount <= 32) {
      targetIntensity = 0.8 + (nodeCount - 16) / 16 * 0.2; // ramp to 1.0
    } else {
      targetIntensity = 1.0;           // full visual fidelity
    }
    // Smooth lerp — never snap
    s.visualIntensity += (targetIntensity - s.visualIntensity) * dt * 2.0;

    // First-split bloom spike — decays over ~3 seconds
    if (s.firstSplitBloom > 0.01) {
      s.firstSplitBloom *= Math.pow(0.15, dt);  // exponential decay
      if (s.firstSplitBloom < 0.01) s.firstSplitBloom = 0;
    }

    // Bloom strength: base scaled by intensity + first-split spike + split flash
    if (s.bloomPass) {
      const baseBloom = s.profile.bloomStrength * (0.1 + s.visualIntensity * 0.9);
      const firstSplitSpike = s.firstSplitBloom * s.profile.bloomStrength * 2.5;
      const splitFlashBloom = s.splitFlash * 2.5;
      s.bloomPass.strength = baseBloom + firstSplitSpike + splitFlashBloom;
    }

    // Background
    s.bgHue += (s.bgTarget - s.bgHue) * dt * 2;
    if (s.renderer) s.renderer.setClearColor(new THREE.Color().setHSL(s.bgHue, 0.12, 0.018 + s.tension * 0.012));

    // Orbit + screen shake (only when instrument owns its own camera)
    if (!this.skipRender) {
      const orbitRadius = 17;
      const orbitAngle = t * 0.15;
      s.cameraBase.set(
        Math.cos(orbitAngle) * orbitRadius,
        10 + Math.sin(t * 0.1) * 1.5,
        Math.sin(orbitAngle) * orbitRadius
      );
      s.camera.position.copy(s.cameraBase);
      s.camera.lookAt(0, 0, 0);

      if (s.screenShake > 0.001) {
        const sx = (Math.random() - 0.5) * s.screenShake * 0.5;
        const sy = (Math.random() - 0.5) * s.screenShake * 0.5;
        s.camera.position.x += sx;
        s.camera.position.y += sy;
        s.camera.position.z += sx * 0.5;
      }
    }
    if (s.screenShake > 0.001) {
      // Death shake decays slower (rumble) vs life shake (snap)
      s.screenShake *= Math.pow(0.05, dt);
    } else {
      s.screenShake = 0;
    }

    // Death animations, orphan drift, bloom dip
    this._updateDeath(dt);

    // Right-hold drain (only in standalone mode — universe/merged handle externally)
    if (this._rightHoldMouse && !this.skipRender) {
      this.handleRightHold(this._rightHoldMouse, dt);
    }

    // Split flash decay (bloom is managed in the visual intensity section above)
    if (s.splitFlash > 0) {
      s.splitFlash = Math.max(0, s.splitFlash - dt * 4);
    }

    // Nodes
    for (const node of s.nodes) {
      const age = t - node.born;
      const spawnT = Math.min(1, age * 5);
      const spawnScale = spawnT * spawnT * (3 - 2 * spawnT);
      if (node.bounce > 0.01) node.bounce *= Math.pow(0.02, dt);
      else node.bounce = 0;

      if (node.mesh) {
        node.mesh.scale.setScalar(s.profile.nodeScale * spawnScale);
        const mat = node.mesh.material as THREE.ShaderMaterial;
        mat.uniforms.uTime.value = t;
        mat.uniforms.uRipple.value = node.ripple;
        mat.uniforms.uRipplePhase.value = node.ripplePhase;
        mat.uniforms.uEmissive.value = 0.15 + node.energy * 0.7;
        mat.uniforms.uReadyGlow.value = node.readyGlow;
        mat.uniforms.uEnergy.value = node.energy;
        mat.uniforms.uBounce.value = node.bounce;
        mat.uniforms.uGlobalIntensity.value = s.visualIntensity;
      }
      if (node.ringMesh) {
        const rm = node.ringMesh.material as THREE.ShaderMaterial;
        rm.uniforms.uEnergy.value = node.energy;
        rm.uniforms.uTime.value = t;
        rm.uniforms.uSegments.value = node.splitCost;
        node.ringMesh.scale.setScalar(spawnScale);
      }
      if (node.ripple > 0.01) {
        node.ripplePhase += dt * 8;
        node.ripple *= Math.pow(0.88, dt * 60);
        if (node.ripple < 0.01) node.ripple = 0;
      }
    }

    // Edges
    const edgeBaseColor = new THREE.Color(s.profile.edgeColor);
    for (const edge of s.edges) {
      const mat = edge.line.material as THREE.LineBasicMaterial;
      const activePackets = s.packets.filter(
        p => (p.from === edge.from && p.to === edge.to) || (p.from === edge.to && p.to === edge.from)
      ).length;
      const targetOpacity = Math.min(0.85, 0.12 + activePackets * 0.2);
      mat.opacity += (targetOpacity - mat.opacity) * dt * 5;

      switch (s.profile.edgeStyle) {
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
    for (let i = s.packets.length - 1; i >= 0; i--) {
      const pkt = s.packets[i];
      pkt.progress += pkt.speed * dt;

      if (pkt.progress >= 1) {
        const target = s.nodes.find(n => n.id === pkt.to);
        if (target) {
          this.audio.onPacketArrive(target.position, target.energy, target.generation);

          const energyGain = (1 / target.splitCost) * 0.8;
          target.energy = Math.min(1, target.energy + energyGain);
          target.ripple = Math.min(1, target.ripple + 0.2);
          target.ripplePhase = 0;
          target.bounce = Math.min(0.3, target.bounce + 0.15);

          if (m.autoSplitOnPacketArrival && target.energy >= 1) {
            this.splitNode(target);
          }

          const bounceChance = m.packetBounceChance ?? 0.2;
          if (Math.random() < bounceChance) {
            spawnPacket(s, pkt.to, pkt.from, 0.2 + Math.random() * 0.4, pkt.size * 0.85, m);
          }
        }
        if (pkt.mesh) s.packetGroup.remove(pkt.mesh);
        s.packets.splice(i, 1);
        continue;
      }

      const from = s.nodes.find(n => n.id === pkt.from);
      const to = s.nodes.find(n => n.id === pkt.to);
      if (from && to && pkt.mesh) {
        const p = pkt.progress;
        const pos = from.position.clone().lerp(to.position, p);
        const curveAmt = s.profile.edgeStyle === 'thick' ? 0.15 :
                          s.profile.edgeStyle === 'sharp' ? 0 : 0.1;
        pos.y += Math.sin(p * Math.PI) * from.position.distanceTo(to.position) * curveAmt;
        pkt.mesh.position.copy(pos);
        if (m.updatePacket) m.updatePacket(pkt.mesh, dt);
        const fade = Math.sin(p * Math.PI);
        (pkt.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 + fade * 0.5;
        pkt.mesh.scale.setScalar(0.7 + fade * 0.5);
      }
    }

    // Mode-specific update
    m.update(s, dt);

    // Spontaneous packets — the network hums on its own
    if (s.phaseChanged && s.edges.length > 0) {
      const spontaneousRate = 0.15 + s.edges.length * 0.03;
      if (Math.random() < spontaneousRate * dt) {
        const edge = s.edges[Math.floor(Math.random() * s.edges.length)];
        const dir = Math.random() > 0.5;
        spawnPacket(s, dir ? edge.from : edge.to, dir ? edge.to : edge.from,
          0.3 + Math.random() * 0.5, 0.04 + Math.random() * 0.03, m);
      }
    }

    // Autotap while holding — BPM slows as network grows
    if (this._holdMouse && !this.skipRender) {
      // 100 BPM at 1 node, easing down to ~55 BPM around 30+ nodes
      const bpm = 100 - Math.min(45, s.nodes.length * 1.5);
      const interval = 60 / bpm;
      this._holdAccum += dt;
      if (this._holdAccum >= interval) {
        this._holdAccum -= interval;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(this._holdMouse, s.camera);
        this.handleRaycast(raycaster);
      }
    }

    // Audio update
    const totalEnergy = s.nodes.reduce((sum, n) => sum + n.energy, 0);
    this.audio.onUpdate(s.nodes.length, s.packets.length, totalEnergy, t);

    // Render (skip if merged view handles rendering)
    if (!this.skipRender) s.composer.render();
  }
}
