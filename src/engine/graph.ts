import * as THREE from 'three';
import { InstrumentState, LatticeNode, Packet } from './types';
import { createPacketMesh } from './meshes';
import type { Morphology } from '../morphologies/Morphology';

export function getNeighborIds(state: InstrumentState, nodeId: number): number[] {
  const ids: number[] = [];
  for (const edge of state.edges) {
    if (edge.from === nodeId) ids.push(edge.to);
    if (edge.to === nodeId) ids.push(edge.from);
  }
  return ids;
}

export function getNodesAtHop(state: InstrumentState, originId: number, targetHop: number): LatticeNode[] {
  if (targetHop === 0) return state.nodes.filter(n => n.id === originId);
  const visited = new Set<number>([originId]);
  let frontier = [originId];
  for (let hop = 0; hop < targetHop; hop++) {
    const next: number[] = [];
    for (const nid of frontier) {
      for (const neighbor of getNeighborIds(state, nid)) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return frontier.map(id => state.nodes.find(n => n.id === id)!).filter(Boolean);
}

/** Remove a node and all its connected edges/packets, dispose meshes */
export function removeNode(state: InstrumentState, nodeId: number): void {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;

  // Remove edges involving this node
  for (let i = state.edges.length - 1; i >= 0; i--) {
    const edge = state.edges[i];
    if (edge.from === nodeId || edge.to === nodeId) {
      state.edgeGroup.remove(edge.line);
      edge.line.geometry.dispose();
      (edge.line.material as THREE.Material).dispose();
      state.edges.splice(i, 1);
    }
  }

  // Remove packets involving this node
  for (let i = state.packets.length - 1; i >= 0; i--) {
    const pkt = state.packets[i];
    if (pkt.from === nodeId || pkt.to === nodeId) {
      if (pkt.mesh) state.packetGroup.remove(pkt.mesh);
      state.packets.splice(i, 1);
    }
  }

  // Dispose node meshes
  if (node.mesh) {
    state.nodeGroup.remove(node.mesh);
    node.mesh.geometry.dispose();
    (node.mesh.material as THREE.Material).dispose();
  }
  if (node.ringMesh) {
    state.nodeGroup.remove(node.ringMesh);
    node.ringMesh.geometry.dispose();
    (node.ringMesh.material as THREE.Material).dispose();
  }

  // Remove from nodes array
  const idx = state.nodes.indexOf(node);
  if (idx !== -1) state.nodes.splice(idx, 1);
}

/**
 * Find bridge nodes (articulation points / cut vertices) using Tarjan's algorithm.
 * Returns the set of node IDs whose removal would disconnect the graph.
 */
export function findBridges(state: InstrumentState): Set<number> {
  const bridges = new Set<number>();
  if (state.nodes.length <= 2) return bridges;

  const ids = state.nodes.map(n => n.id);
  const disc = new Map<number, number>();
  const low = new Map<number, number>();
  const parent = new Map<number, number>();
  let timer = 0;

  function dfs(u: number) {
    disc.set(u, timer);
    low.set(u, timer);
    timer++;
    let children = 0;

    for (const v of getNeighborIds(state, u)) {
      if (!disc.has(v)) {
        children++;
        parent.set(v, u);
        dfs(v);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));

        // u is an articulation point if:
        // 1) u is root of DFS tree and has 2+ children
        if (!parent.has(u) && children > 1) bridges.add(u);
        // 2) u is not root and low[v] >= disc[u]
        if (parent.has(u) && low.get(v)! >= disc.get(u)!) bridges.add(u);
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  }

  // Run DFS from first node (graph may be disconnected after kills)
  for (const id of ids) {
    if (!disc.has(id)) dfs(id);
  }

  return bridges;
}

/**
 * Find connected components. Returns an array of node ID sets.
 */
export function findComponents(state: InstrumentState): Set<number>[] {
  const visited = new Set<number>();
  const components: Set<number>[] = [];

  for (const node of state.nodes) {
    if (visited.has(node.id)) continue;
    const component = new Set<number>();
    const queue = [node.id];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.add(current);
      for (const neighbor of getNeighborIds(state, current)) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }

  return components;
}

export function spawnPacket(state: InstrumentState, fromId: number, toId: number, speed: number, size: number, morphology: Morphology) {
  const from = state.nodes.find(n => n.id === fromId);
  const to = state.nodes.find(n => n.id === toId);
  if (!from || !to) return;
  const color = from.color.clone().lerp(to.color, 0.5).offsetHSL(0, 0, 0.15);
  const mesh = createPacketMesh(color, state.packetGroup, size, () => morphology.packetGeometry(size));
  state.packets.push({ from: fromId, to: toId, progress: 0, speed, mesh, size });
}
