// Custom shader chunks for LATTICE

export const breathingVertexShader = `
  attribute float aPhase;
  attribute float aScale;
  attribute vec3 aColor;
  attribute float aSpawn;

  varying vec3 vColor;
  varying float vSpawn;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  uniform float uTime;
  uniform float uBreathingAmplitude;

  void main() {
    vColor = aColor;
    vSpawn = aSpawn;
    vNormal = normalMatrix * normal;

    // Breathing displacement
    float breath = sin(uTime * 1.5 + aPhase) * uBreathingAmplitude;
    vec3 displaced = position * aScale * (1.0 + breath) * aSpawn;

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(displaced, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const breathingFragmentShader = `
  varying vec3 vColor;
  varying float vSpawn;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  uniform float uTime;
  uniform float uEmissiveIntensity;

  void main() {
    // Basic lighting
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    // Fresnel-like rim glow
    float rim = 1.0 - max(0.0, dot(normal, viewDir));
    rim = pow(rim, 2.0);

    // Base color with emissive
    vec3 color = vColor * (0.4 + 0.6 * max(0.0, dot(normal, vec3(0.3, 0.7, 0.4))));
    color += vColor * rim * 0.5;
    color += vColor * uEmissiveIntensity;

    // Spawn fade-in
    float alpha = smoothstep(0.0, 0.3, vSpawn);

    gl_FragColor = vec4(color, alpha);
  }
`;

export const edgeVertexShader = `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aTraffic;
  attribute float aPulse;

  varying float vTraffic;
  varying float vPulse;
  varying float vProgress;

  uniform float uTime;

  void main() {
    float t = position.x; // 0 to 1 along the edge
    vProgress = t;
    vTraffic = aTraffic;
    vPulse = aPulse;

    vec3 pos = mix(aStart, aEnd, t);

    // Edge bundling: slight curve toward midpoint raised
    vec3 mid = (aStart + aEnd) * 0.5;
    mid.y += length(aEnd - aStart) * 0.1;
    vec3 curved = mix(mix(aStart, mid, t), mix(mid, aEnd, t), t);
    pos = mix(pos, curved, aTraffic * 0.5); // more traffic = more curve

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const edgeFragmentShader = `
  varying float vTraffic;
  varying float vPulse;
  varying float vProgress;

  uniform float uTime;
  uniform vec3 uBaseColor;

  void main() {
    // Traveling light pulse
    float pulse = sin((vProgress - uTime * 0.5 + vPulse) * 6.28318) * 0.5 + 0.5;
    pulse = pow(pulse, 4.0);

    // Base alpha from traffic
    float baseAlpha = 0.15 + vTraffic * 0.4;

    // Pulse adds brightness
    vec3 color = uBaseColor * (1.0 + pulse * 0.8);
    float alpha = baseAlpha + pulse * 0.3;

    // Fade at ends
    float edgeFade = smoothstep(0.0, 0.1, vProgress) * smoothstep(1.0, 0.9, vProgress);
    alpha *= edgeFade;

    gl_FragColor = vec4(color, alpha);
  }
`;

// Confabulation glitch shader
export const confabVertexOffset = `
  float glitch = sin(uTime * 10.0 + aPhase * 3.0) * step(0.95, sin(uTime * 2.3 + aPhase));
  displaced += normal * glitch * 0.1;
`;
