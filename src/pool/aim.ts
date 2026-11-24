import {
  copyMatch,
  strike,
  step,
  targets,
  pockets,
  canPlace,
  R,
  W,
  H,
  type Match,
  type Stroke,
  type Ball,
} from "./game.ts";
export interface Point {
  x: number;
  y: number;
}
function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
const point = (b: Point) => ({ x: b.x, y: b.y });
export function predict(m: Match, stroke: Stroke) {
  const sim = copyMatch(m),
    motion = strike(sim, stroke);
  const line: Point[] = [],
    branch: Point[] = [],
    deflect: Point[] = [];
  if (!motion) return { line, branch, deflect };
  const cue = sim.balls[0];
  line.push(point(cue));
  let contact: Point | undefined;
  for (let n = 0; n < 1000; n++) {
    const banks = motion.bank,
      hits = motion.hit;
    const moving = step(sim, motion);
    if (!contact) {
      if (motion.first !== null) {
        contact = point(cue);
        line.push(contact);
        deflect.push(contact);
        branch.push(point(sim.balls[motion.first]));
      } else if (banks !== motion.bank) {
        line.push(point(cue));
        contact = point(cue);
        deflect.push(contact);
      } else if (!moving || cue.down) {
        line.push(point(cue));
        break;
      }
    } else if (!branch.length) {
      if (n % 3 === 0 || !moving) deflect.push(point(cue));
      if (
        !moving ||
        distance(contact, cue) > 100 ||
        hits !== motion.hit ||
        banks !== motion.bank ||
        cue.down
      )
        break;
    } else {
      const b = sim.balls[motion.first!];
      if (n % 3 === 0 || !moving) {
        branch.push(point(b));
        deflect.push(point(cue));
      }
      if (
        distance(branch[0], b) > 110 ||
        distance(contact, cue) > 90 ||
        motion.hit !== hits ||
        motion.bank !== banks ||
        b.down ||
        !moving
      )
        break;
    }
    if (!moving) break;
  }
  return { line, branch, deflect };
}
function clear(a: Point, b: Point, balls: Ball[], ignore: number) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = dx * dx + dy * dy;
  return balls.every((o) => {
    if (o.down || o.id === 0 || o.id === ignore) return true;
    const t = Math.max(
      0,
      Math.min(1, ((o.x - a.x) * dx + (o.y - a.y) * dy) / len),
    );
    return Math.hypot(o.x - a.x - t * dx, o.y - a.y - t * dy) > 2 * R - 0.2;
  });
}
export function botStroke(m: Match): Stroke {
  if (m.shots === 0) return { angle: 0.006, power: 0.98 };
  const cue = m.balls[0],
    allowed = targets(m);
  const picks: { s: Stroke; rank: number }[] = [];
  for (const id of allowed) {
    const b = m.balls[id];
    for (const [x, y] of pockets) {
      const d = Math.hypot(x - b.x, y - b.y),
        nx = (x - b.x) / d,
        ny = (y - b.y) / d;
      const ghost = { x: b.x - 2 * R * nx, y: b.y - 2 * R * ny };
      if (ghost.x < R || ghost.x > W - R || ghost.y < R || ghost.y > H - R)
        continue;
      let from: Point = cue;
      if (m.hand) {
        for (const length of [85, 50, 28]) {
          const p = { x: ghost.x - length * nx, y: ghost.y - length * ny };
          if (canPlace(m, p.x, p.y)) {
            from = p;
            break;
          }
        }
      }
      const run = distance(from, ghost),
        alignment =
          ((ghost.x - from.x) * nx + (ghost.y - from.y) * ny) / (run || 1);
      if (
        alignment < 0.14 ||
        !clear(from, ghost, m.balls, id) ||
        !clear(b, { x, y }, m.balls, id)
      )
        continue;
      const s = {
        angle: Math.atan2(ghost.y - from.y, ghost.x - from.x),
        power: Math.min(0.95, 0.22 + Math.sqrt(run + d / alignment) * 0.012),
        ...point(from),
      };
      picks.push({ s, rank: alignment * 500 - run * 0.25 - d * 0.35 });
    }
    const angle = Math.atan2(b.y - cue.y, b.x - cue.x);
    const clearHit = clear(cue, b, m.balls, id);
    for (const offset of [0, -0.48, 0.48]) {
      picks.push({
        s: {
          angle: angle + (offset * R) / Math.max(20, distance(cue, b)),
          power: 0.51 + (m.shots % 4) * 0.09,
        },
        rank: (clearHit ? -500 : -1200) - distance(cue, b) * 0.2 + offset,
      });
    }
  }
  picks.sort((a, b) => b.rank - a.rank);
  // Trial shots use the same collisions and friction as the live table.
  let best = picks[0].s,
    bestScore = -Infinity;
  for (const { s, rank } of picks.slice(0, 12)) {
    const sim = copyMatch(m),
      motion = strike(sim, s)!;
    while (step(sim, motion)) {}
    const legal = allowed.includes(motion.first ?? -1);
    const own = motion.drops.filter((id) => allowed.includes(id)).length;
    const score =
      (legal ? 1000 : 0) +
      own * 3500 -
      (motion.drops.includes(0) ? 2200 : 0) -
      (motion.drops.includes(8) && !allowed.includes(8) ? 10000 : 0) +
      (motion.rail ? 150 : 0) +
      rank * 0.1;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}
