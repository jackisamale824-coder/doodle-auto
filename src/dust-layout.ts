import type { Box } from "./world.ts";

type Rect = readonly [number, number, number, number]; // west, north, east, south
export const dustBounds: Rect = [-98, -30, 28, 74];
export const dustAreas: [string, number, number, number, number][] = [
  ["B SITE", -83, -10, 30, 26],
  ["B WINDOW", -66, -20, 8, 6],
  ["B DOORS", -66, -8, 8, 8],
  ["CT SPAWN", -34, -12, 16, 10],
  ["MID DOORS", -47, -4, 10, 8],
  ["MID", -47, 19, 12, 30],
  ["CATWALK", -35, 16, 18, 8],
  ["TOP MID", -43, 39, 18, 14],
  ["LOWER TUNNELS", -61, 16, 18, 8],
  ["UPPER TUNNELS", -84, 24, 12, 36],
  ["OUTSIDE TUNNELS", -77, 48, 22, 16],
  ["T RAMP", -62, 56, 20, 12],
  ["T SPAWN", -39, 65, 28, 16],
  ["OUTSIDE LONG", -9, 46, 38, 12],
  ["LONG DOORS", 8, 33, 12, 12],
  ["PIT", 19, 39, 6, 12],
];

// The open footprints define streets and junctions. Solid city blocks fill the
// space between them so collision, rendering and navigation see the same alleys.
const open: Rect[] = [
  [-28, -30, 28, 30], // original A courtyard
  [-96, -24, -68, 4], // B courtyard
  [-70, -12, -28, -6],
  [-68, -22, -60, -16],
  [-62, -22, -54, -8], // doors and window
  [-56, -16, -28, -6],
  [-54, -10, -42, 36], // CT and Middle
  [-48, 12, -26, 20],
  [-54, 32, -34, 58], // catwalk and top Mid
  [-86, 12, -50, 20],
  [-90, 2, -78, 42], // lower/upper tunnels
  [-92, 40, -66, 54],
  [-76, 48, -58, 60],
  [-66, 54, -48, 66], // outside tunnels / T ramp
  [-54, 54, -24, 72],
  [-32, 46, -20, 62],
  [-40, 40, 16, 52], // T spawn / outside Long
  [2, 28, 22, 46],
  [10, 26, 22, 32], // Long Doors / pit
];

export function expandDust(boxes: Box[]) {
  function solid(
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
  const [west, north, east, south] = dustBounds;
  function slab(x0: number, z0: number, x1: number, z1: number, top: number) {
    const bottom = -3;
    solid(
      "paving",
      (x0 + x1) / 2,
      (top + bottom) / 2,
      (z0 + z1) / 2,
      x1 - x0,
      top - bottom,
      z1 - z0,
    );
  }
  // Leave a real recess beside Long Doors with a walkable stair at its lip.
  slab(west, north, 16, south, 0);
  slab(22, north, east, south, 0);
  slab(16, north, 22, 32, 0);
  slab(16, 44, 22, south, 0);
  slab(16, 32, 22, 44, -1.6);
  for (let i = 0; i < 7; i++) slab(16, 32 + i, 22, 33 + i, -0.2 * (i + 1));
  for (const x of [west, east])
    solid("boundary", x, 20, (north + south) / 2, 0.4, 46, south - north);
  for (const z of [north, south])
    solid("boundary", (west + east) / 2, 20, z, east - west, 46, 0.4);

  // Merge consecutive closed horizontal runs into multi-storey building shells.
  const footprints: number[][] = [];
  let previous = new Map<string, number[]>();
  for (let z = north; z < south; z += 2) {
    const next = new Map<string, number[]>();
    let start = west;
    for (let x = west; x <= east; x += 2) {
      if (
        x < east &&
        !open.some(([l, n, r, s]) => x >= l && x < r && z >= n && z < s)
      )
        continue;
      if (start < x) {
        const key = start + "," + x;
        const rect = previous.get(key) ?? [start, z, x, z];
        if (!previous.has(key)) footprints.push(rect);
        rect[3] = z + 2;
        next.set(key, rect);
      }
      start = x + 2;
    }
    previous = next;
  }
  for (const [l, n, r, s] of footprints) {
    const h = 6.4 + (Math.abs(l + n) % 5) * 0.85;
    solid("cityblock", (l + r) / 2, h / 2, (n + s) / 2, r - l, h, s - n);
  }
  function platform(x: number, z: number, w: number, d: number, h: number) {
    solid("platform", x, h / 2, z, w, h, d);
  }
  platform(-40, 66, 24, 12, 2.4);
  for (let i = 0; i < 10; i++) {
    platform(-44, 50.5 + i, 16, 1, 0.24 * (i + 1));
    platform(-61.5 + i, 63, 1, 5, 0.24 * (i + 1));
    platform(-30, 54.3 + i * 0.6, 4, 0.6, 0.24 * (i + 1));
  }
  // Xbox and the raised catwalk connect Middle to the foot of the A stairs.
  platform(-34, 16, 12, 6, 1.44);
  for (let i = 0; i < 6; i++) {
    platform(-45.5 + i, 16, 1, 6, 0.24 * (i + 1));
    platform(-27.5 + i, 16, 1, 6, 0.24 * (6 - i));
  }
  // Upper tunnels sit two metres above Lower. All three entrances have stairs.
  platform(-84, 24, 12, 20, 2);
  for (let i = 0; i < 10; i++) {
    platform(-84, 4.5 + i, 12, 1, 0.2 * (i + 1));
    platform(-84, 34.5 + i, 12, 1, 0.2 * (10 - i));
    platform(-68.5 - i, 16, 1, 8, 0.2 * (i + 1));
  }
  for (const [x, z, w, d, y] of [
    [-84, 10, 12, 14, 6],
    [-84, 24, 12, 12, 7],
    [-84, 37, 12, 11, 6.8],
    [-65, 16, 26, 8, 5.3],
  ]) {
    solid("vault", x, y, z, w, 0.65, d);
  }
  solid("lintel", -84, 4.8, 42.7, 12, 1.55, 0.2);
  // Offset open leaves and a lintel make each doorway passable at player scale.
  function doors(x: number, z: number, acrossX: boolean, width: number) {
    const wing = (width - 4) / 2;
    for (const sign of [-1, 1]) {
      const offset = sign * (2 + wing / 2);
      solid(
        "gate",
        x + (acrossX ? offset : sign * 0.65),
        2,
        z + (acrossX ? sign * 0.65 : offset),
        acrossX ? wing : 0.6,
        4,
        acrossX ? 0.6 : wing,
      );
    }
    solid("lintel", x, 4.45, z, acrossX ? width : 2, 0.9, acrossX ? 2 : width);
  }
  doors(-48, -4, true, 12);
  doors(-68, -9, false, 6);
  doors(9, 32, true, 14);
  doors(5, 43, false, 10);
  // A second entrance to B goes over a low window sill from CT Mid.
  platform(-68, -19, 2, 6, 1.4);
  for (let i = 0; i < 7; i++) {
    platform(-61.5 - i * 0.85, -19, 0.85, 6, 0.2 * (i + 1));
    platform(-69.425 - i * 0.85, -19, 0.85, 6, 0.2 * (7 - i));
  }
  solid("lintel", -68, 4.65, -19, 2, 0.75, 6);
  platform(-92, -18, 7, 7, 1.2);
  for (let i = 0; i < 6; i++)
    platform(-88.15 + i * 0.7, -18, 0.7, 5, 0.2 * (6 - i));
  for (const [x, z, w, h, d] of [
    [-86, -12, 3, 3.1, 3],
    [-83, -12, 3, 2.2, 3],
    [-76, -5, 3.8, 2, 2.2],
    [-93, -4, 2, 2.7, 3],
    [-51, 9, 2.7, 2.2, 3],
    [-52, 35, 2, 1.7, 2],
    [-73, 46, 3, 2.2, 2],
    [-27, 65, 3, 2.3, 3],
    [-16, 49, 4, 2.4, 2],
    [-38, -15, 2.2, 1.8, 2],
  ]) {
    solid("crate", x, h / 2, z, w, h, d);
  }
  for (const [x, z] of [
    [-92, -7],
    [-91, -7],
    [-57, -12],
    [-31, 49],
  ])
    solid("drum", x, 0.68, z, 1, 1.36, 1);
  solid("wreck", -72, 0.65, 0, 2.1, 1.3, 4.3);
}
