import type { V3 } from "./world.ts";
export interface Blimp {
  kind?: "blimp" | "buoy";
  id: string;
  center: V3;
  radius: number;
  phase: number;
  speed: number;
}
export interface SkyBridge {
  a: number;
  b: number;
  from: V3;
  to: V3;
  width: number;
}
export interface FloatingPlatform {
  id: string;
  p: V3;
  size: V3;
}
// Time is seconds on the shared wall clock (server-corrected online), not time since joining.
export function blimpPosition(b: Blimp, time: number): V3 {
  const t = time * b.speed + b.phase;
  return [
    b.center[0] + Math.sin(t) * b.radius,
    b.center[1] + Math.sin(t * 2) * 1.2,
    b.center[2] + Math.cos(t) * b.radius * 0.42,
  ];
}
export function blimpVelocity(b: Blimp, time: number): V3 {
  const t = time * b.speed + b.phase;
  return [
    Math.cos(t) * b.radius * b.speed,
    Math.cos(t * 2) * 2.4 * b.speed,
    -Math.sin(t) * b.radius * 0.42 * b.speed,
  ];
}
export interface MovingHook {
  id: string;
  position: V3;
  velocity: V3;
  radius: number;
}

/** One connected field; all targets share a gentle drift so edge lengths never stretch. */
export function skyField(
  buildings: { id: number; x: number; z: number; height: number }[],
  bounds: number,
) {
  const blimps: Blimp[] = [],
    platforms: FloatingPlatform[] = [],
    links: [string, string][] = [];
  const entries: { building: number; hook: string }[] = [];
  const base = Math.max(...buildings.map((b) => b.height)) + 14;
  const count = Math.ceil((bounds * 2 - 64) / 50) + 1;
  const spacing = (bounds * 2 - 64) / (count - 1);
  const hook = (id: string, center: V3, kind: "blimp" | "buoy" = "buoy") => {
    const b: Blimp = { id, center, kind, radius: 2, phase: 0, speed: 0.08 };
    blimps.push(b);
    return b;
  };
  for (let z = 0; z < count; z++)
    for (let x = 0; x < count; x++) {
      const id = `sky-${x}-${z}`;
      const b = hook(
        id,
        [
          -bounds + 32 + x * spacing,
          base + ((x + z) % 3) * 12,
          -bounds + 32 + z * spacing,
        ],
        (x + z * count) % 8 === 0 ? "blimp" : "buoy",
      );
      if (x) links.push([`sky-${x - 1}-${z}`, id]);
      if (z) links.push([`sky-${x}-${z - 1}`, id]);
      if (x % 2 === 0 && z % 2 === 0)
        platforms.push({
          id: `rest-${x}-${z}`,
          p: [b.center[0] + 8, b.center[1] - 12, b.center[2]],
          size: [6, 0.5, 6],
        });
    }
  const field = [...blimps];
  // Distributed roof-to-sky ladders; the final lateral edge is above every rooftop.
  for (let z = 0; z < 4; z++)
    for (let x = 0; x < 4; x++) {
      const px = -bounds + ((x + 0.5) * bounds) / 2,
        pz = -bounds + ((z + 0.5) * bounds) / 2;
      const roof = buildings.reduce((a, b) =>
        Math.hypot(a.x - px, a.z - pz) < Math.hypot(b.x - px, b.z - pz) ? a : b,
      );
      const nearest = field.reduce((a, b) =>
        Math.hypot(a.center[0] - roof.x, a.center[2] - roof.z) <
        Math.hypot(b.center[0] - roof.x, b.center[2] - roof.z)
          ? a
          : b,
      );
      let previous = "";
      let level = 0;
      for (
        let y = roof.height + 12;
        ;
        y = Math.min(y + 18, nearest.center[1])
      ) {
        const b = hook(`entry-${x}-${z}-${level++}`, [roof.x, y, roof.z]);
        if (previous) links.push([previous, b.id]);
        else entries.push({ building: roof.id, hook: b.id });
        previous = b.id;
        if (y >= nearest.center[1]) break;
      }
      links.push([previous, nearest.id]);
    }
  return { blimps, platforms, links, entries, ceiling: base + 24 + 45 };
}
