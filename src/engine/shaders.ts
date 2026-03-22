export const nodeVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vPos;

  uniform float uTime;
  uniform float uRipple;
  uniform float uRipplePhase;
  uniform float uReadyGlow;
  uniform float uBounce;

  void main() {
    vNormal = normalMatrix * normal;
    vPos = position;
    float rippleWave = sin(length(position.xz) * 15.0 - uRipplePhase * 10.0) * 0.5 + 0.5;
    float rippleDisplace = rippleWave * uRipple * 0.12;
    float readyPulse = sin(uTime * 4.0) * 0.04 * uReadyGlow;
    float bounce = 1.0 + uBounce * 0.4;
    vec3 displaced = position * bounce * (1.0 + rippleDisplace + readyPulse);
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const nodeFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vPos;

  uniform vec3 uColor;
  uniform float uRipple;
  uniform float uRipplePhase;
  uniform float uEmissive;
  uniform float uReadyGlow;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uBounce;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float rim = 1.0 - max(0.0, dot(normal, viewDir));
    rim = pow(rim, 2.0);

    float rippleWave = sin(length(vPos.xz) * 15.0 - uRipplePhase * 10.0) * 0.5 + 0.5;
    float rippleGlow = rippleWave * uRipple;

    vec3 color = uColor * (0.25 + 0.75 * max(0.0, dot(normal, normalize(vec3(0.3, 0.8, 0.4)))));
    color += uColor * rim * (0.4 + uEnergy * 0.8);
    color += uColor * uEmissive * 0.5;
    color += vec3(1.0) * rippleGlow * 2.0;
    color += vec3(1.0) * uBounce * 0.8;

    float readyPulse = sin(uTime * 4.0) * 0.3 + 0.7;
    color += vec3(1.0, 0.85, 0.3) * uReadyGlow * readyPulse * 0.8;
    color *= (0.6 + uEnergy * 0.6);

    gl_FragColor = vec4(color, 0.95);
  }
`;

export const ringVertexShader = `
  attribute float aAngle;
  varying float vAngle;

  void main() {
    vAngle = aAngle;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = 2.5;
  }
`;

export const ringFragmentShader = `
  varying float vAngle;
  uniform float uEnergy;
  uniform vec3 uColor;
  uniform float uTime;

  void main() {
    float fill = step(vAngle, uEnergy * 6.2832);
    float pulse = sin(uTime * 3.0 + vAngle * 2.0) * 0.15 + 0.85;
    vec3 color = uColor * fill * pulse;
    color += uColor * (1.0 - fill) * 0.08;
    float alpha = fill * 0.9 + (1.0 - fill) * 0.15;
    gl_FragColor = vec4(color, alpha);
  }
`;
