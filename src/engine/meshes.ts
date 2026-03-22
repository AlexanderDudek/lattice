import * as THREE from 'three';
import { LatticeNode, VisualProfile } from './types';
import { nodeVertexShader, nodeFragmentShader, ringVertexShader, ringFragmentShader } from './shaders';

export function createNodeMesh(node: LatticeNode, group: THREE.Group, profile: VisualProfile): void {
  const geo = profile.nodeGeometry();
  const mat = new THREE.ShaderMaterial({
    vertexShader: nodeVertexShader,
    fragmentShader: nodeFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: node.color.clone() },
      uRipple: { value: 0 },
      uRipplePhase: { value: 0 },
      uEmissive: { value: 0.15 },
      uReadyGlow: { value: 0 },
      uEnergy: { value: 0 },
      uBounce: { value: 0 },
    },
    transparent: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(node.position);
  mesh.scale.setScalar(0.01);
  group.add(mesh);
  node.mesh = mesh;

  // Energy ring
  const ringPoints = 64;
  const ringRadius = profile.nodeScale * 1.5;
  const positions = new Float32Array(ringPoints * 3);
  const angles = new Float32Array(ringPoints);
  for (let i = 0; i < ringPoints; i++) {
    const a = (i / ringPoints) * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * ringRadius;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(a) * ringRadius;
    angles[i] = a;
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ringGeo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: ringVertexShader,
    fragmentShader: ringFragmentShader,
    uniforms: {
      uEnergy: { value: 0 },
      uColor: { value: node.color.clone() },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ringMesh = new THREE.Points(ringGeo, ringMat);
  ringMesh.position.copy(node.position);
  ringMesh.rotation.x = -Math.PI * 0.35;
  ringMesh.rotation.y = Math.PI * 0.25;
  group.add(ringMesh);
  node.ringMesh = ringMesh;
}

export function createEdgeLine(from: THREE.Vector3, to: THREE.Vector3, group: THREE.Group, style: string): THREE.Line {
  const points = [];
  const segments = style === 'sharp' ? 2 : 24;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = from.clone().lerp(to, t);
    if (style !== 'sharp') {
      const curve = style === 'thick' ? 0.15 : 0.08;
      p.y += Math.sin(t * Math.PI) * from.distanceTo(to) * curve;
    }
    points.push(p);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    linewidth: 1,
  });
  const line = new THREE.Line(geo, mat);
  group.add(line);
  return line;
}

export function createPacketMesh(color: THREE.Color, group: THREE.Group, size: number, geoFactory: () => THREE.BufferGeometry): THREE.Mesh {
  const geo = geoFactory();
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);
  return mesh;
}

export function createAttractorMesh(pos: THREE.Vector3, group: THREE.Group): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.15, 0.25, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xdaa520,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.rotation.x = -Math.PI * 0.35;
  mesh.rotation.y = Math.PI * 0.25;
  group.add(mesh);
  return mesh;
}
