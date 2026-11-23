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
        const h = town < 0 ? 7 + rand() * 14 : 12 + rand() * 61;
        blocks.push({
          p: [town + i * 44 + 22, h / 2, j * 44 + 22],
          s: [18 + rand() * 10, h, 18 + rand() * 10],
          kind: "building",
          solid: true,
        });
      }
  return blocks;
}
export function countyLadders(boxes: Box[]) {
  return boxes
    .filter((b) => b.kind === "building")
    .filter((_, i) => i % 5 === 0)
    .map((b) => {
      const x = b.p[0],
        z = b.p[2] + b.s[2] / 2 + 0.8,
        top = b.s[1] + 0.36;
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
  for (const b of boxes.filter((b) => b.kind === "building")) {
    // Roof plant and setbacks give both districts a readable silhouette.
    const [x, , z] = b.p,
      [w, h, d] = b.s;
    boxes.push({
      p: [x, h + 0.18, z],
      s: [w + 0.38, 0.36, d + 0.38],
      kind: "roof",
      solid: true,
    });
    if (h > 20 || x < 0) {
      const top = h > 20 ? Math.min(6, h * 0.14) : 1.35;
      boxes.push({
        p: [x + w * 0.12, h + 0.36 + top / 2, z - d * 0.13],
        s: [w * 0.53, top, d * 0.46],
        kind: "roof",
        solid: true,
      });
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
    Array.from({ length: 15 }, (_, i) => ({
      p: [
        t + (i % 5 === 0 ? 0 : ((i % 5) - 2) * 44),
        0,
        92 - Math.floor(i / 5) * 88 - (i % 5) * 5,
      ] as V3,
      yaw: 0,
      driver: null,
    })),
  );
}
