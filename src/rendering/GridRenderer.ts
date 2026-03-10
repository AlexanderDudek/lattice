import * as THREE from 'three';

export class GridRenderer {
  group: THREE.Group;
  private lines: THREE.LineSegments;
  private material: THREE.LineBasicMaterial;
  private gridSize = 10;
  private targetAlpha = 1;
  private currentAlpha = 1;

  constructor() {
    this.group = new THREE.Group();

    const positions: number[] = [];
    const colors: number[] = [];
    const half = this.gridSize / 2;

    // Generate grid lines on the Y=0 plane
    for (let i = -half; i <= half; i++) {
      // X-axis lines
      const distFromCenter = Math.abs(i) / half;
      const alpha = Math.max(0.03, 0.15 * (1 - distFromCenter * distFromCenter));

      // Z direction line
      positions.push(i, 0, -half, i, 0, half);
      colors.push(1, 1, 1, alpha, 1, 1, 1, alpha * 0.3);

      // X direction line
      positions.push(-half, 0, i, half, 0, i);
      colors.push(1, 1, 1, alpha, 1, 1, 1, alpha * 0.3);
    }

    // Also add Y-axis lines at a few key intersections for depth hint
    for (let x = -half; x <= half; x += 2) {
      for (let z = -half; z <= half; z += 2) {
        const distFromCenter = Math.sqrt(x * x + z * z) / (half * Math.SQRT2);
        const alpha = Math.max(0.01, 0.06 * (1 - distFromCenter));
        positions.push(x, 0, z, x, 3, z);
        colors.push(1, 1, 1, alpha, 1, 1, 1, 0);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });

    this.lines = new THREE.LineSegments(geometry, this.material);
    this.group.add(this.lines);
  }

  setAlpha(alpha: number): void {
    this.targetAlpha = alpha;
  }

  update(dt: number): void {
    // Smooth fade
    this.currentAlpha += (this.targetAlpha - this.currentAlpha) * dt * 2;
    this.material.opacity = this.currentAlpha;
    this.lines.visible = this.currentAlpha > 0.01;
  }

  getGroup(): THREE.Group {
    return this.group;
  }
}
