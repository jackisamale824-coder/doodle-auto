import { COUNTY, countyWorld } from "./county.ts";
import { ISLANDS, islandWorld } from "./islands.ts";
import { generateRust } from "./rust.ts";

export function publicMapSeed(seed: unknown) {
  if (seed === COUNTY) return COUNTY;
  if (
    seed === ISLANDS ||
    (typeof seed === "string" && seed.startsWith("city:"))
  )
    return ISLANDS;
  return "public-city-v1";
}

export function generateLevel(seed = "rust", district = 1) {
  switch (publicMapSeed(seed)) {
    case COUNTY:
      return countyWorld();
    case ISLANDS:
      return islandWorld(district);
    default:
      return generateRust(seed, district);
  }
}
