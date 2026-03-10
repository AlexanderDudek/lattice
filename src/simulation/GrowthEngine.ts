import * as THREE from 'three';
import { Graph, createNode, NodeData } from './Graph';
import { randomElement, randomInRange, getGridNeighbors } from '../utils/MathUtils';

export interface GrowthPolicy {
  rate: number;           // 0-1, how often new nodes spawn
  directionBias: THREE.Vector3; // preferred growth direction
  connectionThreshold: number;  // 0-1, how eagerly to connect
  abstractionAggression: number; // 0-1, how aggressively to compress
}

export interface LSystemRule {
  symbol: string;
  production: string[];
  angle: number;
}

// Simple L-system for branching patterns
const L_SYSTEM_RULES: LSystemRule[] = [
  { symbol: 'F', production: ['F', 'F', '+', 'F'], angle: Math.PI / 6 },
  { symbol: 'F', production: ['F', '-', 'F', 'F'], angle: -Math.PI / 6 },
  { symbol: 'F', production: ['F', '+', 'F', '-', 'F'], angle: Math.PI / 4 },
];

export class GrowthEngine {
  policy: GrowthPolicy = {
    rate: 0.3,
    directionBias: new THREE.Vector3(0, 1, 0),
    connectionThreshold: 0.5,
    abstractionAggression: 0.3,
  };

  private growthAccumulator = 0;
  private lSystemDepth = 0;
  rateMultiplier = 1;

  // Phase 2 colors by subsystem
  private subsystemColors: Map<string, THREE.Color> = new Map([
    ['pattern', new THREE.Color(0.3, 0.8, 0.3)],       // green
    ['abstraction', new THREE.Color(0.6, 0.3, 0.8)],    // purple
    ['memory', new THREE.Color(0.9, 0.75, 0.2)],        // gold
    ['compute', new THREE.Color(0.2, 0.5, 1.0)],        // electric blue
  ]);

  tick(graph: Graph, dt: number): NodeData[] {
    const newNodes: NodeData[] = [];
    this.growthAccumulator += this.policy.rate * this.rateMultiplier * dt;

    while (this.growthAccumulator >= 1) {
      this.growthAccumulator -= 1;

      const edgeNodes = graph.getEdgeNodes();
      if (edgeNodes.length === 0) break;

      // Pick a random edge node to grow from
      const parent = randomElement(edgeNodes);
      const newNode = this.spawnFromParent(parent, graph);
      if (newNode) {
        newNodes.push(newNode);
      }
    }

    return newNodes;
  }

  private spawnFromParent(parent: NodeData, graph: Graph): NodeData | null {
    // Find available positions near parent
    const candidates = getGridNeighbors(parent.position, 1);

    // Filter out occupied positions
    const available = candidates.filter(pos => {
      const nearby = graph.getNodesNear(pos, 0.5);
      return nearby.length === 0;
    });

    if (available.length === 0) return null;

    // Bias toward direction policy
    available.sort((a, b) => {
      const da = a.clone().sub(parent.position).normalize().dot(this.policy.directionBias);
      const db = b.clone().sub(parent.position).normalize().dot(this.policy.directionBias);
      return db - da + randomInRange(-0.3, 0.3); // add randomness
    });

    const pos = available[0];

    // Apply L-system branching for visual variety
    if (Math.random() < 0.3 && this.lSystemDepth < 5) {
      const rule = randomElement(L_SYSTEM_RULES);
      const offset = new THREE.Vector3(
        Math.cos(rule.angle) * (Math.random() > 0.5 ? 1 : -1),
        Math.random() > 0.5 ? 1 : 0,
        Math.sin(rule.angle) * (Math.random() > 0.5 ? 1 : -1)
      );
      pos.add(offset).round();
      this.lSystemDepth++;
    }

    const node = createNode(pos, '', parent.id);

    // Assign color based on growth context
    node.color = this.getGrowthColor(parent);

    return node;
  }

  private getGrowthColor(parent: NodeData): THREE.Color {
    // Inherit parent color with slight variation
    const baseColor = parent.color.clone();
    const hsl = { h: 0, s: 0, l: 0 };
    baseColor.getHSL(hsl);

    // Slight hue drift
    hsl.h += randomInRange(-0.02, 0.02);
    if (hsl.h < 0) hsl.h += 1;
    if (hsl.h > 1) hsl.h -= 1;

    // Slight saturation/lightness variation
    hsl.s = Math.max(0.3, Math.min(1, hsl.s + randomInRange(-0.05, 0.05)));
    hsl.l = Math.max(0.4, Math.min(0.8, hsl.l + randomInRange(-0.05, 0.05)));

    return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
  }

  getSubsystemColor(subsystem: string): THREE.Color {
    return this.subsystemColors.get(subsystem)?.clone() || new THREE.Color(0.2, 0.8, 0.9);
  }

  // Auto-connect new nodes to nearby existing nodes
  autoConnect(node: NodeData, graph: Graph, threshold: number): void {
    const nearby = graph.getNodesNear(node.position, threshold);
    for (const other of nearby) {
      if (other.id === node.id) continue;
      const dist = node.position.distanceTo(other.position);
      if (dist <= threshold) {
        // Connection probability based on distance and policy
        const prob = (1 - dist / threshold) * this.policy.connectionThreshold;
        if (Math.random() < prob) {
          graph.addEdge(node.id, other.id);
        }
      }
    }
  }
}
