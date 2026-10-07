import type { ConceptEdge, ConceptNode } from "@/lib/types";

export type Vec3 = [number, number, number];

export interface MoonBody {
  id: string;
  hostId: string;
  orbit: number;
  size: number;
  phase: number;
  period: number;
  inclination: number;
}

export interface PlanetBody {
  id: string;
  tier: number;
  orbit: number;
  size: number;
  phase: number;
  period: number;
  extent: number;
  ringed: boolean;
  moons: MoonBody[];
}

export interface StarSystem {
  key: string;
  label: string;
  center: Vec3;
  tilt: [number, number];
  starRadius: number;
  starColor: string;
  tierOrbits: number[];
  tierCharted: boolean[];
  radius: number;
  planets: PlanetBody[];
  mastered: number;
  total: number;
}

export interface BodyRef {
  id: string;
  systemKey: string;
  kind: "planet" | "moon";
  hostId?: string;
  moonIds: string[];
}

export interface Cosmos {
  systems: StarSystem[];
  bodies: Map<string, BodyRef>;
  routes: Array<[string, string]>;
}

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_MOONS = 4;
const SYSTEM_GAP = 8;

const STAR_TINTS: Record<string, string> = {
  mathematics: "#ffd88c",
  physics: "#a6c8ff",
  chemistry: "#ff9a7a",
  "computer science": "#dfe7ff",
  statistics: "#ffc27f",
  general: "#f5f1e8",
};

// Approximate blackbody tints, hottest to coolest, for subjects without a fixed tint.
const STELLAR_CLASSES = [
  "#9db4ff",
  "#c4d4ff",
  "#f3f1ff",
  "#fff1d6",
  "#ffd88c",
  "#ffbf80",
  "#ff9a7a",
];

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A stable pseudo-random number in [0, 1) derived from a string. */
export function seeded(value: string) {
  return (hashString(value) % 100_000) / 100_000;
}

function domainKey(domain: string) {
  return domain.trim().toLowerCase() || "general";
}

function starTint(key: string) {
  return STAR_TINTS[key] ?? STELLAR_CLASSES[hashString(key) % STELLAR_CLASSES.length];
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function layoutSystem(
  key: string,
  label: string,
  members: ConceptNode[],
  links: ConceptEdge[],
  degree: Map<string, number>,
  bodies: Map<string, BodyRef>,
): StarSystem {
  const order = new Map(members.map((member, index) => [member.id, index]));
  const local = links.filter((edge) => order.has(edge.from) && order.has(edge.to));
  const children = new Map(members.map((member) => [member.id, new Set<string>()]));
  const parents = new Map(members.map((member) => [member.id, new Set<string>()]));
  local.forEach((edge) => {
    children.get(edge.from)?.add(edge.to);
    parents.get(edge.to)?.add(edge.from);
  });

  // A concept that extends another and leads nowhere further is treated as a
  // sub-concept: it orbits the concept it extends instead of the star.
  const moonsOf = new Map<string, string[]>();
  const hostOf = new Map<string, string>();
  members.forEach((member) => {
    if (children.get(member.id)?.size) return;
    const host = Array.from(parents.get(member.id) ?? [])
      .sort(
        (a, b) =>
          (children.get(b)?.size ?? 0) - (children.get(a)?.size ?? 0) ||
          (degree.get(b) ?? 0) - (degree.get(a) ?? 0) ||
          (order.get(a) ?? 0) - (order.get(b) ?? 0),
      )
      .find((id) => (moonsOf.get(id)?.length ?? 0) < MAX_MOONS);
    if (!host) return;
    hostOf.set(member.id, host);
    moonsOf.set(host, [...(moonsOf.get(host) ?? []), member.id]);
  });

  const planets = members.filter((member) => !hostOf.has(member.id));

  // The longest prerequisite chain decides how far from the star a planet orbits.
  const depth = new Map(planets.map((planet) => [planet.id, 0]));
  const planetLinks = local.filter(
    (edge) => depth.has(edge.from) && depth.has(edge.to),
  );
  for (let pass = 0; pass < planets.length; pass += 1) {
    let changed = false;
    planetLinks.forEach((edge) => {
      const next = (depth.get(edge.from) ?? 0) + 1;
      if (next > (depth.get(edge.to) ?? 0) && next < planets.length) {
        depth.set(edge.to, next);
        changed = true;
      }
    });
    if (!changed) break;
  }
  const tierValues = Array.from(new Set(Array.from(depth.values()))).sort(
    (a, b) => a - b,
  );

  const statusOf = new Map(members.map((member) => [member.id, member.status]));
  const planetBodies: PlanetBody[] = planets.map((planet) => {
    const moonIds = moonsOf.get(planet.id) ?? [];
    const size =
      0.3 + Math.min(degree.get(planet.id) ?? 0, 6) * 0.05 + moonIds.length * 0.035;
    let reach = size * 1.7;
    const moons = moonIds.map((moonId, index): MoonBody => {
      const moonSize = 0.1 + Math.min(degree.get(moonId) ?? 0, 3) * 0.022;
      reach += moonSize + (index ? 0.2 : 0);
      const orbit = reach;
      reach += moonSize;
      bodies.set(moonId, {
        id: moonId,
        systemKey: key,
        kind: "moon",
        hostId: planet.id,
        moonIds: [],
      });
      return {
        id: moonId,
        hostId: planet.id,
        orbit,
        size: moonSize,
        phase: seeded(`${moonId}:phase`) * TAU,
        period: 26 + index * 12 + seeded(`${moonId}:period`) * 8,
        inclination: (seeded(`${moonId}:tilt`) - 0.5) * 0.6,
      };
    });
    const ringed = moons.length < 3 && seeded(`${planet.id}:ring`) < 0.3;
    bodies.set(planet.id, {
      id: planet.id,
      systemKey: key,
      kind: "planet",
      moonIds,
    });
    return {
      id: planet.id,
      tier: tierValues.indexOf(depth.get(planet.id) ?? 0),
      orbit: 0,
      size,
      phase: 0,
      period: 0,
      extent: Math.max(moons.length ? reach : size * 1.5, ringed ? size * 2.3 : 0),
      ringed,
      moons,
    };
  });

  const starRadius = 0.9 + Math.min(planets.length, 8) * 0.075;
  const tierOrbits: number[] = [];
  const tierCharted: boolean[] = [];
  let previousOrbit = starRadius * 2.2;
  let previousExtent = 0;

  tierValues.forEach((_, tier) => {
    const onTier = planetBodies.filter((planet) => planet.tier === tier);
    const extent = Math.max(...onTier.map((planet) => planet.extent));
    const orbit = Math.max(
      previousOrbit + previousExtent + extent + 0.8,
      (onTier.length * (extent * 2 + 0.9)) / TAU,
    );
    tierOrbits.push(orbit);
    tierCharted.push(onTier.some((planet) => statusOf.get(planet.id) !== "locked"));

    // Seeded angles keep planets where they were when a neighbour joins the
    // orbit; they are only nudged apart when they would overlap.
    const minimumGap = (extent * 2 + 0.9) / orbit;
    const placed = onTier
      .map((planet) => ({ planet, angle: seeded(`${planet.id}:phase`) * TAU }))
      .sort((a, b) => a.angle - b.angle);
    for (let index = 1; index < placed.length; index += 1) {
      placed[index].angle = Math.max(
        placed[index].angle,
        placed[index - 1].angle + minimumGap,
      );
    }
    const overflow =
      placed.length > 1 &&
      placed[placed.length - 1].angle - placed[0].angle > TAU - minimumGap;
    const period = 120 * Math.pow(orbit / 4, 1.5);
    placed.forEach(({ planet, angle }, index) => {
      planet.orbit = orbit;
      planet.period = period;
      planet.phase = overflow
        ? placed[0].angle + (index / placed.length) * TAU
        : angle;
    });

    previousOrbit = orbit;
    previousExtent = extent;
  });

  return {
    key,
    label,
    center: [0, 0, 0],
    tilt: [
      (seeded(`${key}:tilt-x`) - 0.5) * 0.3,
      (seeded(`${key}:tilt-z`) - 0.5) * 0.3,
    ],
    starRadius,
    starColor: starTint(key),
    tierOrbits,
    tierCharted,
    radius: (tierOrbits.at(-1) ?? starRadius * 2) + previousExtent,
    planets: planetBodies,
    mastered: members.filter((member) => member.status === "mastered").length,
    total: members.length,
  };
}

function placeSystems(systems: StarSystem[]) {
  const placed: StarSystem[] = [];
  systems.forEach((system, index) => {
    if (!placed.length) {
      placed.push(system);
      return;
    }
    const anchor = placed[0];
    const lift = (seeded(`${system.key}:lift`) - 0.5) * 10;
    for (let step = 0; step < 400; step += 1) {
      const angle = index * GOLDEN_ANGLE + step * 0.41;
      const reach = anchor.radius + system.radius + SYSTEM_GAP + step * 1.6;
      const candidate: Vec3 = [Math.cos(angle) * reach, lift, Math.sin(angle) * reach];
      const clear = placed.every(
        (other) =>
          distance(candidate, other.center) >= other.radius + system.radius + SYSTEM_GAP,
      );
      if (clear || step === 399) {
        system.center = candidate;
        break;
      }
    }
    placed.push(system);
  });
}

/**
 * Arranges the flat concept graph as a universe: every subject is a star
 * system, concepts are planets on tiered orbits, and sub-concepts are moons.
 */
export function buildCosmos(nodes: ConceptNode[], edges: ConceptEdge[]): Cosmos {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = edges.filter(
    (edge) =>
      edge.from !== edge.to && nodeById.has(edge.from) && nodeById.has(edge.to),
  );
  const degree = new Map<string, number>();
  links.forEach((edge) => {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  });

  const groups = new Map<string, { label: string; members: ConceptNode[] }>();
  nodes.forEach((node) => {
    const key = domainKey(node.domain);
    const group = groups.get(key);
    if (group) {
      group.members.push(node);
    } else {
      groups.set(key, { label: node.domain.trim() || "General", members: [node] });
    }
  });

  const bodies = new Map<string, BodyRef>();
  const systems = Array.from(groups).map(([key, group]) =>
    layoutSystem(key, group.label, group.members, links, degree, bodies),
  );
  placeSystems(systems);

  const routes = new Map<string, [string, string]>();
  links.forEach((edge) => {
    const from = bodies.get(edge.from)?.systemKey;
    const to = bodies.get(edge.to)?.systemKey;
    if (!from || !to || from === to) return;
    const pair: [string, string] = from < to ? [from, to] : [to, from];
    routes.set(pair.join("|"), pair);
  });

  return { systems, bodies, routes: Array.from(routes.values()) };
}
