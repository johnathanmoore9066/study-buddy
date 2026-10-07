// Value noise and fBm shared by every procedural surface. Inputs stay within a
// few hundred units so the hash keeps enough float precision on mobile GPUs.
const NOISE = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 cell = floor(p);
  vec3 local = fract(p);
  vec3 curve = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(
      mix(hash31(cell), hash31(cell + vec3(1.0, 0.0, 0.0)), curve.x),
      mix(hash31(cell + vec3(0.0, 1.0, 0.0)), hash31(cell + vec3(1.0, 1.0, 0.0)), curve.x),
      curve.y
    ),
    mix(
      mix(hash31(cell + vec3(0.0, 0.0, 1.0)), hash31(cell + vec3(1.0, 0.0, 1.0)), curve.x),
      mix(hash31(cell + vec3(0.0, 1.0, 1.0)), hash31(cell + vec3(1.0, 1.0, 1.0)), curve.x),
      curve.y
    ),
    curve.z
  );
}

float fbm(vec3 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    total += amplitude * noise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.4);
    amplitude *= 0.5;
  }
  return total;
}
`;

export const PLANET_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;

void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const PLANET_FRAGMENT = /* glsl */ `
uniform vec3 uStar;
uniform vec3 uBase;
uniform vec3 uShade;
uniform vec3 uGlow;
uniform float uSeed;
uniform float uBands;
uniform float uLight;
uniform float uMute;
uniform float uHover;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;

${NOISE}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 toStar = normalize(uStar - vWorld);
  vec3 toEye = normalize(cameraPosition - vWorld);
  vec3 p = normalize(vLocal);

  float grain = fbm(p * 2.4 + uSeed);
  float band = 0.5 + 0.5 * sin(p.y * 11.0 + grain * 4.2 + uSeed * 3.0);
  float pattern = mix(smoothstep(0.36, 0.74, grain), band, uBands);
  vec3 surface = mix(uShade, uBase, pattern);
  surface = mix(surface, vec3(dot(surface, vec3(0.299, 0.587, 0.114))), uMute);

  float facing = dot(normal, toStar);
  float day = smoothstep(-0.12, 0.45, facing);
  vec3 color = surface * (0.035 + day * uLight);

  float rim = pow(1.0 - max(dot(normal, toEye), 0.0), 2.6);
  float rimDay = smoothstep(-0.4, 0.5, facing);
  color += uGlow * rim * (0.16 + rimDay * 0.8) * (0.55 + uHover * 0.9) * max(uLight, 0.3);

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export const STAR_VERTEX = /* glsl */ `
varying vec3 vLocal;
varying vec3 vViewNormal;

void main() {
  vLocal = position;
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const STAR_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;

varying vec3 vLocal;
varying vec3 vViewNormal;

${NOISE}

void main() {
  vec3 p = normalize(vLocal);
  float cells = fbm(p * 4.0 + vec3(0.0, uTime * 0.02, 0.0));
  float fine = fbm(p * 11.0 - vec3(uTime * 0.03));
  float heat = clamp(cells * 0.75 + fine * 0.45, 0.0, 1.0);
  float facing = clamp(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
  float limb = 0.4 + 0.6 * pow(facing, 0.5);
  vec3 core = mix(uColor, vec3(1.0, 0.98, 0.94), 0.6);
  vec3 color = mix(uColor * 0.75, core * 1.3, heat) * limb;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export const RING_VERTEX = /* glsl */ `
varying vec2 vLocal;

void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uInner;
uniform float uOuter;
uniform float uSeed;
uniform float uOpacity;

varying vec2 vLocal;

void main() {
  float t = (length(vLocal) - uInner) / (uOuter - uInner);
  float bands = 0.55 + 0.45 * sin(t * 41.0 + uSeed) * sin(t * 13.0 + uSeed * 2.0);
  float edge = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.82, t);
  gl_FragColor = vec4(uColor, bands * edge * uOpacity);
  #include <colorspace_fragment>
}
`;

export const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;

void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Baked once into a cube map: a faint galactic band with dust lanes and two
// emission-nebula tints taken from narrowband astrophotography (OIII, H-alpha).
export const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uBandNormal;

varying vec3 vDirection;

${NOISE}

void main() {
  vec3 d = normalize(vDirection);
  float latitude = dot(d, uBandNormal);
  float clouds = fbm(d * 3.1);
  float detail = fbm(d * 8.5 + 4.0);
  float band = exp(-pow(latitude / (0.17 + clouds * 0.14), 2.0));
  float lanes = smoothstep(0.46, 0.74, fbm(d * 5.5 + 11.0)) * exp(-pow(latitude / 0.06, 2.0));

  vec3 warm = vec3(0.040, 0.028, 0.019);
  vec3 cool = vec3(0.013, 0.017, 0.027);
  vec3 color = mix(cool, warm, clouds) * band * (0.5 + detail * 0.7);
  color *= 1.0 - lanes * 0.8;

  float oxygen = smoothstep(0.6, 0.86, fbm(d * 2.2 + 21.0));
  float hydrogen = smoothstep(0.62, 0.9, fbm(d * 2.6 + 37.0));
  color += vec3(0.005, 0.019, 0.021) * oxygen;
  color += vec3(0.019, 0.006, 0.007) * hydrogen;
  color += vec3(0.0012, 0.0014, 0.0022);

  gl_FragColor = vec4(color, 1.0);
}
`;

export const STARFIELD_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aSpike;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vSpike;

void main() {
  vColor = aColor;
  vSpike = aSpike;
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const STARFIELD_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vSpike;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float alpha = pow(max(1.0 - d, 0.0), 2.4);
  if (vSpike > 0.5) {
    float cross = max(exp(-abs(uv.x) * 70.0), exp(-abs(uv.y) * 70.0));
    alpha = pow(max(1.0 - d * 2.6, 0.0), 2.0) + cross * pow(max(1.0 - d, 0.0), 1.4) * 0.8;
  }
  gl_FragColor = vec4(vColor, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;
