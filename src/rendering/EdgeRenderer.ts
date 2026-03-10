import * as THREE from 'three';
import { Graph, EdgeData } from '../simulation/Graph';

const EDGE_SEGMENTS = 8; // segments per edge for curvature
const MAX_EDGES = 30000;

export class EdgeRenderer {
  group: THREE.Group;
  private mesh: THREE.LineSegments;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;

  private positions: Float32Array;
  private colors: Float32Array;
  private vertexCount = 0;

  private uniforms = {
    uTime: { value: 0 },
    uBaseAlpha: { value: 0.3 },
  };

  constructor() {
    this.group = new THREE.Group();

    // Pre-allocate buffers
    const maxVertices = MAX_EDGES * 2; // 2 vertices per line segment
    this.positions = new Float32Array(maxVertices * 3);
    this.colors = new Float32Array(maxVertices * 4);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      linewidth: 1,
    });

    this.mesh = new THREE.LineSegments(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  update(graph: Graph, time: number): void {
    this.uniforms.uTime.value = time;
    this.vertexCount = 0;

    let idx = 0;
    for (const edge of graph.edges.values()) {
      const nodeA = graph.nodes.get(edge.from);
      const nodeB = graph.nodes.get(edge.to);
      if (!nodeA || !nodeB) continue;
      if (idx >= MAX_EDGES * 2 * 3) break;

      const posA = nodeA.position;
      const posB = nodeB.position;

      // Midpoint with slight upward curve for edge bundling effect
      const traffic = edge.traffic;
      const curveHeight = Math.max(0, traffic * 0.3);

      // Simple straight line (for now, curved bundling at higher traffic)
      if (traffic > 0.3) {
        // Curved edge via midpoint
        const mid = new THREE.Vector3(
          (posA.x + posB.x) * 0.5,
          (posA.y + posB.y) * 0.5 + curveHeight,
          (posA.z + posB.z) * 0.5,
        );

        // Two segments: A->mid, mid->B
        this.positions[idx] = posA.x;
        this.positions[idx + 1] = posA.y;
        this.positions[idx + 2] = posA.z;
        this.positions[idx + 3] = mid.x;
        this.positions[idx + 4] = mid.y;
        this.positions[idx + 5] = mid.z;

        this.positions[idx + 6] = mid.x;
        this.positions[idx + 7] = mid.y;
        this.positions[idx + 8] = mid.z;
        this.positions[idx + 9] = posB.x;
        this.positions[idx + 10] = posB.y;
        this.positions[idx + 11] = posB.z;

        // Colors with pulse effect
        const pulse = Math.sin(time * 2 + edge.pulsePhase) * 0.5 + 0.5;
        const baseAlpha = 0.15 + traffic * 0.35;
        const brightness = 0.5 + traffic * 0.5;

        // Cyan-ish base color
        const r = 0.3 * brightness;
        const g = 0.7 * brightness;
        const b = 0.9 * brightness;

        for (let v = 0; v < 4; v++) {
          const ci = (idx / 3 + v) * 4;
          const pulseFactor = v === 1 || v === 2 ? pulse * 0.3 : 0;
          this.colors[ci] = r + pulseFactor;
          this.colors[ci + 1] = g + pulseFactor;
          this.colors[ci + 2] = b + pulseFactor;
          this.colors[ci + 3] = baseAlpha;
        }

        idx += 12;
        this.vertexCount += 4;
      } else {
        // Simple straight line
        this.positions[idx] = posA.x;
        this.positions[idx + 1] = posA.y;
        this.positions[idx + 2] = posA.z;
        this.positions[idx + 3] = posB.x;
        this.positions[idx + 4] = posB.y;
        this.positions[idx + 5] = posB.z;

        // Color with traveling pulse
        const pulse = Math.sin(time * 2 + edge.pulsePhase) * 0.5 + 0.5;
        const alpha = 0.12 + pulse * 0.08;

        const ci = (idx / 3) * 4;
        // Start vertex
        this.colors[ci] = 0.3;
        this.colors[ci + 1] = 0.7;
        this.colors[ci + 2] = 0.9;
        this.colors[ci + 3] = alpha + pulse * 0.15;
        // End vertex
        this.colors[ci + 4] = 0.3;
        this.colors[ci + 5] = 0.7;
        this.colors[ci + 6] = 0.9;
        this.colors[ci + 7] = alpha;

        idx += 6;
        this.vertexCount += 2;
      }
    }

    // Update draw range
    this.geometry.setDrawRange(0, this.vertexCount);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  // Update edge traffic values based on graph connectivity
  updateTraffic(graph: Graph): void {
    for (const edge of graph.edges.values()) {
      const nodeA = graph.nodes.get(edge.from);
      const nodeB = graph.nodes.get(edge.to);
      if (!nodeA || !nodeB) continue;

      // Traffic based on combined connectivity of endpoints
      const connectivity = (nodeA.connectionCount + nodeB.connectionCount) / 2;
      edge.traffic = Math.min(1, connectivity / 10);
      edge.pulsePhase = Math.random() * Math.PI * 2;
    }
  }

  getGroup(): THREE.Group {
    return this.group;
  }
}
