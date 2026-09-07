import * as T from "three";
import { type City, type V3, worldRay, distance } from "./world.ts";
import { Controller } from "./physics.ts";
import { Doodle } from "./actors.ts";
import { RED, INK, GOLD, stroke, inkMaterial, disposeGroup } from "./render.ts";
import { AudioEngine } from "./audio.ts";
export const WEAPONS = [
  {
    name: "INKRIFLE",
    tag: "01 / AUTOMATIC",
    mag: 30,
    interval: 0.11,
    damage: 25,
    pellets: 1,
    reload: 1.45,
    spread: 0.008,
  },
  {
    name: "SCATTERPEN",
    tag: "02 / SHOTGUN",
    mag: 8,
    interval: 0.72,
    damage: 15,
    pellets: 8,
    reload: 1.9,
    spread: 0.085,
  },
  {
    name: "SIDE NOTE",
    tag: "03 / PISTOL",
    mag: 14,
    interval: 0.25,
    damage: 38,
    pellets: 1,
    reload: 1.05,
    spread: 0.004,
  },
];
interface Bot {
  id: number;
  model: Doodle;
  p: T.Vector3;
  hp: number;
  kind: "rusher" | "grunt" | "sniper";
  cooldown: number;
  path: number[];
  repath: number;
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
  weapon = 0;
  mags = [30, 8, 14];
  cooldown = 0;
  reloadTime = 0;
  hurt = 0;
  hitTime = 0;
  killTime = 0;
  recoil = 0;
  sinceHurt = 10;
  shots = 0;
  enabled = true;
  onNotice: (text: string) => void = () => {};
  onFire: (origin: V3, dir: V3) => void = () => {};
  online = false;
  private adjacency: number[][] = [];
  constructor(
    public scene: T.Scene,
    public city: City,
    public player: Controller,
    public audio: AudioEngine,
    spawnBots = true,
  ) {
    this.adjacency = city.nodes.map(() => []);
    for (const [a, b] of city.links) {
      this.adjacency[a].push(b);
      this.adjacency[b].push(a);
    }
    if (spawnBots) {
      const positions: V3[] = [
        [15, 0.2, 7],
        [15, 0.2, -15],
        [-15, 0.2, 15],
        [45, 0.2, 15],
        [-15, 0.2, -15],
        [15, 0.2, 45],
        [45, 0.2, -45],
        [-45, 0.2, 15],
        ...city.beacons.map((p) => [p[0] - 2, p[1], p[2] - 2] as V3),
      ];
      positions.forEach((p, i) => {
        const model = new Doodle(RED);
        model.group.position.set(...p);
        scene.add(model.group);
        this.bots.push({
          id: i,
          model,
          p: new T.Vector3(...p),
          hp: Math.round(
            (i % 4 === 2 ? 70 : 100) *
              (1 + Math.min(1.5, (city.district - 1) * 0.12)),
          ),
          kind: i >= 8 ? "sniper" : i % 4 === 2 ? "rusher" : "grunt",
          cooldown: 2 + i * 0.22,
          path: [],
          repath: 0,
          speed: 0,
        });
      });
      for (const p of [
        [15, 0.4, 32],
        [-15, 0.4, -30],
        [45, 0.4, 0],
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
  switchWeapon(i: number) {
    if (i < 0 || i > 2 || i === this.weapon) return false;
    this.weapon = i;
    this.reloadTime = 0;
    this.audio.tone(250, 0.05, "triangle");
    return true;
  }
  reload() {
    if (
      this.reloadTime > 0 ||
      this.mags[this.weapon] === WEAPONS[this.weapon].mag
    )
      return;
    this.reloadTime = WEAPONS[this.weapon].reload;
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
  fire() {
    if (this.hp <= 0 || this.cooldown > 0 || this.reloadTime > 0) return false;
    const gun = WEAPONS[this.weapon];
    if (this.mags[this.weapon] <= 0) {
      this.reload();
      return false;
    }
    this.mags[this.weapon]--;
    this.cooldown = gun.interval;
    this.recoil = 1;
    this.shots++;
    this.audio.shoot(this.weapon);
    const origin = this.player.eye,
      forward = this.player.forward;
    this.onFire(origin.toArray() as V3, forward.toArray() as V3);
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
      let range = this.player.physics.ray(origin, dir, 95)?.distance ?? 95;
      let target: Bot | undefined,
        headshot = false;
      if (!this.online)
        for (const bot of this.bots) {
          if (bot.hp <= 0) continue;
          for (const [h, r] of [
            [1.55, 0.3],
            [0.95, 0.43],
          ]) {
            const rel = bot.p
                .clone()
                .add(new T.Vector3(0, h, 0))
                .sub(origin),
              t = rel.dot(dir),
              perp = rel.lengthSq() - t * t;
            if (t > 0 && t < range && perp < r * r) {
              range = t;
              target = bot;
              headshot = h > 1.4;
            }
          }
        }
      const point = origin.clone().addScaledVector(dir, range);
      this.tracer(origin.clone().add(new T.Vector3(0.15, -0.17, 0)), point);
      if (target) {
        target.hp -= gun.damage * (headshot ? 1.6 : 1);
        this.hitTime = 0.15;
        this.audio.hit(target.hp <= 0);
        this.burst(point, RED, 5);
        if (target.hp <= 0) {
          this.kills++;
          this.score += headshot ? 180 : 100;
          this.killTime = 0.25;
          this.onNotice(headshot ? "HEADSHOT +180" : "ERASED +100");
          target.model.group.visible = false;
          if (Math.random() < 0.5) this.hp = Math.min(100, this.hp + 8);
        }
      } else this.burst(point, INK, 3);
    }
    if (this.mags[this.weapon] === 0) this.onNotice("R TO RELOAD");
    return true;
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
    for (const bot of this.bots) {
      if (bot.hp <= 0) continue;
      const eye = bot.p.clone().add(new T.Vector3(0, 1.4, 0)),
        target = this.player.eye,
        delta = target.clone().sub(eye),
        d = delta.length(),
        dir = delta.clone().normalize(),
        occlusion = this.player.physics.ray(eye, dir, d);
      const sees = !occlusion && d < 60;
      bot.cooldown -= dt;
      bot.repath -= dt;
      let movement = new T.Vector3();
      if (this.hp > 0) {
        if (sees && Math.abs(this.player.position.y - bot.p.y) < 1.3) {
          if (
            d > (bot.kind === "rusher" ? 1.5 : bot.kind === "sniper" ? 40 : 12)
          ) {
            movement.copy(dir);
            movement.y = 0;
            movement.normalize();
          } else if (bot.kind !== "rusher" && d < 7) {
            movement.copy(dir).negate();
            movement.y = 0;
          }
        } else {
          if (bot.repath <= 0) {
            bot.path = this.route(
              this.nearest(bot.p),
              this.nearest(this.player.position),
            );
            bot.repath = 2 + bot.id * 0.06;
          }
          if (bot.path.length) {
            const p = new T.Vector3(...this.city.nodes[bot.path[0]]);
            if (p.distanceTo(bot.p) < 0.45) bot.path.shift();
            else movement.copy(p).sub(bot.p).normalize();
          }
        }
        const difficulty = 1 + Math.min(0.5, (this.city.district - 1) * 0.05);
        const speed = (bot.kind === "rusher" ? 5.4 : 2.5) * difficulty;
        bot.speed = movement.length() * speed;
        if (movement.lengthSq() > 0) {
          const move = movement.multiplyScalar(speed * dt);
          const obstacle = this.player.physics.ray(
            eye,
            move.clone().normalize(),
            move.length() + 0.3,
          );
          if (!obstacle || Math.abs(move.y) > 0.01) bot.p.add(move);
        }
        if (sees && bot.cooldown <= 0) {
          bot.cooldown =
            bot.kind === "rusher" ? 0.9 : bot.kind === "sniper" ? 3 : 1.7;
          if (bot.kind === "rusher") {
            if (d < 2.1) {
              this.damage(12);
              this.burst(target, RED);
            }
          } else {
            const v = dir.multiplyScalar(bot.kind === "sniper" ? 38 : 24);
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
                (bot.kind === "sniper" ? 18 : 8) *
                (1 + Math.min(1, (this.city.district - 1) * 0.1)),
            });
          }
        }
      }
      bot.model.group.position.copy(bot.p);
      bot.model.group.rotation.y = Math.atan2(
        this.player.position.x - bot.p.x,
        this.player.position.z - bot.p.z,
      );
      bot.model.animate(time, bot.speed, camera);
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
      if (blocked) p.life = 0;
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
