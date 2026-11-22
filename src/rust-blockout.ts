import {
  type City,
  type Box,
  type V3,
  type Building,
  worldRay,
} from "./world.ts";
export interface ArenaProp {
  kind: "pipe" | "beam" | "tank";
  a: V3;
  b: V3;
  radius: number;
  ink?: string;
}
export interface Ladder {
  x: number;
  z: number;
  bottom: number;
  top: number;
  exit: V3;
}
export interface Arena {
  name: string;
  props: ArenaProp[];
  ladders: Ladder[];
  zones: { name: string; p: V3; size: V3 }[];
}
// Hand-authored Rust homage, in metres. The procedural generator is kept separately.
export function generateRustBlockout(seed = "rust", district = 1): City {
  const boxes: Box[] = [],
    props: ArenaProp[] = [],
    ladders: Ladder[] = [],
    nodes: V3[] = [],
    links: [number, number][] = [];
  const add = (p: V3, s: V3, kind = "metal", solid = true) =>
    boxes.push({ p, s, kind, solid });
  const beam = (a: V3, b: V3, r = 0.1) =>
    props.push({ kind: "beam", a, b, radius: r });
  const pipe = (a: V3, b: V3, r = 0.8) => {
    props.push({ kind: "pipe", a, b, radius: r });
    const length = Math.hypot(...a.map((v, i) => v - b[i]));
    const n = Math.ceil(length / 0.45);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n,
        p = a.map((v, k) => v + (b[k] - v) * t) as V3;
      // Short overlapping hulls provide a continuous, walkable pipe with sub-step-height rises.
      const s: V3 = [
        Math.abs(b[0] - a[0]) / n + 2 * r,
        Math.abs(b[1] - a[1]) / n + 2 * r,
        Math.abs(b[2] - a[2]) / n + 2 * r,
      ];
      add(p, s, "collision");
    }
  };
  const deck = (x: number, y: number, z: number, w: number, d: number) => {
    add([x, y - 0.12, z], [w, 0.24, d]);
    for (const sx of [-1, 1]) {
      beam(
        [x + (sx * w) / 2, y + 1, z - d / 2],
        [x + (sx * w) / 2, y + 1, z + d / 2],
        0.05,
      );
      for (let zz = z - d / 2; zz <= z + d / 2; zz += 2)
        add([x + (sx * w) / 2, y + 0.5, zz], [0.08, 1, 0.08]);
    }
  };
  const ladder = (
    x: number,
    z: number,
    bottom: number,
    top: number,
    exit: V3,
  ) => {
    ladders.push({ x, z, bottom, top, exit });
    for (const dx of [-0.48, 0.48])
      beam([x + dx, bottom, z], [x + dx, top + 1, z], 0.05);
    for (let y = bottom + 0.3; y < top + 0.8; y += 0.32)
      beam([x - 0.48, y, z], [x + 0.48, y, z], 0.035);
  };
  const stairs = (a: V3, b: V3, width = 2.2) => {
    const n = Math.ceil((b[1] - a[1]) / 0.2);
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n;
      add(
        [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t - 0.12,
          a[2] + (b[2] - a[2]) * t,
        ],
        [
          Math.abs(b[0] - a[0]) / n + (a[0] === b[0] ? width : 0.1),
          0.24,
          Math.abs(b[2] - a[2]) / n + (a[2] === b[2] ? width : 0.1),
        ],
      );
    }
  };
  const container = (
    x: number,
    z: number,
    w: number,
    d: number,
    open = false,
  ) => {
    add([x, 3.05, z], [w, 0.2, d]);
    add([x, 0.1, z], [w, 0.2, d]);
    add([x - w / 2, 1.6, z], [0.15, 3, d]);
    add([x + w / 2, 1.6, z], [0.15, 3, d]);
    if (!open) {
      add([x, 1.6, z - d / 2], [w, 3, 0.15]);
      add([x, 1.6, z + d / 2], [w, 3, 0.15]);
    }
    for (let zz = z - d / 2; zz < z + d / 2; zz += 0.55)
      for (const side of [-1, 1])
        add(
          [x + side * (w / 2 + 0.02), 1.6, zz],
          [0.07, 2.9, 0.07],
          "metal",
          false,
        );
  };
  const zones = [
    { name: "TOWER", p: [0, 0, 0] as V3, size: [12, 18, 12] as V3 },
    { name: "PIPELINE", p: [0, 0, -24] as V3, size: [48, 4, 3] as V3 },
    { name: "OIL DERRICK", p: [-21, 0, -15] as V3, size: [10, 5, 12] as V3 },
    { name: "BLUE CONTAINERS", p: [-25, 0, 5] as V3, size: [6, 3, 16] as V3 },
    { name: "LOADING DOCK", p: [-20, 0, 25] as V3, size: [18, 3, 7] as V3 },
    { name: "GENERATORS", p: [-8, 0, 11] as V3, size: [10, 3, 6] as V3 },
    { name: "CONTROL ROOM", p: [8, 0, 8] as V3, size: [7, 4, 7] as V3 },
    { name: "FUEL DEPOT", p: [22, 0, 15] as V3, size: [9, 4, 10] as V3 },
    { name: "RED CONTAINERS", p: [26, 0, -3] as V3, size: [6, 3, 12] as V3 },
    { name: "FRONT GATE", p: [23, 0, -26] as V3, size: [12, 1, 8] as V3 },
  ];
  add([0, -0.5, 0], [76, 1, 76], "ground");
  // Solid yard perimeter with open-looking wire panels and corrugated lower sheets.
  for (const side of [-1, 1]) {
    add([side * 35, 3, 0], [0.25, 6, 70], "collision");
    add([0, 3, side * 35], [70, 6, 0.25], "collision");
    for (let v = -35; v <= 35; v += 5) {
      add([side * 35, 2, v], [0.15, 4, 0.15]);
      add([v, 2, side * 35], [0.15, 4, 0.15]);
      for (let y = 0.2; y < 4; y += 0.5) {
        beam([side * 35, y, v], [side * 35, y, Math.min(35, v + 5)], 0.015);
        beam([v, y, side * 35], [Math.min(35, v + 5), y, side * 35], 0.015);
      }
    }
  }
  // Central refinery stack: open undercroft, steel uprights, asymmetric decks and processor.
  for (const x of [-3, 3])
    for (const z of [-3, 3]) {
      add([x, 11, z], [0.32, 22, 0.32]);
      for (let y = 0; y < 18; y += 4) {
        beam([x, y, z], [x === -3 ? 3 : -3, y + 4, z], 0.1);
      }
    }
  add([1.3, 2.1, 0], [2.6, 4.2, 4]);
  deck(-1, 4.4, 0, 12, 10);
  deck(-2, 8.8, 0, 10, 8);
  deck(-1, 13.2, 0, 8, 7);
  deck(0, 18, 0, 6.5, 6.5);
  // Ladders stand outside each deck lip, with a short collision-checked exit onto the platform.
  ladder(-5.4, 5.8, 0, 4.4, [-5.4, 4.46, 4.2]);
  ladder(-6.4, 4.8, 4.4, 8.8, [-6.4, 8.86, 3.2]);
  ladder(-4.4, 4.4, 8.8, 13.2, [-4.4, 13.26, 2.7]);
  ladder(-2, 4.3, 13.2, 18, [-2, 18.06, 2.5]);
  for (let y = 5; y < 19; y += 4) {
    add([3.05, y, 0], [0.1, 1.5, 4], "metal");
    add([0, y, -3.05], [4, 1.5, 0.1], "metal");
  }
  pipe([1, 5, -1], [1, 22, -1], 0.9);
  // Long elevated north pipeline and climbing diagonal feeder into the tower.
  pipe([-29, 3, -25], [26, 3, -25], 1);
  pipe([-10, 3, -25], [-4, 7.8, -4], 0.8);
  stairs([27, 0.05, -29], [27, 4, -22], 2.4);
  deck(26, 4, -24, 4, 4);
  for (const x of [-25, -15, 5, 20]) add([x, 1.3, -25], [0.3, 2.6, 2]);
  deck(-23, 4, -17, 10, 10);
  for (const x of [-27, -19])
    for (const z of [-21, -13]) add([x, 2, z], [0.25, 4, 0.25]);
  pipe([-25, 3, -25], [-25, 3, -17], 1);
  ladder(-23, -10.8, 0, 4, [-23, 4.06, -12.6]);
  container(-27, 3, 5, 12, true);
  container(-20, 22, 5, 14);
  container(27, -5, 5, 11, true);
  container(22, 26, 10, 5);
  // Maintenance room has two open doorways and a roof reached by crates or a ladder.
  add([10, 4.1, 8], [7, 0.2, 7]);
  for (const x of [6.5, 13.5]) add([x, 2, 8], [0.15, 4, 7]);
  for (const z of [4.5, 11.5])
    for (const x of [7.7, 12.3]) add([x, 2, z], [2.4, 4, 0.15]);
  ladder(10, 12.5, 0, 4.2, [10, 4.26, 10.7]);
  for (const x of [-10, -5]) {
    add([x, 1.4, 11], [4, 2.8, 5]);
    for (let j = -1; j <= 1; j++)
      add([x + j * 0.8, 2.92, 11], [0.12, 0.18, 4.7]);
  }
  for (const z of [12, 18]) {
    pipe([19, 1.7, z], [26, 1.7, z], 1.5);
    add([22.5, 0.3, z], [8, 0.6, 3.4]);
  }
  for (const [x, z, w, d, h] of [
    [17, -22, 3, 3, 1.1],
    [23, -19, 3, 3, 1.6],
    [-12, 25, 4, 3, 1.2],
    [4, 24, 4, 3, 1.2],
    [17, 6, 2, 3, 1.1],
    [-14, -5, 3, 3, 1.3],
    [-24, -7, 3, 2, 1.1],
    [-4, -15, 3, 2, 1.2],
  ]) {
    add([x, h / 2, z], [w, h, d], "crate");
  }
  // Sand berms and pump silhouettes are outside the playable fence.
  for (let i = 0; i < 8; i++) {
    const x = -60 + i * 17;
    props.push({ kind: "tank", a: [x, -7, -57], b: [x, -1, -57], radius: 12 });
  }
  for (const x of [-46, 48]) {
    beam([x, 0, -14], [x, 10, -14], 0.35);
    beam([x - 5, 10, -14], [x + 6, 8, -14], 0.4);
    beam([x + 6, 8, -14], [x + 6, 1, -14], 0.12);
  }
  // Collision-filtered ground graph for NPCs. Narrow passages remain open to the capsule.
  const cells = new Map<string, number>();
  for (let z = -30; z <= 30; z += 3)
    for (let x = -30; x <= 30; x += 3) {
      const blocked = boxes.some(
        (b) =>
          b.solid &&
          b.kind !== "ground" &&
          b.p[1] + b.s[1] / 2 > 0.2 &&
          b.p[1] - b.s[1] / 2 < 1.9 &&
          Math.abs(x - b.p[0]) < b.s[0] / 2 + 0.55 &&
          Math.abs(z - b.p[2]) < b.s[2] / 2 + 0.55,
      );
      if (!blocked) {
        cells.set(`${x},${z}`, nodes.length);
        nodes.push([x, 0.16, z]);
      }
    }
  for (const [key, i] of cells) {
    const [x, z] = key.split(",").map(Number);
    for (const [dx, dz] of [
      [3, 0],
      [0, 3],
    ]) {
      const j = cells.get(`${x + dx},${z + dz}`);
      if (j === undefined) continue;
      const a = nodes[i],
        b = nodes[j],
        d = Math.hypot(dx, dz);
      if (!worldRay(boxes, [a[0], 1, a[2]], [dx / d, 0, dz / d], d))
        links.push([i, j]);
    }
  }
  const spawns: V3[] = [
    [-30, 0.16, 30],
    [30, 0.16, -30],
    [-30, 0.16, -30],
    [30, 0.16, 30],
    [-30, 0.16, 15],
    [30, 0.16, 5],
    [0, 0.16, 30],
    [15, 0.16, -30],
  ];
  const buildings: Building[] = zones.map((zone, id) => ({
    id,
    parcelId: `rust-${id}`,
    neighborhood: "works",
    facing: 0,
    entrance: zone.p,
    inside: zone.p,
    x: zone.p[0],
    z: zone.p[2],
    w: zone.size[0],
    d: zone.size[2],
    floors: 1,
    height: zone.size[1],
    kind: "industrial",
    name: zone.name,
    route: [],
  }));
  return {
    seed,
    district,
    boxes,
    buildings,
    nodes,
    links,
    spawns,
    bounds: 34.5,
    beacons: [
      [-23, 4.2, -17],
      [0, 18.2, 0],
      [10, 4.4, 8],
    ],
    bridges: [],
    blimps: [],
    platforms: [],
    aerialLinks: [],
    aerialEntries: [],
    flightCeiling: 65,
    plan: { streets: [], blocks: [], parcels: [], landmarks: [], bridges: [] },
    streetNodes: nodes.map((_, i) => i),
    roofLinks: [],
    dressing: [],
    arena: { name: "RUST", props, ladders, zones },
  };
}
