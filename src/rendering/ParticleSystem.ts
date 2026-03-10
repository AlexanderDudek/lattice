import * as THREE from 'three';

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

const MAX_PARTICLES = 2000;

export class ParticleSystem {
  group: THREE.Group;
  private particles: Particle[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;

  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  constructor() {
    this.group = new THREE.Group();

    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  // Burst of particles at a position (for node placement)
  burst(position: THREE.Vector3, count: number = 10, color?: THREE.Color): void {
    const baseColor = color || new THREE.Color(0.3, 0.8, 0.9);

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;

      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * Math.PI;
      const speed = 0.5 + Math.random() * 1.5;

      this.particles.push({
        position: position.clone(),
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(elevation) * speed,
          Math.sin(elevation) * speed + 0.5,
          Math.sin(angle) * Math.cos(elevation) * speed,
        ),
        life: 1,
        maxLife: 0.5 + Math.random() * 0.5,
        size: 0.03 + Math.random() * 0.05,
        color: baseColor.clone().offsetHSL(
          (Math.random() - 0.5) * 0.05,
          0,
          (Math.random() - 0.5) * 0.1
        ),
      });
    }
  }

  // Pop effect for pruning
  pop(position: THREE.Vector3, count: number = 15): void {
    const color = new THREE.Color(1, 0.4, 0.3);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;

      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * Math.PI;
      const speed = 1 + Math.random() * 2;

      this.particles.push({
        position: position.clone(),
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.cos(elevation) * speed,
          Math.sin(elevation) * speed,
          Math.sin(angle) * Math.cos(elevation) * speed,
        ),
        life: 1,
        maxLife: 0.3 + Math.random() * 0.3,
        size: 0.04 + Math.random() * 0.06,
        color: color.clone().offsetHSL(
          (Math.random() - 0.5) * 0.05,
          0,
          (Math.random() - 0.5) * 0.15
        ),
      });
    }
  }

  // Collapse animation for abstraction
  collapse(position: THREE.Vector3, fromPositions: THREE.Vector3[]): void {
    for (const from of fromPositions) {
      if (this.particles.length >= MAX_PARTICLES) break;

      const dir = position.clone().sub(from).normalize();
      const dist = from.distanceTo(position);

      this.particles.push({
        position: from.clone(),
        velocity: dir.multiplyScalar(dist * 2),
        life: 1,
        maxLife: 0.5,
        size: 0.05,
        color: new THREE.Color(0.6, 0.3, 0.9),
      });
    }
  }

  update(dt: number): void {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt / p.maxLife;
      p.position.add(p.velocity.clone().multiplyScalar(dt));
      p.velocity.y -= 2 * dt; // gravity
      p.velocity.multiplyScalar(0.97); // drag

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update buffers
    const count = Math.min(this.particles.length, MAX_PARTICLES);
    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      this.positions[i * 3] = p.position.x;
      this.positions[i * 3 + 1] = p.position.y;
      this.positions[i * 3 + 2] = p.position.z;

      const fade = p.life;
      this.colors[i * 3] = p.color.r * fade;
      this.colors[i * 3 + 1] = p.color.g * fade;
      this.colors[i * 3 + 2] = p.color.b * fade;

      this.sizes[i] = p.size * fade;
    }

    this.geometry.setDrawRange(0, count);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }

  getGroup(): THREE.Group {
    return this.group;
  }
}
