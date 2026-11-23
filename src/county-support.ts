import type { Box, V3 } from "./world.ts";

type Point = [number, number];
export interface FallingSection {
  indices: number[];
  direction: V3;
}
interface Member {
  index: number;
  box: Box;
  lo: V3;
  hi: V3;
  center: V3;
  plate: boolean;
  ground: boolean;
  parents: Member[];
  children: Member[];
  joints: Member[];
  seams: Member[];
}
const touch = 0.065;
const overlap = (a: Member, b: Member, k: number) =>
  Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k]);
const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function hull(points: Point[]) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: Point[]) => {
    const result: Point[] = [];
    for (const p of list) {
      while (
        result.length > 1 &&
        cross(result[result.length - 2], result[result.length - 1], p) <= 0
      )
        result.pop();
      result.push(p);
    }
    result.pop();
    return result;
  };
  return [...half(points), ...half(points.reverse())];
}
function patch(a: Member, b: Member): Point[] {
  const l = Math.max(a.lo[0], b.lo[0]),
    r = Math.min(a.hi[0], b.hi[0]);
  const n = Math.max(a.lo[2], b.lo[2]),
    s = Math.min(a.hi[2], b.hi[2]);
  return [
    [l, n],
    [r, n],
    [r, s],
    [l, s],
  ];
}
function horizontal(dx: number, dz: number): V3 {
  const length = Math.hypot(dx, dz);
  return length > 0.001 ? [dx / length, 0, dz / length] : [0.8, 0, 0.6];
}
function connected(nodes: Set<Member>, adjacency: (m: Member) => Member[]) {
  const todo = new Set(nodes),
    groups: Member[][] = [];
  for (const seed of todo) {
    todo.delete(seed);
    const group = [seed];
    for (let i = 0; i < group.length; i++) {
      for (const n of adjacency(group[i])) if (todo.delete(n)) group.push(n);
    }
    groups.push(group);
  }
  return groups;
}
const structural = (m: Member) => m.plate || m.box.piece === "wall";

// Score the physical mount instead of letting any nearby trim or furnishing
// accidentally carry a wall, window or heavy piece of furniture.
function mountScore(item: Member, host: Member) {
  const kind = item.box.kind,
    piece = item.box.piece;
  const x = overlap(item, host, 0),
    y = overlap(item, host, 1),
    z = overlap(item, host, 2);
  if (piece === "door") {
    if (
      host.box.piece !== "wall" ||
      Math.abs(item.lo[0] - host.hi[0]) > touch ||
      z <= 0
    )
      return 0;
    return y > 0.2 ? y : 0;
  }
  if (kind === "ceiling-light") {
    if (
      !host.plate ||
      Math.abs(item.hi[1] - host.lo[1]) > touch ||
      x <= 0 ||
      z <= 0
    )
      return 0;
    return x * z;
  }
  if (kind === "window") {
    if (host.box.piece !== "wall") return 0;
    // The glazing sits in the sill. The jambs are a fallback for panes that
    // span the full height of an opening.
    if (Math.abs(item.lo[1] - host.hi[1]) < touch && x > 0 && z > 0)
      return 10 + x * z;
    if (y > 0.15 && x >= -touch && z >= -touch) return y;
    return 0;
  }
  if (kind === "sign" || kind === "screen" || kind === "framed-print") {
    if (host.box.piece !== "wall" || x <= 0 || y <= 0 || z < -0.32) return 0;
    // A centred bracket wins over an adjacent wall that grazes the frame.
    const centerMount =
      item.center[0] >= host.lo[0] && item.center[0] <= host.hi[0];
    return (centerMount ? 10 : 0) + x * y;
  }
  if (
    (!host.plate &&
      host.box.piece !== "furniture" &&
      host.box.piece !== "wall") ||
    Math.abs(item.lo[1] - host.hi[1]) > touch ||
    x <= 0 ||
    z <= 0
  )
    return 0;
  return x * z;
}

// A run of seam-connected tiles keeps its original contacts and load geometry
// until another tile breaks away. Only the surviving bearing points can change.
class FloorSpan {
  private contacts: { host: Member; points: Point[]; active: boolean }[] = [];
  private loads: { source: Member; weight: number; mx: number; mz: number }[] =
    [];
  private edge: Point[] = [];
  constructor(
    readonly members: Member[],
    structure: Member[],
  ) {
    for (const tile of members) {
      for (const host of tile.parents)
        this.contacts.push({ host, points: patch(tile, host), active: false });
      for (const n of structure) {
        if (n !== tile && n.lo[1] < tile.hi[1] - touch) continue;
        const l = Math.max(tile.lo[0], n.lo[0]),
          r = Math.min(tile.hi[0], n.hi[0]);
        const b = Math.max(tile.lo[2], n.lo[2]),
          f = Math.min(tile.hi[2], n.hi[2]);
        if (r <= l || f <= b) continue;
        const weight =
          (r - l) * (f - b) * (n.hi[1] - n.lo[1]) * (n.box.mesh ? 0.5 : 1);
        this.loads.push({
          source: n,
          weight,
          mx: (weight * (l + r)) / 2,
          mz: (weight * (b + f)) / 2,
        });
      }
    }
  }
  center(detached: Set<number>): Point {
    let mass = 0,
      cx = 0,
      cz = 0;
    for (const load of this.loads) {
      if (!load.source.box.solid || detached.has(load.source.index)) continue;
      mass += load.weight;
      cx += load.mx;
      cz += load.mz;
    }
    return [cx / mass, cz / mass];
  }
  bearing(anchored: Set<Member>): Point[] {
    let changed = false;
    for (const c of this.contacts) {
      const active = anchored.has(c.host);
      if (c.active !== active) {
        c.active = active;
        changed = true;
      }
    }
    if (changed) {
      const points: Point[] = [];
      for (const c of this.contacts) if (c.active) points.push(...c.points);
      this.edge = hull(points);
    }
    return this.edge;
  }
}

class Frame {
  readonly parts: Member[];
  private structure: Member[];
  private floors = new Map<string, FloorSpan>();
  constructor(indices: number[], boxes: Box[]) {
    this.parts = indices.map((index) => {
      const box = boxes[index];
      const rest =
        (box as Box & { closedDoor?: Pick<Box, "p" | "s"> }).closedDoor ?? box;
      const lo = rest.p.map((v, i) => v - rest.s[i] / 2) as V3;
      const hi = rest.p.map((v, i) => v + rest.s[i] / 2) as V3;
      const plate = box.piece === "floor" || box.piece === "roof";
      return {
        index,
        box,
        lo,
        hi,
        center: [...rest.p],
        plate,
        ground: (plate || box.piece === "wall") && lo[1] <= 0.24,
        parents: [],
        children: [],
        joints: [],
        seams: [],
      };
    });
    this.structure = this.parts.filter(structural);
    // All physical mounts and structural joints need overlapping height
    // intervals (up to the contact tolerance). Cache the nearby storeys in
    // original box order so equally scored brackets still choose the same host.
    const storeyHeight = 3;
    const byStorey = new Map<number, Member[]>();
    for (const b of this.parts) {
      const lo = Math.floor((b.lo[1] - touch) / storeyHeight);
      const hi = Math.floor((b.hi[1] + touch) / storeyHeight);
      for (let k = lo; k <= hi; k++) {
        let band = byStorey.get(k);
        if (!band) {
          band = [];
          byStorey.set(k, band);
        }
        band.push(b);
      }
    }
    const ranges = new Map<string, Member[]>();
    const candidates = (a: Member) => {
      const lo = Math.floor(a.lo[1] / storeyHeight),
        hi = Math.floor(a.hi[1] / storeyHeight);
      if (lo === hi) return byStorey.get(lo)!;
      const key = lo + "," + hi;
      let nearby = ranges.get(key);
      if (!nearby) {
        const unique = new Set<Member>();
        for (let k = lo; k <= hi; k++)
          for (const m of byStorey.get(k) ?? []) unique.add(m);
        nearby = [...unique].sort((a, b) => a.index - b.index);
        ranges.set(key, nearby);
      }
      return nearby;
    };
    for (const a of this.parts) {
      const nearby = candidates(a);
      // A wall print or theatre screen can stand off its wall up to 32 cm.
      const mountDepth =
        a.box.kind === "sign" ||
        a.box.kind === "screen" ||
        a.box.kind === "framed-print"
          ? 0.32
          : touch;
      if (!structural(a)) {
        let best = 0,
          mount: Member | undefined;
        for (const b of nearby) {
          if (
            a === b ||
            overlap(a, b, 0) < -touch ||
            overlap(a, b, 2) < -mountDepth
          )
            continue;
          const score = mountScore(a, b);
          if (score > best) {
            mount = b;
            best = score;
          }
        }
        if (mount) this.attach(a, mount);
        else a.ground = a.lo[1] <= 0.24;
        continue;
      }
      for (const b of nearby) {
        if (a === b || !structural(b)) continue;
        const x = overlap(a, b, 0),
          y = overlap(a, b, 1),
          z = overlap(a, b, 2);
        if (x < -touch || y < -touch || z < -touch) continue;
        const side = (x > 0.08 && z >= -touch) || (z > 0.08 && x >= -touch);
        if (x > 0.014 && z > 0.014 && Math.abs(a.lo[1] - b.hi[1]) < touch) {
          this.attach(a, b);
        } else if (
          a.plate &&
          b.plate &&
          Math.abs(a.lo[1] - b.lo[1]) < touch &&
          side
        ) {
          a.seams.push(b);
          a.joints.push(b);
        } else if (
          a.box.piece === "wall" &&
          b.box.piece === "wall" &&
          y > 0.08 &&
          side
        ) {
          a.joints.push(b);
          // A lintel can bridge a gap via a taller jamb. Same-height piers
          // cannot keep each other floating after losing their bearing floor.
          if (b.lo[1] < a.lo[1] - 0.2 && b.hi[1] >= a.hi[1] - touch) {
            a.parents.push(b);
            b.children.push(a);
          }
        }
      }
    }
  }
  private attach(child: Member, host: Member) {
    child.parents.push(host);
    host.children.push(child);
    child.joints.push(host);
    host.joints.push(child);
  }
  lost(removed: number, detached: Set<number>): FallingSection[] {
    const live = this.parts.filter(
      (n) => n.box.solid && !detached.has(n.index),
    );
    const anchored = new Set<Member>();
    // Propagate from a newly supported wall or slab directly to its children.
    // Each surviving non-slab mount enters this queue at most once per break.
    const support = (seeds: Member[]) => {
      const queue = seeds.slice();
      for (const n of queue) anchored.add(n);
      for (let i = 0; i < queue.length; i++)
        for (const child of queue[i].children) {
          if (
            child.plate ||
            !child.box.solid ||
            detached.has(child.index) ||
            anchored.has(child)
          )
            continue;
          anchored.add(child);
          queue.push(child);
        }
    };
    support(live.filter((n) => n.ground));
    const plates = connected(
      new Set(live.filter((n) => n.plate && !n.ground)),
      (m) => m.seams,
    );
    const directions = new Map<Member, V3>();
    const spans = plates.map((members) => {
      const id = members.map((n) => n.index).join(",");
      let floor = this.floors.get(id);
      if (!floor) {
        floor = new FloorSpan(members, this.structure);
        this.floors.set(id, floor);
      }
      return { floor, center: floor.center(detached) };
    });
    // Lower floors normally settle the support decision for the next floor
    // in the same pass. Repeat only for unusual compound arrangements.
    spans.sort((a, b) => a.floor.members[0].lo[1] - b.floor.members[0].lo[1]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const { floor, center } of spans) {
        const members = floor.members;
        if (anchored.has(members[0])) continue;
        const edge = floor.bearing(anchored);
        if (!edge.length) continue;
        let margin = Infinity,
          direction: V3 = [0, 0, 0];
        for (let i = 0; i < edge.length; i++) {
          const a = edge[i],
            b = edge[(i + 1) % edge.length];
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (!length) continue;
          const distance = cross(a, b, center) / length;
          if (distance < margin) {
            margin = distance;
            direction = horizontal(b[1] - a[1], a[0] - b[0]);
          }
        }
        if (edge.length >= 3 && margin >= -0.025) {
          support(members);
          changed = true;
        } else {
          for (const n of members) directions.set(n, direction);
        }
      }
    }
    const hit = this.parts.find((n) => n.index === removed)!;
    const unsupported = new Set(live.filter((n) => !anchored.has(n)));
    return connected(unsupported, (n) => n.joints).map((group) => {
      const plate = group.find((n) => directions.has(n));
      const center = group.reduce(
        (c, n) => [c[0] + n.center[0], c[1] + n.center[2]] as Point,
        [0, 0] as Point,
      );
      const direction = plate
        ? directions.get(plate)!
        : horizontal(
            hit.center[0] - center[0] / group.length,
            hit.center[2] - center[1] / group.length,
          );
      return {
        indices: group.map((n) => n.index).sort((a, b) => a - b),
        direction,
      };
    });
  }
}

export class CountySupport {
  private buildings = new Map<string, number[]>();
  private frames = new Map<string, Frame>();
  private detached = new Set<number>();
  constructor(private boxes: Box[]) {
    boxes.forEach((b, i) => {
      if (!b.buildingId || !b.piece) return;
      const members = this.buildings.get(b.buildingId) ?? [];
      members.push(i);
      this.buildings.set(b.buildingId, members);
    });
  }
  lost(index: number): FallingSection[] {
    const building = this.boxes[index]?.buildingId;
    if (!building || this.detached.has(index)) return [];
    let frame = this.frames.get(building);
    if (!frame) {
      frame = new Frame(this.buildings.get(building)!, this.boxes);
      this.frames.set(building, frame);
    }
    const groups = frame.lost(index, this.detached);
    for (const group of groups)
      for (const i of group.indices) this.detached.add(i);
    return groups;
  }
}
