import { carBodyHit, KNOCKDOWN_TIME, stepKnockback } from "./county-ragdoll.ts";
import type { CountyCitizen } from "./county-citizens.ts";
import type { CountyCar } from "./county.ts";
import type { V3 } from "./world.ts";

export interface CountyFall {
  at: number;
  impulse: V3;
}
export function notorietyAfter(value: number, points: number) {
  return Math.min(100, value + points);
}
export function injuryPoints(before: number, after: number) {
  return (before - after) * 0.24 + (after === 0 && before > 0 ? 12 : 0);
}
// Only airborne or recovering citizens need body queries. Standing pedestrians
// use the street simulation and seated citizens stay inside their own vehicle.
export class CountyImpacts {
  private moving = new Map<CountyCitizen, V3>();
  contact(
    actors: CountyCitizen[],
    car: CountyCar,
    from: V3,
    to: V3,
    yaw: number,
    speed: number,
    now: number,
    damage: (actor: CountyCitizen, amount: number) => void,
  ) {
    if (Math.abs(speed) < 2) return;
    for (const actor of actors) {
      if (
        actor.hp <= 0 ||
        actor.car !== undefined ||
        (actor.downUntil ?? 0) > now
      )
        continue;
      const hit = carBodyHit(from, to, yaw, speed, actor.p, car.kind);
      if (!hit) continue;
      damage(actor, hit.damage);
      actor.downUntil = now + KNOCKDOWN_TIME * 1000;
      actor.fall = { at: now, impulse: hit.impulse };
      this.moving.set(actor, [...hit.impulse]);
    }
  }
  update(dt: number, now: number, ray: Parameters<typeof stepKnockback>[3]) {
    for (const [actor, v] of this.moving) {
      const grounded = stepKnockback(actor.p, v, dt, ray);
      if (grounded && now >= (actor.downUntil ?? 0)) {
        this.moving.delete(actor);
        if (actor.hp > 0) actor.fall = undefined;
      } else if (now >= (actor.downUntil ?? 0)) {
        actor.downUntil = now + 100;
      }
    }
  }
}
