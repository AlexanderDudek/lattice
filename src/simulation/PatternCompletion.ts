import * as THREE from 'three';
import { Graph, createNode, NodeData } from './Graph';
import { randomInRange } from '../utils/MathUtils';

export interface CompletionResult {
  node: NodeData;
  isConfabulation: boolean;
}

export class PatternCompletion {
  confabulationRate = 0.2; // 20% chance of confabulation

  // Find gaps in the lattice and suggest completions
  findGaps(graph: Graph): THREE.Vector3[] {
    const gaps: THREE.Vector3[] = [];
    const occupied = new Set<string>();

    // Build occupied position set
    for (const node of graph.nodes.values()) {
      const key = `${Math.round(node.position.x)},${Math.round(node.position.y)},${Math.round(node.position.z)}`;
      occupied.add(key);
    }

    // For each node, check if there are missing neighbors that would complete patterns
    for (const node of graph.nodes.values()) {
      const neighbors = graph.getNeighbors(node.id);
      if (neighbors.length < 2) continue;

      // Check 6 cardinal directions
      const offsets = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1],
      ];

      for (const [dx, dy, dz] of offsets) {
        const pos = new THREE.Vector3(
          Math.round(node.position.x) + dx,
          Math.round(node.position.y) + dy,
          Math.round(node.position.z) + dz
        );
        const key = `${pos.x},${pos.y},${pos.z}`;
        if (occupied.has(key)) continue;

        // Check if filling this gap would connect at least 2 existing nodes
        let adjacentCount = 0;
        for (const [dx2, dy2, dz2] of offsets) {
          const neighbor = `${pos.x + dx2},${pos.y + dy2},${pos.z + dz2}`;
          if (occupied.has(neighbor)) adjacentCount++;
        }

        if (adjacentCount >= 2) {
          gaps.push(pos);
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return gaps.filter(p => {
      const key = `${p.x},${p.y},${p.z}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Fill a gap, possibly creating a confabulation
  fillGap(graph: Graph, position: THREE.Vector3): CompletionResult {
    const isConfabulation = Math.random() < this.confabulationRate;

    const node = createNode(position);

    if (isConfabulation) {
      node.isConfabulation = true;
      // Confabulations have slightly off colors
      node.color = new THREE.Color().setHSL(
        randomInRange(0, 1),
        randomInRange(0.3, 0.6),
        randomInRange(0.4, 0.6)
      );
      // Slight position jitter to make them visually "wrong"
      node.position.x += randomInRange(-0.15, 0.15);
      node.position.y += randomInRange(-0.15, 0.15);
      node.position.z += randomInRange(-0.15, 0.15);
    } else {
      // Good completions inherit color from nearest neighbor
      const nearest = graph.getClosestNode(position);
      if (nearest) {
        node.color = nearest.color.clone();
      }
    }

    return { node, isConfabulation };
  }

  // Auto-complete: find gaps and fill them
  autoComplete(graph: Graph, maxFills: number = 3): CompletionResult[] {
    const gaps = this.findGaps(graph);
    const results: CompletionResult[] = [];

    const toFill = gaps.slice(0, maxFills);
    for (const pos of toFill) {
      const result = this.fillGap(graph, pos);
      graph.addNode(result.node);

      // Auto-connect to nearby nodes
      const nearby = graph.getNodesNear(result.node.position, 1.5);
      for (const other of nearby) {
        if (other.id !== result.node.id) {
          graph.addEdge(result.node.id, other.id);
        }
      }

      results.push(result);
    }

    return results;
  }
}
