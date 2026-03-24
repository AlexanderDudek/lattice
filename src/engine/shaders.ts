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

export const indicatorVertexShader = `
  attribute float aProgress; // 0-1 normalized position along the indicator
  varying float vProgress;
  uniform float uPointSize;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uEnergy;

  void main() {
    vProgress = aProgress;
    vec3 pos = position;

    // Animate: filled points pulse outward slightly
    float filled = step(aProgress, uEnergy);
    float pulse = sin(uTime * 3.0 * uSpeed + aProgress * 12.0) * 0.03 * filled;
    pos *= 1.0 + pulse;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Filled points are slightly larger
    gl_PointSize = uPointSize * (0.6 + filled * 0.6);
  }
`;

export const indicatorFragmentShader = `
  varying float vProgress;
  uniform float uEnergy;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uSegments;

  void main() {
    // Round point
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float seg = uSegments;
    // Which segment does this point belong to?
    float segIndex = floor(vProgress * seg);
    float segStart = segIndex / seg;
    float segEnd = (segIndex + 1.0) / seg;
    float segCenter = (segStart + segEnd) * 0.5;
    float withinSeg = (vProgress - segStart) / (segEnd - segStart);

    // Gap between segments: hide points near segment boundaries
    float gap = 0.2; // 20% of each segment is gap
    float inGap = step(1.0 - gap, withinSeg) + step(withinSeg, gap * 0.5);
    float segVisible = 1.0 - min(1.0, inGap);

    // How many segments are filled? One per tap.
    float filledCount = floor(uEnergy * seg + 0.01);
    float isFilled = step(segIndex, filledCount - 0.5);

    // The currently-filling segment gets partial brightness
    float isPartial = step(filledCount - 0.5, segIndex) * step(segIndex, filledCount + 0.5);
    float partialFill = fract(uEnergy * seg);

    float brightness = isFilled + isPartial * partialFill * 0.5;

    float pulse = sin(uTime * 3.0 * uSpeed + segIndex * 1.5) * 0.12 + 0.88;

    vec3 color = uColor * brightness * pulse * segVisible;
    color += uColor * (1.0 - brightness) * 0.04 * segVisible;
    float alpha = brightness * (0.9 * smoothstep(0.5, 0.2, d)) * segVisible
                + (1.0 - brightness) * 0.1 * segVisible;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;
