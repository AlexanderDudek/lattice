import * as THREE from 'three';
import { LatticeNode, VisualProfile } from './types';
import { nodeVertexShader, nodeFragmentShader, indicatorVertexShader, indicatorFragmentShader } from './shaders';

/** Generate indicator point positions + progress for each style */
function buildIndicatorGeometry(style: string, r: number): { positions: Float32Array; progress: Float32Array } {
  const pts: number[] = [];
  const prog: number[] = [];

  switch (style) {
    case 'orbit': {
      // 3 tilted orbital rings — like an atom
      const n = 32;
      const tilts = [
        { ax: 0, az: 0 },                   // XZ plane
        { ax: Math.PI * 0.4, az: 0.3 },     // tilted ring 2
        { ax: -Math.PI * 0.3, az: -0.5 },   // tilted ring 3
      ];
      for (const tilt of tilts) {
        const cx = Math.cos(tilt.ax);
        const sx = Math.sin(tilt.ax);
        const cz = Math.cos(tilt.az);
        const sz = Math.sin(tilt.az);
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const a = t * Math.PI * 2;
          let x = Math.cos(a) * r;
          let y = 0;
          let z = Math.sin(a) * r;
          // Rotate around X then Z
          const y1 = y * cx - z * sx;
          const z1 = y * sx + z * cx;
          const x2 = x * cz - y1 * sz;
          const y2 = x * sz + y1 * cz;
          pts.push(x2, y2, z1);
          prog.push(t);
        }
      }
      break;
    }
    case 'column': {
      // Vertical column of points — energy fills bottom to top
      const n = 48;
      const height = r * 3;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const y = -height / 2 + t * height;
        // Slight random scatter on x/z for thickness
        const scatter = r * 0.25;
        const angle = (i * 137.508) * Math.PI / 180; // golden angle scatter
        const sr = scatter * (0.5 + 0.5 * Math.sin(i * 2.3));
        pts.push(Math.cos(angle) * sr, y, Math.sin(angle) * sr);
        prog.push(t);
      }
      break;
    }
    case 'bars': {
      // 6 radial bars pointing outward — like a compass rose
      const numBars = 6;
      const ptsPerBar = 10;
      for (let b = 0; b < numBars; b++) {
        const angle = (b / numBars) * Math.PI * 2;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        for (let i = 0; i < ptsPerBar; i++) {
          const t = i / (ptsPerBar - 1);
          const dist = r * 0.6 + t * r * 1.0;
          pts.push(dx * dist, 0, dz * dist);
          prog.push(t);
        }
      }
      break;
    }
    case 'helix': {
      // Double helix — DNA-like spiral
      const n = 48;
      const turns = 2;
      const height = r * 2.5;
      for (let strand = 0; strand < 2; strand++) {
        const offset = strand * Math.PI;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const a = t * Math.PI * 2 * turns + offset;
          const y = -height / 2 + t * height;
          pts.push(Math.cos(a) * r * 0.7, y, Math.sin(a) * r * 0.7);
          prog.push(t);
        }
      }
      break;
    }
    case 'axes': {
      // 3 perpendicular axes (x, y, z) — fill along each
      const ptsPerAxis = 16;
      const axes = [
        [1, 0, 0], [0, 1, 0], [0, 0, 1],
        [-1, 0, 0], [0, -1, 0], [0, 0, -1],
      ];
      for (const [ax, ay, az] of axes) {
        for (let i = 0; i < ptsPerAxis; i++) {
          const t = i / (ptsPerAxis - 1);
          const dist = r * 0.3 + t * r * 1.3;
          pts.push(ax * dist, ay * dist, az * dist);
          prog.push(t);
        }
      }
      break;
    }
    case 'cloud': {
      // Spherical cloud of points — fills inward to outward
      const n = 64;
      for (let i = 0; i < n; i++) {
        // Fibonacci sphere distribution
        const t = i / (n - 1);
        const y = 1 - 2 * t;
        const rSlice = Math.sqrt(1 - y * y);
        const phi = i * 2.39996323; // golden angle
        const dist = r * (0.5 + t * 1.0);
        pts.push(
          Math.cos(phi) * rSlice * dist,
          y * dist,
          Math.sin(phi) * rSlice * dist
        );
        prog.push(t);
      }
      break;
    }
    default: {
      // ring — classic flat circle (original behavior)
      const n = 64;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const a = t * Math.PI * 2;
        pts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
        prog.push(t);
      }
      break;
    }
  }

  return {
    positions: new Float32Array(pts),
    progress: new Float32Array(prog),
  };
}

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
      uGlobalIntensity: { value: 1.0 },
    },
    transparent: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(node.position);
  mesh.scale.setScalar(0.01);
  group.add(mesh);
  node.mesh = mesh;

  // Energy indicator — fundamentally different geometry per morphology
  const style = profile.indicator ?? 'ring';
  const r = profile.nodeScale * 1.6;
  const { positions: indPos, progress: indProg } = buildIndicatorGeometry(style, r);

  const indGeo = new THREE.BufferGeometry();
  indGeo.setAttribute('position', new THREE.BufferAttribute(indPos, 3));
  indGeo.setAttribute('aProgress', new THREE.BufferAttribute(indProg, 1));
  const indMat = new THREE.ShaderMaterial({
    vertexShader: indicatorVertexShader,
    fragmentShader: indicatorFragmentShader,
    uniforms: {
      uEnergy: { value: 0 },
      uColor: { value: node.color.clone() },
      uTime: { value: 0 },
      uPointSize: { value: profile.indicatorPointSize ?? 2.5 },
      uSpeed: { value: profile.indicatorSpeed ?? 1.0 },
      uSegments: { value: 4 }, // updated per-frame from node.splitCost
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ringMesh = new THREE.Points(indGeo, indMat);
  ringMesh.position.copy(node.position);
  // Only tilt ring-style indicators to match iso camera
  if (style === 'ring' || style === 'orbit') {
    ringMesh.rotation.x = -Math.PI * 0.35;
    ringMesh.rotation.y = Math.PI * 0.25;
  }
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
