import { generateCity } from "./world.ts";
import { generateRust } from "./rust.ts";
/** Runtime default is Rust; archived procedural maps use an explicit city: seed. */
export function generateLevel(seed = "rust", district = 1) {
  return seed.startsWith("city:")
    ? generateCity(seed.slice(5) || "notebook", district)
    : generateRust(seed, district);
}
