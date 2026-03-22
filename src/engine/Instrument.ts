import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { InstrumentState, LatticeNode, INITIAL_SPLIT_COST } from './types';
import { MorphologyAudio } from './audio';
import { createNodeMesh, createEdgeLine } from './meshes';
import { spawnPacket } from './graph';
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
    };

    createNodeMesh(initialNode, nodeGroup, profile);

    // Hold-to-autotap: track mouse state on canvas
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this._holdMouse = this._mouseFromEvent(e);
      this._holdAccum = 99; // fire first tap immediately
    });
    canvas.addEventListener('mousemove', (e) => {
      if (this._holdMouse) this._holdMouse = this._mouseFromEvent(e);
    });
    canvas.addEventListener('mouseup', () => { this._holdMouse = null; });
    canvas.addEventListener('mouseleave', () => { this._holdMouse = null; });
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
      s.bloomPass.strength = s.profile.bloomStrength + s.tension * 0.6;
    }

    // Mode-specific tap
    if (s.phaseChanged && this.morphology.onTap) {
      this.morphology.onTap(s, closest);
    }

    if (closest.energy >= 1) this.splitNode(closest);
  }

  // ─── Node splitting ──────────────────────────────────────────────────────

  private splitNode(node: LatticeNode) {
    const s = this.state;
    const m = this.morphology;
    const isFirstSplit = !s.phaseChanged;
    s.phaseChanged = true;
    s.splitFlash = 1;
    s.screenShake = isFirstSplit ? 0.8 : 0.4;

    node.energy = 0;
    node.tapCount = 0;

    const gen = node.generation + 1;
    const spacing = 1.0 + gen * 0.2;

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

    // Background
    s.bgHue += (s.bgTarget - s.bgHue) * dt * 2;
    s.renderer.setClearColor(new THREE.Color().setHSL(s.bgHue, 0.12, 0.018 + s.tension * 0.012));

    // Orbit
    const orbitRadius = 17;
    const orbitAngle = t * 0.15;
    s.cameraBase.set(
      Math.cos(orbitAngle) * orbitRadius,
      10 + Math.sin(t * 0.1) * 1.5,
      Math.sin(orbitAngle) * orbitRadius
    );
    s.camera.position.copy(s.cameraBase);
    s.camera.lookAt(0, 0, 0);

    // Screen shake
    if (s.screenShake > 0.001) {
      const sx = (Math.random() - 0.5) * s.screenShake * 0.5;
      const sy = (Math.random() - 0.5) * s.screenShake * 0.5;
      s.camera.position.x += sx;
      s.camera.position.y += sy;
      s.camera.position.z += sx * 0.5;
      s.screenShake *= Math.pow(0.05, dt);
    } else {
      s.screenShake = 0;
    }

    // Split flash
    if (s.splitFlash > 0) {
      s.splitFlash = Math.max(0, s.splitFlash - dt * 4);
      s.bloomPass.strength = s.profile.bloomStrength + s.splitFlash * 2.5;
    } else if (s.phaseChanged) {
      s.bloomPass.strength = s.profile.bloomStrength;
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

          const energyGain = (1 / target.splitCost) * 0.4;
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
