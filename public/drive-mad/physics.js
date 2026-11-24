// Each section gives its horizontal length, elevation change and surface.
const bridge = (length, rise = 0) => [length, rise, "bridge"];
const rocker = (length) => [length, 0, "rocker"];
const gap = (length, drop = 0) => [length, drop, "gap"];
const ice = (length, rise = 0) => [length, rise, "ice"];
const courses = [
  [
    "Pine Pass",
    "pine",
    [
      [4, 0],
      [4, 0.8],
      bridge(7),
      [4, -0.7],
      [5, 1.8],
      [6, -1.8],
      [5, 0.7],
      [5, -0.7],
      [4, 0],
    ],
  ],
  [
    "Split Timber",
    "pine",
    [
      [5, 0],
      [5, 1.5],
      bridge(5, -1),
      [4, 0],
      [4, 1.3],
      gap(1.6, -0.7),
      [7, -1],
      bridge(6),
      [4, 0],
    ],
  ],
  [
    "Switchback",
    "clay",
    [
      [3, 0],
      [5, 2.6],
      [4, -2.3],
      [3, 0],
      [4, 2.4],
      [3, -1.3],
      [5, -0.7],
      [4, 2.3],
      [5, -3],
      [3, 0],
    ],
  ],
  [
    "Cold Snap",
    "ice",
    [
      [4, 0],
      ice(7, 2.3),
      ice(5, -2),
      [3, 0],
      [4, 1.5],
      gap(2, -1.4),
      ice(8, -0.8),
      [4, 1.2],
    ],
  ],
  [
    "Hang Time",
    "clay",
    [
      [7, -1.8],
      [4, 0],
      [4, 2],
      gap(3.6, -1.2),
      [5, -1.7],
      [7, 0],
      [4, 1.9],
      gap(3, -1.1),
      [6, -1],
    ],
  ],
  [
    "High Trestle",
    "pine",
    [
      [5, 0],
      [6, 3],
      bridge(5, 1.5),
      rocker(5),
      gap(1.4, -1),
      bridge(6, -1.7),
      [5, -1.8],
      [4, 1.1],
      [4, -0.5],
    ],
  ],
  [
    "Washboard",
    "clay",
    [
      [5, 0],
      [2.6, 1.3],
      [2.5, -1.4],
      [2.4, 1.1],
      [2.5, -1],
      [3.4, 1.7],
      [2.8, -1.6],
      [5, 0],
      [4, 2],
      gap(2.8, -1),
      [6, -1.1],
    ],
  ],
  [
    "Glacier Bay",
    "ice",
    [
      [7, -2],
      ice(4, 0),
      ice(4, 1.8),
      gap(3, -1.2),
      ice(5, -1),
      ice(6, 2.4),
      bridge(6, -1),
      ice(5, -1.6),
      [4, 1.2],
    ],
  ],
  [
    "Broken Span",
    "pine",
    [
      [5, 0],
      bridge(5, 1.6),
      gap(2, -0.9),
      rocker(5),
      [3, 0],
      bridge(5, 1.8),
      gap(3.1, -1),
      bridge(6, -1.7),
      [5, 0],
    ],
  ],
  [
    "Redline Ridge",
    "clay",
    [
      [5, -1],
      [5, 3.2],
      [3, -2.2],
      [5, -2],
      [4, 1.9],
      gap(3.5, -1.5),
      [5, -1],
      [4, 2.2],
      [6, -1.5],
    ],
  ],
  [
    "Thin Ice",
    "ice",
    [
      [5, 0],
      ice(6, -2),
      [4, 1.9],
      gap(3.2, -1.7),
      ice(6, -0.3),
      ice(5, 2.7),
      bridge(4, 0.6),
      gap(2.1, -1.5),
      ice(6, -2),
    ],
  ],
  [
    "Summit Run",
    "pine",
    [
      [3, 0],
      [5, 2.5],
      bridge(4, 1.2),
      gap(2, -0.8),
      [4, -2.1],
      [3, 1.2],
      [3, -1.4],
      [5, -1.1],
      [4, 2.1],
      gap(3.8, -1.5),
      [6, -1],
      [5, 2.2],
      bridge(4),
      [5, -1],
    ],
  ],
];
export const levels = courses.map(([name, theme, parts]) => {
  let x = -8,
    y = 0;
  const track = [[8, 0], ...parts, [7, 0]].map(
    ([width, rise, kind = "earth"]) => {
      const section = {
        x,
        y,
        base: y,
        end: x + width,
        top: y + rise,
        slope: rise / width,
        kind,
      };
      x += width;
      y += rise;
      return section;
    },
  );
  return {
    name,
    theme,
    track,
    rockers: track.filter((s) => s.kind === "rocker"),
    finish: x - 3,
  };
});
export const wheels = [-1.02, 1.02];
export const radius = 0.58;
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export function point(car, x, y) {
  const c = Math.cos(car.angle),
    s = Math.sin(car.angle);
  return { x: car.x + c * x - s * y, y: car.y + s * x + c * y };
}
export function ground(level, x) {
  const section = level.track.find(
    (s) => x >= s.x && x <= s.end && s.kind !== "gap",
  );
  return (
    section && {
      y: section.y + section.slope * (x - section.x),
      slope: section.slope,
      kind: section.kind,
    }
  );
}
export function newCar() {
  return {
    x: 1,
    y: 0.85,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    roll: 0,
    contact: 0,
    clock: 0,
  };
}
// Fixed-step rigid body. Each wheel supplies its own normal spring and tire force.
export function step(level, car, drive, dt) {
  car.clock += dt;
  for (const deck of level.rockers) {
    deck.slope = 0.24 * Math.sin(car.clock * 2.5);
    const rise = (deck.end - deck.x) * deck.slope;
    deck.y = deck.base - rise / 2;
    deck.top = deck.base + rise / 2;
  }
  let fx = -car.vx * 0.19,
    fy = -19,
    torque = -car.spin * 1.25,
    touches = 0;
  for (const axle of wheels) {
    const w = point(car, axle, -0.27),
      g = ground(level, w.x);
    if (!g) continue;
    const norm = Math.hypot(g.slope, 1),
      nx = -g.slope / norm,
      ny = 1 / norm;
    const compression = radius - (w.y - g.y) * ny;
    if (compression <= 0 || w.y < g.y - 1) continue;
    const rx = w.x - car.x,
      ry = w.y - car.y;
    const vx = car.vx - car.spin * ry,
      vy = car.vy + car.spin * rx;
    const normal = clamp(200 * compression - 13 * (vx * nx + vy * ny), 0, 120);
    const speed = vx * ny - vy * nx;
    const target = drive < 0 ? -7 : 13;
    const motor = drive
      ? clamp((target - speed) * 2.1, -16, 12)
      : -speed * 0.67;
    const grip = normal * (g.kind === "ice" ? 0.48 : 1.45);
    const tire = clamp(motor, -grip, grip);
    const hx = normal * nx + tire * ny,
      hy = normal * ny - tire * nx;
    fx += hx;
    fy += hy;
    torque += rx * hy - (ry - 0.18) * hx;
    touches++;
  }
  if (!touches) torque -= drive * 5.7;
  car.contact = touches;
  car.vx += fx * dt;
  car.vy += fy * dt;
  car.spin = clamp(car.spin + (torque / 1.7) * dt, -7, 7);
  car.angle += car.spin * dt;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.roll += (car.vx * dt) / radius;
  for (const corner of [
    [-0.6, 0.91],
    [0.52, 0.91],
    [1.37, 0.29],
    [-1.38, 0.24],
  ]) {
    const p = point(car, ...corner),
      g = ground(level, p.x);
    if (g && p.y < g.y - 0.06) return "crashed";
  }
  if (car.y < -7 || car.x < -6.5) return "crashed";
  if (car.x >= level.finish && touches && Math.cos(car.angle) > 0.25)
    return "won";
  return "running";
}
