import { randomSeed, type V3 } from "./world.ts";
import type { CityPlan, NeighborhoodId, Street } from "./city-plan.ts";

export const COUNTY = "switchback-county";
export const TOWNS = [-320, 320];
export const LIMIT = 800;

// The valley floor sets the course of the county road even beyond the towns.
function valleyZ(x: number) {
  const town = x < 0 ? TOWNS[0] : TOWNS[1];
  const rise = Math.min(1, Math.max(0, (Math.abs(x - town) - 130) / 95));
  const meander =
    (x < 0 ? 0.3 : 0.52) + (x < 0 ? 0.7 : 0.48) * rise * rise * (3 - 2 * rise);
  return meander * (29 * Math.sin(x / 91) + 16 * Math.sin(x / 57));
}
export function elevation(x: number, z: number) {
  const valleyShoulder = Math.max(0, Math.abs(z - valleyZ(x)) - 42) / 150;
  const townShoulder = Math.min(
    ...TOWNS.map(
      (t) =>
        Math.max(0, Math.max(Math.abs(x - t) - 220, Math.abs(z) - 220)) / 100,
    ),
  );
  const hills = Math.min(1, valleyShoulder, townShoulder);
  return hills * hills * (38 + 23 * Math.sin(x / 93) + 15 * Math.cos(z / 72));
}

export interface CountyLot {
  town: number;
  x: number;
  z: number;
  w: number;
  d: number;
  choice: number;
  variation: number;
  front: Street;
  side: Street;
  landmark?: "hall" | "cinema" | "market";
}
export const ruralRoad = (s: Street) => s.id.startsWith("county-road-");
export function alongStreet(s: Street, t: number, offset = 0): V3 {
  const dx = s.b[0] - s.a[0],
    dz = s.b[2] - s.a[2],
    length = Math.hypot(dx, dz);
  return [
    s.a[0] + dx * t - (dz / length) * offset,
    0,
    s.a[2] + dz * t + (dx / length) * offset,
  ];
}

// Grow each row back from the main street. Wide freight parcels often absorb
// a cross street; the eastern terraces keep shorter frontages around the
// market and more breathing room uphill. Every block retains through frontage.
function rowBoundaries(west: boolean, row: number, xs: number[], seed: string) {
  const rand = randomSeed(seed + (west ? "-mill-" : "-terrace-") + row);
  const edgeDistance = Math.min(Math.abs(row - 2), Math.abs(row - 3));
  const fringe = () =>
    edgeDistance === 0 ? 0 : Math.floor(edgeDistance * (0.4 + rand() * 0.67));
  const first = fringe(),
    end = xs.length - 1 - fringe();
  const boundaries = [first];
  for (let i = first + 1; i < end; i++) {
    const previous = boundaries[boundaries.length - 1];
    const collector = i === (west ? 3 : 2);
    const landmarkAccess = (row === 3 || row === 4) && i >= 2 && i <= 4;
    const yard = west && i <= 2;
    const mergeChance = yard
      ? 0.64
      : 0.1 + edgeDistance * (west ? 0.045 : 0.12);
    if (
      xs[i + 1] - xs[previous] > 131 ||
      collector ||
      landmarkAccess ||
      rand() > mergeChance
    )
      boundaries.push(i);
  }
  boundaries.push(end);
  return boundaries;
}

export function planCounty(seed = COUNTY) {
  const plan: CityPlan = {
    streets: [],
    blocks: [],
    parcels: [],
    bridges: [],
    landmarks: [],
  };
  const lots: CountyLot[] = [];
  const gateways: V3[] = [];
  for (const town of TOWNS) {
    const west = town < 0;
    // Freight yards grew on a narrow rectilinear survey. The eastern terraces
    // fan apart away from the market, joined by short streets across the slope.
    const xs = west
      ? [-170, -108, -52, 0, 51, 106, 167]
      : [-164, -101, -42, 13, 76, 144];
    const zs = west
      ? [-155, -101, -51, 0, 51, 105, 158]
      : [-157, -104, -54, 0, 54, 114, 168];
    const spans = zs.slice(1).map((_, j) => rowBoundaries(west, j, xs, seed));
    const points: V3[][] = zs.map((v, j) =>
      xs.map((u, i) => {
        const spread = west ? 1 : 1 + 0.0008 * v;
        const skew = west
          ? i === 3
            ? 0
            : v * 0.035 * Math.sin(i)
          : v * 0.12 + Math.sin(v / 65) * 8;
        const x = town + u * spread + skew;
        // Both main streets follow the same valley as the inter-town highway.
        const terrace = west
          ? v * 0.025 * Math.sin(i)
          : v * 0.075 * Math.sin(i * 1.1 + j * 0.35);
        return [x, 0, valleyZ(x) + v + terrace];
      }),
    );
    gateways.push(points[3][0], points[3][xs.length - 1]);
    const streets = new Map<string, Street>();
    function segment(i: number, j: number, horizontal: boolean) {
      const id = `${west ? "mill" : "terrace"}-${horizontal ? "h" : "v"}${i}-${j}`;
      const existing = streets.get(id);
      if (existing) return existing;
      const arterial = horizontal && j === 3;
      const collector = horizontal
        ? j === (west ? 2 : 4)
        : i === (west ? 3 : 2);
      const width = arterial ? 14 : collector ? 11 : west ? 8.6 : 7.6;
      const street: Street = {
        id,
        a: points[j][i],
        b: points[j + Number(!horizontal)][i + Number(horizontal)],
        width,
        class: arterial ? "arterial" : "local",
      };
      streets.set(id, street);
      plan.streets.push(street);
      return street;
    }
    spans.forEach((boundaries, j) =>
      boundaries.slice(1).forEach((end, k) => {
        const start = boundaries[k];
        const left = segment(start, j, false),
          right = segment(end, j, false);
        const north: Street[] = [],
          south: Street[] = [];
        for (let i = start; i < end; i++) {
          north.push(segment(i, j, true));
          south.push(segment(i, j + 1, true));
        }
        const id = `${west ? "mill" : "terrace"}-block-${j}-${start}`;
        const rand = randomSeed(seed + id);
        const boundary = [left, right, ...north, ...south];
        const vertices = boundary.flatMap((s) => [s.a, s.b]);
        const neighborhood: NeighborhoodId = west
          ? start < 2
            ? "works"
            : "market"
          : Math.abs(j - 3) < 2
            ? "press"
            : "heights";
        plan.blocks.push({
          id,
          neighborhood,
          minX: Math.min(...vertices.map((p) => p[0])),
          maxX: Math.max(...vertices.map((p) => p[0])),
          minZ: Math.min(...vertices.map((p) => p[2])),
          maxZ: Math.max(...vertices.map((p) => p[2])),
        });
        // A merged freight block has a single yard. Other large blocks have
        // independent street frontages and a foot passage between them.
        const count = west && start < 2 ? 1 : end - start;
        for (let n = 0; n < count; n++) {
          const index = count === 1 ? Math.floor((end - start - 1) / 2) : n;
          const front = south[index],
            back = north[index];
          const fy = 0.46 + rand() * 0.1,
            fx = 0.46 + rand() * 0.08;
          const a = alongStreet(front, fx),
            b = alongStreet(back, fx);
          const x = b[0] + (a[0] - b[0]) * fy,
            z = b[2] + (a[2] - b[2]) * fy;
          const landmark =
            j === 3 && start === 2 && n === 0
              ? "hall"
              : j === 3 && start === 3 && n === 0
                ? "market"
                : j === 4 && start === 3 && n === 0
                  ? "cinema"
                  : undefined;
          const palette = west
            ? start < 2
              ? [0, 0, 0, 2]
              : Math.abs(j - 3) < 2
                ? [2, 2, 1, 3]
                : [1, 1, 0, 1]
            : Math.abs(j - 3) < 2
              ? [4, 4, 2, 2, 3]
              : [1, 1, 2, 3];
          const choice =
            landmark === "hall"
              ? 5
              : landmark === "market"
                ? 6
                : landmark === "cinema"
                  ? 3
                  : palette[Math.floor(rand() * palette.length)];
          // Inscribe the paved apron between the four road rights-of-way. The
          // separating axis projects the axis-aligned pad onto each road normal.
          let w = Math.min(45, Math.abs(front.b[0] - front.a[0]) - 13),
            d = Math.min(43, Math.abs(a[2] - b[2]) - 12);
          for (const s of boundary) {
            const dx = s.b[0] - s.a[0],
              dz = s.b[2] - s.a[2],
              len = Math.hypot(dx, dz);
            const clearance =
              Math.abs(dx * (z - s.a[2]) - dz * (x - s.a[0])) / len -
              s.width / 2 -
              0.7;
            const ratio = Math.min(
              1,
              (clearance * 2 * len) / (Math.abs(dz) * w + Math.abs(dx) * d),
            );
            w *= ratio;
            d *= ratio;
          }
          const lot = {
            town,
            x,
            z,
            w,
            d,
            choice,
            variation: rand(),
            front,
            side: n === 0 ? left : right,
            landmark,
          } satisfies CountyLot;
          lots.push(lot);
          plan.parcels.push({
            id: `${id}-p${n}`,
            blockId: id,
            x,
            z,
            w,
            d,
            facing: 0,
            streetId: front.id,
            neighborhood,
            kind: [
              "works",
              "rowhouses",
              "arcade",
              "cinema",
              "exchange",
              "hall",
              "square",
            ][choice],
            floors: [
              2,
              2,
              4 + Math.floor(lot.variation * 3),
              3,
              7 + 2 * Math.floor(lot.variation * 3),
              5,
              1,
            ][choice],
          });
          if (landmark)
            plan.landmarks.push({
              id: `${id}-${landmark}`,
              p: [x, 0, z],
              size: [w, 0, d],
            });
        }
      }),
    );
  }
  function highway(a: V3, b: V3) {
    const steps = Math.ceil((b[0] - a[0]) / 25);
    let previous = a;
    for (let i = 1; i <= steps; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / steps;
      const next: V3 = i === steps ? b : [x, 0, valleyZ(x)];
      plan.streets.push({
        id: `county-road-${plan.streets.length}`,
        a: previous,
        b: next,
        width: 12,
        class: "arterial",
      });
      previous = next;
    }
  }
  highway([-790, 0, valleyZ(-790)], gateways[0]);
  highway(gateways[1], gateways[2]);
  highway(gateways[3], [790, 0, valleyZ(790)]);
  return { plan, lots };
}

export function countyRoutes(streets: Street[]) {
  const nodes: V3[] = [],
    links: [number, number][] = [];
  const junctions = new Map<string, number>();
  function junction(p: V3) {
    const key = p.join(","),
      known = junctions.get(key);
    if (known !== undefined) return known;
    const i = nodes.push([p[0], p[1] + 0.07, p[2]]) - 1;
    junctions.set(key, i);
    return i;
  }
  for (const s of streets) {
    const a = junction(s.a),
      b = junction(s.b);
    if (ruralRoad(s)) {
      links.push([a, b]);
      continue;
    }
    for (const sign of [-1, 1]) {
      let previous = a;
      for (const t of [0.28, 0.53, 0.76]) {
        const p = alongStreet(s, t, sign * (s.width / 2 - 0.65));
        p[1] = 0.07;
        const i = nodes.push(p) - 1;
        links.push([previous, i]);
        previous = i;
      }
      links.push([previous, b]);
    }
  }
  return { nodes, links };
}
