import * as THREE from 'three';
import { generateId } from '../utils/MathUtils';

export interface NodeData {
  id: string;
  position: THREE.Vector3;
  label: string;
  maturity: number;       // 0-1, increases with age and connections
  age: number;            // ticks since creation
  connectionCount: number;
  color: THREE.Color;
  scale: number;
  phase: number;          // for breathing animation offset
  isMetaNode: boolean;    // compressed abstraction node
  isConfabulation: boolean;
  clusterId: string | null;
  spawnAnimation: number; // 0-1, for spawn-in effect
  parentId: string | null;
  traffic: number;        // information flow through this node
}

export interface EdgeData {
  from: string;
  to: string;
  traffic: number;       // 0-1, visual thickness
  age: number;
  pulsePhase: number;    // for traveling light animation
  isBundled: boolean;
}

export function createNode(
  position: THREE.Vector3,
  label: string = '',
  parentId: string | null = null
): NodeData {
  return {
    id: generateId(),
    position: position.clone(),
    label,
    maturity: 0,
    age: 0,
    connectionCount: 0,
    color: new THREE.Color(0.2, 0.8, 0.9), // cyan default
    scale: 1,
    phase: Math.random() * Math.PI * 2,
    isMetaNode: false,
    isConfabulation: false,
    clusterId: null,
    spawnAnimation: 0,
    parentId,
    traffic: 0,
  };
}

export class Graph {
  nodes: Map<string, NodeData> = new Map();
  adjacency: Map<string, Set<string>> = new Map();
  edges: Map<string, EdgeData> = new Map();

  private edgeKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  addNode(node: NodeData): void {
    this.nodes.set(node.id, node);
    this.adjacency.set(node.id, new Set());
  }

  removeNode(id: string): void {
    const neighbors = this.adjacency.get(id);
    if (neighbors) {
      for (const nid of neighbors) {
        this.adjacency.get(nid)?.delete(id);
        this.edges.delete(this.edgeKey(id, nid));
        const neighborNode = this.nodes.get(nid);
        if (neighborNode) neighborNode.connectionCount--;
      }
    }
    this.adjacency.delete(id);
    this.nodes.delete(id);
  }

  addEdge(a: string, b: string): boolean {
    if (a === b) return false;
    if (!this.nodes.has(a) || !this.nodes.has(b)) return false;

    const key = this.edgeKey(a, b);
    if (this.edges.has(key)) return false;

    this.adjacency.get(a)!.add(b);
    this.adjacency.get(b)!.add(a);

    this.edges.set(key, {
      from: a < b ? a : b,
      to: a < b ? b : a,
      traffic: 0,
      age: 0,
      pulsePhase: 0,
      isBundled: false,
    });

    const nodeA = this.nodes.get(a)!;
    const nodeB = this.nodes.get(b)!;
    nodeA.connectionCount++;
    nodeB.connectionCount++;

    return true;
  }

  removeEdge(a: string, b: string): void {
    const key = this.edgeKey(a, b);
    if (!this.edges.has(key)) return;

    this.adjacency.get(a)?.delete(b);
    this.adjacency.get(b)?.delete(a);
    this.edges.delete(key);

    const nodeA = this.nodes.get(a);
    const nodeB = this.nodes.get(b);
    if (nodeA) nodeA.connectionCount--;
    if (nodeB) nodeB.connectionCount--;
  }

  hasEdge(a: string, b: string): boolean {
    return this.edges.has(this.edgeKey(a, b));
  }

  getNeighbors(id: string): string[] {
    return Array.from(this.adjacency.get(id) || []);
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  getEdgeCount(): number {
    return this.edges.size;
  }

  // Find all nodes within a certain distance of a position
  getNodesNear(pos: THREE.Vector3, radius: number): NodeData[] {
    const results: NodeData[] = [];
    for (const node of this.nodes.values()) {
      if (node.position.distanceTo(pos) <= radius) {
        results.push(node);
      }
    }
    return results;
  }

  // Find the closest node to a position
  getClosestNode(pos: THREE.Vector3): NodeData | null {
    let closest: NodeData | null = null;
    let minDist = Infinity;
    for (const node of this.nodes.values()) {
      const d = node.position.distanceTo(pos);
      if (d < minDist) {
        minDist = d;
        closest = node;
      }
    }
    return closest;
  }

  // Get a connected cluster via BFS
  getCluster(startId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of this.getNeighbors(current)) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    return visited;
  }

  // Get edge nodes (nodes with fewer connections than possible neighbors)
  getEdgeNodes(): NodeData[] {
    const edgeNodes: NodeData[] = [];
    for (const node of this.nodes.values()) {
      if (node.connectionCount < 3) {
        edgeNodes.push(node);
      }
    }
    return edgeNodes;
  }

  // Get all edges as array
  getEdgesArray(): EdgeData[] {
    return Array.from(this.edges.values());
  }

  // Tick: age all nodes and edges
  tick(): void {
    for (const node of this.nodes.values()) {
      node.age++;
      // Maturity grows with age and connections, asymptotically approaches 1
      node.maturity = Math.min(1, node.maturity + 0.002 + node.connectionCount * 0.001);
      // Spawn animation
      if (node.spawnAnimation < 1) {
        node.spawnAnimation = Math.min(1, node.spawnAnimation + 0.05);
      }
    }
    for (const edge of this.edges.values()) {
      edge.age++;
    }
  }

  // Serialize for save
  serialize(): object {
    const nodes: any[] = [];
    for (const n of this.nodes.values()) {
      nodes.push({
        ...n,
        position: { x: n.position.x, y: n.position.y, z: n.position.z },
        color: '#' + n.color.getHexString(),
      });
    }
    const edges: any[] = [];
    for (const e of this.edges.values()) {
      edges.push({ ...e });
    }
    return { nodes, edges };
  }

  // Deserialize from save
  static deserialize(data: any): Graph {
    const g = new Graph();
    for (const n of data.nodes) {
      const node: NodeData = {
        ...n,
        position: new THREE.Vector3(n.position.x, n.position.y, n.position.z),
        color: new THREE.Color(n.color),
      };
      g.nodes.set(node.id, node);
      g.adjacency.set(node.id, new Set());
    }
    for (const e of data.edges) {
      const edge: EdgeData = { ...e };
      g.edges.set(`${e.from}:${e.to}`, edge);
      g.adjacency.get(e.from)?.add(e.to);
      g.adjacency.get(e.to)?.add(e.from);
    }
    return g;
  }
}
