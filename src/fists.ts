import { actorHit } from "./actor-hit.ts";
import type { V3 } from "./world.ts";

export const FISTS = 4;
export const PUNCHES = [
  {
    name: "Jab",
    side: -1,
    contact: 0.115,
    duration: 0.34,
    reach: 1.28,
    damage: 20,
  },
  {
    name: "Cross",
    side: 1,
    contact: 0.155,
    duration: 0.43,
    reach: 1.36,
    damage: 25,
  },
  {
    name: "Hook",
    side: -1,
    contact: 0.19,
    duration: 0.5,
    reach: 1.18,
    damage: 30,
  },
] as const;
export interface Punch {
  move: number;
  start: number;
} // milliseconds on the simulation's clock
export function nextPunch(previous: Punch | undefined, now: number): Punch {
  const chained =
    previous &&
    now - previous.start <= PUNCHES[previous.move].duration * 1000 + 420;
  return {
    move: chained ? (previous.move + 1) % PUNCHES.length : 0,
    start: now,
  };
}
const smooth = (x: number) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
// All three moves pass from guard through anticipation, contact and recovery.
// Sideways travel peaks before contact for the hook. The other hand stays up.
export function punchPose(move: number, age: number, side: number) {
  const strike = PUNCHES[move],
    active = side === strike.side;
  const wind =
    smooth(age / (strike.contact * 0.38)) *
    (1 - smooth((age - strike.contact * 0.38) / (strike.contact * 0.62)));
  const out =
    smooth((age - strike.contact * 0.27) / (strike.contact * 0.73)) *
    (1 - smooth((age - strike.contact) / (strike.duration - strike.contact)));
  const arc =
    move === 2 && age < strike.contact
      ? Math.sin(Math.PI * smooth(age / strike.contact))
      : 0;
  return {
    x: active
      ? side * (0.035 * wind - (move === 2 ? 0.3 : 0.18) * out + 0.14 * arc)
      : side * 0.025 * out,
    y: active ? -0.022 * wind + (move === 2 ? 0.12 : 0.14) * out : 0.045 * out,
    z: active ? -0.05 * wind + (move === 2 ? 0.25 : 0.42) * out : -0.045 * out,
    roll: active ? side * (move === 2 ? 0.95 : 0.46) * out : 0,
    twist: strike.side * ((move === 0 ? 0.12 : 0.32) * out - 0.085 * wind),
  };
}

export interface PunchTarget {
  p: V3;
  height: number;
  yaw: number;
  lean?: number;
}
export function punchHit<T extends PunchTarget>(
  origin: V3,
  yaw: number,
  pitch: number,
  move: number,
  targets: T[],
  ray: (o: V3, d: V3, max: number) => { distance: number } | null,
) {
  const strike = PUNCHES[move];
  let closest:
    { actor: T; hit: NonNullable<ReturnType<typeof actorHit>> } | undefined;
  // Short fan from one origin; clip each sample against its own blocking surface.
  for (const angle of [0, -0.13, 0.13, ...(move === 2 ? [-0.3, 0.3] : [])]) {
    const d: V3 = [
      -Math.sin(yaw + angle) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw + angle) * Math.cos(pitch),
    ];
    const limit = Math.min(strike.reach, closest?.hit.distance ?? Infinity);
    const wall = ray(origin, d, limit);
    let range = wall?.distance ?? limit;
    for (const actor of targets) {
      const hit = actorHit(
        origin,
        d,
        actor.p,
        actor.height,
        range,
        actor.yaw + Math.PI,
        actor.lean,
      );
      if (hit) {
        closest = { actor, hit };
        range = hit.distance;
      }
    }
  }
  return closest;
}
