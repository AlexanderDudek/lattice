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

export function spawnPacket(state: InstrumentState, fromId: number, toId: number, speed: number, size: number, morphology: Morphology) {
  const from = state.nodes.find(n => n.id === fromId);
  const to = state.nodes.find(n => n.id === toId);
  if (!from || !to) return;
  const color = from.color.clone().lerp(to.color, 0.5).offsetHSL(0, 0, 0.15);
  const mesh = createPacketMesh(color, state.packetGroup, size, () => morphology.packetGeometry(size));
  state.packets.push({ from: fromId, to: toId, progress: 0, speed, mesh, size });
}
