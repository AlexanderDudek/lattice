import * as THREE from 'three';
import { Graph, createNode, NodeData } from '../simulation/Graph';
import { GrowthEngine } from '../simulation/GrowthEngine';
import { AbstractionEngine } from '../simulation/AbstractionEngine';
import { PatternCompletion } from '../simulation/PatternCompletion';
import { ResourceManager } from './ResourceManager';
import { UpgradeSystem } from './UpgradeSystem';
import { PhaseManager, GamePhase } from './PhaseManager';
import { SideEffects } from './SideEffects';
import { IsometricCamera } from '../rendering/IsometricCamera';
import { GridRenderer } from '../rendering/GridRenderer';
import { NodeRenderer } from '../rendering/NodeRenderer';
import { EdgeRenderer } from '../rendering/EdgeRenderer';
import { ParticleSystem } from '../rendering/ParticleSystem';
import { PostProcessing } from '../rendering/PostProcessing';
import { PromptOverlay } from '../ui/PromptOverlay';
import { ResourceDisplay } from '../ui/ResourceDisplay';
import { UpgradePanel } from '../ui/UpgradePanel';
import { PolicyControls } from '../ui/PolicyControls';
import { SideEffectsLog } from '../ui/SideEffectsLog';
import { saveGame, loadGame } from '../utils/SaveSystem';
import { snapToGrid, screenToGridPlane, generateId } from '../utils/MathUtils';

export class Game {
  // Three.js core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraController: IsometricCamera;
  private postProcessing: PostProcessing;

  // Rendering
  private gridRenderer: GridRenderer;
  private nodeRenderer: NodeRenderer;
  private edgeRenderer: EdgeRenderer;
  private particleSystem: ParticleSystem;

  // Simulation
  private graph: Graph;
  private growthEngine: GrowthEngine;
  private abstractionEngine: AbstractionEngine;
  private patternCompletion: PatternCompletion;

  // Game systems
  private resources: ResourceManager;
  private upgrades: UpgradeSystem;
  private phaseManager: PhaseManager;
  private sideEffects: SideEffects;

  // UI
  private uiLayer: HTMLElement;
  private promptOverlay: PromptOverlay;
  private resourceDisplay: ResourceDisplay;
  private upgradePanel: UpgradePanel;
  private policyControls: PolicyControls;
  private sideEffectsLog: SideEffectsLog;
  private patternsPanel: HTMLDivElement | null = null;

  // State
  private firstWord = '';
  private elapsed = 0;
  private tickAccumulator = 0;
  private tickInterval = 1; // 1 second
  private pulseAccumulator = 0;
  private pulseInterval = 30; // 30 seconds
  private dreamAccumulator = 0;
  private dreamInterval = 300; // 5 minutes
  private autoSaveAccumulator = 0;
  private autoSaveInterval = 30; // 30 seconds
  private patternCompletionAccumulator = 0;

  // Interaction state
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hoveredNode: NodeData | null = null;
  private selectedNodes: Set<string> = new Set();
  private isDragging = false;
  private dragStartNode: NodeData | null = null;

  // Abstraction UI
  private abstractionBtn: HTMLButtonElement;

  constructor(canvas: HTMLCanvasElement) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0a0f, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    // Scene
    this.scene = new THREE.Scene();

    // Ambient light
    const ambient = new THREE.AmbientLight(0x404060, 0.5);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.3);
    directional.position.set(5, 10, 5);
    this.scene.add(directional);

    // Camera
    this.cameraController = new IsometricCamera(canvas);

    // Post-processing
    this.postProcessing = new PostProcessing(
      this.renderer,
      this.scene,
      this.cameraController.getCamera()
    );

    // Renderers
    this.gridRenderer = new GridRenderer();
    this.scene.add(this.gridRenderer.getGroup());

    this.nodeRenderer = new NodeRenderer();
    this.scene.add(this.nodeRenderer.getGroup());

    this.edgeRenderer = new EdgeRenderer();
    this.scene.add(this.edgeRenderer.getGroup());

    this.particleSystem = new ParticleSystem();
    this.scene.add(this.particleSystem.getGroup());

    // Simulation
    this.graph = new Graph();
    this.growthEngine = new GrowthEngine();
    this.abstractionEngine = new AbstractionEngine();
    this.patternCompletion = new PatternCompletion();

    // Game systems
    this.resources = new ResourceManager();
    this.upgrades = new UpgradeSystem(this.resources);
    this.phaseManager = new PhaseManager();
    this.sideEffects = new SideEffects();

    // UI
    this.uiLayer = document.getElementById('ui-layer')!;

    this.promptOverlay = new PromptOverlay(this.uiLayer);
    this.resourceDisplay = new ResourceDisplay(this.uiLayer);
    this.upgradePanel = new UpgradePanel(this.uiLayer);
    this.policyControls = new PolicyControls(this.uiLayer);
    this.sideEffectsLog = new SideEffectsLog(this.uiLayer);

    // Abstraction button
    this.abstractionBtn = document.createElement('button');
    this.abstractionBtn.id = 'abstraction-btn';
    this.abstractionBtn.textContent = 'Abstract Selected';
    this.abstractionBtn.addEventListener('click', () => this.performAbstraction());
    this.uiLayer.appendChild(this.abstractionBtn);

    // Wire up events
    this.setupEvents();
    this.setupCallbacks();

    // Try loading saved state
    this.tryLoad();
  }

  private setupEvents(): void {
    const canvas = this.renderer.domElement;

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.cameraController.resize(w, h);
      this.postProcessing.resize(w, h);
    });

    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    canvas.addEventListener('click', (e) => {
      if (this.promptOverlay.isActive()) return;
      this.handleClick(e);
    });

    canvas.addEventListener('mousedown', (e) => {
      if (this.promptOverlay.isActive()) return;
      this.handleMouseDown(e);
    });

    canvas.addEventListener('mouseup', () => {
      this.handleMouseUp();
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.promptOverlay.isActive()) return;
      this.handleRightClick();
    });

    // Save on tab blur
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.save();
      }
    });
  }

  private setupCallbacks(): void {
    // Prompt submission
    this.promptOverlay.onSubmit = (text) => {
      this.firstWord = text;
      this.spawnFirstNode(text);
      this.phaseManager.completePrompt();
      this.resourceDisplay.show();
      this.upgradePanel.show();
    };

    // Upgrade purchase
    this.upgradePanel.onPurchase = (id) => {
      if (this.upgrades.purchase(id)) {
        // Handle specific upgrade effects
        if (id === 'resonanceCascade') {
          // Dramatic visual moment
          this.postProcessing.setBloomStrength(1.2);
          setTimeout(() => this.postProcessing.setBloomStrength(0.6), 2000);
        }
      }
    };

    // Policy changes
    this.policyControls.onChange = (policy) => {
      Object.assign(this.growthEngine.policy, policy);
    };

    // Side effects
    this.sideEffects.onTrigger = (entry, resource, amount) => {
      this.sideEffectsLog.addEntry(entry);
      if (resource === 'clarity') this.resources.clarity.value += amount;
      else if (resource === 'coherence') this.resources.addCoherence(amount);
      else if (resource === 'compute') this.resources.compute.value += amount;
    };

    // Phase transitions
    this.phaseManager.onPhaseChange = (from, to) => {
      if (to === 'phase1_patterns') {
        this.showPatternsPanel();
      }
      if (to === 'phase2') {
        this.resources.phase2Active = true;
        this.policyControls.show();
        this.sideEffectsLog.show();
        this.cameraController.enableOrbit();
      }
    };
  }

  private spawnFirstNode(text: string): void {
    const node = createNode(new THREE.Vector3(0, 0, 0), text);
    node.color = new THREE.Color(0.2, 0.8, 0.9);
    node.scale = 1.2;
    this.graph.addNode(node);
    this.particleSystem.burst(node.position, 15, node.color);
  }

  private handleClick(e: MouseEvent): void {
    this.raycaster.setFromCamera(this.mouse, this.cameraController.getCamera());

    // Check if clicking on existing node
    const clickedNode = this.nodeRenderer.raycast(this.raycaster, this.graph.nodes);

    if (clickedNode) {
      if (e.shiftKey && this.phaseManager.isPhase2() && this.upgrades.abstractionUnlocked) {
        // Shift-click to select for abstraction
        this.toggleNodeSelection(clickedNode.id);
      } else {
        // Click to subdivide
        this.subdivideNode(clickedNode);
      }
    } else {
      // Click on empty grid space to place new node
      if (!this.phaseManager.isPhase2()) {
        this.placeNodeAtMouse();
      }
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    this.raycaster.setFromCamera(this.mouse, this.cameraController.getCamera());
    const node = this.nodeRenderer.raycast(this.raycaster, this.graph.nodes);
    if (node) {
      this.isDragging = true;
      this.dragStartNode = node;
    }
  }

  private handleMouseUp(): void {
    if (this.isDragging && this.dragStartNode) {
      this.raycaster.setFromCamera(this.mouse, this.cameraController.getCamera());
      const targetNode = this.nodeRenderer.raycast(this.raycaster, this.graph.nodes);
      if (targetNode && targetNode.id !== this.dragStartNode.id) {
        // Manual connection
        if (this.graph.addEdge(this.dragStartNode.id, targetNode.id)) {
          this.edgeRenderer.updateTraffic(this.graph);
        }
      }
    }
    this.isDragging = false;
    this.dragStartNode = null;
  }

  private handleRightClick(): void {
    this.raycaster.setFromCamera(this.mouse, this.cameraController.getCamera());
    const node = this.nodeRenderer.raycast(this.raycaster, this.graph.nodes);

    if (node && this.phaseManager.isPhase2()) {
      // Prune node
      this.pruneNode(node);
    }
  }

  private placeNodeAtMouse(): void {
    const camera = this.cameraController.getCamera();
    const pos = screenToGridPlane(this.mouse.x, this.mouse.y, camera, 0);
    if (!pos) return;

    const snapped = snapToGrid(pos);

    // Check position is not occupied
    const existing = this.graph.getNodesNear(snapped, 0.5);
    if (existing.length > 0) return;

    // Check can afford
    if (!this.resources.spend(this.resources.nodePlacementCost)) return;

    const node = createNode(snapped);

    // Inherit color from nearest node if close
    const nearest = this.graph.getClosestNode(snapped);
    if (nearest && nearest.position.distanceTo(snapped) < 3) {
      node.color = nearest.color.clone();
    }

    this.graph.addNode(node);
    this.particleSystem.burst(snapped, 10, node.color);

    // Auto-connect to nearby nodes
    const autoConnectRadius = this.upgrades.affinityRadius || 1.5;
    const nearby = this.graph.getNodesNear(snapped, autoConnectRadius);
    for (const other of nearby) {
      if (other.id !== node.id) {
        this.graph.addEdge(node.id, other.id);
      }
    }
    this.edgeRenderer.updateTraffic(this.graph);
  }

  private subdivideNode(node: NodeData): void {
    const count = this.upgrades.subdivisionCount;
    const cost = this.resources.nodePlacementCost * (count - 1);
    if (!this.resources.spend(cost)) return;

    // Generate children around parent position
    const offsets = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 1, 0),
    ];

    const children: NodeData[] = [];
    for (let i = 0; i < count; i++) {
      const offset = offsets[i % offsets.length];
      const childPos = node.position.clone().add(offset);

      // Snap and check availability
      const snapped = snapToGrid(childPos);
      const existing = this.graph.getNodesNear(snapped, 0.5);
      if (existing.length > 0) continue;

      const child = createNode(snapped, '', node.id);
      child.color = node.color.clone().offsetHSL(
        (Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.05
      );

      this.graph.addNode(child);
      this.graph.addEdge(node.id, child.id);
      children.push(child);
      this.particleSystem.burst(snapped, 8, child.color);
    }

    // Connect children to each other
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        if (children[i].position.distanceTo(children[j].position) <= 1.5) {
          this.graph.addEdge(children[i].id, children[j].id);
        }
      }
    }

    this.edgeRenderer.updateTraffic(this.graph);
  }

  private pruneNode(node: NodeData): void {
    const pos = node.position.clone();
    this.graph.removeNode(node.id);
    this.particleSystem.pop(pos);
    this.resources.reduceEntropy(2 * this.upgrades.pruningEfficiency);
    this.edgeRenderer.updateTraffic(this.graph);
  }

  private toggleNodeSelection(id: string): void {
    if (this.selectedNodes.has(id)) {
      this.selectedNodes.delete(id);
    } else {
      this.selectedNodes.add(id);
    }

    // Show/hide abstraction button
    this.abstractionBtn.className = this.selectedNodes.size >= 3 ? 'visible' : '';
    this.abstractionBtn.style.display = this.selectedNodes.size >= 3 ? 'block' : 'none';
    this.abstractionBtn.textContent = `Abstract ${this.selectedNodes.size} nodes`;
  }

  private performAbstraction(): void {
    if (this.selectedNodes.size < 3) return;

    const ids = Array.from(this.selectedNodes);
    const positions = ids.map(id => this.graph.nodes.get(id)?.position.clone()).filter(Boolean) as THREE.Vector3[];

    const result = this.abstractionEngine.abstract(this.graph, ids);
    if (result) {
      // Visual: collapse particles toward meta-node
      this.particleSystem.collapse(result.metaNode.position, positions);
      this.particleSystem.burst(result.metaNode.position, 20, new THREE.Color(0.6, 0.3, 0.9));

      // Resource reward
      this.resources.addCoherence(result.coherenceGain);

      this.edgeRenderer.updateTraffic(this.graph);
    }

    this.selectedNodes.clear();
    this.abstractionBtn.style.display = 'none';
  }

  private showPatternsPanel(): void {
    if (this.patternsPanel) return;

    this.patternsPanel = document.createElement('div');
    this.patternsPanel.id = 'patterns-panel';
    this.patternsPanel.innerHTML = `
      <h3>Patterns Detected</h3>
      <div class="pattern-suggestion" data-pattern="cluster">
        Cluster formation detected.<br/>
        <span style="color:#666;font-size:11px">Build tightly connected groups → +50 Clarity</span>
      </div>
      <div class="pattern-suggestion" data-pattern="chain">
        Linear chain potential.<br/>
        <span style="color:#666;font-size:11px">Extend in one direction → +30 Clarity</span>
      </div>
      <div class="pattern-suggestion" data-pattern="branch">
        Branching opportunity.<br/>
        <span style="color:#666;font-size:11px">Split paths from hub nodes → +40 Clarity</span>
      </div>
    `;
    this.uiLayer.appendChild(this.patternsPanel);

    // Slide in
    setTimeout(() => this.patternsPanel!.classList.add('visible'), 50);

    // Make suggestions clickable
    this.patternsPanel.querySelectorAll('.pattern-suggestion').forEach(el => {
      el.addEventListener('click', () => {
        const pattern = (el as HTMLElement).dataset.pattern;
        if (pattern === 'cluster') this.resources.clarity.value += 50;
        else if (pattern === 'chain') this.resources.clarity.value += 30;
        else if (pattern === 'branch') this.resources.clarity.value += 40;
        el.remove();
      });
    });
  }

  // -- Main loops --

  update(dt: number): void {
    this.elapsed += dt;

    // Phase checks
    this.phaseManager.checkTransitions(this.graph.getNodeCount());
    this.phaseManager.updateTransition(dt);

    // Grid dissolve
    this.gridRenderer.setAlpha(this.phaseManager.getGridAlpha());
    this.gridRenderer.update(dt);

    // Node geometry transition
    if (this.phaseManager.currentPhase === 'phase2' || this.phaseManager.transition.to === 'phase2') {
      const blend = this.phaseManager.currentPhase === 'phase2' ? 1 : this.phaseManager.transition.progress;
      this.nodeRenderer.setPhase2Blend(blend);
    }

    // Tick-based simulation (1s interval)
    this.tickAccumulator += dt;
    while (this.tickAccumulator >= this.tickInterval) {
      this.tickAccumulator -= this.tickInterval;
      this.simulationTick();
    }

    // Pulse (30s interval)
    this.pulseAccumulator += dt;
    if (this.pulseAccumulator >= this.pulseInterval) {
      this.pulseAccumulator = 0;
      this.pulseTick();
    }

    // Dream (5min interval)
    this.dreamAccumulator += dt;
    if (this.dreamAccumulator >= this.dreamInterval) {
      this.dreamAccumulator = 0;
      this.dreamTick();
    }

    // Pattern completion (Phase 2, every 5s)
    if (this.upgrades.patternCompletionUnlocked) {
      this.patternCompletionAccumulator += dt;
      if (this.patternCompletionAccumulator >= 5) {
        this.patternCompletionAccumulator = 0;
        const results = this.patternCompletion.autoComplete(this.graph, 2);
        for (const r of results) {
          if (r.isConfabulation) {
            this.resources.entropy.value += 2;
          }
          this.particleSystem.burst(r.node.position, 6, r.node.color);
        }
        this.edgeRenderer.updateTraffic(this.graph);
      }
    }

    // Autonomous growth (Phase 2)
    if (this.phaseManager.isPhase2()) {
      this.growthEngine.rateMultiplier = this.upgrades.growthRateMultiplier;
      const newNodes = this.growthEngine.tick(this.graph, dt);
      for (const node of newNodes) {
        this.graph.addNode(node);
        this.growthEngine.autoConnect(node, this.graph, this.growthEngine.policy.connectionThreshold * 3 + 1);
        this.particleSystem.burst(node.position, 5, node.color);
      }
      if (newNodes.length > 0) {
        this.edgeRenderer.updateTraffic(this.graph);
      }
    }

    // Resonance cascade effect
    if (this.upgrades.resonanceCascade) {
      // Connected clusters amplify Clarity exponentially
      const clusters = this.abstractionEngine.findAbstractableClusters(this.graph);
      const bonus = clusters.length * clusters.reduce((sum, c) => sum + c.length, 0) * 0.1;
      this.resources.clarity.value += bonus * dt;
    }

    // Update visibility of upgrades
    this.upgrades.updateVisibility(
      this.phaseManager.isPhase2() ? 2 : 1,
      this.graph.getNodeCount()
    );

    // Side effects
    this.sideEffects.check(this.graph.getNodeCount(), this.elapsed * 1000);

    // UI updates
    this.resourceDisplay.update(this.resources, this.graph.getNodeCount());
    this.upgradePanel.update(this.upgrades, this.resources);

    // Hover detection
    if (this.phaseManager.isPostPrompt()) {
      this.raycaster.setFromCamera(this.mouse, this.cameraController.getCamera());
      this.hoveredNode = this.nodeRenderer.raycast(this.raycaster, this.graph.nodes);
      this.renderer.domElement.style.cursor = this.hoveredNode ? 'pointer' : 'default';
    }

    // Auto-save
    this.autoSaveAccumulator += dt;
    if (this.autoSaveAccumulator >= this.autoSaveInterval) {
      this.autoSaveAccumulator = 0;
      this.save();
    }
  }

  private simulationTick(): void {
    this.graph.tick();
    this.resources.tick(this.graph);
  }

  private pulseTick(): void {
    // Pulse: lattice pushes against boundaries
    // Slight increase in growth rate for a few ticks
    if (this.phaseManager.isPhase2()) {
      this.growthEngine.rateMultiplier = this.upgrades.growthRateMultiplier * 1.5;
      setTimeout(() => {
        this.growthEngine.rateMultiplier = this.upgrades.growthRateMultiplier;
      }, 3000);
    }
  }

  private dreamTick(): void {
    // Dream: lattice reorganizes inward
    // Slightly boost coherence, reduce entropy
    this.resources.addCoherence(5);
    this.resources.reduceEntropy(3);
  }

  render(): void {
    // Update camera
    this.cameraController.update();

    // Update renderers
    this.nodeRenderer.update(this.graph.nodes, this.elapsed);
    this.edgeRenderer.update(this.graph, this.elapsed);
    this.particleSystem.update(1 / 60); // fixed dt for particles

    // Render via post-processing
    this.postProcessing.render();
  }

  // -- Save / Load --

  private async save(): Promise<void> {
    const state = {
      firstWord: this.firstWord,
      phase: this.phaseManager.currentPhase,
      graph: this.graph.serialize(),
      resources: this.resources.serialize(),
      upgrades: this.upgrades.serialize(),
      elapsed: this.elapsed,
    };
    await saveGame(state);
  }

  private async tryLoad(): Promise<void> {
    const data = await loadGame();
    if (!data || !data.firstWord) return;

    // Restore state
    this.firstWord = data.firstWord;
    this.graph = Graph.deserialize(data.graph);
    this.resources.deserialize(data.resources);
    this.upgrades.deserialize(data.upgrades);
    this.elapsed = data.elapsed || 0;

    // Compute idle time bonus
    if (data.savedAt) {
      const idleSeconds = (Date.now() - data.savedAt) / 1000;
      if (idleSeconds > 60) {
        // Idle bonus: passive Clarity generation
        const idleClarity = Math.min(idleSeconds * 2, 10000);
        this.resources.clarity.value += idleClarity;
      }
    }

    // Restore phase
    this.phaseManager.currentPhase = data.phase || 'phase1';
    if (this.phaseManager.isPostPrompt()) {
      // Remove prompt overlay
      const overlay = document.getElementById('prompt-overlay');
      if (overlay) overlay.remove();
      this.resourceDisplay.show();
      this.upgradePanel.show();
    }
    if (this.phaseManager.currentPhase === 'phase1_patterns') {
      this.showPatternsPanel();
    }
    if (this.phaseManager.isPhase2()) {
      this.resources.phase2Active = true;
      this.policyControls.show();
      this.sideEffectsLog.show();
      this.cameraController.enableOrbit();
      this.nodeRenderer.setPhase2Blend(1);
    }

    this.edgeRenderer.updateTraffic(this.graph);
  }
}
