import {
  throwGrenade,
  obscured,
  SMOKE_RADIUS,
  type GrenadeEffect,
} from "./grenades.ts";
import { FISTS, PUNCHES, nextPunch, type Punch } from "./fists.ts";
import { combatStep, shotDelay } from "./enemy-movement.ts";
import {
  BURST_AR,
  BURST_RECOVERY,
  KNIFE,
  FLASH,
  isGrenade,
  isUtility,
  WEAPONS,
  inventory,
} from "./weapon-balance.ts";
import { actorHit, HIT_MULTIPLIER, type HitRegion } from "./actor-hit.ts";
import * as T from "three";
import { type City, type V3, worldRay, distance } from "./world.ts";
import { Controller } from "./physics.ts";
import { Doodle } from "./actors.ts";
import { RED, INK, GOLD, stroke, inkMaterial, disposeGroup } from "./render.ts";
import { chooseNpcSpawn, NPC_RADIUS } from "./npc-presence.ts";
import { Waves } from "./waves.ts";
import { AudioEngine } from "./audio.ts";
import { ShotTrails } from "./shot-trails.ts";
export { WEAPONS };
interface Bot {
  id: number;
  model: Doodle;
  p: T.Vector3;
  hp: number;
  kind: "rusher" | "grunt" | "sniper";
  cooldown: number;
  path: number[];
  repath: number;
  velocity: T.Vector3;
  sideSign: number;
  blockedFor: number;
  shots: number;
  sightTime: number;
  speed: number;
}
interface Projectile {
  p: T.Vector3;
  v: T.Vector3;
  life: number;
  mesh: T.Mesh;
  damage: number;
}
interface Flash {
  mesh: T.Object3D;
  life: number;
  max: number;
}
export class Combat {
  bots: Bot[] = [];
  projectiles: Projectile[] = [];
  flashes: Flash[] = [];
  pickups: { p: T.Vector3; mesh: T.Group; active: boolean }[] = [];
  hp = 100;
  kills = 0;
  score = 0;
  owned = inventory().owned;
  weapon = 0;
  mags = WEAPONS.map((g) => g.mag);
  punch?: Punch;
  private punchClock = 0;
  private punchPending = false;
  get punchAge() {
    return this.punch ? (this.punchClock - this.punch.start) / 1000 : 1;
  }
  onPunch = () => {};
  onPunchContact = (_move: number) => {};
  burstLeft = 0;
  effects: GrenadeEffect[] = [];
  addGrenade(effect: GrenadeEffect, now = Date.now()) {
    if (effect.expires <= now) return;
    this.effects.push(effect);
    const smoke = effect.weapon !== FLASH;
    const mesh = new T.Mesh(
      new T.IcosahedronGeometry(smoke ? SMOKE_RADIUS : 0.65, 2),
      new T.MeshBasicMaterial({
        color: smoke ? "#92958f" : "#fff7d3",
        transparent: true,
        opacity: smoke ? 0.94 : 0.85,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.position.fromArray(effect.p);
    this.scene.add(mesh);
    const life = (effect.expires - now) / 1000;
    this.flashes.push({ mesh, life, max: life });
  }
  cancelPunch() {
    this.burstLeft = 0;
    this.punchPending = false;
    this.punch = undefined;
  }
  cooldown = 0;
  reloadTime = 0;
  hurt = 0;
  hitTime = 0;
  hitRegion: HitRegion = "body";
  killTime = 0;
  recoil = 0;
  sinceHurt = 10;
  shots = 0;
  enabled = true;
  onNotice: (text: string) => void = () => {};
  onFire: (origin: V3, dir: V3) => void = () => {};
  muzzlePosition: (() => T.Vector3) | null = null;
  shotTrails: ShotTrails;
  online = false;
  waves = new Waves();
  private waveEnabled = false;
  private botSerial = 0;
  onReload: () => void = () => {};
  private adjacency: number[][] = [];
  constructor(
    public scene: T.Scene,
    public city: City,
    public player: Controller,
    public audio: AudioEngine,
    spawnBots = true,
  ) {
    this.shotTrails = new ShotTrails(scene);
    this.adjacency = city.nodes.map(() => []);
    for (const [a, b] of city.links) {
      this.adjacency[a].push(b);
      this.adjacency[b].push(a);
    }
    if (spawnBots) {
      this.waveEnabled = true;
      for (let i = 0; i < 4; i++) this.spawnBot();
      this.waves.spawned = this.bots.length;
      for (const p of [
        ...city.spawns.slice(2, 5).map((p) => [p[0], 0.4, p[2]]),
        ...city.beacons,
      ] as V3[]) {
        const mesh = new T.Group();
        const box = new T.Mesh(
          new T.BoxGeometry(0.65, 0.65, 0.65),
          inkMaterial("#42856b", 0.08),
        );
        mesh.add(box);
        for (const [sx, sy] of [
          [0.4, 0.1],
          [0.1, 0.4],
        ]) {
          const cross = new T.Mesh(
            new T.BoxGeometry(sx, sy, 0.02),
            new T.MeshBasicMaterial({ color: "#42856b" }),
          );
          cross.position.z = 0.34;
          mesh.add(cross);
        }
        mesh.position.set(...p);
        scene.add(mesh);
        this.pickups.push({ p: new T.Vector3(...p), mesh, active: true });
      }
    }
  }
  private spawnBot() {
    const id = this.botSerial++;
    const node = chooseNpcSpawn(
      this.city.nodes,
      this.city.nodes.map((_, i) => i),
      [
        {
          p: this.player.position.toArray() as V3,
          eye: this.player.eye.toArray() as V3,
        },
      ],
      this.bots.filter((b) => b.hp > 0).map((b) => b.p.toArray() as V3),
      id,
      (eye, to) => {
        const a = new T.Vector3(...eye),
          delta = new T.Vector3(...to).sub(a);
        return !!this.player.physics.ray(
          a,
          delta.clone().normalize(),
          delta.length() - 0.2,
        );
      },
      (p) => this.player.physics.clear(new T.Vector3(...p), 1.85),
    );
    if (node === null) return false;
    const p = this.city.nodes[node];
    const model = new Doodle(RED, undefined, "combatant", "bot-" + id);
    model.group.position.set(...p);
    this.scene.add(model.group);
    this.bots.push({
      id,
      model,
      p: new T.Vector3(...p),
      hp: 100,
      kind:
        this.waves.number > 2 && id % 5 === 0
          ? "sniper"
          : id % 3 === 2
            ? "rusher"
            : "grunt",
      cooldown: 1.8,
      path: [],
      repath: 0,
      velocity: new T.Vector3(),
      sideSign: 1,
      blockedFor: 0,
      shots: 0,
      sightTime: 0,
      speed: 0,
    });
    return true;
  }
  switchWeapon(i: number) {
    if (
      !Number.isInteger(i) ||
      i < 0 ||
      !this.owned.includes(i) ||
      i === this.weapon
    )
      return false;
    this.cancelPunch();
    this.weapon = i;
    this.reloadTime = 0;
    this.audio.tone(250, 0.05, "triangle");
    return true;
  }
  reload() {
    if (this.weapon === FISTS || isUtility(this.weapon)) return;
    if (
      this.reloadTime > 0 ||
      this.mags[this.weapon] === WEAPONS[this.weapon].mag
    )
      return;
    this.burstLeft = 0;
    this.reloadTime = WEAPONS[this.weapon].reload;
    this.onReload();
    this.audio.noise(0.14, 0.2);
    this.onNotice("RELOADING");
  }
  tracer(from: T.Vector3, to: T.Vector3, color = GOLD) {
    const mesh = stroke(from, to, color, 0.018);
    this.scene.add(mesh);
    this.flashes.push({ mesh, life: 0.07, max: 0.07 });
  }
  burst(at: T.Vector3, color: string, count = 7) {
    for (let i = 0; i < count; i++) {
      const off = new T.Vector3(
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.6,
      );
      const mesh = stroke(
        at.clone().add(off),
        at.clone().add(off.multiplyScalar(2.5)),
        color,
        0.022,
      );
      this.scene.add(mesh);
      this.flashes.push({ mesh, life: 0.22, max: 0.22 });
    }
  }
  onSurfaceHit = (_index: number, _damage: number) => {};
  civilianShot?: (
    origin: V3,
    dir: V3,
    range: number,
    baseDamage: number,
  ) => { distance: number; region: HitRegion; kill: boolean } | null;
  vehicleShot?: (
    origin: V3,
    direction: V3,
    range: number,
  ) => { distance: number; strike: () => void } | undefined;
  shotOrigin = () => this.player.eye;
  fire() {
    if (this.hp <= 0 || this.cooldown > 0 || this.reloadTime > 0) return false;
    if (this.weapon === FISTS) {
      this.punch = nextPunch(this.punch, this.punchClock);
      this.cooldown = PUNCHES[this.punch.move].duration;
      this.punchPending = true;
      this.audio.noise(0.065, 0.07);
      this.onPunch();
      return true;
    }
    const gun = WEAPONS[this.weapon];
    if (this.weapon !== KNIFE && this.mags[this.weapon] <= 0) {
      this.burstLeft = 0;
      this.reload();
      return false;
    }
    if (this.weapon !== KNIFE) this.mags[this.weapon]--;
    this.cooldown = gun.interval;
    if (this.weapon === BURST_AR) {
      this.burstLeft = this.burstLeft ? this.burstLeft - 1 : 2;
      if (!this.burstLeft || !this.mags[this.weapon]) {
        this.burstLeft = 0;
        this.cooldown = BURST_RECOVERY;
      }
    }
    this.recoil = 1;
    this.shots++;
    if (isUtility(this.weapon)) this.audio.noise(0.09, 0.15);
    else this.audio.shoot(gun.model);
    const origin = this.shotOrigin(),
      forward = this.player.forward;
    this.onFire(origin.toArray() as V3, forward.toArray() as V3);
    if (isGrenade(this.weapon)) {
      if (!this.online)
        this.addGrenade(
          throwGrenade(
            this.weapon,
            origin.toArray(),
            forward.toArray(),
            (o, d, n) =>
              this.player.physics.ray(
                new T.Vector3(...o),
                new T.Vector3(...d),
                n,
              ),
            Date.now(),
          ),
        );
      return true;
    }
    for (let pellet = 0; pellet < gun.pellets; pellet++) {
      const dir = forward
        .clone()
        .add(
          new T.Vector3(
            (Math.random() - 0.5) * gun.spread,
            (Math.random() - 0.5) * gun.spread,
            (Math.random() - 0.5) * gun.spread,
          ),
        )
        .normalize();
      const maxRange = this.weapon === KNIFE ? 2 : this.weapon === 3 ? 220 : 95;
      const surface = this.player.physics.ray(
        origin,
        dir,
        maxRange,
        !!this.vehicleShot,
      );
      const vehicle = this.vehicleShot?.(
        origin.toArray(),
        dir.toArray(),
        surface?.distance ?? maxRange,
      );
      let range = vehicle?.distance ?? surface?.distance ?? maxRange;
      let target: Bot | undefined,
        headshot = false,
        region: HitRegion = "body";
      if (!this.online)
        for (const bot of this.bots) {
          if (bot.hp <= 0) continue;
          const hit = actorHit(
            origin.toArray() as V3,
            dir.toArray() as V3,
            bot.p.toArray() as V3,
            1.76,
            range,
            bot.model.group.rotation?.y ?? 0,
          );
          if (hit) {
            range = hit.distance;
            target = bot;
            headshot = hit.head;
            region = hit.region;
          }
        }
      const civil = !this.online
        ? this.civilianShot?.(
            origin.toArray(),
            dir.toArray(),
            range,
            gun.damage,
          )
        : null;
      if (civil) range = civil.distance;
      const point = origin.clone().addScaledVector(dir, range);
      if (this.weapon !== KNIFE) this.shotTrails.queue(point);
      if (civil) {
        this.hitRegion = civil.region;
        this.hitTime = 0.15;
        if (civil.kill) this.audio.npcEliminated();
        else this.audio.hit();
        this.burst(point, RED, 5);
      } else if (target) {
        target.hp -= Math.round(gun.damage * HIT_MULTIPLIER[region]);
        const localX = point
          .clone()
          .sub(target.p)
          .applyAxisAngle(
            new T.Vector3(0, 1, 0),
            -(target.model.group.rotation?.y ?? 0),
          ).x;
        target.model.react?.(
          region,
          localX < 0 ? -1 : 1,
          gun.damage * HIT_MULTIPLIER[region],
        );
        this.hitRegion = region;
        this.hitTime = 0.15;
        if (target.hp <= 0) this.audio.npcEliminated();
        else this.audio.hit();
        this.burst(point, RED, 5);
        if (target.hp <= 0) {
          this.kills++;
          this.score += headshot ? 180 : 100;
          this.killTime = 0.25;
          this.onNotice(headshot ? "HEADSHOT +180" : "ERASED +100");
          target.model.fall?.(0);
          if (Math.random() < 0.5) this.hp = Math.min(100, this.hp + 8);
        }
      } else if (vehicle) {
        if (!this.online) vehicle.strike();
      } else {
        if (!this.online && surface?.box?.pieceId !== undefined)
          this.onSurfaceHit(surface.box.pieceId, gun.damage);
        this.burst(point, INK, 3);
      }
    }
    if (this.weapon !== KNIFE && this.mags[this.weapon] === 0)
      this.onNotice("R TO RELOAD");
    return true;
  }
  renderShots(dt: number) {
    this.shotTrails.render(dt, () => {
      const eye = this.player.eye;
      let muzzle =
        this.muzzlePosition?.() ??
        eye.clone().addScaledVector(this.player.forward, 0.5);
      const offset = muzzle.clone().sub(eye),
        length = offset.length();
      const obstruction =
        length > 0
          ? this.player.physics.ray(eye, offset.clone().normalize(), length)
          : null;
      if (obstruction)
        muzzle = new T.Vector3(...obstruction.point).addScaledVector(
          offset.normalize(),
          -0.015,
        );
      return muzzle;
    });
  }
  damage(n: number) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - n);
    this.hurt = Math.min(1, this.hurt + 0.45);
    this.sinceHurt = 0;
    this.audio.noise(0.12, 0.3);
  }
  private nearest(p: T.Vector3) {
    let best = Infinity,
      idx = 0;
    this.city.nodes.forEach((v, i) => {
      const d =
        p.distanceToSquared(new T.Vector3(...v)) + Math.abs(p.y - v[1]) * 20;
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    return idx;
  }
  private route(start: number, goal: number) {
    const dist = new Map<number, number>([[start, 0]]),
      prev = new Map<number, number>(),
      open = new Set([start]);
    let iterations = 0;
    while (open.size && iterations++ < 1500) {
      let current = -1,
        lowest = Infinity;
      for (const n of open) {
        const score =
          dist.get(n)! + distance(this.city.nodes[n], this.city.nodes[goal]);
        if (score < lowest) {
          lowest = score;
          current = n;
        }
      }
      if (current === goal) {
        const path = [goal];
        while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
        return path;
      }
      open.delete(current);
      for (const n of this.adjacency[current]) {
        const score =
          dist.get(current)! +
          distance(this.city.nodes[current], this.city.nodes[n]);
        if (score < (dist.get(n) ?? Infinity)) {
          dist.set(n, score);
          prev.set(n, current);
          open.add(n);
        }
      }
    }
    return [];
  }
  update(dt: number, time: number, camera: T.Camera) {
    const effectTime = Date.now();
    for (let i = this.effects.length - 1; i >= 0; i--)
      if (this.effects[i].expires <= effectTime) this.effects.splice(i, 1);
    this.punchClock += dt * 1000;
    if (
      this.punchPending &&
      this.punch &&
      this.punchAge >= PUNCHES[this.punch.move].contact
    ) {
      this.punchPending = false;
      if (!this.online && this.hp > 0 && this.weapon === FISTS)
        this.onPunchContact(this.punch.move);
    }
    this.cooldown -= dt;
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.hitTime -= dt;
    this.killTime -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.sinceHurt += dt;
    if (this.reloadTime > 0) {
      this.reloadTime -= dt;
      if (this.reloadTime <= 0) {
        this.mags[this.weapon] = WEAPONS[this.weapon].mag;
        this.audio.tone(320, 0.06, "triangle");
      }
    }
    if (!this.online && this.sinceHurt > 7 && this.hp > 0)
      this.hp = Math.min(100, this.hp + dt * 4);
    if (this.waveEnabled && !this.online && this.hp > 0) {
      for (let i = this.bots.length - 1; i >= 0; i--)
        if (
          this.bots[i].hp > 0 &&
          this.bots[i].p.distanceTo(this.player.position) > NPC_RADIUS
        ) {
          this.bots[i].model.dispose();
          this.bots.splice(i, 1);
          this.waves.spawned--;
        }
      const before = this.waves.number;
      this.waves.update(dt, this.bots.filter((b) => b.hp > 0).length, () =>
        this.spawnBot(),
      );
      if (before !== this.waves.number) {
        this.bots.forEach((b) => b.model.dispose());
        this.bots.splice(0);
        this.onNotice("WAVE " + this.waves.number);
      }
    }
    for (const bot of this.bots) {
      if (bot.hp <= 0) {
        bot.model.fall(dt);
        continue;
      }
      const previousPosition = bot.p.clone();
      const eye = bot.p.clone().add(new T.Vector3(0, 1.4, 0)),
        target = this.player.eye,
        delta = target.clone().sub(eye),
        d = delta.length(),
        dir = delta.clone().normalize(),
        occlusion = this.player.physics.ray(eye, dir, d);
      const sees =
        !occlusion &&
        d < 60 &&
        !obscured(this.effects, eye.toArray(), target.toArray(), effectTime);
      bot.cooldown -= dt;
      bot.repath -= dt;
      let movement = new T.Vector3();
      if (this.hp > 0) {
        if (sees && Math.abs(this.player.position.y - bot.p.y) < 1.3) {
          const walk = combatStep(
            bot.id,
            time,
            d,
            bot.hp,
            bot.kind === "sniper" ? 32 : 12,
          );
          const forward =
            bot.kind === "rusher" ? (d > 1.5 ? 1 : 0) : walk.forward;
          const side = bot.kind === "rusher" ? 0 : walk.side * bot.sideSign;
          movement.set(
            dir.x * forward - dir.z * side,
            0,
            dir.z * forward + dir.x * side,
          );
          if (movement.lengthSq() > 1) movement.normalize();
        } else {
          if (
            bot.repath <= 0 &&
            (!bot.path.length ||
              bot.p.distanceTo(new T.Vector3(...this.city.nodes[bot.path[0]])) <
                0.5)
          ) {
            bot.path = this.route(
              this.nearest(bot.p),
              this.nearest(this.player.position),
            );
            bot.repath =
              this.waves.settings.reaction / 1000 + (bot.id % 3) * 0.05;
          }
          if (bot.path.length) {
            const p = new T.Vector3(...this.city.nodes[bot.path[0]]);
            if (p.distanceTo(bot.p) < 0.45) bot.path.shift();
            else movement.copy(p).sub(bot.p).normalize();
          }
        }
        bot.sightTime = sees ? bot.sightTime + dt : 0;
        bot.blockedFor -= dt;
        const difficulty = 1 + Math.min(0.5, (this.city.district - 1) * 0.05);
        const speed =
          this.waves.settings.speed *
          (bot.kind === "rusher" ? 1.3 : 1) *
          difficulty;
        bot.speed = movement.length() * speed;
        bot.velocity.lerp(
          movement.multiplyScalar(speed),
          1 - Math.exp(-dt * 8),
        );
        if (bot.velocity.lengthSq() > 0.002) {
          const move = bot.velocity.clone().multiplyScalar(dt);
          const obstacle = this.player.physics.ray(
            eye,
            move.clone().normalize(),
            move.length() + 0.3,
          );
          let safe = !obstacle || Math.abs(move.y) > 0.01;
          if (
            safe &&
            sees &&
            Math.abs(this.player.position.y - bot.p.y) < 1.3
          ) {
            const floor = this.player.physics.ray(
              bot.p
                .clone()
                .add(move)
                .add(new T.Vector3(0, 0.5, 0)),
              new T.Vector3(0, -1, 0),
              1,
            );
            safe = !!floor;
            if (floor) move.y += 0.5 - floor.distance;
          }
          if (safe) bot.p.add(move);
          else if (bot.blockedFor <= 0) {
            bot.sideSign *= -1;
            bot.blockedFor = 0.65;
            bot.velocity.set(0, 0, 0);
          }
        }
        const yaw = bot.model.group.rotation.y;
        const aligned = Math.sin(yaw) * dir.x + Math.cos(yaw) * dir.z > 0.88;
        if (
          aligned &&
          sees &&
          bot.cooldown <= 0 &&
          bot.sightTime >= this.waves.settings.reaction / 1000 &&
          (bot.kind !== "rusher" || d < 2.1)
        ) {
          bot.model.fire();
          bot.cooldown =
            bot.kind === "grunt"
              ? shotDelay(
                  ++bot.shots,
                  this.waves.number,
                  this.waves.settings.shotInterval / 1000,
                )
              : (this.waves.settings.shotInterval / 1000) *
                (bot.kind === "sniper" ? 1.4 : 0.8);
          if (bot.kind === "rusher") {
            if (d < 2.1) {
              this.damage(this.waves.settings.damage * 1.5);
              this.burst(target, RED);
            }
          } else {
            const projectileSpeed = bot.kind === "sniper" ? 43 : 30;
            const lead =
              Math.min(0.32, d / projectileSpeed) *
              Math.min(0.8, 0.4 + this.waves.number * 0.09);
            const v = target
              .clone()
              .addScaledVector(this.player.velocity, lead)
              .sub(eye)
              .normalize()
              .multiplyScalar(projectileSpeed);
            const mesh = new T.Mesh(
              new T.SphereGeometry(0.07, 6, 5),
              new T.MeshBasicMaterial({ color: RED }),
            );
            mesh.position.copy(eye);
            this.scene.add(mesh);
            this.projectiles.push({
              p: eye,
              v,
              life: 3,
              mesh,
              damage:
                this.waves.settings.damage *
                (bot.kind === "sniper" ? 1.7 : 1) *
                (1 + Math.min(1, (this.city.district - 1) * 0.1)),
            });
          }
        }
      }
      bot.model.group.position.copy(bot.p);
      const travel = bot.p.clone().sub(previousPosition);
      const speed = travel.length() / Math.max(dt, 0.001);
      const facing = sees
        ? Math.atan2(dir.x, dir.z)
        : speed > 0.05
          ? Math.atan2(travel.x, travel.z)
          : bot.model.group.rotation.y;
      const yaw = bot.model.group.rotation.y,
        turn = Math.atan2(Math.sin(facing - yaw), Math.cos(facing - yaw));
      bot.model.group.rotation.y += T.MathUtils.clamp(turn, -dt * 7, dt * 7);
      bot.model.animate(
        time,
        speed,
        camera,
        sees ? Math.asin(dir.y) : 0,
        dt,
        travel.x,
        travel.z,
        sees,
      );
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i],
        delta = p.v.clone().multiplyScalar(dt),
        blocked = this.player.physics.ray(
          p.p,
          delta.clone().normalize(),
          delta.length(),
        );
      p.life -= dt;
      const toPlayer = this.player.position
          .clone()
          .add(new T.Vector3(0, this.player.height / 2, 0))
          .sub(p.p),
        projection = T.MathUtils.clamp(
          toPlayer.dot(delta) / delta.lengthSq(),
          0,
          1,
        );
      if (
        toPlayer.sub(delta.clone().multiplyScalar(projection)).length() < 0.6 &&
        !blocked
      ) {
        this.damage(p.damage);
        p.life = 0;
      }
      if (blocked) {
        if (blocked.box?.pieceId !== undefined)
          this.onSurfaceHit(blocked.box.pieceId, p.damage);
        p.life = 0;
      }
      p.p.add(delta);
      p.mesh.position.copy(p.p);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as T.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        const mesh = f.mesh as T.Mesh;
        mesh.geometry.dispose();
        (mesh.material as T.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }
    for (const item of this.pickups)
      if (item.active) {
        item.mesh.rotation.y = time;
        item.mesh.position.y = item.p.y + 0.3 + Math.sin(time * 2) * 0.12;
        if (this.hp < 95 && item.p.distanceTo(this.player.position) < 1.5) {
          item.active = false;
          item.mesh.visible = false;
          this.hp = Math.min(100, this.hp + 35);
          this.audio.collect();
          this.onNotice("+35 HEALTH");
        }
      }
  }
  dispose() {
    this.shotTrails.dispose();
    this.bots.forEach((b) => b.model.dispose());
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as T.Material).dispose();
    }
    for (const f of this.flashes) {
      this.scene.remove(f.mesh);
      const m = f.mesh as T.Mesh;
      m.geometry.dispose();
      (m.material as T.Material).dispose();
    }
    this.pickups.forEach((p) => disposeGroup(p.mesh));
  }
}
