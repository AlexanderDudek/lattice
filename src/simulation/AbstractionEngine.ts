import * as THREE from 'three';
import { Graph, createNode, NodeData } from './Graph';

export interface AbstractionResult {
  metaNode: NodeData;
  removedIds: string[];
  coherenceGain: number;
}

export class AbstractionEngine {
  // Minimum cluster size to abstract
  minClusterSize = 3;

  abstract(graph: Graph, nodeIds: string[]): AbstractionResult | null {
    if (nodeIds.length < this.minClusterSize) return null;

    // Verify all nodes exist
    const nodes = nodeIds.map(id => graph.nodes.get(id)).filter(Boolean) as NodeData[];
    if (nodes.length < this.minClusterSize) return null;

    // Calculate centroid for meta-node position
    const centroid = new THREE.Vector3();
    for (const node of nodes) {
      centroid.add(node.position);
    }
    centroid.divideScalar(nodes.length);

    // Calculate average color (mix all node colors)
    const avgColor = new THREE.Color(0, 0, 0);
    for (const node of nodes) {
      avgColor.add(node.color);
    }
    avgColor.multiplyScalar(1 / nodes.length);
    // Shift toward purple for abstraction
    const hsl = { h: 0, s: 0, l: 0 };
    avgColor.getHSL(hsl);
    hsl.h = hsl.h * 0.5 + 0.75 * 0.5; // blend toward purple (0.75)
    hsl.s = Math.min(1, hsl.s + 0.1);
    avgColor.setHSL(hsl.h % 1, hsl.s, hsl.l);

    // Create meta-node
    const metaNode = createNode(centroid, `[${nodes.length}]`);
    metaNode.isMetaNode = true;
    metaNode.scale = 1.5 + Math.log2(nodes.length) * 0.3;
    metaNode.color = avgColor;
    metaNode.maturity = 0.5; // starts mature

    // Find all external connections (edges from cluster to non-cluster)
    const clusterSet = new Set(nodeIds);
    const externalNeighbors = new Set<string>();
    for (const id of nodeIds) {
      const neighbors = graph.getNeighbors(id);
      for (const nid of neighbors) {
        if (!clusterSet.has(nid)) {
          externalNeighbors.add(nid);
        }
      }
    }

    // Remove all cluster nodes
    for (const id of nodeIds) {
      graph.removeNode(id);
    }

    // Add meta-node
    graph.addNode(metaNode);

    // Reconnect external edges to meta-node
    for (const externalId of externalNeighbors) {
      if (graph.nodes.has(externalId)) {
        graph.addEdge(metaNode.id, externalId);
      }
    }

    // Calculate coherence gain
    const coherenceGain = nodes.length * 2;

    return {
      metaNode,
      removedIds: nodeIds,
      coherenceGain,
    };
  }

  // Find abstractable clusters (connected components of similar nodes)
  findAbstractableClusters(graph: Graph): string[][] {
    const visited = new Set<string>();
    const clusters: string[][] = [];

    for (const [id, node] of graph.nodes) {
      if (visited.has(id) || node.isMetaNode) continue;

      // BFS to find nearby connected similar nodes
      const cluster: string[] = [];
      const queue = [id];
      while (queue.length > 0 && cluster.length < 20) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        cluster.push(current);

        for (const nid of graph.getNeighbors(current)) {
          if (visited.has(nid)) continue;
          const neighborNode = graph.nodes.get(nid);
          if (neighborNode && !neighborNode.isMetaNode) {
            // Check similarity (color proximity as a simple heuristic)
            // Color distance via manual component comparison
            const dr = node.color.r - neighborNode.color.r;
            const dg = node.color.g - neighborNode.color.g;
            const db = node.color.b - neighborNode.color.b;
            const colorDist = Math.sqrt(dr * dr + dg * dg + db * db);
            if (colorDist < 0.5) {
              queue.push(nid);
            }
          }
        }
      }

      if (cluster.length >= this.minClusterSize) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }
}
