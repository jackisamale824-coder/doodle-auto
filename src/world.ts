export type V3 = [number, number, number];
export interface Box {
  p: V3;
  s: V3;
  kind: string;
  solid: boolean;
  ink?: string;
}
export interface Building {
  id: number;
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
  seed: string;
  district: number;
  boxes: Box[];
  buildings: Building[];
  beacons: V3[];
  spawns: V3[];
  nodes: V3[];
  links: [number, number][];
  bounds: number;
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
  return lo;
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
export function generateCity(seed: string, district = 1): City {
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
  const bounds = 90;
  add([0, -0.5, 0], [190, 1, 190], "ground");
  // Streets establish the block grid; lot variation stays inside generous pedestrian alleys.
  for (let i = -3; i <= 2; i++) {
    const q = i * 30 + 15;
    add([q, 0.006, 0], [7, 0.012, 180], "road", false);
    add([0, 0.007, q], [180, 0.014, 7], "road", false);
    for (let k = -84; k < 87; k += 7) {
      add([q, 0.02, k], [0.12, 0.02, 2.5], "mark", false);
      add([k, 0.02, q], [2.5, 0.02, 0.12], "mark", false);
    }
  }
  const streetGrid = new Map<string, number>();
  for (let ix = -3; ix <= 2; ix++)
    for (let iz = -3; iz <= 2; iz++)
      streetGrid.set(`${ix},${iz}`, node([ix * 30 + 15, 0.1, iz * 30 + 15]));
  for (let ix = -3; ix <= 2; ix++)
    for (let iz = -3; iz <= 2; iz++)
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ]) {
        const a = streetGrid.get(`${ix},${iz}`),
          b = streetGrid.get(`${ix + dx},${iz + dz}`);
        if (a !== undefined && b !== undefined) links.push([a, b]);
      }
  for (let iz = -2; iz <= 2; iz++)
    for (let ix = -2; ix <= 2; ix++) {
      const id = buildings.length,
        x = ix * 30,
        z = iz * 30;
      const kind =
        Math.abs(ix) === 2
          ? "warehouse"
          : iz === 0
            ? "shop"
            : (ix + iz) % 3 === 0
              ? "office"
              : "apartment";
      const w = kind === "warehouse" ? 22 : 17 + Math.floor(rand() * 4),
        d = kind === "warehouse" ? 22 : 18 + Math.floor(rand() * 3);
      const floors = kind === "warehouse" ? 2 : 2 + Math.floor(rand() * 3),
        height = floors * 3.6;
      const b: Building = {
        id,
        x,
        z,
        w,
        d,
        floors,
        height,
        kind,
        name: names[kind][Math.floor(rand() * 4)],
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
      ) => add([x + px, y, z + pz], [sx, sy, sz], k, solid);
      // Sidewalk, threshold and door frame. The center of the front wall is intentionally open.
      box(0, 0.06, 0, w + 3, 0.12, d + 3, "pavement");
      box(0, 0.13, 0, w, 0.14, d, "floor");
      const stairX = -w / 2 + 2.1,
        run = d - 4,
        steps = 20;
      // Enclosed stairwell sides protect the flight from lateral momentum and leave both landings open.
      for (const side of [-1, 1])
        box(stairX + side * 1.52, height / 2, 0, 0.16, height, run, "wall");
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
      const entrance = node([x, 0.16, z + d / 2 + 2]),
        inside = node([x, 0.16, z + d / 2 - 1]);
      links.push([entrance, inside]);
      let last = inside;
      for (const p of b.route) {
        const n = node(p);
        links.push([last, n]);
        last = n;
      }
      // Connect both front corners to the front door along the public sidewalk.
      for (const corner of [ix - 1, ix]) {
        const sid = streetGrid.get(`${corner},${iz}`)!;
        const n = node([nodes[sid][0], 0.16, z + d / 2 + 2]);
        links.push([sid, n], [n, entrance]);
      }
      // Street cover is offset from doors, keeping an obvious walkable approach.
      box(w / 2 - 2, 0.5, d / 2 + 2.25, 2, 1, 0.8, "prop");
    }
  // A small training plaza beside the central spawn has deliberately vaultable barriers.
  for (const x of [10.5, 19.5]) add([x, 0.65, 20], [1.3, 1.3, 3], "prop");
  // Collision hulls correspond to the detailed render-only tank and car meshes.
  for (const b of buildings)
    if (b.id % 4 === 0)
      add([b.x + 4, b.height + 2.6, b.z - 4], [2.4, 2.8, 2.4], "collision");
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++)
      if ((i + j) % 3 === 0)
        add([i * 30 + 12.8, 0.85, j * 30 + 3], [1.8, 1.3, 3.7], "collision");
  const picks = [buildings[7], buildings[18], buildings[21]];
  return {
    seed,
    district,
    boxes,
    buildings,
    beacons: picks.map((b) => [b.x + 2, b.height + 0.2, b.z + 2]),
    spawns: [
      [15, 0.2, 24],
      [45, 0.2, -15],
      [-15, 0.2, -45],
      [-45, 0.2, 45],
      [75, 0.2, 15],
      [-75, 0.2, -15],
      [15, 0.2, 75],
      [-15, 0.2, -75],
    ],
    nodes,
    links,
    bounds,
  };
}
