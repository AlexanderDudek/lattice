import * as THREE from 'three';

// Isometric projection helpers
// Standard isometric angles: rotate 45° around Y, then ~35.264° around X
const ISO_ANGLE = Math.PI / 4;
const ISO_ELEVATION = Math.atan(1 / Math.sqrt(2)); // ~35.264°

export function isoProject(gridX: number, gridY: number, gridZ: number): THREE.Vector3 {
  // Grid coordinates to world-space isometric positions
  // Each grid unit = 1.0 world unit
  return new THREE.Vector3(gridX, gridY, gridZ);
}

export function screenToGridPlane(
  screenX: number,
  screenY: number,
  camera: THREE.OrthographicCamera,
  gridY: number = 0
): THREE.Vector3 | null {
  const ndc = new THREE.Vector2(screenX, screenY);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -gridY);
  const intersection = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(plane, intersection);
  return hit ? intersection : null;
}

export function snapToGrid(pos: THREE.Vector3, gridSize: number = 1): THREE.Vector3 {
  return new THREE.Vector3(
    Math.round(pos.x / gridSize) * gridSize,
    Math.round(pos.y / gridSize) * gridSize,
    Math.round(pos.z / gridSize) * gridSize
  );
}

export function gridDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

export function euclideanDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.distanceTo(b);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate points on the surface of a grid
export function getGridNeighbors(pos: THREE.Vector3, radius: number = 1): THREE.Vector3[] {
  const neighbors: THREE.Vector3[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= radius) {
          neighbors.push(new THREE.Vector3(pos.x + dx, pos.y + dy, pos.z + dz));
        }
      }
    }
  }
  return neighbors;
}

// Unique ID generator
let _idCounter = 0;
export function generateId(): string {
  return `n${++_idCounter}`;
}

export function resetIdCounter(startFrom: number = 0): void {
  _idCounter = startFrom;
}

// Easing functions
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
}
