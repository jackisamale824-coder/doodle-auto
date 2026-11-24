import assert from "node:assert/strict";
import test from "node:test";
import { CountyCitizens, type CitizenAction } from "../src/county-citizens.ts";
import { countyCars, countyWorld, parkedCars } from "../src/county.ts";
import { Spatial } from "../server/spatial.ts";
import { distance, type V3 } from "../src/world.ts";

const city = countyWorld();
const spatial = new Spatial(city.boxes);
const noop = () => {};
function setup() {
  const cars = countyCars(),
    ai = new CountyCitizens(city, cars, spatial);
  return { cars, ai };
}
function player(id: string, p: V3, notoriety: number) {
  return { id, p, hp: 100, height: 1.76, notoriety };
}

test("both towns retain their parked fleet while deterministic citizens walk and drive interconnected streets", () => {
  const { cars, ai } = setup(),
    repeat = setup();
  assert.deepEqual(cars.slice(0, 30), parkedCars());
  assert.deepEqual(ai.actors, repeat.ai.actors);
  const starts = ai.actors.map((a) => [...a.p] as V3),
    traveled = starts.map(() => 0);
  for (const a of ai.actors) assert.ok(spatial.clear(a.p));
  for (let i = 0; i < 900; i++) {
    const last = ai.actors.map((a) => a.p);
    ai.update(1 / 30, (i * 1000) / 30, [], noop, noop);
    repeat.ai.update(1 / 30, (i * 1000) / 30, [], noop, noop);
    ai.actors.forEach((a, j) => (traveled[j] += distance(last[j], a.p)));
  }
  assert.deepEqual(ai.actors, repeat.ai.actors);
  assert.deepEqual(cars, repeat.cars);
  assert.equal(ai.actors.length, 32);
  assert.deepEqual(cars.slice(0, 30), parkedCars());
  ai.actors.forEach((a, i) => {
    assert.ok(
      traveled[i] > (a.car === undefined ? 25 : 80),
      a.id + " traveled " + traveled[i],
    );
    if (a.car !== undefined) {
      assert.equal(cars[a.car].driver, a.id);
      assert.deepEqual(cars[a.car].p, a.p);
    }
  });
});

test("even a notorious player gets space, and only a witnessed incident triggers dispatch", () => {
  let wall = false;
  const fleet: ReturnType<typeof countyCars> = [];
  const ai = new CountyCitizens(city, fleet, {
    ray: () => wall,
    clear: () => true,
    movement: () => true,
  });
  const witness = ai.actors[0];
  ai.actors.splice(1);
  const suspect = player(
    "suspect",
    [witness.p[0] + 1, witness.p[1], witness.p[2]],
    100,
  );
  const bystander = player("neighbor", [suspect.p[0], 0, suspect.p[2] + 5], 0);
  const people = [suspect, bystander];
  const tick = (now: number) =>
    ai.update(
      0.1,
      now,
      people,
      (_target, bot) => assert.equal(bot.civilian, false),
      noop,
    );
  tick(100);
  assert.ok(distance(witness.p, suspect.p) > 1);
  assert.equal(ai.wanted(suspect.id), undefined);
  wall = true;
  ai.alarm(suspect.id, suspect.p, 200, 2, 36);
  assert.equal(ai.wanted(suspect.id), undefined);
  wall = false;
  ai.alarm(suspect.id, suspect.p, 300, 2, 36);
  const before = distance(witness.p, suspect.p);
  tick(400);
  assert.ok(distance(witness.p, suspect.p) > before + 0.45);
  assert.equal(witness.action, "calling");
  assert.equal(ai.wanted(suspect.id)?.phase, "calling");
  assert.equal(ai.actors.length, 1);
  tick(1700);
  const officer = ai.actors.find((a) => !a.civilian)!;
  assert.equal(officer.targetId, suspect.id);
  assert.equal(witness.action, "flee");
  assert.equal(ai.wanted(suspect.id)?.stars, 1);
  assert.equal(ai.wanted(bystander.id), undefined);
  const cruiser = fleet[officer.car!];
  assert.equal(cruiser.cruiser, true);
  assert.equal(cruiser.driver, officer.id);
  const start = [...cruiser.p] as V3;
  let shots = 0;
  for (let now = 1800; now <= 12000; now += 100) {
    ai.update(
      0.1,
      now,
      people,
      (target, unit, _d, kind) => {
        assert.equal(target.id, suspect.id);
        assert.equal(unit.car, undefined);
        assert.equal(kind, "shot");
        shots++;
      },
      noop,
    );
  }
  assert.ok(distance(start, cruiser.p) > 5);
  assert.equal(cruiser.driver, null);
  assert.ok(shots > 0);
  wall = true;
  tick(15000);
  assert.equal(ai.wanted(suspect.id)?.phase, "search");
  tick(33000);
  assert.equal(ai.wanted(suspect.id), undefined);
  assert.deepEqual(ai.actors, [witness]);
});

test("distinct car thefts and kills each add a star and dispatch one unit per star", () => {
  const { ai, cars } = setup();
  const p = player("suspect", [...city.spawns[0]], 0);
  const other = player("innocent", [...city.spawns[15]], 0);
  const people = [p, other];
  const stolen = cars.find((c) => c.driver?.startsWith("civilian-driver-"))!;
  const driver = ai.actors.find((a) => a.id === stolen.driver)!;
  ai.takeCar(p.id, stolen, 100);
  assert.equal(driver.car, undefined);
  assert.equal(stolen.driver, null);
  assert.equal(ai.wanted(p.id)?.stars, 1);
  ai.takeCar(p.id, stolen, 200);
  assert.equal(ai.wanted(p.id)?.stars, 1);
  ai.takeCar(p.id, cars[1], 300);
  assert.equal(ai.wanted(p.id)?.stars, 2);
  for (let kill = 0; kill < 5; kill++) {
    ai.alarm(p.id, p.p, 400 + kill, 12, 0, { ...other, hp: 0 });
    assert.equal(ai.wanted(p.id)?.stars, Math.min(5, 3 + kill));
  }
  for (let t = 500; t < 19300; t += 100) ai.update(0.1, t, people, noop, noop);
  assert.equal(
    ai.actors.filter((a) => !a.civilian && a.targetId === p.id).length,
    5,
  );
  assert.equal(cars.filter((c) => c.cruiser).length, 5);
  assert.equal(ai.wanted(other.id), undefined);
  ai.update(0.1, 19400, [other], noop, noop);
  assert.ok(cars.every((c) => !c.driver?.startsWith("police-")));
});
test("an interrupted call never dispatches police", () => {
  const { ai } = setup();
  const witness = ai.actors[0];
  ai.actors.splice(1);
  const p = player("attacker", [...witness.p], 0);
  ai.alarm(p.id, p.p, 100, 10, 24, witness);
  witness.hp = 0;
  ai.update(0.1, 1501, [p], noop, noop);
  assert.equal(ai.wanted(p.id), undefined);
  assert.equal(ai.actors.length, 1);
});

test("drivers brake for calm pedestrians and active human car ownership survives civilian recovery", () => {
  const { ai, cars } = setup();
  const a = ai.actors.find((c) => c.car !== undefined)!,
    slot = a.car!,
    car = cars[slot];
  ai.actors.splice(0, ai.actors.length, a);
  const start = [...car.p] as V3;
  const p = player(
    "human",
    [
      car.p[0] - 2.3 * Math.sin(car.yaw),
      car.p[1],
      car.p[2] - 2.3 * Math.cos(car.yaw),
    ],
    30,
  );
  ai.update(1 / 30, 1000, [p], () => assert.fail(), noop);
  assert.deepEqual(car.p, start);
  p.notoriety = 100;
  const hits: CitizenAction[] = [];
  ai.update(
    1 / 30,
    1100,
    [p],
    (target, _bot, _damage, k) => {
      assert.equal(target, p);
      hits.push(k);
    },
    noop,
  );
  ai.update(1 / 30, 1200, [p], (_t, _b, _d, k) => hits.push(k), noop);
  assert.deepEqual(hits, []);
  assert.deepEqual(car.p, start);
  a.hp = 0;
  ai.update(1 / 30, 1300, [], noop, noop);
  assert.equal(car.driver, null);
  car.driver = p.id;
  const stopped = [...car.p];
  ai.update(1 / 30, 30000, [], noop, noop);
  assert.equal(a.hp, 100);
  assert.equal(a.car, undefined);
  assert.equal(car.driver, p.id);
  assert.deepEqual(car.p, stopped);
});

test("a knocked-down citizen suspends activity, then walks and heals without changing identity", () => {
  const { ai } = setup(),
    a = ai.actors[0],
    original = [...a.p];
  a.hp = 65;
  a.downUntil = 6000;
  ai.update(1 / 30, 1000, [], noop, noop);
  assert.deepEqual(a.p, original);
  assert.equal(a.hp, 65);
  ai.update(1 / 30, 7000, [], noop, noop);
  assert.notDeepEqual(a.p, original);
  assert.equal(a.hp, 65);
  ai.update(1 / 30, 13000, [], noop, noop);
  assert.equal(a.hp, 70);
  const count = ai.actors.length;
  a.hp = 0;
  ai.update(1 / 30, 14000, [], noop, noop);
  ai.update(1 / 30, 41000, [], noop, noop);
  assert.equal(a.hp, 100);
  assert.equal(ai.actors[0], a);
  assert.equal(ai.actors.length, count);
});

test("traffic stays in its lane around both calm and notorious motorists", () => {
  function trajectory(level: number) {
    const { cars, ai } = setup();
    const a = ai.actors.find((a) => a.car !== undefined)!;
    ai.actors.splice(0, ai.actors.length, a);
    const c = cars[a.car!],
      forward = [-Math.sin(c.yaw), -Math.cos(c.yaw)],
      side = [Math.cos(c.yaw), -Math.sin(c.yaw)];
    const start = [...c.p] as V3;
    const other = player(
      "driver",
      [
        start[0] + 6 * side[0] + 3 * forward[0],
        start[1],
        start[2] + 6 * side[1] + 3 * forward[1],
      ],
      level,
    );
    cars[0] = { p: other.p, yaw: c.yaw, kind: "taxi", driver: other.id };
    for (let i = 1; i <= 18; i++)
      ai.update(
        1 / 30,
        1000 + (i * 1000) / 30,
        [other],
        () => assert.fail(),
        noop,
      );
    return (c.p[0] - start[0]) * side[0] + (c.p[2] - start[2]) * side[1];
  }
  assert.ok(Math.abs(trajectory(30)) < 0.01);
  assert.equal(trajectory(100), trajectory(30));
});

test("civilian motorists share a seated mesh, visible only in their occupied near-detail cars", async () => {
  const { CountyCarModel } = await import("../src/county-car.ts");
  const { Group, Mesh, MeshBasicMaterial } = await import("three");
  const template = new Group(),
    coat = new MeshBasicMaterial();
  template.userData = {
    seat: [-0.37, 1.16, 0.375],
    wheelRadius: 0.34,
    doorSide: -1,
  };
  for (const tier of ["near", "street", "far"]) {
    const level = new Group(),
      door = new Group();
    level.name = tier;
    door.name = tier + "_door";
    level.add(door);
    template.add(level);
    if (tier === "near")
      for (const name of ["dial0", "dial1"]) {
        const dial = new Group();
        dial.name = name;
        level.add(dial);
      }
  }
  const a = new CountyCarModel(template, coat, coat),
    b = new CountyCarModel(template, coat, coat);
  const seated = a.getObjectByName("civilian-driver")!,
    other = b.getObjectByName("civilian-driver")!;
  assert.ok(seated instanceof Mesh && other instanceof Mesh);
  assert.equal(seated.geometry, other.geometry);
  assert.equal(seated.material, other.material);
  assert.equal(seated.parent?.name, "near");
  assert.deepEqual(seated.position.toArray(), template.userData.seat);
  a.update("civilian-driver-0", 1, 5);
  assert.ok(seated.visible);
  assert.equal(other.visible, false);
  a.update("civilian-driver-0", 2, 12);
  assert.equal(seated.visible, false);
  a.update("human", 3, 2);
  assert.equal(seated.visible, false);
  a.update("civilian-driver-0", 4, 2);
  assert.ok(seated.visible);
  a.update(null, 5, 2);
  assert.equal(seated.visible, false);
  coat.dispose();
});
