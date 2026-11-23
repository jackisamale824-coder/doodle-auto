import { meshRay, type TriangleMesh } from "./mesh-collision.ts";
import type { Arena } from "./rust.ts";
import {
  skyField,
  type Blimp,
  type SkyBridge,
  type FloatingPlatform,
} from "./aerial.ts";
import {
  planCity,
  NEIGHBORHOODS,
  type CityPlan,
  type NeighborhoodId,
  type CityOverrides,
} from "./city-plan.ts";
export type V3 = [number, number, number];
export type PieceState = 0 | 1 | 2;
export interface Box {
  piece?: "door" | "wall" | "roof" | "floor" | "furniture" | "fixture";
  pieceId?: number;
  buildingId?: string;
  onPieceState?: (state: PieceState) => void;
  mesh?: TriangleMesh;
  p: V3;
  s: V3;
  kind: string;
  solid: boolean;
  ink?: string;
  cell?: [number, number];
}
export interface Building {
  id: number;
  parcelId: string;
  neighborhood: NeighborhoodId;
  facing: number;
  entrance: V3;
  inside: V3;
  x: number;
  z: number;
  w: number;
  d: number;
  floors: number;
  height: number;
  kind: string;
  name: string;
  route: V3[];
}
export interface City {
  arena?: Arena;
  seed: string;
  district: number;
  boxes: Box[];
  buildings: Building[];
  beacons: V3[];
  spawns: V3[];
  nodes: V3[];
  links: [number, number][];
  bounds: number;
  bridges: SkyBridge[];
  blimps: Blimp[];
  platforms: FloatingPlatform[];
  aerialLinks: [string, string][];
  aerialEntries: { building: number; hook: string }[];
  flightCeiling: number;
  plan: CityPlan;
  streetNodes: number[];
  roofLinks: {
    from: number;
    to: number;
    kind: "jump" | "grapple";
    distance: number;
  }[];
  dressing: { kind: "lamp" | "tree" | "car"; p: V3 }[];
}
export function randomSeed(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let n = Math.imul(h ^ (h >>> 15), 1 | h);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export const distance = (a: V3, b: V3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function rayBox(o: V3, d: V3, b: Box, max = Infinity): number | null {
  let lo = 0,
    hi = max;
  for (let a = 0; a < 3; a++) {
    const min = b.p[a] - b.s[a] / 2,
      maxB = b.p[a] + b.s[a] / 2;
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min || o[a] > maxB) return null;
    } else {
      let t1 = (min - o[a]) / d[a],
        t2 = (maxB - o[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      lo = Math.max(lo, t1);
      hi = Math.min(hi, t2);
      if (lo > hi) return null;
    }
  }
  return b.mesh ? meshRay(b.mesh, o, d, max) : lo;
}
export function worldRay(boxes: Box[], o: V3, d: V3, max: number) {
  let best = max,
    box: Box | null = null;
  for (const b of boxes) {
    if (!b.solid) continue;
    const t = rayBox(o, d, b, best);
    if (t !== null && t < best) {
      best = t;
      box = b;
    }
  }
  return box
    ? { distance: best, box, point: o.map((v, i) => v + d[i] * best) as V3 }
    : null;
}
const names: Record<string, string[]> = {
  apartment: ["PAPER HOUSE", "BLUEBIRD FLATS", "THE MARGINS", "STUDIO 04"],
  shop: ["CORNER COFFEE", "INK & SUNDRY", "PENNY RECORDS", "DAILY BREAD"],
  office: ["THE PRESS", "ARCHIVE CO.", "LINEWORK STUDIO", "PAPERWORK"],
  warehouse: ["INK WORKS", "NORTH DEPOT", "PAPER MILL", "LOADING BAY"],
};
export function generateCity(
  seed: string,
  district = 1,
  overrides: CityOverrides = {},
): City {
  const rand = randomSeed(seed + ":" + district),
    boxes: Box[] = [],
    buildings: Building[] = [],
    nodes: V3[] = [],
    links: [number, number][] = [];
  const add = (p: V3, s: V3, kind = "wall", solid = true, ink?: string) =>
    boxes.push({ p, s, kind, solid, ...(ink ? { ink } : {}) });
  const node = (p: V3) => {
    nodes.push(p);
    return nodes.length - 1;
  };
  const bounds = 292;
  add([0, -0.5, 0], [bounds * 2 + 10, 1, bounds * 2 + 10], "ground");
  const plan = planCity(seed, district, overrides);
  const streetMap = new Map<string, number>();
  const streetNode = (p: V3) => {
    const key = `${p[0]},${p[2]}`;
    if (!streetMap.has(key)) streetMap.set(key, node([p[0], 0.16, p[2]]));
    return streetMap.get(key)!;
  };
  for (const street of plan.streets) {
    const vertical = street.a[0] === street.b[0];
    const length = distance(street.a, street.b);
    add(
      [(street.a[0] + street.b[0]) / 2, 0.006, (street.a[2] + street.b[2]) / 2],
      vertical ? [street.width, 0.012, length] : [length, 0.012, street.width],
      "road",
      false,
    );
    links.push([streetNode(street.a), streetNode(street.b)]);
    for (let d = 4; d < length - 3; d += 7) {
      const t = d / length;
      add(
        [
          street.a[0] + (street.b[0] - street.a[0]) * t,
          0.016,
          street.a[2] + (street.b[2] - street.a[2]) * t,
        ],
        vertical ? [0.12, 0.012, 2.5] : [2.5, 0.012, 0.12],
        "mark",
        false,
      );
    }
  }
  const streetNodes = [...streetMap.values()];
  const roofNodes = new Map<number, number>();
  for (const parcel of plan.parcels) {
    const { x, z, w, d, kind, facing } = parcel;
    const authored = overrides.buildings?.[parcel.id];
    const floors = Math.max(1, Math.min(16, authored?.floors ?? parcel.floors));
    const rand = randomSeed(`${seed}:${district}:${parcel.id}:kit`);
    const id = buildings.length,
      height = floors * 3.6,
      front = facing === 2 ? -1 : 1;
    const b: Building = {
      id,
      parcelId: parcel.id,
      neighborhood: parcel.neighborhood,
      facing,
      entrance: [x, 0.16, z + front * (d / 2 + 2)],
      inside: [x, 0.16, z + front * (d / 2 - 1)],
      x,
      z,
      w,
      d,
      floors,
      height,
      kind,
      name: authored?.name ?? names[kind][Math.floor(rand() * 4)],
      route: [],
    };
    buildings.push(b);
    const box = (
      px: number,
      y: number,
      pz: number,
      sx: number,
      sy: number,
      sz: number,
      k = "wall",
      solid = true,
    ) => {
      const index = add(
        [x + front * px, y, z + front * pz],
        [sx, sy, sz],
        k,
        solid,
      );
      boxes[index - 1].cell = [Math.floor(x / 66), Math.floor(z / 66)];
      return index;
    };
    // Sidewalk, threshold and door frame. The center of the front wall is intentionally open.
    box(0, 0.006, 0, w + 3, 0.012, d + 3, "pavement", false);
    box(0, -0.07, 0, w, 0.14, d, "floor");
    const stairX = -w / 2 + 2.1,
      run = d - 4,
      steps = 20;
    // Enclosed stairwell sides protect the flight from lateral momentum and leave both landings open.
    for (const side of [-1, 1])
      box(
        stairX + side * 1.52,
        (height + 0.9) / 2,
        0,
        0.16,
        height + 0.9,
        run,
        "wall",
      );
    for (let f = 0; f < floors; f++) {
      const y = f * 3.6;
      // Each wall is composed around real openings, including a walk-through front door.
      const wall = (horizontal: boolean, side: number, len: number) => {
        const segments = Math.round(len / 3.8) | 1,
          sw = len / segments;
        for (let n = 0; n < segments; n++) {
          const off = -len / 2 + sw * (n + 0.5),
            isDoor =
              horizontal && side === 1 && f === 0 && Math.abs(off) < sw * 0.6;
          const wx = horizontal ? off : (side * w) / 2,
            wz = horizontal ? (side * d) / 2 : off;
          if (isDoor) {
            if (horizontal) {
              box(wx, y + 3.15, wz, sw, 0.9, 0.25);
              box(wx - sw / 2 + 0.13, y + 1.35, wz, 0.26, 2.7, 0.25);
              box(wx + sw / 2 - 0.13, y + 1.35, wz, 0.26, 2.7, 0.25);
            }
            continue;
          }
          if (horizontal) {
            box(wx, y + 0.5, wz, sw, 1, 0.25);
            box(wx, y + 3.15, wz, sw, 0.9, 0.25);
            box(wx - sw / 2 + 0.18, y + 1.85, wz, 0.36, 1.7, 0.25);
            box(wx, y + 1.85, wz, 0.065, 1.7, 0.12, "trim", false);
            box(wx, y + 1.85, wz, sw, 0.065, 0.12, "trim", false);
          } else {
            box(wx, y + 0.5, wz, 0.25, 1, sw);
            box(wx, y + 3.15, wz, 0.25, 0.9, sw);
            box(wx, y + 1.85, wz - sw / 2 + 0.18, 0.25, 1.7, 0.36);
            box(wx, y + 1.85, wz, 0.12, 1.7, 0.065, "trim", false);
            box(wx, y + 1.85, wz, 0.12, 0.065, sw, "trim", false);
          }
        }
      };
      wall(true, 1, w);
      wall(true, -1, w);
      wall(false, 1, d);
      wall(false, -1, d);
      // Full storey slabs have a continuous stair void, plus front and rear landings.
      box(2, y + 3.6, 0, w - 4, 0.22, d, "floor");
      box(-w / 2 + 2, y + 3.6, -d / 2 + 1, 4, 0.22, 2, "floor");
      box(-w / 2 + 2, y + 3.6, d / 2 - 1, 4, 0.22, 2, "floor");
      for (let s = 0; s < steps; s++) {
        const rise = ((s + 1) * 3.6) / steps;
        box(
          stairX,
          y + rise - 0.09,
          d / 2 - 2 - ((s + 0.5) * run) / steps,
          2.7,
          0.18,
          run / steps,
          "stairs",
        );
      }
      // Waypoints follow a real loop: front landing -> stairs -> back landing -> floor -> next flight.
      const path: V3[] = [
        [x + stairX, y + 0.15, z + d / 2 - 1.2],
        [x + stairX, y + 0.45, z + d / 2 - 2.4],
        [x + stairX, y + 3.6, z - d / 2 + 2.1],
        [x + stairX, y + 3.75, z - d / 2 + 1],
        [x - w / 2 + 5.2, y + 3.75, z - d / 2 + 1],
        [x - w / 2 + 5.2, y + 3.75, z + d / 2 - 1],
      ];
      b.route.push(...path);
      box(w / 2 - 2, y + 0.6, -d / 2 + 2, 2.1, 1.2, 1.1, "furniture");
      if (f === 0 && kind === "shop")
        box(2, y + 0.55, -2, 4, 1.1, 1, "furniture");
      // Architectural cornices articulate the skyline rather than using featureless blocks.
      box(0, y + 3.5, d / 2 + 0.18, w + 0.65, 0.18, 0.65, "trim");
      box(w / 2 + 0.18, y + 3.5, 0, 0.65, 0.18, d, "trim");
    }
    // Safe rooftop parapets leave openings at front/back for parkour routes.
    box(-w / 2, height + 0.4, 0, 0.3, 0.8, d);
    box(w / 2, height + 0.4, 0, 0.3, 0.8, d);
    for (const side of [-1, 1])
      for (const end of [-1, 1])
        box(
          end * (w / 4 + 1),
          height + 0.4,
          (side * d) / 2,
          w / 2 - 2,
          0.8,
          0.3,
        );
    box(w / 2 - 3, height + 0.55, -d / 2 + 3, 2.5, 1.1, 2.1, "vent");
    box(w / 2 - 5, height + 0.4, 2, 1.3, 0.8, 1.3, "vent");
    b.route.push([x + 1, height + 0.16, z]);
    // External fire escape platforms form climbable alternate routes on residential blocks.
    if (kind === "apartment")
      for (let f = 1; f <= floors; f++) {
        box(w / 2 + 1, f * 3.6, 2, 2, 0.16, 4, "metal");
        box(w / 2 + 1.9, f * 3.6 + 0.5, 2, 0.12, 1, 4, "metal");
        for (let r = 0; r < 9; r++)
          box(
            w / 2 + 0.45,
            (f - 1) * 3.6 + r * 0.4 + 0.2,
            0.3,
            0.9,
            0.09,
            0.18,
            "metal",
          );
      }
    b.route = b.route.map((p) => [
      x + (p[0] - x) * front,
      p[1],
      z + (p[2] - z) * front,
    ]);
    const entrance = node(b.entrance),
      inside = node(b.inside);
    links.push([entrance, inside]);
    let last = inside;
    for (const point of b.route) {
      const n = node(point);
      links.push([last, n]);
      last = n;
    }
    roofNodes.set(b.id, last);
    const street = plan.streets.find((s) => s.id === parcel.streetId)!;
    const approach = node([x, 0.16, street.a[2]]);
    links.push(
      [streetNode(street.a), approach],
      [approach, streetNode(street.b)],
      [approach, entrance],
    );
    // Street cover is offset from doors, keeping an obvious walkable approach.
    box(w / 2 - 2, 0.5, d / 2 + 2.25, 2, 1, 0.8, "prop");
  }
  // A small training plaza beside the central spawn has deliberately vaultable barriers.
  for (const x of [10.5, 19.5]) add([x, 0.65, 20], [1.3, 1.3, 3], "prop");
  // Dressing reads frontage and excludes entrances. Hulls and render placements share these records.
  const dressing: City["dressing"] = [];
  for (const b of buildings) {
    const front = b.facing === 2 ? -1 : 1;
    if (b.id % 4 === 0)
      add(
        [b.x + front * 4, b.height + 2.6, b.z - front * 4],
        [2.4, 2.8, 2.4],
        "collision",
      );
    const street = plan.streets.find(
      (s) => s.id === plan.parcels.find((p) => p.id === b.parcelId)!.streetId,
    )!;
    const px = b.x + b.w / 2 - 2,
      pz = street.a[2] - front * (street.width / 2 + 1);
    dressing.push({ kind: "lamp", p: [px, 0, pz] });
    add([px, 2.5, pz], [0.12, 5, 0.12], "collision");
    if (b.neighborhood === "heights") {
      dressing.push({ kind: "tree", p: [px - 3, 0, pz] });
      add([px - 3, 1.35, pz], [0.24, 2.7, 0.24], "collision");
    }
    if (b.id % 3 === 0) {
      const p: V3 = [
        b.x + b.w / 2 - 2,
        0,
        street.a[2] - front * (street.width / 2 - 1.1),
      ];
      dressing.push({ kind: "car", p });
      add([p[0], 0.85, p[2]], [3.7, 1.3, 1.8], "collision");
    }
  }
  const bridges: SkyBridge[] = [];
  for (const pair of plan.bridges) {
    const a = buildings.find((b) => b.parcelId === pair.a)!,
      b = buildings.find((b) => b.parcelId === pair.b)!;
    const south = a.z > b.z ? a : b,
      north = a.z > b.z ? b : a;
    const from: V3 = [
        north.x,
        north.height + 0.13,
        north.z + north.d / 2 - 0.6,
      ],
      to: V3 = [south.x, south.height + 0.13, south.z - south.d / 2 + 0.6];
    if (Math.abs(from[1] - to[1]) > 0.01) continue;
    const z = (from[2] + to[2]) / 2,
      len = to[2] - from[2];
    if (len <= 0 || len > 24) continue;
    bridges.push({ a: north.id, b: south.id, from, to, width: 2.6 });
    add([from[0], from[1] - 0.13, z], [2.6, 0.26, len], "bridge");
    for (const side of [-1, 1]) {
      add(
        [from[0] + side * 1.23, from[1] + 0.95, z],
        [0.12, 0.14, len],
        "bridge",
      );
      for (let v = from[2]; v <= to[2]; v += 2.5)
        add(
          [from[0] + side * 1.23, from[1] + 0.45, v],
          [0.12, 0.9, 0.12],
          "bridge",
        );
    }
    const n = node(from),
      m = node(to);
    links.push(
      [roofNodes.get(north.id)!, n],
      [n, m],
      [m, roofNodes.get(south.id)!],
    );
  }
  const aerial = skyField(buildings, 292);
  const { platforms, blimps } = aerial;
  for (const p of platforms)
    add([p.p[0], p.p[1] - 0.25, p.p[2]], p.size, "sky-platform");
  const roofCells = new Map<string, Box[]>();
  for (const box of boxes)
    if (box.solid) {
      for (
        let x = Math.floor((box.p[0] - box.s[0] / 2) / 32);
        x <= Math.floor((box.p[0] + box.s[0] / 2) / 32);
        x++
      )
        for (
          let z = Math.floor((box.p[2] - box.s[2] / 2) / 32);
          z <= Math.floor((box.p[2] + box.s[2] / 2) / 32);
          z++
        ) {
          const key = x + "," + z;
          if (!roofCells.has(key)) roofCells.set(key, []);
          roofCells.get(key)!.push(box);
        }
    }
  const roofCandidates = (a: V3, b: V3) => {
    const found = new Set<Box>();
    for (
      let x = Math.floor(Math.min(a[0], b[0]) / 32);
      x <= Math.floor(Math.max(a[0], b[0]) / 32);
      x++
    )
      for (
        let z = Math.floor(Math.min(a[2], b[2]) / 32);
        z <= Math.floor(Math.max(a[2], b[2]) / 32);
        z++
      )
        for (const box of roofCells.get(x + "," + z) || []) found.add(box);
    return [...found];
  };
  const roofLinks: City["roofLinks"] = [];
  for (const b of buildings)
    for (const other of buildings) {
      if (other.id <= b.id) continue;
      const a: V3 = [b.x, b.height + 1, b.z],
        t: V3 = [other.x, other.height + 1, other.z];
      const len = distance(a, t),
        gap = Math.max(
          Math.abs(b.x - other.x) - (b.w + other.w) / 2,
          Math.abs(b.z - other.z) - (b.d + other.d) / 2,
        );
      if (len > 55 || Math.abs(b.height - other.height) > 11) continue;
      const dir = a.map((v, i) => (t[i] - v) / len) as V3;
      if (worldRay(roofCandidates(a, t), a, dir, len - 0.5)) continue;
      roofLinks.push({
        from: b.id,
        to: other.id,
        kind:
          gap < 5 && Math.abs(b.height - other.height) < 1 ? "jump" : "grapple",
        distance: len,
      });
    }
  const picks = NEIGHBORHOODS.slice(1).map(
    (n) =>
      buildings
        .filter((b) => b.neighborhood === n.id)
        .sort((a, b) => b.height - a.height)[0],
  );
  return {
    seed,
    district,
    boxes,
    buildings,
    beacons: picks.map((b) => [b.x + 1, b.height + 0.2, b.z] as V3),
    spawns: [
      [15, 0.16, 24],
      ...streetNodes
        .filter((i) => distance(nodes[i], [15, 0, 24]) > 25)
        .sort(
          (a, b) =>
            distance(nodes[a], [15, 0, 24]) - distance(nodes[b], [15, 0, 24]),
        )
        .filter((_, i) => i % 2 === 0)
        .slice(0, 7)
        .map((i) => nodes[i]),
    ] as V3[],
    nodes,
    links,
    bounds,
    bridges,
    blimps,
    platforms,
    aerialLinks: aerial.links,
    aerialEntries: aerial.entries,
    flightCeiling: aerial.ceiling,
    plan,
    streetNodes,
    roofLinks,
    dressing,
  };
}
