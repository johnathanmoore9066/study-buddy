import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import {
  PLANET_FRAGMENT,
  PLANET_VERTEX,
  RING_FRAGMENT,
  RING_VERTEX,
  SKY_FRAGMENT,
  SKY_VERTEX,
  STARFIELD_FRAGMENT,
  STARFIELD_VERTEX,
  STAR_FRAGMENT,
  STAR_VERTEX,
} from "@/components/universe-shaders";
import { STATUS_COLORS, statusLabel } from "@/lib/concepts";
import {
  seeded,
  type Cosmos,
  type MoonBody,
  type PlanetBody,
  type StarSystem,
} from "@/lib/cosmos";
import type { ConceptEdge, ConceptNode, ConceptStatus } from "@/lib/types";

export type CosmosPick =
  | { kind: "body"; id: string }
  | { kind: "system"; key: string };

type Focus = CosmosPick | { kind: "overview" } | { kind: "free" };

type LabelSide = "left" | "right" | "below";

interface LabelHandle {
  object: CSS2DObject;
  element: HTMLButtonElement;
  name: HTMLSpanElement;
  meta: HTMLSpanElement;
  radiusPx: number;
  side: LabelSide;
  textWidth: number;
}

interface LabelCandidate {
  label: LabelHandle;
  world: THREE.Vector3;
  parent: THREE.Vector3 | null;
  radius: number;
  distance: number;
  rank: number;
  pinned: boolean;
}

interface BodyHandle {
  id: string;
  kind: "planet" | "moon";
  systemKey: string;
  hostId?: string;
  status: ConceptStatus;
  size: number;
  extent: number;
  phase: number;
  period: number;
  pivot: THREE.Object3D;
  anchor: THREE.Object3D;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  label: LabelHandle;
  world: THREE.Vector3;
  born: number | null;
}

interface SystemHandle {
  key: string;
  center: THREE.Vector3;
  radius: number;
  starRadius: number;
  starMaterial: THREE.ShaderMaterial;
  label: LabelHandle;
  inside: boolean;
}

interface Flight {
  start: number;
  duration: number;
  fromTarget: THREE.Vector3;
  fromDirection: THREE.Vector3;
  fromDistance: number;
  toDirection: THREE.Vector3;
  toDistance: number;
  fromShift: THREE.Vector2;
  toShift: THREE.Vector2;
}

interface Arc {
  line: Line2;
  geometry: LineGeometry;
  material: LineMaterial;
  otherId: string;
  points: THREE.Vector3[];
}

const TAU = Math.PI * 2;
const LINE_TINT = "#e9dfc8";
const UP = new THREE.Vector3(0, 1, 0);
const ARC_SEGMENTS = 40;
const BAND_NORMAL = new THREE.Vector3(0.75, 0.35, 0.55).normalize();

const SURFACES: Record<
  ConceptStatus,
  {
    base: string;
    shade: string;
    glow: string;
    light: number;
    mute: number;
    trail: number;
    trailWidth: number;
  }
> = {
  learning: {
    base: STATUS_COLORS.learning,
    shade: "#5c2c12",
    glow: "#ffd3a3",
    light: 1,
    mute: 0,
    trail: 0.95,
    trailWidth: 2.4,
  },
  mastered: {
    base: STATUS_COLORS.mastered,
    shade: "#123f3a",
    glow: "#bdfff1",
    light: 1,
    mute: 0,
    trail: 0.7,
    trailWidth: 2,
  },
  suggested: {
    base: STATUS_COLORS.suggested,
    shade: "#23324a",
    glow: "#d9e7ff",
    light: 0.78,
    mute: 0.12,
    trail: 0.5,
    trailWidth: 1.6,
  },
  locked: {
    base: "#4b515d",
    shade: "#16191f",
    glow: "#7f889a",
    light: 0.3,
    mute: 0.55,
    trail: 0,
    trailWidth: 0,
  },
};

function pickKey(pick: CosmosPick) {
  return pick.kind === "body" ? `body:${pick.id}` : `system:${pick.key}`;
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t: number) {
  return 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
}

function directionFrom(azimuth: number, elevation: number) {
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  );
}

function circlePoints(radius: number, segments: number) {
  const points: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * TAU;
    points.push(Math.cos(angle) * radius, 0, -Math.sin(angle) * radius);
  }
  return points;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeGlowTexture() {
  return canvasTexture(128, (context, size) => {
    const half = size / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.14, "rgba(255,255,255,0.55)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.13)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}

// Four-vane diffraction spikes, the way a reflecting telescope renders a star.
function makeSpikeTexture() {
  return canvasTexture(256, (context, size) => {
    const half = size / 2;
    const spike = (angle: number, length: number, width: number, alpha: number) => {
      context.save();
      context.translate(half, half);
      context.rotate(angle);
      const gradient = context.createLinearGradient(-length, 0, length, 0);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(-length, 0);
      context.lineTo(0, -width);
      context.lineTo(length, 0);
      context.lineTo(0, width);
      context.closePath();
      context.fill();
      context.restore();
    };
    spike(0, half, 2.4, 0.95);
    spike(Math.PI / 2, half, 2.4, 0.95);
    spike(Math.PI / 4, half * 0.5, 1.2, 0.3);
    spike(-Math.PI / 4, half * 0.5, 1.2, 0.3);
  });
}

// A finder circle: one thin ring with four short ticks outside it.
function makeReticleTexture() {
  return canvasTexture(256, (context, size) => {
    const half = size / 2;
    const radius = size * 0.4;
    context.strokeStyle = "rgba(255,255,255,0.95)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(half, half, radius, 0, TAU);
    context.stroke();
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * TAU;
      context.beginPath();
      context.moveTo(half + Math.cos(angle) * (radius + 8), half + Math.sin(angle) * (radius + 8));
      context.lineTo(half + Math.cos(angle) * (radius + 24), half + Math.sin(angle) * (radius + 24));
      context.stroke();
    }
  });
}

function makeStarfield(pixelRatio: number) {
  const count = 5200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const spikes = new Float32Array(count);
  const temperatures = [
    "#9db4ff",
    "#c4d4ff",
    "#f3f1ff",
    "#fff4ea",
    "#fff1d6",
    "#ffd8a8",
    "#ffbf80",
  ].map((hex) => new THREE.Color(hex));
  const random = mulberry32(417);
  const point = new THREE.Vector3();

  for (let index = 0; index < count; index += 1) {
    const z = random() * 2 - 1;
    const theta = random() * TAU;
    const ring = Math.sqrt(1 - z * z);
    point.set(ring * Math.cos(theta), z, ring * Math.sin(theta));
    if (random() < 0.38) {
      point
        .addScaledVector(BAND_NORMAL, -point.dot(BAND_NORMAL) * (0.72 + random() * 0.24))
        .normalize();
    }
    point.multiplyScalar(900);
    positions.set([point.x, point.y, point.z], index * 3);

    const magnitude = Math.pow(random(), 7);
    const spiked = magnitude > 0.5 && random() < 0.45;
    sizes[index] = spiked ? 10 + magnitude * 10 : 1.1 + magnitude * 3.4;
    spikes[index] = spiked ? 1 : 0;
    const tint = temperatures[
      Math.min(temperatures.length - 1, Math.floor(Math.pow(random(), 0.9) * temperatures.length))
    ];
    const brightness = 0.32 + magnitude * 0.85 + random() * 0.18;
    colors.set([tint.r * brightness, tint.g * brightness, tint.b * brightness], index * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aSpike", new THREE.BufferAttribute(spikes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: pixelRatio } },
    vertexShader: STARFIELD_VERTEX,
    fragmentShader: STARFIELD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}

/**
 * Owns the WebGL scene for the learning universe. React hands it data and the
 * current selection; it reports picks back and handles all camera travel.
 */
export class CosmosEngine {
  private readonly mount: HTMLDivElement;
  private readonly onPick: (pick: CosmosPick) => void;
  private readonly reduceMotion: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly content = new THREE.Group();
  private readonly sphere = new THREE.SphereGeometry(1, 48, 32);
  private readonly hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private readonly glowTexture = makeGlowTexture();
  private readonly spikeTexture = makeSpikeTexture();
  private readonly reticleTexture = makeReticleTexture();
  private readonly reticle: THREE.Sprite;
  private readonly halo: THREE.Sprite;
  private readonly starfield: THREE.Points;
  private readonly skyTarget: THREE.WebGLCubeRenderTarget;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private readonly startedAt = performance.now();
  private readonly lastFocusPoint = new THREE.Vector3();
  private readonly scratchPoint = new THREE.Vector3();
  private readonly scratchDelta = new THREE.Vector3();
  private readonly targetBefore = new THREE.Vector3();
  private readonly arcMiddle = new THREE.Vector3();
  private readonly labelAnchor = new THREE.Vector3();
  private readonly labelParent = new THREE.Vector3();
  private readonly viewShift = new THREE.Vector2();

  private owned: Array<{ dispose(): void }> = [];
  private arcs: Arc[] = [];
  private labelElements: HTMLElement[] = [];
  private hitTargets: THREE.Object3D[] = [];
  private systems = new Map<string, SystemHandle>();
  private bodies = new Map<string, BodyHandle>();
  private links: ConceptEdge[] = [];
  private learning: BodyHandle | null = null;
  private galaxyCenter = new THREE.Vector3();
  private galaxyRadius = 30;
  private selection: CosmosPick | null = null;
  private focus: Focus = { kind: "overview" };
  private flight: Flight | null = null;
  private hovered: string | null = null;
  private pointerInside = false;
  private pointerDirty = false;
  private pressStart: { x: number; y: number } | null = null;
  private framed = false;
  private frame = 0;
  private introTimer = 0;
  private occluders: Array<[number, number, number, number]> = [];
  private occludersAge = Infinity;

  constructor(mount: HTMLDivElement, onPick: (pick: CosmosPick) => void) {
    this.mount = mount;
    this.onPick = onPick;
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { width, height } = this.viewport();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = this.renderer.domElement;
    canvas.className = "cosmos-canvas";
    canvas.setAttribute("role", "img");
    mount.appendChild(canvas);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(width, height);
    this.labelRenderer.domElement.className = "cosmos-labels";
    mount.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.03, 2400);
    this.camera.position.set(0, 70, 120);
    this.viewShift.copy(this.shiftFor(this.focus));
    this.applyViewOffset(width, height);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 1.1;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 520;
    this.controls.addEventListener("start", this.handleControlStart);

    this.skyTarget = this.bakeSky();
    this.scene.background = this.skyTarget.texture;
    this.starfield = makeStarfield(this.renderer.getPixelRatio());
    this.scene.add(this.starfield, this.content);

    this.reticle = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.reticleTexture,
        color: new THREE.Color("#fff1dc"),
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.reticle.renderOrder = 10;
    this.reticle.visible = false;
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: new THREE.Color(STATUS_COLORS.learning),
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.halo.visible = false;
    this.scene.add(this.reticle, this.halo);

    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(mount);
    this.loop();
  }

  setContent(cosmos: Cosmos, nodes: ConceptNode[], links: ConceptEdge[]) {
    const previous = new Set(Array.from(this.bodies.keys()));
    const announceNew = this.bodies.size > 0 && !this.reduceMotion;
    this.clearContent();
    this.links = links;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    cosmos.systems.forEach((system) => this.buildSystem(system, nodeById));
    this.buildRoutes(cosmos);
    this.measureGalaxy(cosmos);

    const now = performance.now();
    this.learning = null;
    this.bodies.forEach((body) => {
      if (body.status === "learning") this.learning = body;
      if (announceNew && !previous.has(body.id)) body.born = now;
    });
    this.updateOrbits(now);

    const mastered = nodes.filter((node) => node.status === "mastered").length;
    this.renderer.domElement.setAttribute(
      "aria-label",
      nodes.length
        ? `Learning universe: ${cosmos.systems.length} star systems, ${nodes.length} concepts, ${mastered} mastered`
        : "Learning universe: no concepts charted yet",
    );

    if (!this.framed) this.placeAt({ kind: "overview" });
    this.refreshSelection();
  }

  setSelection(selection: CosmosPick | null) {
    this.selection = selection;
    this.refreshSelection();
    if (!selection || !this.exists(selection)) return;
    if (!this.framed) {
      this.framed = true;
      if (this.reduceMotion) {
        this.placeAt(selection);
      } else {
        // Open on the whole sky, then travel to where the learner is working.
        this.placeAt({ kind: "overview" });
        this.introTimer = window.setTimeout(() => this.flyTo(selection), 450);
      }
      return;
    }
    if (!this.isFocused(selection)) this.flyTo(selection);
  }

  flyTo(focus: CosmosPick | { kind: "overview" }) {
    const point = new THREE.Vector3();
    if (!this.focusPoint(focus, point)) return;
    window.clearTimeout(this.introTimer);
    if (this.reduceMotion) {
      this.placeAt(focus);
      return;
    }
    const { distance, direction } = this.framing(focus, point);
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const travel = this.controls.target.distanceTo(point);
    this.focus = focus;
    this.lastFocusPoint.copy(point);
    this.flight = {
      start: performance.now(),
      duration: THREE.MathUtils.clamp(
        900 + travel * 8 + Math.abs(Math.log(offset.length() / distance)) * 260,
        900,
        2200,
      ),
      fromTarget: this.controls.target.clone(),
      fromDirection: offset.clone().normalize(),
      fromDistance: offset.length(),
      toDirection: direction,
      toDistance: distance,
      fromShift: this.viewShift.clone(),
      toShift: this.shiftFor(focus),
    };
  }

  dispose() {
    window.cancelAnimationFrame(this.frame);
    window.clearTimeout(this.introTimer);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.controls.removeEventListener("start", this.handleControlStart);
    this.controls.dispose();
    this.clearContent();
    this.sphere.dispose();
    this.hitMaterial.dispose();
    this.glowTexture.dispose();
    this.spikeTexture.dispose();
    this.reticleTexture.dispose();
    this.reticle.material.dispose();
    this.halo.material.dispose();
    this.starfield.geometry.dispose();
    (this.starfield.material as THREE.Material).dispose();
    this.skyTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.labelRenderer.domElement.remove();
  }

  private own<T extends { dispose(): void }>(resource: T) {
    this.owned.push(resource);
    return resource;
  }

  private viewport() {
    return {
      width: Math.max(this.mount.clientWidth, 1),
      height: Math.max(this.mount.clientHeight, 1),
    };
  }

  private bakeSky() {
    const target = new THREE.WebGLCubeRenderTarget(512);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const skyScene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(10, 64, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: { uBandNormal: { value: BAND_NORMAL } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
    });
    skyScene.add(new THREE.Mesh(geometry, material));
    new THREE.CubeCamera(0.1, 100, target).update(this.renderer, skyScene);
    geometry.dispose();
    material.dispose();
    return target;
  }

  private clearContent() {
    this.content.clear();
    this.owned.forEach((resource) => resource.dispose());
    this.owned = [];
    this.labelElements.forEach((element) => element.remove());
    this.labelElements = [];
    this.clearArcs();
    this.hitTargets = [];
    this.systems.clear();
    this.bodies.clear();
    this.learning = null;
    this.hovered = null;
    this.renderer.domElement.style.cursor = "";
  }

  private sprite(map: THREE.Texture, color: THREE.Color, opacity: number, scale: number) {
    const sprite = new THREE.Sprite(
      this.own(
        new THREE.SpriteMaterial({
          map,
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    sprite.scale.setScalar(scale);
    return sprite;
  }

  private orbitLine(
    radius: number,
    options: { opacity: number; width: number; dashed?: boolean; segments?: number },
  ) {
    const geometry = this.own(new LineGeometry());
    geometry.setPositions(circlePoints(radius, options.segments ?? 160));
    const material = this.own(
      new LineMaterial({
        color: LINE_TINT,
        linewidth: options.width,
        transparent: true,
        opacity: options.opacity,
        depthWrite: false,
        dashed: Boolean(options.dashed),
        dashSize: 0.32,
        gapSize: 0.5,
      }),
    );
    const line = new Line2(geometry, material);
    if (options.dashed) line.computeLineDistances();
    return line;
  }

  // A fading arc behind each charted planet, in the colour of its status.
  private trail(radius: number, status: ConceptStatus) {
    const surface = SURFACES[status];
    const color = new THREE.Color(STATUS_COLORS[status]);
    const segments = 48;
    const length = 0.95;
    const positions: number[] = [];
    const colors: number[] = [];
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const angle = -length + t * length;
      positions.push(Math.cos(angle) * radius, 0, -Math.sin(angle) * radius);
      const fade = t * t;
      colors.push(color.r * fade, color.g * fade, color.b * fade);
    }
    const geometry = this.own(new LineGeometry());
    geometry.setPositions(positions);
    geometry.setColors(colors);
    const material = this.own(
      new LineMaterial({
        vertexColors: true,
        linewidth: surface.trailWidth,
        transparent: true,
        opacity: surface.trail,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    return new Line2(geometry, material);
  }

  private planetMaterial(node: ConceptNode, star: THREE.Vector3, bands: number) {
    const surface = SURFACES[node.status];
    const base = new THREE.Color(surface.base).offsetHSL(
      (seeded(`${node.id}:hue`) - 0.5) * 0.06,
      (seeded(`${node.id}:saturation`) - 0.5) * 0.12,
      (seeded(`${node.id}:lightness`) - 0.5) * 0.1,
    );
    return this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uStar: { value: star.clone() },
          uBase: { value: base },
          uShade: { value: new THREE.Color(surface.shade) },
          uGlow: { value: new THREE.Color(surface.glow) },
          uSeed: { value: seeded(`${node.id}:seed`) * 40 },
          uBands: { value: bands },
          uLight: { value: surface.light },
          uMute: { value: surface.mute },
          uHover: { value: 0 },
        },
        vertexShader: PLANET_VERTEX,
        fragmentShader: PLANET_FRAGMENT,
      }),
    );
  }

  private planetRing(planet: PlanetBody, node: ConceptNode) {
    const inner = planet.size * 1.35;
    const outer = planet.size * 2.25;
    const geometry = this.own(new THREE.RingGeometry(inner, outer, 96, 1));
    const color = new THREE.Color(SURFACES[node.status].base).lerp(
      new THREE.Color(LINE_TINT),
      0.45,
    );
    const material = this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: color },
          uInner: { value: inner },
          uOuter: { value: outer },
          uSeed: { value: seeded(`${node.id}:ring-seed`) * 20 },
          uOpacity: { value: node.status === "locked" ? 0.2 : 0.55 },
        },
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2 + (seeded(`${node.id}:ring-tilt`) - 0.5) * 0.9;
    ring.rotation.y = (seeded(`${node.id}:ring-spin`) - 0.5) * 0.6;
    return ring;
  }

  private hitArea(scale: number, pick: CosmosPick) {
    const hit = new THREE.Mesh(this.sphere, this.hitMaterial);
    hit.scale.setScalar(scale);
    hit.userData.pick = pick;
    this.hitTargets.push(hit);
    return hit;
  }

  private makeLabel(options: {
    kind: "star" | "planet" | "moon";
    text: string;
    meta: string;
    ariaLabel: string;
    pick: CosmosPick;
    status?: ConceptStatus;
  }): LabelHandle {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `body-label body-label--${options.kind}`;
    if (options.status) element.dataset.status = options.status;
    element.setAttribute("aria-label", options.ariaLabel);
    const name = document.createElement("span");
    name.className = "body-label__name";
    name.textContent = options.text;
    const meta = document.createElement("span");
    meta.className = "body-label__meta";
    meta.textContent = options.meta;
    element.append(name, meta);

    const key = pickKey(options.pick);
    element.addEventListener("click", () => this.choose(options.pick));
    element.addEventListener("pointerover", () => this.setHover(key));
    element.addEventListener("pointerout", () => this.setHover(null));
    element.addEventListener("focus", () => this.setHover(key));
    element.addEventListener("blur", () => this.setHover(null));

    const object = new CSS2DObject(element);
    const side: LabelSide = options.kind === "star" ? "below" : "right";
    object.center.set(side === "below" ? 0.5 : 0, side === "below" ? 0 : 0.5);
    this.labelElements.push(element);
    return { object, element, name, meta, radiusPx: -1, side, textWidth: 0 };
  }

  private buildSystem(system: StarSystem, nodeById: Map<string, ConceptNode>) {
    const center = new THREE.Vector3().fromArray(system.center);
    const group = new THREE.Group();
    group.position.copy(center);
    this.content.add(group);
    const plane = new THREE.Group();
    plane.rotation.set(system.tilt[0], 0, system.tilt[1]);
    group.add(plane);

    const color = new THREE.Color(system.starColor);
    const progress = system.total ? system.mastered / system.total : 0;
    const starMaterial = this.own(
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color }, uTime: { value: 0 } },
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
      }),
    );
    const star = new THREE.Mesh(this.sphere, starMaterial);
    star.scale.setScalar(system.starRadius);

    // Stars burn brighter as more of their system is mastered.
    group.add(
      star,
      this.sprite(this.glowTexture, color, 0.9, system.starRadius * 3),
      this.sprite(this.glowTexture, color, 0.32 + progress * 0.3, system.starRadius * (7 + progress * 5)),
      this.sprite(
        this.spikeTexture,
        color.clone().lerp(new THREE.Color("#ffffff"), 0.4),
        0.3 + progress * 0.35,
        system.starRadius * (11 + progress * 6),
      ),
      this.sprite(this.glowTexture, color, 0.045, system.radius * 2.4),
      this.hitArea(system.starRadius * 1.5, { kind: "system", key: system.key }),
    );

    system.tierOrbits.forEach((orbit, tier) => {
      plane.add(
        this.orbitLine(
          orbit,
          system.tierCharted[tier]
            ? { opacity: 0.2, width: 1 }
            : { opacity: 0.16, width: 1, dashed: true },
        ),
      );
    });

    const label = this.makeLabel({
      kind: "star",
      text: system.label,
      meta: `${system.mastered} of ${system.total} mastered`,
      ariaLabel: `${system.label} star system, ${system.mastered} of ${system.total} concepts mastered`,
      pick: { kind: "system", key: system.key },
    });
    group.add(label.object);

    this.systems.set(system.key, {
      key: system.key,
      center,
      radius: system.radius,
      starRadius: system.starRadius,
      starMaterial,
      label,
      inside: false,
    });

    system.planets.forEach((planet) =>
      this.buildPlanet(planet, system.key, plane, center, nodeById),
    );
  }

  private buildPlanet(
    planet: PlanetBody,
    systemKey: string,
    plane: THREE.Object3D,
    star: THREE.Vector3,
    nodeById: Map<string, ConceptNode>,
  ) {
    const node = nodeById.get(planet.id);
    if (!node) return;
    const pivot = new THREE.Group();
    const anchor = new THREE.Group();
    anchor.position.set(planet.orbit, 0, 0);
    pivot.add(anchor);
    plane.add(pivot);

    const material = this.planetMaterial(
      node,
      star,
      seeded(`${planet.id}:bands`) > 0.5 ? 1 : 0,
    );
    const mesh = new THREE.Mesh(this.sphere, material);
    mesh.scale.setScalar(planet.size);
    anchor.add(mesh, this.hitArea(Math.max(planet.size * 1.7, 0.5), { kind: "body", id: planet.id }));
    if (planet.ringed) anchor.add(this.planetRing(planet, node));
    if (SURFACES[node.status].trail > 0) pivot.add(this.trail(planet.orbit, node.status));

    const label = this.makeLabel({
      kind: "planet",
      text: node.label,
      meta: `${node.mastery}%`,
      ariaLabel: `${node.label}: concept, ${statusLabel(node.status).toLowerCase()}`,
      pick: { kind: "body", id: planet.id },
      status: node.status,
    });
    anchor.add(label.object);

    this.bodies.set(planet.id, {
      id: planet.id,
      kind: "planet",
      systemKey,
      status: node.status,
      size: planet.size,
      extent: planet.extent,
      phase: planet.phase,
      period: planet.period,
      pivot,
      anchor,
      mesh,
      material,
      label,
      world: new THREE.Vector3(),
      born: null,
    });

    planet.moons.forEach((moon) => this.buildMoon(moon, systemKey, anchor, star, nodeById));
  }

  private buildMoon(
    moon: MoonBody,
    systemKey: string,
    host: THREE.Object3D,
    star: THREE.Vector3,
    nodeById: Map<string, ConceptNode>,
  ) {
    const node = nodeById.get(moon.id);
    if (!node) return;
    const tilt = new THREE.Group();
    tilt.rotation.x = moon.inclination;
    const pivot = new THREE.Group();
    const anchor = new THREE.Group();
    anchor.position.set(moon.orbit, 0, 0);
    pivot.add(anchor);
    tilt.add(this.orbitLine(moon.orbit, { opacity: 0.16, width: 0.8, segments: 96 }), pivot);
    host.add(tilt);

    const material = this.planetMaterial(node, star, 0);
    const mesh = new THREE.Mesh(this.sphere, material);
    mesh.scale.setScalar(moon.size);
    anchor.add(mesh, this.hitArea(Math.max(moon.size * 2.2, 0.32), { kind: "body", id: moon.id }));

    const label = this.makeLabel({
      kind: "moon",
      text: node.label,
      meta: `${node.mastery}%`,
      ariaLabel: `${node.label}: sub-concept, ${statusLabel(node.status).toLowerCase()}`,
      pick: { kind: "body", id: moon.id },
      status: node.status,
    });
    anchor.add(label.object);

    this.bodies.set(moon.id, {
      id: moon.id,
      kind: "moon",
      systemKey,
      hostId: moon.hostId,
      status: node.status,
      size: moon.size,
      extent: moon.size * 2,
      phase: moon.phase,
      period: moon.period,
      pivot,
      anchor,
      mesh,
      material,
      label,
      world: new THREE.Vector3(),
      born: null,
    });
  }

  // Faint dashed lanes between subjects that share a cross-disciplinary link.
  private buildRoutes(cosmos: Cosmos) {
    cosmos.routes.forEach(([fromKey, toKey]) => {
      const from = this.systems.get(fromKey);
      const to = this.systems.get(toKey);
      if (!from || !to) return;
      const heading = new THREE.Vector3().subVectors(to.center, from.center).normalize();
      const start = from.center.clone().addScaledVector(heading, from.starRadius * 3);
      const end = to.center.clone().addScaledVector(heading, -to.starRadius * 3);
      const geometry = this.own(new LineGeometry());
      geometry.setPositions([start.x, start.y, start.z, end.x, end.y, end.z]);
      const material = this.own(
        new LineMaterial({
          color: LINE_TINT,
          linewidth: 1,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          dashed: true,
          dashSize: 1.1,
          gapSize: 2.4,
        }),
      );
      const line = new Line2(geometry, material);
      line.computeLineDistances();
      this.content.add(line);
    });
  }

  private measureGalaxy(cosmos: Cosmos) {
    if (!cosmos.systems.length) {
      this.galaxyCenter.set(0, 0, 0);
      this.galaxyRadius = 30;
      return;
    }
    const centers = cosmos.systems.map((system) => new THREE.Vector3().fromArray(system.center));
    const bounds = new THREE.Box3();
    centers.forEach((center, index) => {
      const radius = cosmos.systems[index].radius;
      bounds.expandByPoint(new THREE.Vector3(center.x - radius, center.y, center.z - radius));
      bounds.expandByPoint(new THREE.Vector3(center.x + radius, center.y, center.z + radius));
    });
    bounds.getCenter(this.galaxyCenter);
    this.galaxyRadius = Math.max(
      ...centers.map(
        (center, index) => center.distanceTo(this.galaxyCenter) + cosmos.systems[index].radius,
      ),
      20,
    );
  }

  private exists(focus: Focus) {
    if (focus.kind === "body") return this.bodies.has(focus.id);
    if (focus.kind === "system") return this.systems.has(focus.key);
    return true;
  }

  private isFocused(pick: CosmosPick) {
    return (
      this.focus.kind === pick.kind &&
      pickKey(this.focus as CosmosPick) === pickKey(pick)
    );
  }

  private choose(pick: CosmosPick) {
    this.onPick(pick);
    this.flyTo(pick);
  }

  private refreshSelection() {
    const selectedKey = this.selection ? pickKey(this.selection) : null;
    this.systems.forEach((system) => {
      system.label.element.classList.toggle("is-selected", selectedKey === `system:${system.key}`);
    });
    this.bodies.forEach((body) => {
      body.label.element.classList.toggle("is-selected", selectedKey === `body:${body.id}`);
      body.label.textWidth = 0;
    });
    this.clearArcs();
    if (this.selection?.kind === "body") this.buildArcs(this.selection.id);
    if (!this.exists(this.focus)) {
      this.flight = null;
      this.focus = { kind: "overview" };
    }
  }

  private clearArcs() {
    this.arcs.forEach((arc) => {
      arc.line.removeFromParent();
      arc.geometry.dispose();
      arc.material.dispose();
    });
    this.arcs = [];
  }

  // Bright where the selected concept is, fading toward what it connects to.
  private buildArcs(id: string) {
    const body = this.bodies.get(id);
    if (!body) return;
    const tint = new THREE.Color(STATUS_COLORS.learning).lerp(new THREE.Color("#fff3e0"), 0.45);
    const colors: number[] = [];
    for (let index = 0; index <= ARC_SEGMENTS; index += 1) {
      const strength = 0.75 - (index / ARC_SEGMENTS) * 0.65;
      colors.push(tint.r * strength, tint.g * strength, tint.b * strength);
    }
    const seen = new Set<string>();
    this.links.forEach((link) => {
      const otherId = link.from === id ? link.to : link.to === id ? link.from : null;
      if (!otherId || seen.has(otherId)) return;
      const other = this.bodies.get(otherId);
      // A moon's link to its host is already drawn as its orbit.
      if (!other || body.hostId === otherId || other.hostId === id) return;
      seen.add(otherId);
      const geometry = new LineGeometry();
      geometry.setPositions(new Array((ARC_SEGMENTS + 1) * 3).fill(0));
      geometry.setColors(colors);
      const material = new LineMaterial({
        vertexColors: true,
        linewidth: 1.2,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const line = new Line2(geometry, material);
      line.frustumCulled = false;
      this.scene.add(line);
      this.arcs.push({
        line,
        geometry,
        material,
        otherId,
        points: Array.from({ length: ARC_SEGMENTS + 1 }, () => new THREE.Vector3()),
      });
    });
  }

  private placeAt(focus: CosmosPick | { kind: "overview" }) {
    const point = new THREE.Vector3();
    if (!this.focusPoint(focus, point)) return;
    const { distance, direction } = this.framing(focus, point);
    this.flight = null;
    this.focus = focus;
    this.lastFocusPoint.copy(point);
    this.controls.target.copy(point);
    this.camera.position.copy(point).addScaledVector(direction, distance);
    this.viewShift.copy(this.shiftFor(focus));
    const { width, height } = this.viewport();
    this.applyViewOffset(width, height);
  }

  private focusPoint(focus: Focus, target: THREE.Vector3) {
    if (focus.kind === "body") {
      const body = this.bodies.get(focus.id);
      if (!body) return false;
      target.copy(body.world);
      return true;
    }
    if (focus.kind === "system") {
      const system = this.systems.get(focus.key);
      if (!system) return false;
      target.copy(system.center);
      return true;
    }
    if (focus.kind === "overview") {
      target.copy(this.galaxyCenter);
      return true;
    }
    return false;
  }

  private framing(focus: CosmosPick | { kind: "overview" }, point: THREE.Vector3) {
    const fit = 1 / Math.min(this.camera.aspect, 1.3);
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const azimuth = Math.atan2(offset.x, offset.z);

    if (focus.kind === "body") {
      const body = this.bodies.get(focus.id);
      const star = body ? this.systems.get(body.systemKey)?.center : undefined;
      // Stand on the star's side, about 50 degrees off the line to it, so the
      // body reads as mostly lit and its status colour is visible.
      const outward = star ? new THREE.Vector3().subVectors(point, star) : offset;
      const heading = Math.atan2(outward.x, outward.z) + 2.25;
      if (body?.kind === "moon") {
        return {
          distance: THREE.MathUtils.clamp(1.4 + body.extent * 8, 2.2, 4.5),
          direction: directionFrom(heading, 0.55),
        };
      }
      return {
        distance: THREE.MathUtils.clamp(6 + (body?.extent ?? 1) * 4.2, 7, 20) * Math.max(fit, 0.85),
        direction: directionFrom(heading, 0.5),
      };
    }

    if (focus.kind === "system") {
      const radius = this.systems.get(focus.key)?.radius ?? 10;
      return { distance: radius * 2.1 * fit + 4, direction: directionFrom(azimuth, 0.85) };
    }

    return {
      distance: this.galaxyRadius * 1.95 * fit + 8,
      direction: directionFrom(azimuth, 0.95),
    };
  }

  private updateOrbits(now: number) {
    const seconds = this.reduceMotion ? 0 : Date.now() / 1000;
    this.bodies.forEach((body) => {
      const angle = (body.phase + (TAU * seconds) / body.period) % TAU;
      body.pivot.rotation.y = angle;
      // Counter-rotate so rings and moon orbits keep a fixed orientation.
      body.anchor.rotation.y = -angle;
      if (body.born !== null) {
        const progress = Math.min((now - body.born) / 900, 1);
        body.mesh.scale.setScalar(body.size * Math.max(easeOutBack(progress), 0.001));
        if (progress >= 1) body.born = null;
      }
    });
    const time = this.reduceMotion ? 0 : (now - this.startedAt) / 1000;
    this.systems.forEach((system) => {
      system.starMaterial.uniforms.uTime.value = time;
    });
    this.scene.updateMatrixWorld();
    this.bodies.forEach((body) => body.anchor.getWorldPosition(body.world));
  }

  private updateCamera(now: number) {
    const point = this.scratchPoint;
    if (this.focus.kind !== "free" && this.focusPoint(this.focus, point)) {
      if (this.flight) {
        const progress = Math.min((now - this.flight.start) / this.flight.duration, 1);
        const eased = easeInOut(progress);
        this.controls.target.lerpVectors(this.flight.fromTarget, point, eased);
        const turn = new THREE.Quaternion().setFromUnitVectors(
          this.flight.fromDirection,
          this.flight.toDirection,
        );
        const direction = this.flight.fromDirection
          .clone()
          .applyQuaternion(new THREE.Quaternion().slerp(turn, eased));
        const distance = Math.exp(
          THREE.MathUtils.lerp(
            Math.log(this.flight.fromDistance),
            Math.log(this.flight.toDistance),
            eased,
          ),
        );
        this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
        this.viewShift.lerpVectors(this.flight.fromShift, this.flight.toShift, eased);
        const { width, height } = this.viewport();
        this.applyViewOffset(width, height);
        if (progress >= 1) this.flight = null;
      } else {
        // Ride along with an orbiting body without turning the camera.
        this.scratchDelta.subVectors(point, this.lastFocusPoint);
        this.controls.target.add(this.scratchDelta);
        this.camera.position.add(this.scratchDelta);
      }
      this.lastFocusPoint.copy(point);
    }

    this.targetBefore.copy(this.controls.target);
    this.controls.update();
    // Only panning moves the orbit target; once the learner pans, stop tracking.
    if (
      !this.flight &&
      this.focus.kind !== "free" &&
      this.controls.target.distanceToSquared(this.targetBefore) > 1e-10
    ) {
      this.focus = { kind: "free" };
    }
  }

  private pixelsToWorld(pixels: number, distance: number) {
    const height = this.mount.clientHeight || 1;
    return (
      (pixels * 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) /
      height
    );
  }

  private updateDecor(now: number) {
    const camera = this.camera.position;
    const selection = this.selection;
    const body = selection?.kind === "body" ? this.bodies.get(selection.id) : undefined;
    const system = selection?.kind === "system" ? this.systems.get(selection.key) : undefined;
    if (body) {
      this.reticle.visible = true;
      this.reticle.position.copy(body.world);
      this.reticle.scale.setScalar(
        Math.max(body.size * (body.kind === "moon" ? 4.4 : 3.4), this.pixelsToWorld(30, camera.distanceTo(body.world))),
      );
    } else if (system) {
      this.reticle.visible = true;
      this.reticle.position.copy(system.center);
      this.reticle.scale.setScalar(
        Math.max(system.starRadius * 4.4, this.pixelsToWorld(40, camera.distanceTo(system.center))),
      );
    } else {
      this.reticle.visible = false;
    }

    const learning = this.learning;
    if (learning) {
      const pulse = this.reduceMotion ? 1 : 1 + Math.sin(now / 650) * 0.08;
      this.halo.visible = true;
      this.halo.position.copy(learning.world);
      this.halo.scale.setScalar(
        Math.max(learning.size * 5.5, this.pixelsToWorld(26, camera.distanceTo(learning.world))) * pulse,
      );
    } else {
      this.halo.visible = false;
    }

    if (body) {
      this.arcs.forEach((arc) => {
        const other = this.bodies.get(arc.otherId);
        if (!other) return;
        const start = body.world;
        const end = other.world;
        this.arcMiddle
          .addVectors(start, end)
          .multiplyScalar(0.5)
          .addScaledVector(UP, start.distanceTo(end) * 0.2 + 0.4);
        const start4 = arc.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
        const buffer = start4.data;
        const array = buffer.array as Float32Array;
        arc.points.forEach((point, index) => {
          const t = index / ARC_SEGMENTS;
          const inverse = 1 - t;
          point
            .copy(start)
            .multiplyScalar(inverse * inverse)
            .addScaledVector(this.arcMiddle, 2 * inverse * t)
            .addScaledVector(end, t * t);
        });
        for (let index = 0; index < ARC_SEGMENTS; index += 1) {
          const a = arc.points[index];
          const b = arc.points[index + 1];
          array.set([a.x, a.y, a.z, b.x, b.y, b.z], index * 6);
        }
        buffer.needsUpdate = true;
      });
    }
  }

  // Level of detail first (planets inside the system you are near, moons up
  // close), then a greedy pass in priority order that drops any label that
  // would collide with one already placed. Pinned labels always show.
  private updateLabels() {
    const { width, height } = this.viewport();
    const focal = height / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const camera = this.camera.position;
    const selectedKey = this.selection ? pickKey(this.selection) : null;
    const selectedBody =
      this.selection?.kind === "body" ? this.bodies.get(this.selection.id) : undefined;
    const neighbourhood = selectedBody?.hostId ?? selectedBody?.id;
    const candidates: LabelCandidate[] = [];
    // Read every pending label size before this frame writes any styles, so the
    // browser lays out once instead of once per label.
    this.systems.forEach((system) => this.measureLabel(system.label));
    this.bodies.forEach((body) => this.measureLabel(body.label));

    this.systems.forEach((system) => {
      const distance = camera.distanceTo(system.center);
      system.inside = distance < system.radius * 2.8 + 18;
      const key = `system:${system.key}`;
      const pinned = key === selectedKey || key === this.hovered;
      candidates.push({
        label: system.label,
        world: system.center,
        parent: null,
        radius: system.starRadius,
        distance,
        rank: pinned ? 0 : 1,
        pinned,
      });
    });

    this.bodies.forEach((body) => {
      const distance = Math.max(camera.distanceTo(body.world), 0.001);
      const key = `body:${body.id}`;
      const pinned = key === selectedKey || key === this.hovered || body.status === "learning";
      const visible =
        pinned ||
        (body.kind === "planet"
          ? Boolean(this.systems.get(body.systemKey)?.inside)
          : distance < 9 || (body.hostId === neighbourhood && distance < 24));
      if (!visible) {
        this.placeLabel(body.label, false, 0, body.label.side);
        return;
      }
      candidates.push({
        label: body.label,
        world: body.world,
        parent:
          body.kind === "moon" && body.hostId
            ? (this.bodies.get(body.hostId)?.world ?? null)
            : (this.systems.get(body.systemKey)?.center ?? null),
        radius: body.size,
        distance,
        rank: pinned ? 0 : body.kind === "planet" ? 2 : 3,
        pinned,
      });
    });

    candidates.sort((a, b) => a.rank - b.rank || a.distance - b.distance);
    this.camera.updateMatrixWorld();
    this.measureOccluders();
    const placed = this.occluders.slice();
    const anchor = this.labelAnchor;
    const parent = this.labelParent;

    candidates.forEach((candidate) => {
      const { label } = candidate;
      anchor.copy(candidate.world).project(this.camera);
      if (anchor.z > 1) {
        this.placeLabel(label, false, 0, label.side);
        return;
      }
      const x = ((anchor.x + 1) / 2) * width;
      const y = ((1 - anchor.y) / 2) * height;
      const radiusPx = Math.min((candidate.radius / candidate.distance) * focal, 90);

      let side: LabelSide = label.side === "below" ? "below" : "right";
      if (side !== "below" && candidate.parent) {
        parent.copy(candidate.parent).project(this.camera);
        if (((parent.x + 1) / 2) * width > x + 2) side = "left";
      }

      const textWidth =
        label.textWidth ||
        (label.name.textContent?.length ?? 8) * (side === "below" ? 11 : 7.2) + 12;
      const gap = radiusPx + 10;
      const rect: [number, number, number, number] =
        side === "below"
          ? [x - textWidth / 2 - 6, y + gap, x + textWidth / 2 + 6, y + gap + 36]
          : side === "right"
            ? [x + gap, y - 11, x + gap + textWidth + 10, y + 11]
            : [x - gap - textWidth - 10, y - 11, x - gap, y + 11];

      const blocked =
        !candidate.pinned &&
        placed.some(
          (other) =>
            rect[0] < other[2] + 3 &&
            rect[2] + 3 > other[0] &&
            rect[1] < other[3] + 3 &&
            rect[3] + 3 > other[1],
        );
      this.placeLabel(label, !blocked, radiusPx, side);
      if (!blocked) placed.push(rect);
    });
  }

  // Interface panels drawn over the scene ([data-occludes]) count as space
  // labels must avoid. Their layout changes rarely, so re-read a few times a second.
  private measureOccluders() {
    this.occludersAge += 1;
    if (this.occludersAge < 20) return;
    this.occludersAge = 0;
    const bounds = this.mount.getBoundingClientRect();
    this.occluders = Array.from(document.querySelectorAll("[data-occludes]"))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect): [number, number, number, number] => [
        rect.left - bounds.left,
        rect.top - bounds.top,
        rect.right - bounds.left,
        rect.bottom - bounds.top,
      ]);
  }

  // Labels that have never been on screen use an estimate until they can be measured.
  private measureLabel(label: LabelHandle) {
    if (label.textWidth || !label.object.visible || !label.name.offsetWidth) return;
    label.textWidth =
      label.name.offsetWidth + (label.meta.offsetWidth ? label.meta.offsetWidth + 7 : 0);
  }

  private placeLabel(label: LabelHandle, visible: boolean, radiusPx: number, side: LabelSide) {
    if (label.object.visible !== visible) label.object.visible = visible;
    if (!visible) return;
    const rounded = Math.round(radiusPx);
    if (rounded !== label.radiusPx) {
      label.radiusPx = rounded;
      label.element.style.setProperty("--r", `${rounded}px`);
    }
    if (side !== label.side) {
      label.side = side;
      label.element.classList.toggle("is-left", side === "left");
      label.object.center.set(side === "left" ? 1 : 0, 0.5);
    }
  }

  private pickAtPointer(): CosmosPick | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.hitTargets, false)[0];
    return (hit?.object.userData.pick as CosmosPick | undefined) ?? null;
  }

  private setHover(key: string | null) {
    if (key === this.hovered) return;
    this.applyHover(this.hovered, false);
    this.hovered = key;
    this.applyHover(key, true);
    this.renderer.domElement.style.cursor = key ? "pointer" : "";
  }

  private applyHover(key: string | null, on: boolean) {
    if (!key) return;
    const split = key.indexOf(":");
    const kind = key.slice(0, split);
    const id = key.slice(split + 1);
    if (kind === "body") {
      const body = this.bodies.get(id);
      if (!body) return;
      body.material.uniforms.uHover.value = on ? 1 : 0;
      body.label.element.classList.toggle("is-hovered", on);
    } else {
      this.systems.get(id)?.label.element.classList.toggle("is-hovered", on);
    }
  }

  private handleControlStart = () => {
    // Taking the controls mid-flight hands the camera back to the learner.
    if (!this.flight) return;
    this.flight = null;
    this.focus = { kind: "free" };
  };

  private handlePointerMove = (event: PointerEvent) => {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.pointerInside = true;
    this.pointerDirty = true;
  };

  private handlePointerLeave = () => {
    this.pointerInside = false;
    this.setHover(null);
  };

  private handlePointerDown = (event: PointerEvent) => {
    this.pressStart = { x: event.clientX, y: event.clientY };
  };

  private handlePointerUp = (event: PointerEvent) => {
    const start = this.pressStart;
    this.pressStart = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    this.handlePointerMove(event);
    const pick = this.pickAtPointer();
    if (pick) this.choose(pick);
  };

  // The dossier covers the lower right of the panel (the whole bottom on
  // phones), so the point the camera orbits is drawn above and left of centre,
  // most strongly for close-ups where the body would otherwise sit beneath it.
  private shiftFor(focus: Focus) {
    const compact = this.viewport().width < 640;
    if (focus.kind === "body") return new THREE.Vector2(compact ? 0 : 0.1, compact ? 0.2 : 0.09);
    if (focus.kind === "system") return new THREE.Vector2(compact ? 0 : 0.06, compact ? 0.14 : 0.05);
    if (focus.kind === "overview") return new THREE.Vector2(compact ? 0 : 0.02, compact ? 0.1 : 0.02);
    return this.viewShift.clone();
  }

  private applyViewOffset(width: number, height: number) {
    this.camera.setViewOffset(
      width,
      height,
      width * this.viewShift.x,
      height * this.viewShift.y,
      width,
      height,
    );
  }

  private handleResize = () => {
    const { width, height } = this.viewport();
    this.camera.aspect = width / height;
    if (!this.flight) this.viewShift.copy(this.shiftFor(this.focus));
    this.applyViewOffset(width, height);
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  };

  private loop = () => {
    this.frame = window.requestAnimationFrame(this.loop);
    if (!this.mount.clientWidth) return;
    const now = performance.now();
    this.updateOrbits(now);
    this.updateCamera(now);
    this.starfield.position.copy(this.camera.position);
    if (this.pointerDirty && this.pointerInside) {
      this.pointerDirty = false;
      const pick = this.pickAtPointer();
      this.setHover(pick ? pickKey(pick) : null);
    }
    this.updateDecor(now);
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };
}
