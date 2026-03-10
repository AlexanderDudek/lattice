import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class IsometricCamera {
  camera: THREE.OrthographicCamera;
  controls: OrbitControls | null = null;
  private frustumSize = 12;
  private aspect: number;
  private orbitEnabled = false;

  constructor(canvas: HTMLCanvasElement) {
    this.aspect = window.innerWidth / window.innerHeight;

    this.camera = new THREE.OrthographicCamera(
      -this.frustumSize * this.aspect / 2,
      this.frustumSize * this.aspect / 2,
      this.frustumSize / 2,
      -this.frustumSize / 2,
      -100,
      200
    );

    // Standard isometric position
    const dist = 20;
    this.camera.position.set(dist, dist, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    // Pre-create controls but keep them disabled
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableRotate = false;
    this.controls.enableZoom = true;
    this.controls.enablePan = true;
    this.controls.zoomSpeed = 0.5;
    this.controls.panSpeed = 0.5;
    this.controls.minZoom = 0.3;
    this.controls.maxZoom = 3;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
  }

  enableOrbit(): void {
    if (this.orbitEnabled || !this.controls) return;
    this.orbitEnabled = true;
    this.controls.enableRotate = true;
  }

  update(): void {
    this.controls?.update();
  }

  resize(width: number, height: number): void {
    this.aspect = width / height;
    this.camera.left = -this.frustumSize * this.aspect / 2;
    this.camera.right = this.frustumSize * this.aspect / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.camera.updateProjectionMatrix();
  }

  zoom(delta: number): void {
    this.frustumSize = Math.max(6, Math.min(40, this.frustumSize + delta));
    this.resize(window.innerWidth, window.innerHeight);
  }

  getCamera(): THREE.OrthographicCamera {
    return this.camera;
  }
}
