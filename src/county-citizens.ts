import { obscured, type GrenadeEffect } from "./grenades.ts";
import { vehicleHandling } from "./county-vehicle-damage.ts";
import type { Npc } from "../server/npcs.ts";
import { movementYaw } from "./actor-hit.ts";
import type { Street } from "./city-plan.ts";
import { alongStreet, ruralRoad, TOWNS } from "./county-plan.ts";
import type { CountyCar } from "./county.ts";
import { VEHICLE_DIMENSIONS } from "./county-vehicle-dimensions.ts";
import { distance, randomSeed, type City, type V3 } from "./world.ts";

export interface CountyCitizen extends Npc {
  civilian: boolean;
  action: CountyAction;
  car?: number;
  downUntil?: number;
}
interface Person {
  id: string;
  p: V3;
  hp: number;
  height: number;
  notoriety?: number;
  shieldUntil?: number;
  downUntil?: number;
}
interface Queries {
  ray(o: V3, d: V3, limit: number): unknown;
  clear(p: V3, height: number): boolean;
  movement(a: V3, b: V3, height: number): boolean;
}
export type CountyAction = "idle" | "calling" | "flee" | "melee" | "shoot";
export type CitizenAction = "punch" | "shot";
export const MAX_WANTED = 5;
const STAR_POINTS = 25;
export interface Wanted {
  stars: number;
  phase: "calling" | "responding" | "pursuit" | "search";
}
interface PoliceReport {
  wanted: Wanted;
  callers: Set<CountyCitizen>;
  points: number;
  dispatchAt: number;
  lastSeen: number;
  location: V3;
  officers: CountyCitizen[];
  reinforceAt: number;
}
interface Route {
  road: Street;
  dir: number;
  entering: boolean;
  goal: V3;
  seat?: number;
  reverseUntil: number;
  poseUntil: number;
  panicUntil: number;
  danger?: V3;
  pace: number;
  random: () => number;
  checkAt: number;
  actionAt: number;
  blockedFor: number;
  healAt: number;
  lastHealth: number;
  respawnAt: number;
}
type Hurt<T extends Person> = (
  target: T,
  bot: CountyCitizen,
  damage: number,
  kind: CitizenAction,
) => void;
const horizontal = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const lane = (s: Street) => Math.min(s.width * 0.21, 2.8);
function onRoute(s: Street, dir: number, t: number, driving: boolean): V3 {
  const p = alongStreet(
    s,
    dir === 1 ? t : 1 - t,
    dir * (driving ? lane(s) : s.width / 2 + 0.72),
  );
  p[1] = driving ? 0.08 : 0.16;
  return p;
}
function setGoal(route: Route, driving: boolean, entering: boolean) {
  const s = route.road;
  const inset = Math.min(0.24, (s.width / 2 + 1) / horizontal(s.a, s.b));
  route.goal = onRoute(s, route.dir, entering ? inset : 1 - inset, driving);
  route.entering = entering;
  route.checkAt = 0;
}
function newCitizen(id: string, name: string, p: V3): CountyCitizen {
  return {
    id,
    name,
    p,
    npc: true,
    civilian: true,
    action: "idle",
    yaw: 0,
    pitch: 0,
    hp: 100,
    kills: 0,
    deaths: 0,
    weapon: 2,
    height: 1.76,
    anchor: null,
    lastMove: 0,
    lastShot: 0,
    deadAt: 0,
    shieldUntil: 0,
    mags: [30, 8, 14, 5],
    reloadUntil: 0,
    reloadWeapon: 0,
    moveCredit: 0,
    node: 0,
    path: [],
    thinkAt: 0,
  };
}

// Test a point against an oriented car body, with an optional safety margin.
function nearCar(p: V3, car: CountyCar, margin: number) {
  const x = p[0] - car.p[0],
    z = p[2] - car.p[2];
  if (
    Math.abs(x) > 4 + margin ||
    Math.abs(z) > 4 + margin ||
    Math.abs(p[1] - car.p[1]) > 2.1
  )
    return false;
  const [width, length] = VEHICLE_DIMENSIONS[car.kind];
  const sin = Math.sin(car.yaw),
    cos = Math.cos(car.yaw);
  return (
    Math.abs(x * cos - z * sin) < width + margin &&
    Math.abs(x * sin + z * cos) < length + margin
  );
}

export class CountyCitizens {
  effects: GrenadeEffect[] = [];
  readonly actors: CountyCitizen[] = [];
  onTrafficMove?: (
    driver: CountyCitizen,
    car: CountyCar,
    from: V3,
    speed: number,
    now: number,
  ) => void;
  private routes = new Map<string, Route>();
  private reports = new Map<string, PoliceReport>();
  private unitSerial = 0;
  private streets: Street[];
  private owners = new WeakMap<CountyCar, string>();
  private junctions = new Map<string, Street[]>();
  constructor(
    city: City,
    private cars: CountyCar[],
    private queries: Queries,
  ) {
    const streets = (this.streets = city.plan.streets);
    for (const s of streets) {
      for (const point of [s.a, s.b]) {
        const key = point.join(",");
        if (!this.junctions.has(key)) this.junctions.set(key, []);
        this.junctions.get(key)!.push(s);
      }
    }
    for (const [district, town] of TOWNS.entries()) {
      const random = randomSeed(city.seed + "-neighbors-" + town);
      const local = streets.filter(
        (s) => !ruralRoad(s) && Math.sign(s.a[0]) === Math.sign(town),
      );
      const byCinema = local
        .slice()
        .sort(
          (a, b) =>
            horizontal(alongStreet(a, 0.5), city.spawns[district * 15]) -
            horizontal(alongStreet(b, 0.5), city.spawns[district * 15]),
        );
      const shuffled = local
        .map((road) => ({ road, rank: random() }))
        .sort((a, b) => a.rank - b.rank);
      for (let i = 0; i < 12; i++) {
        const s = i < 3 ? byCinema[i] : shuffled[i].road;
        const dir = i % 2 ? -1 : 1;
        const p = onRoute(s, dir, 0.22 + random() * 0.56, false);
        this.add(
          "civilian-walker-" + (district * 12 + i),
          "Pedestrian",
          s,
          dir,
          p,
        );
      }
    }
    for (const [index, car] of cars.entries()) {
      if (!car.driver?.startsWith("civilian-driver-")) continue;
      // Factory places the seats on their lanes. Recover the directed edge
      // from the physical pose so the world and rendering use identical slots.
      let min = Infinity,
        closest = streets[0],
        direction = 1;
      for (const s of streets) {
        const dx = s.b[0] - s.a[0],
          dz = s.b[2] - s.a[2],
          len2 = dx * dx + dz * dz;
        const dir =
          dx * -Math.sin(car.yaw) + dz * -Math.cos(car.yaw) >= 0 ? 1 : -1;
        const t = Math.min(
          1,
          Math.max(
            0,
            ((car.p[0] - s.a[0]) * dx + (car.p[2] - s.a[2]) * dz) / len2,
          ),
        );
        const d = horizontal(car.p, alongStreet(s, t, dir * lane(s)));
        if (d < min) {
          closest = s;
          min = d;
          direction = dir;
        }
      }
      this.add(car.driver, "Motorist", closest, direction, [...car.p], index);
    }
  }
  private add(
    id: string,
    name: string,
    road: Street,
    dir: number,
    p: V3,
    car?: number,
  ) {
    const random = randomSeed(id);
    const actor = newCitizen(id, name, p);
    actor.car = car;
    const route: Route = {
      road,
      dir,
      goal: p,
      seat: car,
      reverseUntil: 0,
      poseUntil: 0,
      panicUntil: 0,
      entering: false,
      pace: car === undefined ? 1.25 + random() * 0.65 : 7.5 + random() * 3,
      random,
      checkAt: 0,
      actionAt: 0,
      blockedFor: 0,
      healAt: 0,
      lastHealth: 100,
      respawnAt: 0,
    };
    setGoal(route, car !== undefined, false);
    actor.yaw = movementYaw(
      dir * (road.b[0] - road.a[0]),
      dir * (road.b[2] - road.a[2]),
      0,
    );
    this.routes.set(id, route);
    this.actors.push(actor);
    return actor;
  }
  private nextRoad(route: Route, driving: boolean) {
    if (route.entering) {
      setGoal(route, driving, false);
      return;
    }
    const end = route.dir === 1 ? route.road.b : route.road.a;
    const options = this.junctions
      .get(end.join(","))!
      .filter((s) => s !== route.road && (driving || !ruralRoad(s)));
    route.road = options.length
      ? options[Math.floor(route.random() * options.length)]
      : route.road;
    route.dir =
      route.road.a === end || horizontal(route.road.a, end) < 0.01 ? 1 : -1;
    setGoal(route, driving, true);
  }
  private visible(
    a: CountyCitizen,
    b: Pick<Person, "p" | "height">,
    now: number,
  ) {
    const eye: V3 = [a.p[0], a.p[1] + 1.45, a.p[2]];
    const to: V3 = [b.p[0], b.p[1] + b.height * 0.58, b.p[2]];
    const len = distance(eye, to);
    return (
      !obscured(this.effects, eye, to, now) &&
      !this.queries.ray(
        eye,
        to.map((v, i) => (v - eye[i]) / Math.max(len, 0.01)) as V3,
        Math.max(0, len - 0.12),
      )
    );
  }
  wanted(id: string) {
    return this.reports.get(id)?.wanted;
  }
  takeCar(id: string, car: CountyCar, now: number) {
    if (!car.driver && this.owners.get(car) === id) return;
    this.owners.set(car, id);
    const motorist = this.actors.find((a) => a.id === car.driver);
    if (motorist) this.leaveCar(motorist, this.routes.get(motorist.id)!);
    this.alarm(id, car.p, now, STAR_POINTS, 24, motorist, true);
  }
  // A surviving victim can identify the attacker. Bystanders need sight of the incident.
  alarm(
    id: string,
    origin: V3,
    now: number,
    points: number,
    radius: number,
    victim?: Person,
    confirmed = victim?.hp === 0,
  ) {
    const callers = new Set<CountyCitizen>();
    const scene = victim ?? { p: origin, height: 1.76 };
    for (const actor of this.actors) {
      if (actor.hp <= 0 || (actor.downUntil ?? 0) > now) continue;
      if (
        actor.id !== victim?.id &&
        (distance(actor.p, scene.p) > radius ||
          !this.visible(actor, scene, now))
      )
        continue;
      callers.add(actor);
      if (actor.civilian) {
        const route = this.routes.get(actor.id)!;
        route.danger = [...origin];
        route.panicUntil = now + 9000;
      }
    }
    if (!callers.size && !confirmed) return;
    let report = this.reports.get(id);
    if (!report) {
      report = {
        wanted: { stars: 0, phase: "calling" },
        callers,
        points: 0,
        dispatchAt: now + 1400,
        lastSeen: now,
        location: [...origin],
        officers: [],
        reinforceAt: now,
      };
      this.reports.set(id, report);
    }
    if (report.wanted.phase === "calling") {
      for (const actor of callers) {
        report.callers.add(actor);
        if (actor.civilian) {
          actor.action = "calling";
          this.routes.get(actor.id)!.poseUntil = report.dispatchAt;
        }
      }
    }
    if (confirmed && report.wanted.phase === "calling") {
      report.wanted.phase = "responding";
      report.dispatchAt = now;
    }
    report.points = Math.min(
      STAR_POINTS * MAX_WANTED,
      report.points + (victim?.hp === 0 ? STAR_POINTS : points),
    );
    if (report.wanted.phase !== "calling")
      report.wanted.stars = Math.ceil(report.points / STAR_POINTS);
    report.lastSeen = now;
    report.location = [...origin];
  }
  private dispatch<T extends Person>(players: T[], now: number) {
    for (const [id, report] of this.reports) {
      const suspect = players.find((p) => p.id === id && p.hp > 0);
      const calling = report.wanted.phase === "calling";
      if (
        !suspect ||
        now - report.lastSeen > 20000 ||
        (calling && ![...report.callers].some((a) => a.hp > 0))
      ) {
        for (const officer of report.officers) {
          if (officer.car !== undefined)
            this.leaveCar(officer, this.routes.get(officer.id)!);
          this.routes.delete(officer.id);
          this.actors.splice(this.actors.indexOf(officer), 1);
        }
        this.reports.delete(id);
        continue;
      }
      if (now < report.dispatchAt) continue;
      report.callers.clear();
      const wanted = report.wanted;
      wanted.stars = Math.max(1, Math.ceil(report.points / STAR_POINTS));
      if (calling) wanted.phase = "responding";
      if (
        now - report.lastSeen > 2500 &&
        report.officers.some((a) => a.hp > 0 && a.car === undefined)
      )
        wanted.phase = "search";
      if (
        now < report.reinforceAt ||
        report.officers.filter((a) => a.hp > 0).length >= wanted.stars
      )
        continue;
      report.reinforceAt = now + 4000;
      for (const officer of report.officers.filter(
        (a) => a.hp <= 0 && now - a.deadAt > 4000,
      )) {
        this.routes.delete(officer.id);
        this.actors.splice(this.actors.indexOf(officer), 1);
        report.officers.splice(report.officers.indexOf(officer), 1);
      }
      this.sendCruiser(id, report, players);
    }
  }
  private sendCruiser(id: string, report: PoliceReport, players: Person[]) {
    // Approach along a single street lane ending near the last reported position.
    let best = Infinity;
    let entry: { road: Street; dir: number; p: V3; stop: V3 } | undefined;
    for (const road of this.streets) {
      const length = horizontal(road.a, road.b);
      if (length < 24) continue;
      const dx = (road.b[0] - road.a[0]) / length,
        dz = (road.b[2] - road.a[2]) / length;
      const along =
        (report.location[0] - road.a[0]) * dx +
        (report.location[2] - road.a[2]) * dz;
      for (const dir of [1, -1]) {
        const near = Math.max(4, Math.min(length - 4, along - dir * 7));
        const far = Math.max(3, Math.min(length - 3, near - dir * 30));
        if ((near - far) * dir < 10) continue;
        const p = alongStreet(road, far / length, dir * lane(road));
        const stop = alongStreet(road, near / length, dir * lane(road));
        p[1] = stop[1] = 0.08;
        const score = horizontal(stop, report.location);
        if (
          score >= best ||
          players.some((v) => v.hp > 0 && distance(v.p, p) < 16) ||
          this.cars.some((c) => nearCar(p, c, 2) || nearCar(stop, c, 1)) ||
          this.actors.some((a) => a.hp > 0 && distance(a.p, p) < 3) ||
          !this.queries.clear(p, 1.76) ||
          !this.queries.clear(stop, 1.76)
        )
          continue;
        best = score;
        entry = { road, dir, p, stop };
      }
    }
    if (!entry) return;
    const reusable = this.cars.findIndex(
      (c, i) =>
        c.cruiser &&
        !c.driver &&
        !players.some((p) => distance(p.p, c.p) < 40) &&
        !this.actors.some(
          (a) => !a.civilian && this.routes.get(a.id)?.seat === i,
        ),
    );
    const slot = reusable < 0 ? this.cars.length : reusable;
    const officer = this.add(
      "police-" + ++this.unitSerial,
      "County Police",
      entry.road,
      entry.dir,
      [...entry.p],
      slot,
    );
    this.cars[slot] = {
      kind: "saloon",
      cruiser: true,
      driver: officer.id,
      p: entry.p,
      yaw: officer.yaw,
    };
    officer.civilian = false;
    officer.targetId = id;
    this.routes.get(officer.id)!.goal = entry.stop;
    report.officers.push(officer);
  }
  update<T extends Person>(
    dt: number,
    now: number,
    players: T[],
    hurt: Hurt<T>,
    shot: (a: CountyCitizen, to: V3) => void,
  ) {
    dt = Math.min(dt, 0.12);
    this.dispatch(players, now);
    for (const a of this.actors) {
      const route = this.routes.get(a.id)!;
      a.vx = 0;
      a.vz = 0;
      if (now >= route.poseUntil) a.action = "idle";
      if (a.hp <= 0) {
        a.action = "idle";
        a.engaged = false;
        if (!a.civilian) {
          if (a.car !== undefined) this.leaveCar(a, route);
          continue;
        }
        route.panicUntil = 0;
        if (!route.respawnAt)
          route.respawnAt = now + 18000 + route.random() * 8000;
        if (a.car !== undefined) this.leaveCar(a, route);
        if (now < route.respawnAt) continue;
        const seat =
          route.seat === undefined ? undefined : this.cars[route.seat];
        if (
          seat &&
          !seat.driver &&
          !players.some((p) => p.hp > 0 && distance(p.p, seat.p) < 12)
        ) {
          seat.driver = a.id;
          a.car = route.seat;
          a.p = [...seat.p];
          a.yaw = seat.yaw;
          route.pace = 8.5;
        } else {
          const local = this.junctions.get(route.road.a.join(","))!;
          const spawn = [route.road, ...local]
            .map((road) => ({ road, p: onRoute(road, 1, 0.4, false) }))
            .find(
              ({ p }) =>
                this.queries.clear(p, a.height) &&
                !players.some((v) => v.hp > 0 && distance(p, v.p) < 12) &&
                !this.cars.some((c) => nearCar(p, c, 0.35)) &&
                !this.actors.some(
                  (b) => b !== a && b.hp > 0 && distance(b.p, p) < 1.2,
                ),
            );
          if (!spawn) continue;
          a.p = spawn.p;
          route.road = spawn.road;
          route.dir = 1;
        }
        a.hp = 100;
        a.deadAt = 0;
        a.downUntil = 0;
        a.fall = undefined;
        route.respawnAt = 0;
        route.lastHealth = 100;
        route.blockedFor = 0;
        route.reverseUntil = 0;
        route.actionAt = now + 1000;
        setGoal(route, a.car !== undefined, false);
      }
      if (a.hp < route.lastHealth) route.healAt = now + 12000;
      if (a.hp < 100 && now >= route.healAt && (a.downUntil ?? 0) <= now) {
        a.hp = Math.min(100, a.hp + 5);
        route.healAt = now + 1000;
      }
      route.lastHealth = a.hp;
      if (
        a.car !== undefined &&
        (this.cars[a.car].driver !== a.id || (a.downUntil ?? 0) > now)
      )
        this.leaveCar(a, route);
      if ((a.downUntil ?? 0) > now) {
        a.action = "idle";
        a.engaged = false;
        continue;
      }
      if (!a.civilian) {
        const suspect = players.find((p) => p.id === a.targetId);
        const report = this.reports.get(a.targetId!);
        if (suspect && report)
          this.police(a, route, suspect, report, players, dt, now, hurt, shot);
        continue;
      }
      a.engaged = false;
      const panic = now < route.panicUntil;
      if (panic && a.action !== "calling") a.action = "flee";
      if (a.car !== undefined) {
        this.drive(a, route, players, dt, now, panic);
        continue;
      }
      let danger = panic ? route.danger : undefined;
      let nearest = 3.4;
      for (const p of players) {
        const d = distance(a.p, p.p);
        if (p.hp > 0 && d < nearest && this.visible(a, p, now)) {
          danger = p.p;
          nearest = d;
        }
      }
      if (danger) {
        let dx = a.p[0] - danger[0],
          dz = a.p[2] - danger[2];
        if (Math.hypot(dx, dz) < 0.01) {
          dx = -Math.sin(a.yaw);
          dz = -Math.cos(a.yaw);
        }
        this.walk(
          a,
          route,
          [a.p[0] + dx * 4, a.p[1], a.p[2] + dz * 4],
          panic ? 5.4 : 2.4,
          players,
          dt,
          now,
          true,
        );
      } else if (horizontal(a.p, route.goal) < 0.5) this.nextRoad(route, false);
      else this.walk(a, route, route.goal, route.pace, players, dt, now, false);
    }
  }
  private leaveCar(a: CountyCitizen, r: Route) {
    const car = this.cars[a.car!];
    if (car.driver === a.id) car.driver = null;
    for (const side of [-1, 1]) {
      const exit: V3 = [
        car.p[0] + side * 1.65 * Math.cos(car.yaw),
        0.16,
        car.p[2] - side * 1.65 * Math.sin(car.yaw),
      ];
      if (
        this.queries.clear(exit, a.height) &&
        !this.cars.some((c) => c !== car && nearCar(exit, c, 0.32))
      ) {
        a.p = exit;
        break;
      }
    }
    a.car = undefined;
    r.pace = 1.6;

    setGoal(r, false, false);
  }
  private police<T extends Person>(
    a: CountyCitizen,
    r: Route,
    suspect: T,
    report: PoliceReport,
    players: T[],
    dt: number,
    now: number,
    hurt: Hurt<T>,
    shot: (a: CountyCitizen, to: V3) => void,
  ) {
    if (a.car !== undefined) {
      const car = this.cars[a.car];
      const remaining = horizontal(car.p, r.goal);
      // Ease into the stop. A blocked cruiser unloads instead of ramming traffic.
      const step = Math.min(remaining, dt * Math.min(12, 2 + remaining * 1.2) * vehicleHandling(car).speed);
      const dx = -Math.sin(car.yaw),
        dz = -Math.cos(car.yaw);
      const next: V3 = [car.p[0] + dx * step, car.p[1], car.p[2] + dz * step];
      const nose: V3 = [next[0] + dx * 2.5, next[1], next[2] + dz * 2.5];
      const blocked =
        this.cars.some((c) => c !== car && nearCar(nose, c, 0.8)) ||
        [...players, ...this.actors].some(
          (p) => p !== a && p.hp > 0 && distance(nose, p.p) < 1.7,
        ) ||
        !this.passable(a, r, next, dx, dz, now, true);
      if (remaining > 0.25 && !blocked) {
        car.p = next;
        a.p = [...next];
        a.lastMove = now;
        r.blockedFor = 0;
      } else if (remaining <= 0.25 || (r.blockedFor += dt) >= 0.8) {
        this.leaveCar(a, r);
        r.actionAt = now + 650;
      }
      return;
    }
    const d = distance(a.p, suspect.p);
    const seen = d <= 42 && this.visible(a, suspect, now);
    a.engaged = seen;
    if (seen) {
      report.lastSeen = now;
      report.location = [...suspect.p];
      report.wanted.phase = "pursuit";
      if (d <= 20) {
        a.yaw = movementYaw(
          suspect.p[0] - a.p[0],
          suspect.p[2] - a.p[2],
          a.yaw,
        );
        if (now >= r.actionAt && (suspect.shieldUntil ?? 0) <= now) {
          a.action = "shoot";
          r.poseUntil = now + 450;
          r.actionAt = now + 1500;
          shot(a, [
            suspect.p[0],
            suspect.p[1] + suspect.height * 0.58,
            suspect.p[2],
          ]);
          hurt(suspect, a, 9, "shot");
        }
        return;
      }
    }
    if (horizontal(a.p, report.location) > 0.4)
      this.walk(a, r, report.location, 4.8, players, dt, now, true);
  }
  private walk(
    a: CountyCitizen,
    r: Route,
    goal: V3,
    pace: number,
    players: Person[],
    dt: number,
    now: number,
    steer: boolean,
  ) {
    const len = Math.max(0.001, horizontal(a.p, goal));
    const heading = Math.atan2(goal[2] - a.p[2], goal[0] - a.p[0]);
    const step = Math.min(len, pace * dt);
    const from = a.p;
    for (const angle of steer ? [0, 0.7, -0.7, 1.45, -1.45] : [0]) {
      const dx = Math.cos(heading + angle),
        dz = Math.sin(heading + angle);
      const next: V3 = [from[0] + dx * step, from[1], from[2] + dz * step];
      const clearance = 0.48;
      const obstruction =
        this.cars.some(
          (c) =>
            nearCar(next, c, clearance) &&
            (!nearCar(from, c, clearance) ||
              horizontal(next, c.p) <= horizontal(from, c.p)),
        ) ||
        this.actors.some(
          (b) =>
            b !== a &&
            b.hp > 0 &&
            b.car === undefined &&
            distance(b.p, next) < 0.7 &&
            distance(b.p, next) < distance(b.p, from),
        ) ||
        players.some(
          (p) =>
            p.hp > 0 &&
            distance(p.p, next) < 0.77 &&
            distance(p.p, next) < distance(p.p, from),
        );
      if (steer) r.checkAt = 0;
      if (obstruction || !this.passable(a, r, next, dx, dz, now, false)) {
        continue;
      }
      r.blockedFor = 0;
      a.vx = (dx * step) / Math.max(0.001, dt);
      a.vz = (dz * step) / Math.max(0.001, dt);
      a.p = next;
      a.lastMove = now;
      a.yaw = movementYaw(dx, dz, a.yaw);
      return;
    }
    this.blocked(r, dt, now, false);
  }
  private drive<T extends Person>(
    a: CountyCitizen,
    r: Route,
    players: T[],
    dt: number,
    now: number,
    panic: boolean,
  ) {
    const car = this.cars[a.car!];
    const goal = r.goal;
    const len = horizontal(car.p, goal);
    if (len < 1.4) {
      this.nextRoad(r, true);
      return;
    }
    const desired = movementYaw(
      goal[0] - car.p[0],
      goal[2] - car.p[2],
      car.yaw,
    );
    const turn = Math.atan2(
      Math.sin(desired - car.yaw),
      Math.cos(desired - car.yaw),
    );
    const handling = vehicleHandling(car);
    const reversing = now < r.reverseUntil;
    const gear = reversing ? -1 : 1;
    const pace =
      (reversing ? 2.2 : panic ? 12 : r.pace) *
      handling.speed *
      Math.max(0.31, 1 - Math.abs(turn) * 0.58);
    const step = Math.min(len, pace * dt);
    const yaw =
      car.yaw +
      Math.max(-2.5 * dt, Math.min(2.5 * dt, turn)) +
      (gear * step * Math.tan(handling.pull * 0.6)) /
        VEHICLE_DIMENSIONS[car.kind][3];
    const dx = -Math.sin(yaw) * gear,
      dz = -Math.cos(yaw) * gear;
    const next: V3 = [car.p[0] + dx * step, 0.08, car.p[2] + dz * step];
    const [, length] = VEHICLE_DIMENSIONS[car.kind];
    const nose: V3 = [next[0] + dx * length, next[1], next[2] + dz * length];
    const blocked =
      this.cars.some(
        (c) => c !== car && (nearCar(nose, c, 0.72) || nearCar(next, c, 0.72)),
      ) ||
      [...players, ...this.actors].some(
        (p) =>
          p !== a &&
          p.hp > 0 &&
          (!("car" in p) || p.car === undefined) &&
          distance(p.p, nose) < 1.65,
      );
    if (blocked || !this.passable(a, r, next, dx, dz, now, true)) {
      this.blocked(r, dt, now, true);
      return;
    }
    const previous = car.p;
    car.p = next;
    car.yaw = yaw;
    a.p = [...next];
    a.yaw = yaw;
    a.lastMove = now;
    r.blockedFor = 0;
    this.onTrafficMove?.(a, car, previous, step / Math.max(dt, 0.001), now);
  }
  private passable(
    a: CountyCitizen,
    r: Route,
    next: V3,
    dx: number,
    dz: number,
    now: number,
    driving: boolean,
  ) {
    if (now < r.checkAt) return true;
    const margin = driving ? 2.25 : 0,
      look = driving ? 2.25 : 0.8;
    for (const side of driving ? [-0.85, 0.85] : [0]) {
      const from: V3 = [
        next[0] + dx * margin + dz * side,
        next[1],
        next[2] + dz * margin - dx * side,
      ];
      const ahead: V3 = [from[0] + dx * look, from[1], from[2] + dz * look];
      if (
        !this.queries.clear(from, a.height) ||
        !this.queries.clear(ahead, a.height) ||
        !this.queries.movement(from, ahead, a.height)
      )
        return false;
    }
    r.checkAt = now + (driving ? 130 : 195);
    return true;
  }
  private blocked(r: Route, dt: number, now: number, driving: boolean) {
    r.blockedFor += dt;
    if (r.blockedFor < (driving ? 2.2 : 0.9)) return;
    if (driving) r.reverseUntil = now + 1050;
    r.dir = -r.dir;
    setGoal(r, driving, false);
    r.blockedFor = 0;
  }
}
