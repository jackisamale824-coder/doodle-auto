import { randomSeed, type V3, type City, type Box } from "./world.ts";
import { planCity } from "./city-plan.ts";
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
export function countyWorld(): City {
  const spawns: V3[] = Array.from({ length: 30 }, (_, i) => [
    -323 + (i % 2) * 6,
    0,
    92 - Math.floor(i / 2) * 6,
  ]);
  return {
    seed: COUNTY,
    district: 1,
    boxes: countyBlocks(),
    spawns,
    bounds: LIMIT,
    flightCeiling: 130,
    plan: planCity(COUNTY, 1),
    buildings: [],
    beacons: [],
    nodes: [],
    links: [],
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
