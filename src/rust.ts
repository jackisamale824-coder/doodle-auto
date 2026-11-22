import { rustBoundary, RUST_SCALE } from "./rust-boundary.ts";
import { desertFloor } from "./rust-terrain.ts";
import collision from "./generated/rust-collision.json";
import navigation from "./generated/rust-navigation.json";
import type { City, Box, V3, Building } from "./world.ts";
export type { ArenaProp, Ladder } from "./rust-blockout.ts";
import type { Arena as BlockoutArena } from "./rust-blockout.ts";
export interface Arena extends BlockoutArena {
  model?: boolean;
}
export { RUST_SCALE } from "./rust-boundary.ts";
const scalePoint = (p: readonly number[]) => p.map((v) => v * RUST_SCALE) as V3;
const worldBoxes: Box[] = (collision as unknown as Box[]).map((b) => ({
  ...b,
  p: scalePoint(b.p),
  s: scalePoint(b.s),
  mesh: b.mesh
    ? {
        vertices: b.mesh.vertices.map((v) => v * RUST_SCALE),
        indices: b.mesh.indices,
      }
    : undefined,
}));
worldBoxes.push(desertFloor(), ...rustBoundary(RUST_SCALE));
const worldNodes = navigation.nodes.map(scalePoint),
  worldSpawns = navigation.spawns.map(scalePoint);
export function generateRust(seed = "rust", district = 1): City {
  const zones = [
    ["TOWER", -3, -3, 8, 11],
    ["OIL DERRICK", -12, 10, 8, 8],
    ["LOADING DOCK", 0, 19, 9, 6],
    ["PIPELINE", -14, -10, 5, 25],
    ["FUEL DEPOT", 5, -23, 10, 6],
    ["CONTROL ROOM", 14, -20, 7, 8],
    ["MAINTENANCE", 16, -6, 7, 12],
  ] as const;
  const buildings: Building[] = zones.map(([name, x, z, w, d], id) => ({
    id,
    parcelId: `rust-${id}`,
    neighborhood: "works",
    facing: 0,
    entrance: scalePoint([x, 0.1, z]),
    inside: scalePoint([x, 0.1, z]),
    x: x * RUST_SCALE,
    z: z * RUST_SCALE,
    w: w * RUST_SCALE,
    d: d * RUST_SCALE,
    floors: 1,
    height: (id === 0 ? 22 : 3) * RUST_SCALE,
    kind: "industrial",
    name,
    route: [],
  }));
  return {
    seed,
    district,
    boxes: worldBoxes,
    buildings,
    nodes: worldNodes,
    links: navigation.links as [number, number][],
    spawns: worldSpawns,
    bounds: 120,
    beacons: [
      [-4, 9.95, -2.5],
      [-13, 8.1, 15],
      [14, 2.7, -20],
    ].map(scalePoint),
    bridges: [],
    blimps: [],
    platforms: [],
    aerialLinks: [],
    aerialEntries: [],
    flightCeiling: 65 * RUST_SCALE,
    plan: { streets: [], blocks: [], parcels: [], landmarks: [], bridges: [] },
    streetNodes: navigation.nodes.map((_, i) => i),
    roofLinks: [],
    dressing: [],
    arena: {
      name: "RUST",
      model: true,
      props: [],
      ladders: [
        {
          x: -3.85,
          z: -1.15,
          bottom: 0.1,
          top: 9.84,
          exit: [-3.85, 9.92, -2.4],
        },
        {
          x: 1.65,
          z: -10.89,
          bottom: 0.1,
          top: 4.76,
          exit: [0.2, 4.84, -10.89],
        },
        {
          x: -0.08,
          z: -9.9,
          bottom: 7.25,
          top: 9.93,
          exit: [-0.08, 10.01, -8.5],
        },
      ].map((l) => ({
        ...l,
        x: l.x * RUST_SCALE,
        z: l.z * RUST_SCALE,
        bottom: l.bottom * RUST_SCALE,
        top: l.top * RUST_SCALE,
        exit: scalePoint(l.exit),
      })),
      zones: buildings.map((b) => ({
        name: b.name,
        p: [b.x, 0, b.z],
        size: [b.w, b.height, b.d],
      })),
    },
  };
}
