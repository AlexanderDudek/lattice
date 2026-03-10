import * as THREE from 'three';
import { NodeData } from '../simulation/Graph';
import { breathingVertexShader, breathingFragmentShader } from './ShaderLib';

const MAX_INSTANCES = 15000;

interface MeshData {
  mesh: THREE.InstancedMesh;
  phase: Float32Array;
  scale: Float32Array;
  color: Float32Array;
  spawn: Float32Array;
}

export class NodeRenderer {
  group: THREE.Group;

  private cubeData: MeshData;
  private icoData: MeshData;

  // Shared uniforms
  private uniforms = {
    uTime: { value: 0 },
    uBreathingAmplitude: { value: 0.03 },
    uEmissiveIntensity: { value: 0.3 },
  };

  private material: THREE.ShaderMaterial;
  private tempMatrix = new THREE.Matrix4();

  // Track maturity threshold for geometry swap
  private maturityThreshold = 0.7;
  private phase2Blend = 0; // 0 = all cubes, 1 = all ico

  constructor() {
    this.group = new THREE.Group();

    this.material = new THREE.ShaderMaterial({
      vertexShader: breathingVertexShader,
      fragmentShader: breathingFragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });

    this.cubeData = this.createMeshData(new THREE.BoxGeometry(0.35, 0.35, 0.35));
    this.icoData = this.createMeshData(new THREE.IcosahedronGeometry(0.25, 1));
    this.icoData.mesh.visible = false;

    this.group.add(this.cubeData.mesh);
    this.group.add(this.icoData.mesh);
  }

  private createMeshData(geometry: THREE.BufferGeometry): MeshData {
    const phaseArr = new Float32Array(MAX_INSTANCES);
    const scaleArr = new Float32Array(MAX_INSTANCES);
    const colorArr = new Float32Array(MAX_INSTANCES * 3);
    const spawnArr = new Float32Array(MAX_INSTANCES);

    const mesh = new THREE.InstancedMesh(geometry, this.material, MAX_INSTANCES);
    mesh.count = 0;
    mesh.frustumCulled = false;

    mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArr, 1));
    mesh.geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scaleArr, 1));
    mesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colorArr, 3));
    mesh.geometry.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(spawnArr, 1));

    return { mesh, phase: phaseArr, scale: scaleArr, color: colorArr, spawn: spawnArr };
  }

  setPhase2Blend(blend: number): void {
    this.phase2Blend = blend;
    this.icoData.mesh.visible = blend > 0;
    this.cubeData.mesh.visible = blend < 1;
  }

  update(nodes: Map<string, NodeData>, time: number): void {
    this.uniforms.uTime.value = time;

    let cubeCount = 0;
    let icoCount = 0;

    for (const node of nodes.values()) {
      const useIco = this.phase2Blend > 0 && (
        node.maturity > this.maturityThreshold || this.phase2Blend >= 1
      );

      const spawnScale = node.spawnAnimation;
      const scale = node.scale * spawnScale;

      this.tempMatrix.makeTranslation(node.position.x, node.position.y, node.position.z);

      if (useIco && icoCount < MAX_INSTANCES) {
        const d = this.icoData;
        d.mesh.setMatrixAt(icoCount, this.tempMatrix);
        d.phase[icoCount] = node.phase;
        d.scale[icoCount] = scale;
        d.color[icoCount * 3] = node.color.r;
        d.color[icoCount * 3 + 1] = node.color.g;
        d.color[icoCount * 3 + 2] = node.color.b;
        d.spawn[icoCount] = spawnScale;
        icoCount++;
      } else if (cubeCount < MAX_INSTANCES) {
        const d = this.cubeData;
        d.mesh.setMatrixAt(cubeCount, this.tempMatrix);
        d.phase[cubeCount] = node.phase;
        d.scale[cubeCount] = scale;
        d.color[cubeCount * 3] = node.color.r;
        d.color[cubeCount * 3 + 1] = node.color.g;
        d.color[cubeCount * 3 + 2] = node.color.b;
        d.spawn[cubeCount] = spawnScale;
        cubeCount++;
      }
    }

    this.cubeData.mesh.count = cubeCount;
    this.icoData.mesh.count = icoCount;

    if (cubeCount > 0) {
      this.cubeData.mesh.instanceMatrix.needsUpdate = true;
      this.markNeedsUpdate(this.cubeData.mesh);
    }
    if (icoCount > 0) {
      this.icoData.mesh.instanceMatrix.needsUpdate = true;
      this.markNeedsUpdate(this.icoData.mesh);
    }
  }

  private markNeedsUpdate(mesh: THREE.InstancedMesh): void {
    (mesh.geometry.getAttribute('aPhase') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (mesh.geometry.getAttribute('aScale') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (mesh.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (mesh.geometry.getAttribute('aSpawn') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  // Raycast to find which node is under cursor
  raycast(raycaster: THREE.Raycaster, nodes: Map<string, NodeData>): NodeData | null {
    let closest: NodeData | null = null;
    let minDist = 0.6;

    for (const node of nodes.values()) {
      const dist = raycaster.ray.distanceToPoint(node.position);
      if (dist < minDist) {
        minDist = dist;
        closest = node;
      }
    }

    return closest;
  }
}
