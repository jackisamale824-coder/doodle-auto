import type { Box, V3 } from "./world.ts";
/** A gently rising desert underlay extends well beyond the playable boundary into fog. */
export function desertFloor(): Box {
  const vertices: number[] = [],
    indices: number[] = [],
    steps = 100,
    extent = 300;
  for (let z = 0; z <= steps; z++)
    for (let x = 0; x <= steps; x++) {
      const px = -extent + x * 6,
        pz = -extent + z * 6;
      const distance = Math.hypot(
        Math.max(0, Math.abs(px) - 27),
        Math.max(0, Math.abs(pz) - 40),
      );
      const t = Math.min(1, distance / 28),
        blend = t * t * (3 - 2 * t);
      const dune =
        1.4 +
        0.9 * Math.sin(px * 0.035) * Math.cos(pz * 0.043) +
        0.45 * Math.sin(px * 0.018 + pz * 0.028);
      vertices.push(px, -0.5 + blend * dune, pz);
    }
  for (let z = 0; z < steps; z++)
    for (let x = 0; x < steps; x++) {
      const a = z * (steps + 1) + x,
        b = a + 1,
        c = a + steps + 1,
        d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  return {
    p: [0, 1, 0] as V3,
    s: [600, 5, 600] as V3,
    kind: "desert",
    solid: true,
    mesh: { vertices, indices },
  };
}
