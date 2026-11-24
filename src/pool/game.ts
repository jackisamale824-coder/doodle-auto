export const W = 900,
  H = 450,
  R = 10,
  DT = 1 / 160;
export const pockets = [
  [0, 0],
  [450, 0],
  [900, 0],
  [0, 450],
  [450, 450],
  [900, 450],
] as const;
export type Seat = 0 | 1;
export type Group = "Solids" | "Stripes";
export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  roll: number;
  down: boolean;
}
export interface Match {
  balls: Ball[];
  turn: Seat;
  groups: [Group | null, Group | null];
  shots: number;
  hand: boolean;
  winner: Seat | null;
  message: string;
}
export interface Stroke {
  angle: number;
  power: number;
  x?: number;
  y?: number;
}
export interface Motion {
  first: number | null;
  rail: boolean;
  drops: number[];
  targets: number[];
  hit: number;
  bank: number;
}
export function rack(turn: Seat = 0): Match {
  const balls: Ball[] = [];
  function ball(id: number, x: number, y: number) {
    balls.push({ id, x, y, vx: 0, vy: 0, roll: 0, down: false });
  }
  ball(0, 225, 225);
  const order = [1, 10, 3, 6, 8, 14, 12, 4, 15, 2, 7, 11, 5, 13, 9];
  let i = 0;
  for (let col = 0; col < 5; col++)
    for (let row = 0; row <= col; row++)
      ball(
        order[i++],
        650 + col * Math.sqrt(3) * 10.04,
        225 + (row - col / 2) * 20.08,
      );
  balls.sort((a, b) => a.id - b.id);
  return {
    balls,
    turn,
    groups: [null, null],
    shots: 0,
    hand: false,
    winner: null,
    message: "Opening break",
  };
}
export const groupOf = (id: number): Group => (id < 8 ? "Solids" : "Stripes");
export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
export function targets(m: Match) {
  const group = m.groups[m.turn];
  const ids = m.balls
    .filter(
      (b) =>
        !b.down &&
        b.id !== 0 &&
        b.id !== 8 &&
        (!group || groupOf(b.id) === group),
    )
    .map((b) => b.id);
  return ids.length ? ids : [8];
}
export function canPlace(m: Match, x: number, y: number, id = 0) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= R &&
    x <= W - R &&
    y >= R &&
    y <= H - R &&
    pockets.every(([px, py]) => Math.hypot(x - px, y - py) > 22) &&
    m.balls.every(
      (b) =>
        b.down || b.id === id || Math.hypot(x - b.x, y - b.y) > 2 * R + 0.1,
    )
  );
}
function spot(m: Match, id: number, x: number, y: number) {
  if (!canPlace(m, x, y, id)) {
    let best = Infinity;
    for (let i = R + 2; i < W - R; i += 21)
      for (let j = R + 2; j < H - R; j += 21) {
        const d = Math.hypot(i - x, j - y);
        if (d < best && canPlace(m, i, j, id)) {
          best = d;
          Object.assign(m.balls[id], { x: i, y: j });
        }
      }
  } else Object.assign(m.balls[id], { x, y });
  Object.assign(m.balls[id], { down: false, vx: 0, vy: 0 });
}
export function strike(m: Match, s: Stroke): Motion | null {
  if (
    m.winner !== null ||
    !Number.isFinite(s.angle) ||
    !Number.isFinite(s.power) ||
    s.power < 0.03 ||
    s.power > 1
  )
    return null;
  const cue = m.balls[0];
  if (m.hand && (s.x !== undefined || s.y !== undefined)) {
    if (s.x === undefined || s.y === undefined || !canPlace(m, s.x, s.y))
      return null;
    Object.assign(cue, { x: s.x, y: s.y });
  }
  const speed = 80 + 1020 * s.power;
  cue.vx = Math.cos(s.angle) * speed;
  cue.vy = Math.sin(s.angle) * speed;
  m.hand = false;
  m.shots++;
  return {
    first: null,
    rail: false,
    drops: [],
    targets: targets(m),
    hit: 0,
    bank: 0,
  };
}
// Rounded cushion ends define the pocket jaws as well as the playable rail.
const rails = [
  [25, 0, 427, 0],
  [473, 0, 875, 0],
  [25, H, 427, H],
  [473, H, 875, H],
  [0, 25, 0, H - 25],
  [W, 25, W, H - 25],
];
export function step(m: Match, shot: Motion) {
  let moving = false;
  for (const b of m.balls) {
    if (b.down || (!b.vx && !b.vy)) continue;
    const speed = Math.hypot(b.vx, b.vy);
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.roll += (speed * DT) / R;
    const fall = pockets.some(
      ([x, y]) => Math.abs(b.x - x) < 20 && Math.hypot(b.x - x, b.y - y) < 20,
    );
    if (fall || b.x < 0 || b.x > W || b.y < 0 || b.y > H) {
      b.vx = b.vy = 0;
      b.down = true;
      shot.drops.push(b.id);
      continue;
    }
    for (const [x1, y1, x2, y2] of rails) {
      const dx = b.x - Math.max(x1, Math.min(x2, b.x)),
        dy = b.y - Math.max(y1, Math.min(y2, b.y));
      if (Math.abs(dx) >= R || Math.abs(dy) >= R) continue;
      const d = Math.hypot(dx, dy);
      if (d >= R || d === 0) continue;
      const nx = dx / d,
        ny = dy / d,
        v = b.vx * nx + b.vy * ny;
      b.x += nx * (R - d);
      b.y += ny * (R - d);
      if (v < 0) {
        b.vx -= 1.83 * v * nx;
        b.vy -= 1.83 * v * ny;
        shot.bank++;
        if (shot.first !== null) shot.rail = true;
      }
    }
    const v = Math.hypot(b.vx, b.vy),
      k = v > 3 ? Math.max(0, 1 - ((82 + 0.25 * v) * DT) / v) : 0;
    b.vx *= k;
    b.vy *= k;
    moving ||= !!(b.vx || b.vy);
  }
  for (let i = 0; i < m.balls.length; i++) {
    const a = m.balls[i];
    if (a.down) continue;
    for (let j = i + 1; j < m.balls.length; j++) {
      const b = m.balls[j],
        dx = b.x - a.x,
        dy = b.y - a.y;
      if (b.down || Math.abs(dx) >= 2 * R || Math.abs(dy) >= 2 * R) continue;
      const d = Math.hypot(dx, dy);
      if (!d || d >= 2 * R) continue;
      const nx = dx / d,
        ny = dy / d,
        push = (2 * R - d + 0.001) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const v = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (v <= 0) continue;
      if (a.id === 0 && shot.first === null) shot.first = b.id;
      const impulse = v * 0.975;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
      shot.hit++;
      moving = true;
    }
  }
  return moving;
}
export function settle(m: Match, s: Motion) {
  const breaker = m.shots === 1,
    shooter = m.turn,
    next = other(shooter);
  const scratched = s.drops.includes(0);
  const foul = scratched
    ? "Scratch"
    : s.first === null
      ? "No ball hit"
      : !s.targets.includes(s.first)
        ? "Wrong first ball"
        : !s.rail && !s.drops.length
          ? "No cushion after contact"
          : "";
  if (s.drops.includes(8)) {
    if (breaker) spot(m, 8, 650, H / 2);
    else {
      const legal = s.targets.includes(8) && !foul;
      m.winner = legal ? shooter : next;
      m.message = legal
        ? "Eight ball sunk"
        : scratched
          ? "Scratch on the eight"
          : foul || "Eight ball sunk early";
      return;
    }
  }
  const object = s.drops.filter((id) => id !== 0 && id !== 8);
  if (!breaker && !foul && !m.groups[shooter] && object.length) {
    m.groups[shooter] = groupOf(object[0]);
    m.groups[next] = m.groups[shooter] === "Solids" ? "Stripes" : "Solids";
  }
  const keep =
    !foul &&
    (breaker
      ? s.drops.some((id) => id > 0)
      : object.some((id) => groupOf(id) === m.groups[shooter]));
  if (!keep) m.turn = next;
  m.hand = !!foul;
  if (scratched) spot(m, 0, 225, H / 2);
  else if (m.hand && !canPlace(m, m.balls[0].x, m.balls[0].y))
    spot(m, 0, m.balls[0].x, m.balls[0].y);
  m.message = foul
    ? foul + " · ball in hand"
    : breaker && s.drops.includes(8)
      ? "Eight ball re-spotted"
      : keep
        ? "Ball pocketed · shoot again"
        : "Turn passed";
}
export function copyMatch(m: Match): Match {
  return { ...m, balls: m.balls.map((b) => ({ ...b })), groups: [...m.groups] };
}
