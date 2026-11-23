import { cityLot, isCityMass } from "./county-architecture.ts";
import { randomSeed, type V3, type City, type Box } from "./world.ts";
import type { CityPlan } from "./city-plan.ts";
export const COUNTY = "switchback-county";
export const LIMIT = 800;
export const TOWNS = [-320, 320];
export function elevation(x: number, z: number) {
  const hills = Math.min(
    1,
    Math.abs(z) / 180,
    ...TOWNS.map(
      (t) => Math.max(0, Math.max(Math.abs(x - t), Math.abs(z)) - 160) / 95,
    ),
  );
  return hills * hills * (38 + 23 * Math.sin(x / 93) + 15 * Math.cos(z / 72));
}
export function countyBlocks() {
  const rand = randomSeed(COUNTY),
    blocks: Box[] = [];
  for (const town of TOWNS)
    for (let i = -3; i < 3; i++)
      for (let j = -3; j < 3; j++) {
        const x = town + i * 44 + 22,
          z = j * 44 + 22;
        const palette = town < 0 ? [0, 0, 1, 1, 2, 3] : [1, 2, 2, 3, 4, 4];
        const choice =
          i === -1 && j === 0
            ? 5
            : i === 0 && j === 0
              ? 6
              : i === 0 && j === 1
                ? 3
                : palette[Math.floor(rand() * palette.length)];
        const lot = cityLot(x, z, choice, rand());
        blocks.push(...lot);
        for (const [dx, dz] of [
          [-13.8, 10],
          [12, -13.8],
          [13.8, 8],
          ...(choice === 6
            ? [
                [2, 4],
                [-6, 7],
                [6, -7],
              ]
            : []),
        ]) {
          if (
            lot.some(
              (b) =>
                Math.abs(x + dx - b.p[0]) < b.s[0] / 2 + 1.6 &&
                Math.abs(z + dz - b.p[2]) < b.s[2] / 2 + 1.6,
            )
          )
            continue;
          blocks.push({
            p: [x + dx, 1.5, z + dz],
            s: [0.35, 3, 0.35],
            kind: "county-tree",
            solid: true,
          });
        }
        blocks.push({
          p: [x, 0.075, z],
          s: [30, 0.15, 30],
          kind: "pavement",
          solid: true,
        });
      }
  return blocks;
}
export function countyLadders(boxes: Box[]) {
  return boxes
    .filter(
      (b) =>
        isCityMass(b) &&
        b.p[1] - b.s[1] / 2 < 0.01 &&
        (b.frontage === "shops" || b.frontage === "civic"),
    )
    .filter((_, i) => i % 5 === 0)
    .map((b) => {
      const x = b.p[0],
        z = b.p[2] + b.s[2] / 2 + 0.8,
        top = b.s[1];
      return { x, z, bottom: 0, top, exit: [x, top + 0.08, z - 1.5] as V3 };
    });
}
export function countyWorld(): City {
  const spaces = parkedCars();
  const spawns: V3[] = spaces.map(({ p }, i) => [
    p[0] + (i % 2 ? 3 : -3),
    p[1] + 0.05,
    p[2],
  ]);
  const plan: CityPlan = {
    streets: [],
    blocks: [],
    parcels: [],
    bridges: [],
    landmarks: [],
  };
  const boxes = countyBlocks(),
    nodes: V3[] = [],
    links: [number, number][] = [];
  function street(a: V3, b: V3, width: number) {
    plan.streets.push({
      id: String(plan.streets.length),
      a,
      b,
      width,
      class: "local",
    });
    boxes.push({
      p: [(a[0] + b[0]) / 2, 0.02, (a[2] + b[2]) / 2],
      s: [Math.abs(a[0] - b[0]) || width, 0.04, Math.abs(a[2] - b[2]) || width],
      kind: "road",
      solid: false,
    });
  }
  street([-790, 0, 0], [790, 0, 0], 14);
  for (const t of TOWNS) {
    const base = nodes.length;
    for (let i = 0; i < 7; i++) {
      const n = (i - 3) * 44;
      street([t + n, 0, -138], [t + n, 0, 138], 11);
      street([t - 138, 0, n], [t + 138, 0, n], 11);
      for (let j = 0; j < 7; j++) {
        const id = nodes.length;
        nodes.push([t + n, 0.07, (j - 3) * 44]);
        if (i) links.push([id - 7, id]);
        if (j) links.push([id - 1, id]);
      }
    }
    if (base) links.push([45, base + 3]);
  }
  // Street corners alone are too far apart for covered wave spawns. Add
  // curbside route choices on each city block, all connected to its endpoints.
  const streetEdges = links.splice(0);
  for (const [a, b] of streetEdges) {
    const from = nodes[a],
      to = nodes[b],
      dx = to[0] - from[0],
      dz = to[2] - from[2];
    if (Math.hypot(dx, dz) > 50) {
      links.push([a, b]);
      continue;
    }
    for (const side of [-1, 1]) {
      const id = nodes.length;
      nodes.push([
        (from[0] + to[0]) / 2 + Math.sign(dz) * side * 5.2,
        0.07,
        (from[2] + to[2]) / 2 - Math.sign(dx) * side * 5.2,
      ]);
      links.push([a, id], [id, b]);
    }
  }
  for (const l of countyLadders(boxes)) {
    for (const side of [-0.36, 0.36])
      boxes.push({
        p: [l.x + side, l.top / 2, l.z - 0.18],
        s: [0.06, l.top, 0.06],
        kind: "metal",
        solid: false,
      });
    for (let y = 0.3; y < l.top; y += 0.32)
      boxes.push({
        p: [l.x, y, l.z - 0.18],
        s: [0.78, 0.045, 0.055],
        kind: "metal",
        solid: false,
      });
  }
  for (const t of TOWNS)
    for (const z of [-90, -45, 45, 100]) {
      boxes.push({
        p: [t + 6, 0.49, z],
        s: [0.65, 0.98, 3],
        kind: "pavement",
        solid: true,
      });
    }
  // Tile the terrain so rendering and physics only visit nearby patches.
  for (let tz = -LIMIT; tz < LIMIT; tz += 160)
    for (let tx = -LIMIT; tx < LIMIT; tx += 160) {
      const vertices: number[] = [],
        indices: number[] = [];
      let low = Infinity,
        high = -Infinity;
      for (let z = 0; z <= 8; z++)
        for (let x = 0; x <= 8; x++) {
          const px = tx + 20 * x,
            pz = tz + 20 * z,
            y = elevation(px, pz);
          low = Math.min(low, y);
          high = Math.max(high, y);
          vertices.push(px, y, pz);
          if (x < 8 && z < 8) {
            const i = z * 9 + x;
            indices.push(i, i + 9, i + 1, i + 1, i + 9, i + 10);
          }
        }
      if (high === low) {
        boxes.push({
          p: [tx + 80, low - 0.5, tz + 80],
          s: [160, 1, 160],
          kind: "ground",
          solid: true,
        });
      } else
        boxes.push({
          p: [tx + 80, (low + high) / 2, tz + 80],
          s: [160, high - low + 0.01, 160],
          kind: "ground",
          solid: true,
          mesh: { vertices, indices },
        });
    }
  return {
    seed: COUNTY,
    district: 1,
    boxes,
    spawns,
    bounds: LIMIT,
    flightCeiling: 130,
    plan,
    buildings: [],
    beacons: [nodes[0], nodes[52], nodes[34]],
    nodes,
    links,
    bridges: [],
    blimps: [],
    platforms: [],
    aerialLinks: [],
    aerialEntries: [],
    streetNodes: [],
    roofLinks: [],
    dressing: [],
  };
}

export interface CountyCar {
  p: V3;
  yaw: number;
  driver: string | null;
}
export function parkedCars(): CountyCar[] {
  return TOWNS.flatMap((t) =>
    Array.from({ length: 15 }, (_, i) => {
      const cross = i === 14,
        reverse = i >= 7;
      const street = (((i + 3) % 7) - 3) * 44,
        curb = reverse ? -4 : 4;
      // Park in the curb lane between crossings, facing the flow of traffic.
      const along =
        [66, -22, 110, -66, 22, -110, 66][i % 7] * (reverse ? -1 : 1);
      return {
        p: (cross ? [t + 66, 0, 48] : [t + street + curb, 0, along]) as V3,
        yaw: cross ? Math.PI / 2 : reverse ? Math.PI : 0,
        driver: null,
      };
    }),
  );
}
