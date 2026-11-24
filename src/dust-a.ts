import type { Box, Building, City, V3 } from "./world.ts";

export const DUST_A = "dust-a";
const deck = 3.6;
export function dustSite(district = 1): City {
  const boxes: Box[] = [];
  function box(
    kind: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) {
    boxes.push({ kind, p: [x, y, z], s: [w, h, d], solid: true });
  }
  box("paving", 0, -0.4, 0, 56, 0.8, 58);
  box("platform", -2, deck / 2, -5, 20, deck, 20);
  // The bridge spans the lower lane. Its underside stays open.
  box("bridge", -15, deck - 0.27, -8, 6, 0.54, 7);
  box("platform", -21, deck / 2, -8, 6, deck, 7);
  // Long A rises continuously to the platform. Both physics engines consume
  // this same surface, including its absolute-coordinate collision triangles.
  const x0 = 8,
    x1 = 22,
    z0 = -7,
    z1 = 17;
  boxes.push({
    kind: "slope",
    solid: true,
    p: [15, deck / 2, 5],
    s: [14, deck, 24],
    mesh: {
      vertices: [x0, deck, z0, x1, deck, z0, x1, 0, z1, x0, 0, z1],
      indices: [0, 2, 1, 0, 3, 2],
    },
  });
  box("asphalt", 15, deck / 2, -14.5, 14, deck, 15);
  box("asphalt", 15, 0.015, 22, 14, 0.03, 10);
  // A stepped sidewalk along the eastern wall leads to a view over both lanes.
  for (let i = 0; i < 16; i++) {
    const h = deck + (i + 1) * 0.2;
    box("step", 20.25, h / 2, -8.5 + i, 3.5, h, 1);
  }
  box("platform", 20.25, 3.4, 10.5, 3.5, 6.8, 7);
  for (const side of [-1, 1]) {
    box("boundary", side * 28, 15, 0, 0.3, 30, 58);
    box("boundary", 0, 15, side * 29, 56, 30, 0.3);
  }
  // Short A links the lower lane to the bridge by a flight of traversable steps.
  for (let i = 0; i < 16; i++) {
    const h = (deck * (i + 1)) / 16;
    box("step", -21, h / 2, 10.5 - i, 6, h, 1);
  }
  box("parapet", -2, deck + 0.44, 4.8, 19.8, 0.88, 0.45);
  box("parapet", -11.78, deck + 0.42, 0.4, 0.44, 0.84, 8);
  box("parapet", -11.78, deck + 0.42, -13, 0.44, 0.84, 3.6);
  box("parapet", -15, deck + 0.36, -11.32, 6, 0.72, 0.36);
  box("parapet", -15, deck + 0.36, -4.68, 6, 0.72, 0.36);
  box("hotel", -2, 6.8, -21.5, 28, 13.6, 12);
  box("stucco", -22, 5.3, -20.8, 12, 10.6, 9);
  box("stucco", 25, 4.8, -9, 6, 9.6, 36);
  box("stucco", 25, 4.4, 20.5, 6, 8.8, 14);
  box("ochre", -26, 4, 5, 4, 8, 43);
  box("stucco", -7, 4.8, 26, 34, 9.6, 4);
  box("stucco", 16, 5.4, -25, 12, 10.8, 6);
  for (const [x, z] of [
    [-6, -7],
    [-3.7, -7],
    [3, -10],
    [3, -7.9],
    [-8, 1],
  ]) {
    box("crate", x, deck + 1.15, z, 2.2, 2.3, 2);
  }
  box("crate", -6, deck + 3.45, -7, 2.2, 2.3, 2);
  box("crate", -13.8, 1, -0.8, 2, 2, 2);
  box("crate", -13.8, 0.85, 13, 1.8, 1.7, 1.8);
  box("crate", 1, 0.75, 6.6, 3.1, 1.5, 1.1);
  for (const [x, z] of [
    [18, -16],
    [20, -15.3],
  ])
    box("drum", x, deck + 0.68, z, 1, 1.36, 1);

  const nodes: V3[] = [],
    links: [number, number][] = [];
  // Walkable samples exclude crate tops, railings and building interiors.
  // Connect the bridge on its own elevation, keeping the lane under it intact.
  const walkable = new Set([
    "paving",
    "step",
    "platform",
    "asphalt",
    "bridge",
    "slope",
  ]);
  const columns = new Map<string, number[]>();
  for (let z = -23; z <= 23; z += 2)
    for (let x = -23; x <= 21; x += 2) {
      const overlaps = boxes.filter(
        (b) =>
          Math.abs(x - b.p[0]) < b.s[0] / 2 + 0.32 &&
          Math.abs(z - b.p[2]) < b.s[2] / 2 + 0.32,
      );
      const candidates = overlaps
        .filter((b) => walkable.has(b.kind))
        .map((b) =>
          b.kind === "slope"
            ? (deck * (z1 - z)) / (z1 - z0)
            : b.p[1] + b.s[1] / 2,
        );
      const column: number[] = [];
      for (const y of candidates.sort((a, b) => b - a)) {
        if (column.some((i) => Math.abs(nodes[i][1] - y) < 0.35)) continue;
        if (
          overlaps.some((b) =>
            b.kind === "slope"
              ? y < (deck * (z1 - z)) / (z1 - z0) - 0.12
              : b.p[1] + b.s[1] / 2 > y + 0.15 && b.p[1] - b.s[1] / 2 < y + 1.9,
          )
        )
          continue;
        column.push(nodes.push([x, y + 0.05, z]) - 1);
      }
      columns.set(x + "," + z, column);
      for (const i of column)
        for (const key of [`${x - 2},${z}`, `${x},${z - 2}`]) {
          for (const j of columns.get(key) ?? [])
            if (Math.abs(nodes[i][1] - nodes[j][1]) < 0.62) links.push([j, i]);
        }
    }
  const areas: [string, number, number, number, number][] = [
    ["A SITE", -2, -5, 20, 20],
    ["LONG A", 15, 7, 14, 28],
    ["SHORT A", -21, 2, 6, 23],
    ["LOWER PASSAGE", -15, 0, 6, 24],
    ["LONG CORNER", 8, 20, 22, 6],
  ];
  const buildings: Building[] = areas.map(([name, x, z, w, d], id) => ({
    id,
    name,
    x,
    z,
    w,
    d,
    parcelId: "dust-" + id,
    neighborhood: "market",
    facing: 0,
    entrance: [x, 0, z],
    inside: [x, 0, z],
    floors: 1,
    height: deck,
    kind: "courtyard",
    route: [],
  }));
  return {
    seed: DUST_A,
    district,
    boxes,
    buildings,
    nodes,
    links,
    bounds: 32,
    spawns: [
      [20.25, 6.88, 11],
      [-9, deck + 0.1, -11],
      [-21, deck + 0.1, -8],
      [-16, 0.1, 12],
      [12, deck + 0.1, -13],
      [-2, deck + 0.1, 0],
    ],
    beacons: [
      [-5.9, deck + 5.2, -7],
      [16, deck + 0.8, -16],
      [-21, deck + 0.8, -8],
    ],
    bridges: [],
    blimps: [],
    platforms: [],
    aerialLinks: [],
    aerialEntries: [],
    flightCeiling: 24,
    plan: { streets: [], blocks: [], parcels: [], landmarks: [], bridges: [] },
    streetNodes: nodes.map((_, i) => i),
    roofLinks: [],
    dressing: [],
  };
}
