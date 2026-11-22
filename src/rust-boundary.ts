import type { Box } from "./world.ts";

// Surveyed from the model's concrete walls and fence lines, in source metres.
// Preserve the northwest recess and the step in the western wall.
export const RUST_PERIMETER: readonly (readonly [number, number])[] = [
  [-21.3, -28.5],
  [-19.95, -28.5],
  [-19.95, -31.65],
  [-10.1, -31.65],
  [-10.1, -28.5],
  [20.3, -28.5],
  [20.3, 27],
  [-19.95, 27],
  [-19.95, 1.6],
  [-21.3, 1.6],
];

export function rustBoundary(scale: number): Box[] {
  return RUST_PERIMETER.map(([x, z], i) => {
    const [ex, ez] = RUST_PERIMETER[(i + 1) % RUST_PERIMETER.length];
    return {
      kind: "boundary",
      solid: true,
      p: [((x + ex) * scale) / 2, 50, ((z + ez) * scale) / 2],
      // Overlap corners; extend below terrain and above the flight ceiling.
      s: [
        Math.abs(ex - x) * scale + 0.45,
        300,
        Math.abs(ez - z) * scale + 0.45,
      ],
    };
  });
}

export const RUST_SCALE = 1.21;
export function insideRust(p: readonly number[], margin = 0): boolean {
  const x = p[0] / RUST_SCALE,
    z = p[2] / RUST_SCALE;
  let inside = false;
  for (
    let i = 0, j = RUST_PERIMETER.length - 1;
    i < RUST_PERIMETER.length;
    j = i++
  ) {
    const [ax, az] = RUST_PERIMETER[i],
      [bx, bz] = RUST_PERIMETER[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      inside = !inside;
    const dx = bx - ax,
      dz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)),
    );
    if (Math.hypot(x - ax - t * dx, z - az - t * dz) * RUST_SCALE < margin)
      return false;
  }
  return inside;
}
