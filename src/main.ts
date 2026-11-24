import { drawRange, rangeWorld, weaponRack } from "./weapon-range.ts";
import { shardForSeed } from "./game-shards.ts";
import { QuickInventory } from "./quick-inventory.ts";
import { bindLoadoutPreview, loadoutScreen } from "./loadout-screen.ts";
import {
  ARMORY_RADIUS,
  type Loadout,
  defaultLoadout,
  readLoadout,
  inventory,
  loadoutSlots,
  KNIFE,
  FLASH,
  ROCKET,
  scopeMagnification,
  canAimWeapon,
  isUtility,
  isGrenade,
} from "./weapon-balance.ts";
import { SMOKE_RADIUS } from "./grenades.ts";
import { bindPlayerAccount } from "./player-account.ts";
import { characterLook } from "./character-art.ts";
import { addCountyArms } from "./county-hands.ts";
import { CountyCasings } from "./county-casings.ts";
import { KNIFE_DAMAGE } from "./county-knife.ts";
import {
  damageVehicle,
  nearestVehicleSurface,
} from "./county-vehicle-damage.ts";
import {
  FISTS,
  PUNCHES,
  punchHit,
  punchImpact,
  reactionWeights,
  REACTION_SECONDS,
  type PunchImpact,
} from "./fists.ts";
import { buildFists, animateFists } from "./fist-view.ts";
import { Spatial } from "../server/spatial.ts";
import {
  CountyCitizens,
  MAX_WANTED,
  type CountyCitizen,
  type Wanted,
} from "./county-citizens.ts";
import { CountyRagdolls } from "./county-ragdoll.ts";
import {
  CountyImpacts,
  injuryPoints,
  notorietyAfter,
} from "./county-incidents.ts";
import { actorHit, HIT_MULTIPLIER } from "./actor-hit.ts";
import type { RemoteState } from "./network.ts";
import {
  CountyDriveWorld,
  MAX_PENDING_DRIVE_STEPS,
  driveInput,
  type DrivePose,
} from "./county-driving.ts";
import { RELEASE_ID } from "./release-info.ts";
import { RubbleView } from "./county-rubble-view.ts";
import { CountyWreckage, type RubbleMessage } from "./county-wreckage.ts";
import { CountyDebris } from "./county-debris.ts";
import { CountyStructures } from "./county-structures.ts";
import { COUNTY, countyLadders, countyCars, type CountyCar } from "./county.ts";
import { CoverPeek, peekEye, validatedLean } from "./cover-peek.ts";
import { WeaponClearance } from "./weapon-clearance.ts";
/// <reference types="vite/client" />
import { ISLANDS, SEA_LEVEL } from "./islands.ts";
import { drawIslandMap, islandMapScale } from "./island-view.ts";
import { DUST_A } from "./dust-a.ts";
import { publicMapSeed, generateLevel } from "./levels.ts";
import "./style.css";
import * as T from "three";
import { distance, type City, type V3 } from "./world.ts";
import { Controller, Physics, idleInput } from "./physics.ts";
import { Renderer, INK, GOLD, stroke, disposeGroup } from "./render.ts";
import { buildWeapon, Doodle } from "./actors.ts";
import { Combat, WEAPONS } from "./combat.ts";
import { AudioEngine } from "./audio.ts";
import { animateWeaponParts } from "./weapon-motion.ts";
import { ViewMotion, scopedFov, sensitivityScale } from "./motion.ts";
import { NEIGHBORHOODS } from "./city-plan.ts";
import { blimpPosition, blimpVelocity } from "./aerial.ts";
import { NPC_RADIUS } from "./npc-presence.ts";
import { Network } from "./network.ts";
import { routeRope } from "./rope-path.ts";
import { GrappleVisual } from "./grapple-visual.ts";
const $ = <E extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as E;
const canvas = $<HTMLCanvasElement>("world"),
  dialog = $<HTMLDialogElement>("dialog");
const safeRead = (key: string, fallback: any) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const settings = safeRead("dc.settings", {
  sensitivity: 1,
  fov: 82,
  volume: 0.35,
  reduced: false,
  quality: true,
  invert: false,
});
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const theme =
    settings.theme === "light" || settings.theme === "dark"
      ? settings.theme
      : systemDark.matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      getComputedStyle(document.documentElement)
        .getPropertyValue("--paper")
        .trim(),
    );
}
applyTheme();
systemDark.addEventListener("change", applyTheme);
function saveSettings() {
  localStorage.setItem("dc.settings", JSON.stringify(settings));
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const timeLabel = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
type Mode = "contract" | "roam" | "online";
class Game {
  private mapExpanded = false;
  loadout = readLoadout(safeRead("dc.loadout", null));
  private kitReviewed = false;
  private respawnAt = 0;
  private armorySpawn?: V3;
  private previousWeapon?: number;
  private quickInventory = new QuickInventory($("quick-inventory"));
  render = new Renderer(canvas);
  audio = new AudioEngine();
  private params = new URLSearchParams(location.search);
  private readonly weaponTest = this.params.get("mode") === "weapon-test";
  private islandsSelected = ["islands", "city"].includes(this.params.get("level") ?? "");
  private dustSelected = this.params.get("level") === DUST_A;
  countySelected = !this.islandsSelected && !this.dustSelected &&
    (this.params.get("mode") === "county" || (location.pathname === "/" && !this.params.has("mode") && !this.params.has("room")));
  private selectedSeed = this.dustSelected ? DUST_A : this.islandsSelected ? ISLANDS : this.countySelected ? COUNTY : "";
  network = new Network(this.dustSelected ? DUST_A : this.islandsSelected ? "islands" : this.countySelected ? "county" : "dc");
  private identity = bindPlayerAccount();
  cars: CountyCar[] = [];
  citizens?: CountyCitizens;
  countySpatial?: Spatial;
  notoriety = 0;
  private wanted?: Wanted;
  private citizenTick = 0;
  private selfReaction?: PunchImpact;
  private equippedAt = 0;
  private incidents = new CountyImpacts();
  private ragdolls?: CountyRagdolls;
  private lastFall = new WeakMap<Doodle, number>();
  private countyVandalism() {
    this.notoriety = notorietyAfter(this.notoriety, 5);
    this.citizens?.alarm(
      "local",
      this.player.position.toArray(),
      Date.now(),
      5,
      20,
    );
  }
  private injureCitizen(
    actor: CountyCitizen,
    amount: number,
    playerCaused = true,
  ) {
    const before = actor.hp;
    actor.hp = Math.max(0, before - amount);
    if (playerCaused && before > 0) {
      const points = injuryPoints(before, actor.hp);
      this.notoriety = notorietyAfter(this.notoriety, points);
      this.citizens?.alarm(
        "local",
        this.player.position.toArray(),
        Date.now(),
        points,
        32,
        actor,
      );
    }
    if (before > 0 && !actor.hp) {
      actor.deadAt = Date.now();
      actor.deaths++;
      if (playerCaused) {
        this.combat.kills++;
        this.combat.score += 100;
      }
    }
  }
  private countyCarContact(
    index: number,
    from: V3,
    to: V3,
    yaw: number,
    speed: number,
  ) {
    if (this.citizens)
      this.incidents.contact(
        this.citizens.actors,
        this.cars[index],
        from,
        to,
        yaw,
        speed,
        Date.now(),
        (actor, amount) => this.injureCitizen(actor, amount),
      );
  }
  private tickCitizens(dt: number) {
    const citizens = this.citizens,
      q = this.countySpatial;
    if (!citizens || !q) return;
    this.citizenTick += dt;
    if (this.citizenTick + 1e-8 < 1 / 30) return;
    const tick = this.citizenTick,
      now = Date.now();
    this.citizenTick = 0;
    this.incidents.update(tick, now, q.ray.bind(q));
    const p = this.player,
      me = {
        id: "local",
        p: p.position.toArray() as V3,
        hp: this.combat.hp,
        height: p.height,
        notoriety: this.notoriety,
      };
    citizens.update(
      tick,
      now,
      [me],
      (_target, bot, damage, kind) => {
        if (damage > 0) {
          if (kind === "punch")
            this.selfReaction = punchImpact(
              now,
              1,
              "body",
              1,
              me.p,
              p.yaw,
              bot.p,
            );
          this.combat.damage(damage);
        }
        me.hp = this.combat.hp;
      },
      (bot, to) => {
        this.remotes.get(bot.id)?.fire();
        this.combat.tracer(
          new T.Vector3(bot.p[0], bot.p[1] + 1.45, bot.p[2]),
          new T.Vector3(...to),
          "#347a75",
        );
      },
    );
    this.wanted = citizens.wanted("local");
  }
  vehicle = -1;
  carSpeed = 0;
  private carSteer = 0;
  private driveWorld?: CountyDriveWorld;
  private crashUntil = 0;
  private driveAuthority = false;
  private driveSequence = 0;
  private sentDriveSequence = 0;
  private drivePending: { seq: number; input: number; pose: DrivePose }[] = [];
  private drivePose(): DrivePose {
    return {
      p: this.player.position.toArray(),
      yaw: this.player.yaw,
      speed: this.carSpeed,
      steer: this.carSteer,
    };
  }
  private applyDrivePose(pose: DrivePose) {
    this.player.position.fromArray(pose.p);
    this.player.yaw = pose.yaw;
    this.carSpeed = pose.speed;
    this.carSteer = pose.steer;
    this.player.velocity.set(
      -Math.sin(pose.yaw) * pose.speed,
      0,
      -Math.cos(pose.yaw) * pose.speed,
    );
  }
  private reconcileDrive(m: { index: number; seq: number; pose: DrivePose }) {
    if (m.index !== this.vehicle || this.vehicle < 0) return;
    const predicted = this.drivePending.find((i) => i.seq === m.seq)?.pose;
    this.drivePending = this.drivePending.filter((i) => i.seq > m.seq);
    if (
      predicted &&
      predicted.yaw === m.pose.yaw &&
      predicted.speed === m.pose.speed &&
      predicted.steer === m.pose.steer &&
      predicted.p.every((v, i) => Math.abs(v - m.pose.p[i]) < 0.0001)
    )
      return;
    const pose = { ...m.pose };
    for (const pending of this.drivePending) {
      this.driveWorld!.advance(
        pose,
        this.cars[this.vehicle].kind,
        pending.input,
        undefined,
        this.cars[this.vehicle],
      );
      pending.pose = { ...pose };
    }
    this.applyDrivePose(pose);
    this.previousCarPosition.copy(this.player.position);
    this.previousCarYaw = this.player.yaw;
  }
  cockpit = false;
  private cockpitYaw = 0;
  private doorUntil = 0;
  private seatPending = false;
  private seatRequestedAt = 0;
  private carKeyHeld = false;
  private entryTime = -Infinity;
  private entryPosition = new T.Vector3();
  private entryRotation = new T.Quaternion();
  private wreckage?: CountyWreckage;
  private rubbleView?: RubbleView;
  get rubbleClusters() {
    return this.rubbleView?.roster.clusters;
  }
  private structures?: CountyStructures;
  private animateArms?: ReturnType<typeof addCountyArms>;
  private casings?: CountyCasings;
  private deathBody?: Doodle;
  private deadActors = new WeakSet<Doodle>();
  private debris?: CountyDebris;
  private restoringStructures = false;
  private aimedDoor() {
    if (!this.structures || this.vehicle >= 0) return;
    const box = this.physics.ray(
      this.player.eye,
      this.player.forward,
      3.5,
    )?.box;
    if (
      box?.piece === "door" &&
      this.player.eye.distanceTo(new T.Vector3(...box.p)) <= 3.5
    )
      return box.pieceId;
  }
  private useDoor(index: number) {
    const open = this.structures!.states.get(index) !== 1;
    if (this.mode === "online") {
      this.sendState();
      this.network.send({ type: "door", index, open });
    } else {
      const p = this.player;
      this.structures!.operate(
        index,
        open,
        p.eye.toArray(),
        [
          { p: p.position.toArray(), height: p.height },
          ...(this.citizens?.actors.filter(
            (a) => a.hp > 0 && a.car === undefined,
          ) ?? []),
          ...this.combat.bots
            .filter((b) => b.hp > 0)
            .map((b) => ({ p: b.p.toArray() as V3, height: 1.76 })),
        ],
        (o, d, n) =>
          this.physics.ray(new T.Vector3(...o), new T.Vector3(...d), n),
      );
    }
  }
  nearestCar() {
    let nearest = -1,
      best = 25;
    this.cars.forEach((c, index) => {
      const distance = this.player.position.distanceToSquared(
        new T.Vector3(...c.p),
      );
      if ((!c.driver || c.driver.startsWith("civilian-driver-")) && distance < best) {
        best = distance;
        nearest = index;
      }
    });
    return nearest;
  }
  useCar() {
    const i = this.vehicle >= 0 ? this.vehicle : this.nearestCar();
    if (i < 0 || this.seatPending) return;
    this.carKeyHeld = true;
    if (this.mode === "online") {
      if (!this.network.active) return;
      this.seatPending = true;
      this.seatRequestedAt = performance.now();
      this.sendState();
      this.network.send({
        type: "vehicle",
        driveVersion: 1,
        action: this.vehicle < 0 ? "enter" : "exit",
        index: i,
      });
    } else {
      if (this.vehicle < 0)
        this.citizens?.takeCar("local", this.cars[i], Date.now());
      this.cars[i].driver = this.vehicle >= 0 ? null : "local";
    }
  }
  private previousCarPosition = new T.Vector3();
  private previousCarYaw = 0;
  syncSeat() {
    const mine = this.mode === "online" ? this.network.id : "local";
    const i = this.cars.findIndex((c) => c.driver === mine);
    if (this.vehicle !== i) {
      this.doorUntil = performance.now() + 650;
      this.carSpeed = this.carSteer = 0;
      this.drivePending = [];
      this.sentDriveSequence = this.driveSequence;
      if (i >= 0) {
        this.entryPosition.copy(this.render.camera.position);
        this.entryRotation.copy(this.render.camera.quaternion);
        this.entryTime = performance.now();
        this.combat.cancelPunch();
        this.firing = this.aiming = false;
        this.player.reset(this.cars[i].p);
        this.cockpitYaw = 0;
        this.player.yaw = this.cars[i].yaw;
        this.player.pitch = 0;
        this.previousCarPosition.copy(this.player.position);
        this.previousCarYaw = this.player.yaw;
      } else if (this.vehicle >= 0 && this.combat.hp > 0) {
        const p = this.player;
        this.physics.move(
          p.position,
          new T.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)).multiplyScalar(
            2.2 * this.render.countyCars[this.vehicle].doorSide,
          ),
          1.76,
        );
      }
      this.seatPending = false;
      this.vehicle = i;
    }
  }
  syncCars(dt: number) {
    const i = this.vehicle;
    this.cars.forEach((c, k) => {
      if (!this.render.countyCars[k] && this.render.addCountyCar)
        this.render.countyCars[k] = this.render.addCountyCar(c, k);
    });
    this.render.countyCars.forEach((model, k) => {
      const c = this.cars[k];
      if (!c) return;
      if (k === i) {
        const alpha = T.MathUtils.clamp(this.accumulator * 120, 0, 1);
        model.position.lerpVectors(
          this.previousCarPosition,
          this.player.position,
          alpha,
        );
        model.rotation.y = T.MathUtils.lerp(
          this.previousCarYaw,
          this.player.yaw,
          alpha,
        );
      } else if (c.driver) {
        const driver = this.network.players.find((p) => p.id === c.driver);
        const target = new T.Vector3(
            ...(driver ? this.network.position(driver) : c.p),
          ),
          alpha = 1 - Math.exp(-14 * dt);
        if (model.position.distanceToSquared(target) > 400)
          model.position.copy(target);
        else model.position.lerp(target, alpha);
        const angle = (driver?.yaw ?? c.yaw) - model.rotation.y;
        model.rotation.y +=
          Math.atan2(Math.sin(angle), Math.cos(angle)) * alpha;
      } else {
        model.position.fromArray(c.p);
        model.rotation.y = c.yaw;
      }
      model.setDamage(c);
      model.update(
        c.driver,
        performance.now() / 1000,
        model.position.distanceTo(this.render.camera.position),
        k === i ? -this.carSteer / 0.45 : 0,
      );
    });
  }
  city!: City;
  physics!: Physics;
  player!: Controller;
  combat!: Combat;
  mode: Mode = "contract";
  soloMode: Mode = "contract";
  private menuMode: "public" | "duel" | "roam" | "contract" = "public";
  private dismissDialog: () => void = () => this.closeDialog();
  private lobbies: {
    code: string;
    mode: "play" | "duel";
    players: number;
    capacity: number;
  }[] = [];
  private checkingLobbies = false;
  state: "menu" | "play" | "paused" | "dead" | "complete" | "loading" =
    "loading";
  seed = String(safeRead("dc.seed", "notebook"));
  district = 1;
  elapsed = 0;
  time = 0;
  collected = new Set<number>();
  noticeUntil = 0;
  input = idleInput();
  keys = new Set<string>();
  firing = false;
  aiming = false;
  viewMotion = new ViewMotion();
  weaponClearance = new WeaponClearance();
  coverPeek = new CoverPeek();
  weaponMesh = new T.Group();
  rope: GrappleVisual | null = null;
  remotes = new Map<string, Doodle>();
  remoteRopes = new Map<string, T.Line>();
  netTick = 0;
  accumulator = 0;
  frame = 0;
  fps = 0;
  private previous = performance.now();
  private frames = 0;
  private fpsTime = 0;
  private feedUntil = 0;
  private buildVersion = 0;
  private busy = false;
  private boardContent = "";
  private lookReady = 0;
  async init() {
    if (this.params.get("level") === "city") {
      const url = new URL(location.href);
      url.searchParams.set("level", "islands");
      history.replaceState(null, "", url);
    }
    if (this.weaponTest) this.mode = "roam";
    this.seed = this.weaponTest ? "weapon-test" : this.selectedSeed || "rust";
    this.audio.volume = settings.volume;
    this.render.setQuality(settings.quality);
    $<HTMLInputElement>("seed").value = this.seed;
    await document.fonts.ready;
    await this.build(this.seed, 1);
    const map = this.dustSelected ? DUST_A : this.countySelected
      ? "county"
      : this.islandsSelected
        ? "islands"
        : "rust";
    $<HTMLSelectElement>("map-picker").value = map;
    $("contract-mode").hidden = this.countySelected;
    $("roam-mode").textContent = this.countySelected ? "Solo" : "Free roam";
    $("seed-options").hidden = !!this.selectedSeed;
    $("model-credits").hidden = false;
    if (this.islandsSelected || this.dustSelected) this.menuMode = "roam";
    document.title = "Doodle Auto — " + (this.countySelected ? "Switchback County · Suncoast" : this.islandsSelected ? "Four Tides" : this.dustSelected ? "Dust II · A Site" : "Rust · Oil Yard");
    this.paintLobbyOptions();
    this.state = "menu";
    this.bind();
    $("loading").classList.add("hidden");
    if (this.weaponTest) {
      document.body.classList.add("weapon-test");
      document.title = "Weapon test range · Doodle Auto";
      $("menu").classList.add("hidden");
      $("hud").classList.remove("hidden");
      document.querySelector(".escape-tip")!.textContent = "B · WEAPON RACK　 SCROLL · SWITCH　 R · RELOAD / RESTOCK";
      this.state = "paused";
      this.showWeaponRack();
      requestAnimationFrame((t) => this.loop(t));
      return;
    }
    await this.identity.enter(!this.selectedSeed);
    try {
      const restored = await this.network.bootstrap();
      if (restored) {
        this.mode = "online";
        this.state = "loading";
        this.loadout = readLoadout(restored.loadout);
        await this.build(restored.seed, 1, restored.p || restored.spawn);
        $("menu").classList.add("hidden");
        $("hud").classList.remove("hidden");
        this.state = "paused";
        this.updateMission();
        if (restored.type === "resumed") this.applyResume(restored);
        else
          this.showPause(
            "MATCH READY",
            "Your runner is ready. Enter when you are.",
          );
      }
    } catch (error) {
      this.showDialog(
        `<h2>Your match is unavailable.</h2><p>${escape((error as Error).message)}</p><button id="session-menu" class="primary-button">BACK TO MENU</button>`,
      );
      $("session-menu").onclick = () => this.mainMenu();
    }
    $("loading").classList.add("hidden");
    $("menu").classList.toggle("hidden", this.state !== "menu");
    const invite = new URLSearchParams(location.search).get("room");
    if (this.mode !== "online" && invite && /^[A-Z0-9]{5}$/i.test(invite)) {
      await this.prepareEntry(true, () => {
        this.showOnline();
        $<HTMLInputElement>("room-input").value = invite.toUpperCase();
      });
    }
    requestAnimationFrame((t) => this.loop(t));
  }
  async build(seed: string, district: number, spawn?: V3) {
    if (this.mode !== "online" && (this.islandsSelected || this.dustSelected)) seed = this.selectedSeed;
    const version = ++this.buildVersion;
    const city = this.weaponTest ? rangeWorld() : generateLevel(seed, district),
      physics = await Physics.create(city.boxes);
    if (version !== this.buildVersion) {
      physics.dispose();
      return;
    }
    this.clearDeathBody();
    this.ragdolls?.dispose();
    this.combat?.dispose();
    this.rubbleView?.clear();
    this.wreckage?.dispose();
    this.physics?.dispose();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    for (const line of this.remoteRopes.values()) {
      this.render.scene.remove(line);
      line.geometry.dispose();
      (line.material as T.Material).dispose();
    }
    this.remoteRopes.clear();
    this.city = city;
    const islands = city.seed === ISLANDS;
    document.querySelector("#city-map-panel small")!.textContent = islands ? "Gold lines mark bridges" : city.seed === DUST_A ? "Teal: crates · red: A site" : "solid: streets · gold: roof routes";
    $("city-map").setAttribute("aria-label", islands ? "Five islands, bridges and player positions" : "Map with your position in red and other living players in blue");
    this.cars = seed === COUNTY ? countyCars() : [];
    this.vehicle = -1;
    this.drivePending = [];
    this.driveWorld =
      seed === COUNTY
        ? new CountyDriveWorld(
            city.boxes,
            () => this.rubbleClusters?.values() ?? [],
            () => this.cars,
          )
        : undefined;
    this.seatPending = false;
    this.carSpeed = this.carSteer = this.crashUntil = 0;
    this.physics = physics;
    this.seed = seed;
    this.setMapExpanded(false);
    document.body.classList.toggle("county-world", seed === COUNTY);
    document.body.classList.toggle("daylight-world", seed === COUNTY || islands || seed === DUST_A);
    this.district = district;
    await this.render.build(city);
    if (this.weaponTest) drawRange(this.render.cityGroup);
    if (version !== this.buildVersion) return;
    this.casings =
      seed === COUNTY
        ? new CountyCasings(this.render.cityGroup, physics)
        : undefined;
    this.debris =
      seed === COUNTY ? new CountyDebris(this.render.cityGroup) : undefined;
    this.rubbleView =
      seed === COUNTY
        ? new RubbleView(this.render.cityGroup, city.boxes, physics)
        : undefined;
    this.wreckage =
      seed === COUNTY && this.mode !== "online"
        ? new CountyWreckage(city.boxes, (m) => this.rubbleMessage(m, false))
        : undefined;
    this.wreckage?.prepare();
    this.countySpatial =
      seed === COUNTY && this.mode !== "online"
        ? new Spatial(city.boxes)
        : undefined;
    if (this.countySpatial) this.countySpatial.rubble = this.wreckage;
    this.citizens = this.countySpatial
      ? new CountyCitizens(city, this.cars, this.countySpatial)
      : undefined;
    this.ragdolls = seed === COUNTY ? new CountyRagdolls(physics) : undefined;
    this.incidents = new CountyImpacts();
    const citizens = this.citizens;
    if (citizens)
      citizens.onTrafficMove = (_driver, car, from, speed, now) => {
        this.incidents.contact(
          citizens.actors,
          car,
          from,
          car.p,
          car.yaw,
          speed,
          now,
          (a, amount) => this.injureCitizen(a, amount, false),
        );
      };
    this.citizenTick = 0;
    this.notoriety = 0;
    this.wanted = undefined;
    this.structures =
      seed === COUNTY
        ? new CountyStructures(
            city.boxes,
            (_index, state, box, detached) => {
              if (
                state === 2 &&
                !detached &&
                !this.restoringStructures &&
                this.state === "play"
              )
                this.debris?.break(box, this.player.position);
              physics.updateStructure(box);
              box.onPieceState?.(state);
            },
            this.wreckage,
          )
        : undefined;
    if (this.mode === "online") this.restoreStructures();
    this.player = new Controller(physics, spawn ?? city.spawns[0]);
    this.armorySpawn = this.player.position.toArray();
    this.player.ladders =
      city.arena?.ladders ?? (seed === COUNTY ? countyLadders(city.boxes) : []);
    this.player.grappleEnabled = !this.weaponTest && !city.arena && seed !== COUNTY;
    this.player.jumpHeightScale = city.arena || seed === COUNTY ? 0.85 : 1;
    document.body.classList.toggle(
      "no-grapple",
      !!city.arena || seed === COUNTY,
    );
    if (city.arena || seed === DUST_A)
      this.player.yaw = Math.atan2(
        this.player.position.x + 3,
        this.player.position.z + (seed === DUST_A ? 10 : 3),
      );
    this.player.movingHooks = () =>
      city.blimps.map((b) => {
        const t = this.network.active
          ? this.network.worldTime
          : Date.now() / 1000;
        const position = blimpPosition(b, t);
        position[1] -= 4;
        return {
          id: b.id,
          position,
          velocity: blimpVelocity(b, t),
          radius: 1.8,
        };
      });
    this.combat = new Combat(
      this.render.scene,
      city,
      this.player,
      this.audio,
      this.mode === "contract" && seed !== COUNTY,
    );
    if (seed === COUNTY)
      this.combat.vehicleShot = (origin, direction, range) => {
        const result = nearestVehicleSurface(
          this.cars,
          origin,
          direction,
          range,
          (_, i) => this.render.countyCars[i]?.collisionModel,
        );
        if (!result) return;
        const { index, hit } = result;
        return {
          distance: hit.distance,
          strike: () => {
            if (!damageVehicle(this.cars[index], hit)) return;
            const model = this.render.countyCars[index];
            model.setDamage(this.cars[index]);
            model.showImpact(hit.part, hit.point, new T.Vector3(...direction));
            this.audio.hit();
          },
        };
      };
    this.combat.online = this.mode === "online";
    if (this.combat.online)
      for (const effect of this.network.effects)
        this.showNetworkGrenade(effect);
    if (this.citizens) {
      this.citizens.effects = this.combat.effects;
      this.combat.blastCitizens = () => this.citizens!.actors;
      this.combat.onBlastCitizen = (actor, damage) =>
        this.injureCitizen(actor as CountyCitizen, damage);
    }
    this.combat.onSurfaceHit = (index, damage) => {
      if (this.weaponTest) {
        this.combat.hitTime = 0.18;
        this.combat.hitRegion = "body";
        this.audio.hit();
      } else this.structures?.damage(index, damage);
    };
    if (this.citizens)
      this.combat.civilianShot = (origin, dir, range, baseDamage) => {
        let victim: CountyCitizen | undefined;
        let closest: ReturnType<typeof actorHit> = null;
        for (const actor of this.citizens!.actors) {
          if (actor.hp <= 0) continue;
          const hit = actorHit(
            origin,
            dir,
            actor.p,
            actor.height,
            closest?.distance ?? range,
            actor.yaw + Math.PI,
          );
          if (hit) {
            closest = hit;
            victim = actor;
          }
        }
        if (!victim || !closest) return null;
        const damage = Math.round(baseDamage * HIT_MULTIPLIER[closest.region]);
        this.injureCitizen(victim, damage);
        this.remotes
          .get(victim.id)
          ?.react(closest.region, closest.side, damage);
        return { ...closest, kill: victim.hp === 0 };
      };
    this.combat.onReload = () => {
      if (this.mode === "online") {
        this.sendState();
        this.network.send({ type: "reload" });
      }
    };
    this.combat.onNotice = (s) => this.notice(s);
    this.viewMotion = new ViewMotion();
    this.weaponClearance = new WeaponClearance();
    this.coverPeek = new CoverPeek();
    this.combat.shotOrigin = () =>
      new T.Vector3(
        ...peekEye(
          this.player.eye.toArray() as V3,
          this.player.yaw,
          validatedLean(
            this.player.eye.toArray() as V3,
            this.player.yaw,
            this.player.pitch,
            this.coverPeek.lean,
            (o, d, n) =>
              this.physics.ray(new T.Vector3(...o), new T.Vector3(...d), n),
          ),
        ),
      );
    this.combat.muzzlePosition = () => {
      const muzzle = this.weaponMesh.getObjectByName("muzzle");
      this.weaponMesh.updateWorldMatrix(true, true);
      return muzzle
        ? muzzle.getWorldPosition(new T.Vector3())
        : this.player.eye.clone().addScaledVector(this.player.forward, 0.5);
    };
    this.combat.onPunch = () => {
      this.citizens?.alarm(
        "local",
        this.player.position.toArray(),
        Date.now(),
        2,
        2.5,
      );
      this.armorySpawn = undefined;
      if (this.mode === "online") {
        this.sendState();
        this.network.send({ type: "punch" });
      }
    };
    this.combat.onPunchContact = (move) => {
      if (this.vehicle >= 0 || this.seatPending || this.player.traversing)
        return;
      const amount = this.seed === COUNTY ? KNIFE_DAMAGE : PUNCHES[move].damage,
        p = this.player;
      if (this.weaponTest) {
        const plate = this.physics.ray(p.eye, p.forward, PUNCHES[move].reach)?.box?.pieceId;
        if (plate !== undefined) this.combat.onSurfaceHit(plate, amount);
        return;
      }
      const targets = [
        ...(this.citizens?.actors ?? [])
          .filter((a) => a.hp > 0)
          .map((a) => ({ ...a, citizen: a, bot: undefined })),
        ...this.combat.bots
          .filter((b) => b.hp > 0)
          .map((b) => ({
            p: b.p.toArray() as V3,
            yaw: b.model.group.rotation.y - Math.PI,
            height: 1.76,
            bot: b,
            citizen: undefined,
          })),
      ];
      const result = punchHit(
        p.eye.toArray(),
        p.yaw,
        p.pitch,
        move,
        targets,
        (o, d, n) =>
          this.physics.ray(new T.Vector3(...o), new T.Vector3(...d), n),
      );
      if (this.seed === COUNTY) {
        const range = Math.min(
          PUNCHES[move].reach,
          result?.hit.distance ?? Infinity,
        );
        const wall = this.physics.ray(p.eye, p.forward, range, true);
        const car = nearestVehicleSurface(
          this.cars,
          p.eye.toArray(),
          p.forward.toArray(),
          wall?.distance ?? range,
          (_, i) => this.render.countyCars[i]?.collisionModel,
        );
        if (car) {
          if (
            car.hit.part >= 16 &&
            damageVehicle(this.cars[car.index], car.hit)
          ) {
            const model = this.render.countyCars[car.index];
            model.setDamage(this.cars[car.index]);
            model.showImpact(car.hit.part, car.hit.point, p.forward);
            this.audio.hit();
          }
          return;
        }
      }
      if (!result) return;
      const { actor, hit } = result;
      const model = actor.bot?.model ?? this.remotes.get(actor.citizen!.id);
      const now = Date.now();
      model?.reactToPunch(
        punchImpact(
          now,
          move,
          hit.region,
          hit.side,
          actor.p,
          actor.yaw,
          p.position.toArray(),
        ),
        now,
      );
      if (actor.citizen) this.injureCitizen(actor.citizen, amount);
      else if (actor.bot) {
        actor.bot.hp = Math.max(0, actor.bot.hp - amount);
        if (!actor.bot.hp) {
          this.combat.kills++;
          this.combat.score += 100;
          actor.bot.model.fall(0);
        }
      }
      this.combat.hitRegion = hit.region;
      this.combat.hitTime = 0.16;
      this.audio.tone(125, 0.09, "triangle", 0.26, 48);
      if ((actor.citizen ?? actor.bot)!.hp <= 0) this.audio.npcEliminated();
    };
    this.combat.onFire = () => {
      this.armorySpawn = undefined;
      if (
        this.casings &&
        !isUtility(this.combat.weapon) &&
        this.combat.weapon !== ROCKET
      ) {
        const port = this.weaponMesh.localToWorld(
          new T.Vector3(0.07, 0.04, 0.13),
        );
        this.casings.eject(
          WEAPONS[this.combat.weapon].model,
          port,
          this.player.yaw,
          this.player.velocity,
        );
      }
      this.viewMotion.shot(WEAPONS[this.combat.weapon].model);
      if (this.citizens) {
        this.notoriety = notorietyAfter(this.notoriety, 2);
        this.citizens.alarm(
          "local",
          this.player.position.toArray(),
          Date.now(),
          2,
          this.combat.weapon === KNIFE ? 2.5 : 36,
        );
      }
      if (this.mode === "online") {
        this.sendState();
        this.network.send({ type: "fire" });
      }
    };

    this.collected.clear();
    this.elapsed = 0;
    this.selfReaction = undefined;
    if (this.weaponTest) {
      this.combat.owned = WEAPONS.map((_, id) => id);
      this.combat.mags = WEAPONS.map(w => w.mag);
    } else Object.assign(this.combat, inventory(this.loadout, seed === COUNTY));
    this.setWeapon(this.combat.weapon, true);
    $("district-number").textContent = String(district).padStart(2, "0");
    $("district-stamp")?.setAttribute("data-district", String(district));
  }
  notice(text: string, duration = 1.5) {
    $("notice").textContent = text;
    this.noticeUntil = this.time + duration;
  }
  private get appearanceId() {
    return this.mode === "online" ? this.network.id : this.identity.name || "local";
  }
  setWeapon(i: number, force = false) {
    const before = this.combat.weapon;
    if (!force && !this.combat.switchWeapon(i)) return;
    this.previousWeapon = force ? undefined : before;
    disposeGroup(this.weaponMesh);
    const daylight = this.seed === DUST_A || this.weaponTest || this.seed === COUNTY || this.city.seed === ISLANDS;
    const look = characterLook(this.appearanceId);
    this.weaponMesh =
      i === FISTS
        ? buildFists(this.seed === COUNTY, look)
        : buildWeapon(i, daylight);
    this.animateArms =
      (daylight || i === ROCKET) && i !== FISTS
        ? addCountyArms(this.weaponMesh, WEAPONS[i].model, look)
        : undefined;
    $("ammo-row").classList.toggle("hidden", i === FISTS || i === KNIFE);
    if (!canAimWeapon(i)) this.aiming = false;
    if (i === ROCKET) this.viewMotion.ads = 0;
    if (i === FISTS) this.equippedAt = this.time;
    const zoom = scopeMagnification(i);
    $("scope-label").textContent = zoom > 1
      ? WEAPONS[i].name + " · " + zoom + "×"
      : "";
    this.render.camera.add(this.weaponMesh);
    $("weapon-name").textContent =
      this.seed === COUNTY && i === FISTS ? "KNIFE" : i === 0 ? "INKRIFLE" : WEAPONS[i].name;
    $("weapon-slots").replaceChildren(
      ...this.combat.owned.map((id, slot) => {
        const item = document.createElement("span");
        item.textContent =
          slot +
          1 +
          " " +
          (daylight ? (["Rifle", "Shotgun", "Pistol", "Sniper", this.seed === COUNTY ? "Knife" : "Fists"][id] ?? WEAPONS[id].name) : WEAPONS[id].name);
        item.classList.toggle("active", id === i);
        return item;
      }),
    );
  }
  private showWeaponRack() {
    this.showDialog(weaponRack(this.combat.weapon), () => this.resume());
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-range-weapon]")) {
      button.onclick = () => {
        const id = Number(button.dataset.rangeWeapon);
        this.combat.mags[id] = WEAPONS[id].mag;
        this.combat.burstLeft = 0;
        this.combat.reloadTime = 0;
        this.combat.cooldown = 0;
        this.combat.cancelPunch();
        this.setWeapon(id);
        this.resume();
      };
    }
  }
  private pickLoadout(
    enter: () => void,
    respawning = false,
    back = () => this.closeDialog(),
    live = false,
    menuOnly = false,
  ) {
    let chosenSlot: keyof Loadout | undefined;
    this.showDialog(
      loadoutScreen(
        this.loadout ?? defaultLoadout,
        live
          ? "Return to game"
          : respawning
            ? "Equip and respawn"
            : menuOnly
              ? "Save loadout"
              : "Use this loadout",
      ),
      back,
    );
    bindLoadoutPreview($<HTMLFormElement>("kit-form"), back, (slot) => {
      chosenSlot = slot;
      this.audio.init();
      this.audio.tone(475, 0.045, "triangle", 0.09, 330);
    });
    if (respawning) this.waitForRespawn($<HTMLButtonElement>("equip-kit"));
    $("kit-form").onsubmit = (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const kit = readLoadout(
        Object.fromEntries(
          loadoutSlots.map(({ key }) => [key, Number(form.get(key))]),
        ),
      );
      if (!kit) return;
      if (live && chosenSlot) {
        if (!this.armorySpawn || this.combat.hp <= 0) return;
        const next = inventory(kit, this.seed === COUNTY);
        const weapon =
          next.owned[loadoutSlots.findIndex((slot) => slot.key === chosenSlot)];
        if (
          this.mode === "online" &&
          !this.network.send({ type: "equip-at-spawn", loadout: kit, weapon })
        )
          return;
        Object.assign(this.combat, next, { weapon });
        this.combat.cancelPunch();
        this.combat.reloadTime = 0;
        this.setWeapon(weapon, true);
      }
      this.loadout = kit;
      if (this.state === "menu") {
        this.kitReviewed = menuOnly;
        this.showKitSummary();
      }
      try {
        localStorage.setItem("dc.loadout", JSON.stringify(kit));
      } catch {}
      if (!respawning) this.closeDialog();
      enter();
    };
  }
  private waitForRespawn(button: HTMLButtonElement) {
    const delay = this.respawnAt - Date.now();
    if (delay <= 0) return;
    button.disabled = true;
    setTimeout(() => {
      button.disabled = false;
    }, delay);
  }
  async start(mode: Mode, spawn?: V3) {
    if (this.busy) return;
    this.busy = true;
    this.audio.init();
    this.mode = mode;
    this.state = "loading";
    $("menu").classList.add("hidden");
    $("loading").classList.remove("hidden");
    this.closeDialog();
    try {
      const seed = $<HTMLInputElement>("seed").value.trim() || "notebook";
      await this.build(seed, mode === "online" ? 1 : this.district, spawn);
      localStorage.setItem("dc.seed", seed);
      $("loading").classList.add("hidden");
      $("hud").classList.remove("hidden");
      this.state = "play";
      this.resume();
      this.notice(
        mode === "roam"
          ? this.city.seed === DUST_A ? "DUST II · A SITE" : this.city.seed === ISLANDS ? "COMPASS CAY" : this.city.arena
            ? "THE YARD IS YOURS"
            : "THE CITY IS YOURS"
          : mode === "online"
            ? this.network.public
              ? "PUBLIC CITY"
              : this.network.duel
                ? "DUEL"
                : "PRIVATE MATCH"
            : "MAKE YOUR MARK",
        3,
      );
      this.updateMission();
    } finally {
      this.busy = false;
    }
  }
  resume() {
    if (this.mode === "online" && !this.network.active) return;
    this.closeDialog();
    this.state = "play";
    this.keys.clear();
    this.firing = false;
    this.audio.init();
    canvas.focus({ preventScroll: true });
    const lock = canvas.requestPointerLock();
    if (lock instanceof Promise)
      lock.catch(() => {
        this.state = "paused";
        this.showPause(
          "CLICK TO ENTER",
          "One click captures the mouse. Escape releases it.",
        );
      });
  }
  pause() {
    if (this.state !== "play") return;
    this.state = "paused";
    this.keys.clear();
    this.firing = false;
    this.aiming = false;
    document.exitPointerLock();
    this.showPause();
  }
  showPause(title = "Paused", body = "") {
    if (this.weaponTest) return this.showWeaponRack();
    this.showDialog(
      `<h2>${title}</h2>${body ? `<p>${body}</p>` : ""}${this.mode === "online" ? `<p>Room <b>${escape(this.network.code)}</b> · The match continues while you pause.</p>` : ""}<button id="resume" class="primary-button">Resume game</button><div class="pause-tools"><button id="pause-controls" class="secondary-button">Controls</button><button id="pause-settings" class="secondary-button">Settings</button></div><button id="main-menu" class="text-button">Leave for main menu</button>`,
    );
    const update = document.createElement("button");
    update.id = "pause-update";
    update.className = "secondary-button hidden";
    update.textContent = "Leave and open latest version";
    $("main-menu").before(update);
    update.onclick = () => this.openLatest();
    this.showReleaseUpdate();
    void this.checkRelease();
    $("pause-controls").onclick = () => this.showHelp(true);
    $("resume").onclick = () => this.resume();
    $("pause-settings").onclick = () => this.showSettings(true);
    $("main-menu").onclick = () => this.mainMenu();
  }
  mainMenu() {
    this.showKitSummary();
    this.clearDeathBody();
    this.network.disconnect();
    this.state = "menu";
    this.mode = this.soloMode;
    this.keys.clear();
    document.exitPointerLock();
    this.closeDialog();
    $("hud").classList.add("hidden");
    $("menu").classList.remove("hidden");
    this.district = 1;
    this.weaponMesh.visible = false;
    void this.build($<HTMLInputElement>("seed").value.trim() || "notebook", 1);
  }
  showDialog(html: string, back?: () => void) {
    this.dismissDialog =
      back ??
      (() => {
        if (
          this.state === "paused" &&
          (this.mode !== "online" || this.network.active)
        )
          this.resume();
        else if (["paused", "dead", "complete"].includes(this.state))
          this.mainMenu();
        else this.closeDialog();
      });
    this.quickInventory.close();
    $("dialog-content").innerHTML = html;
    const heading = $("dialog-content").querySelector("h2");
    if (heading) heading.id = "dialog-title";
    if (!dialog.open) dialog.showModal();
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    dialog.scrollTop = 0;
  }
  closeDialog() {
    if (dialog.open) dialog.close();
  }
  updateMission() {
    if (this.weaponTest) {
      $("mission-title").textContent = "Weapon test range";
      $("mission").textContent = canAimWeapon(this.combat.weapon)
        ? "Left click · Use　 Right click · Aim"
        : "Left click · Use";
      return;
    }
    const online = this.mode === "online",
      roam = this.mode === "roam",
      ready = this.combat.kills >= 6 && this.collected.size === 3;
    $("mode-label").textContent = online
      ? this.network.public
        ? "PUBLIC CITY"
        : this.network.duel
          ? "DUEL"
          : "PRIVATE MATCH"
      : roam
        ? "FREE ROAM"
        : "THE PAPER DISTRICT";
    $("mission-title").style.display = online ? "none" : "";
    $("mission-title").textContent = online
      ? ""
      : roam
        ? "FIND YOUR OWN WAY"
        : ready
          ? "BACK TO THE START"
          : "LEAVE YOUR MARK";
    $("mission").textContent = online
      ? this.network.public
        ? "Shared NPCs + online rivals · TAB for the scoreboard"
        : this.network.duel &&
            this.network.players.filter((p) => !p.npc).length < 2
          ? "Waiting for another player · no NPCs in Duel"
          : "First to 15 eliminations · TAB for the scoreboard"
      : roam
        ? this.city.arena
          ? "Explore Rust. Climb the tower. Find your angles."
          : "No rivals. No objectives. Just you and the skyline."
        : ready
          ? "Reach the starting plaza to draw the next district."
          : "Erase 6 rivals · Find 3 rooftop marks";
    $("mission-progress").style.display = online || roam ? "none" : "flex";
    if (this.seed === DUST_A && roam) {
      $("mission-title").textContent = "DUST II · A SITE";
      $("mission").textContent = "Explore Long A, the raised site and the lower passage.";
    }
    $("kill-objective").textContent =
      `${this.combat.kills >= 6 ? "✓" : "○"} ${Math.min(6, this.combat.kills)} / 6 RIVALS`;
    $("beacon-objective").textContent =
      `${this.collected.size === 3 ? "✓" : "◇"} ${this.collected.size} / 3 MARKS`;
    if (this.seed === COUNTY && !(online && this.network.duel)) {
      $("mission-title").textContent = "SWITCHBACK COUNTY";
      $("mission-title").style.display = "";
      $("mission").textContent =
        this.wanted?.phase === "calling"
          ? "Witness calling police"
          : this.wanted?.phase === "responding"
            ? "County police dispatched"
            : this.wanted?.phase === "pursuit"
              ? "Police pursuit · Break line of sight"
              : this.wanted?.phase === "search"
                ? "Police searching · Stay out of sight"
                : "Explore on foot or take a parked car";
      $("mission-progress").style.display = "none";
      if (!online) $("mode-label").textContent = "OPEN WORLD";
    }
    if (this.city.seed === ISLANDS && !online) {
      $("mission-title").textContent = roam ? "FOUR TIDES" : ready ? "BACK TO THE START" : "LEAVE YOUR MARK";
      $("mission").textContent = roam ? "Follow a bridge to explore an island" : ready ? "Return to Compass Cay" : "Erase 6 rivals · Find 3 island marks";
    }
    $("room-badge").textContent = online
      ? `${this.network.public ? "PUBLIC" : this.network.duel ? "DUEL" : "ROOM"} ${this.network.code} · ${this.network.players.filter((p) => !p.npc).length} PLAYERS · ${Math.round(this.network.rtt)} ms`
      : "";
  }
  private async prepareEntry(multiplayer: boolean, enter: () => void) {
    if (multiplayer && !this.identity.name) {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.identity.enter();
      } finally {
        this.busy = false;
      }
    }
    if (this.kitReviewed) {
      this.kitReviewed = false;
      enter();
    } else this.pickLoadout(enter);
  }
  private showKitSummary() {
    const kit = this.loadout ?? defaultLoadout;
    $("menu-kit-summary").textContent = loadoutSlots
      .map(({ key }) => WEAPONS[kit[key]].name)
      .join(" · ");
  }
  bind() {
    this.showKitSummary();
    $("menu-weapons").onclick = () => this.pickLoadout(() => {}, false, () => this.closeDialog(), false, true);
    $<HTMLSelectElement>("map-picker").onchange = (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      $("menu").classList.add("hidden");
      $("loading").classList.remove("hidden");
      location.assign(
        value === "county"
          ? "/?mode=county"
          : value === DUST_A ? "/?level=dust-a" : value === "islands"
            ? "/?level=islands"
            : "/?mode=rust",
      );
    };
    window.addEventListener("pageshow", (e) => {
      if (e.persisted && this.state === "menu") {
        $("loading").classList.add("hidden");
        $("menu").classList.remove("hidden");
      }
    });
    $("play").onclick = () => {
      if (this.busy) return;
      this.district = 1;
      const mode = this.menuMode;
      void this.prepareEntry(mode === "public" || mode === "duel", () => {
        if (mode === "public" || mode === "duel") {
          const lobby = this.lobbies.find(
            (r) => r.mode === (mode === "public" ? "play" : "duel"),
          );
          void this.joinPublic(mode, lobby?.code);
        } else void this.start(mode);
      });
    };
    for (const [id, mode] of [
      ["public-mode", "public"],
      ["duel", "duel"],
      ["roam-mode", "roam"],
      ["contract-mode", "contract"],
    ] as const) {
      $(id).onclick = () => {
        this.menuMode = mode;
        this.paintLobbyOptions();
      };
    }
    $("menu-update").onclick = () => this.openLatest();
    void this.checkRelease();
    document.addEventListener("visibilitychange", () => {
      if (this.state === "menu" || this.state === "paused")
        void this.checkRelease();
    });
    if (!this.weaponTest) {
      void this.refreshLobbies();
      setInterval(() => {
        if (this.state === "menu" || this.state === "paused")
          void this.checkRelease();
        if (this.state === "menu") void this.refreshLobbies();
      }, 3000);
    }
    $("reroll").onclick = () => {
      const words = ["paper", "rooftops", "sketch", "ink", "creed", "bluebird"];
      $<HTMLInputElement>("seed").value =
        words[Math.floor(Math.random() * words.length)] +
        "-" +
        Math.floor(Math.random() * 999);
      void this.build($<HTMLInputElement>("seed").value, 1);
    };
    $<HTMLInputElement>("seed").onchange = () =>
      void this.build(
        $<HTMLInputElement>("seed").value.trim() || "notebook",
        1,
      );
    $("help").onclick = () => this.showHelp();
    $("settings").onclick = () => this.showSettings();
    $("online").onclick = () => void this.prepareEntry(true, () => this.showOnline());
    $("close-dialog").onclick = () => {
      if (!this.busy) this.dismissDialog();
    };
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (!this.busy) this.dismissDialog();
    });
    document.addEventListener("pointerlockchange", () => {
      this.lookReady = performance.now() + 120;
      if (!document.pointerLockElement && this.state === "play") this.pause();
    });
    document.addEventListener("mousemove", (e) => {
      if (
        document.pointerLockElement !== canvas ||
        this.state !== "play" ||
        (!this.quickInventory.open && performance.now() < this.lookReady)
      )
        return;
      if (this.quickInventory.open) {
        this.quickInventory.move(e.movementX, e.movementY);
        return;
      }
      const sens =
        0.002 *
        settings.sensitivity *
        sensitivityScale(this.render.camera.fov, settings.fov);
      this.viewMotion.look(e.movementX, e.movementY);
      if (this.vehicle >= 0) {
        if (!this.cockpit) return;
        this.cockpitYaw = T.MathUtils.clamp(
          this.cockpitYaw - e.movementX * sens,
          -1.55,
          1.55,
        );
      } else if (this.seatPending) return;
      else this.player.yaw -= e.movementX * sens;
      this.player.pitch = T.MathUtils.clamp(
        this.player.pitch - e.movementY * sens * (settings.invert ? -1 : 1),
        -1.48,
        1.48,
      );
    });
    document.addEventListener("keydown", (e) => {
      if (
        !e.repeat &&
        e.code === "KeyB" &&
        this.state === "dead" &&
        $("change-kit")
      ) {
        e.preventDefault();
        $("change-kit").click();
        return;
      }
      if (
        this.state !== "play" ||
        dialog.open ||
        (e.target as HTMLElement).matches("input,select")
      )
        return;
      if (
        [
          "Space",
          "Tab",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.code)
      )
        e.preventDefault();
      if (e.code === "Escape" && this.state === "play") {
        e.preventDefault();
        e.stopPropagation();
        this.pause();
        return;
      }
      if (this.state !== "play") return;
      this.keys.add(e.code);
      if (e.repeat) return;
      if (this.vehicle < 0 && !this.seatPending) {
        if (e.code === "KeyT" && document.pointerLockElement === canvas) {
          this.firing = this.aiming = false;
          this.quickInventory.show(
            this.combat.owned,
            this.combat.weapon,
            this.seed === COUNTY,
          );
          return;
        }
        if (this.quickInventory.open) return;
        if (e.code === "KeyB") {
          if (this.weaponTest) return this.pause();
          if (!this.armorySpawn) {
            this.notice("Loadout changes are available at spawn");
            return;
          }
          this.state = "paused";
          this.keys.clear();
          this.firing = this.aiming = false;
          document.exitPointerLock();
          this.pickLoadout(
            () => this.resume(),
            false,
            () => this.resume(),
            true,
          );
          return;
        }
        if (
          e.code === "KeyX" ||
          (e.code === "KeyQ" && !this.player.grappleEnabled)
        ) {
          if (this.previousWeapon !== undefined)
            this.setWeapon(this.previousWeapon);
          return;
        }
      }
      if (e.code === "KeyV" && this.vehicle >= 0) {
        this.cockpit = !this.cockpit;
        return;
      }
      if (e.code === "KeyE" && this.seed === COUNTY) {
        const door = this.aimedDoor();
        if (door !== undefined && !this.seatPending) this.useDoor(door);
        else this.useCar();
        return;
      }
      if (e.code === "KeyR") {
        if (this.weaponTest && isGrenade(this.combat.weapon)) {
          this.combat.mags[this.combat.weapon] = WEAPONS[this.combat.weapon].mag;
          this.notice("Restocked");
        } else this.combat.reload();
      }
      if (/^Digit[1-9]$/.test(e.code)) {
        const id = this.combat.owned[Number(e.code.slice(-1)) - 1];
        if (id !== undefined) this.setWeapon(id);
      }
      if (e.code === "KeyM") {
        if (e.shiftKey) {
          this.audio.enabled = !this.audio.enabled;
          this.notice(this.audio.enabled ? "SOUND ON" : "SOUND OFF");
        } else this.setMapExpanded(!this.mapExpanded);
      }
      if (e.code === "KeyH")
        this.notice(
          this.city.arena
            ? "WASD MOVE · SPACE VAULT · C SLIDE"
            : "WASD MOVE · SPACE VAULT · Q GRAPPLE · C SLIDE",
          5,
        );
    });
    document.addEventListener("keyup", (e) => {
      if (e.code === "KeyT" && this.quickInventory.open) {
        const id = this.quickInventory.close();
        if (
          this.state === "play" &&
          document.pointerLockElement === canvas &&
          this.vehicle < 0 &&
          !this.seatPending &&
          id !== undefined
        )
          this.setWeapon(id);
      }
      this.keys.delete(e.code);
      if (e.code === "KeyE") this.carKeyHeld = false;
    });
    document.addEventListener("mousedown", (e) => {
      if (
        this.state !== "play" ||
        this.quickInventory.open ||
        document.pointerLockElement !== canvas
      )
        return;
      if (e.button === 0) {
        this.firing = true;
        if (this.vehicle < 0 && !this.seatPending && !this.player.traversing)
          this.combat.fire();
      }
      if (
        e.button === 2 &&
        this.vehicle < 0 &&
        !this.seatPending &&
        canAimWeapon(this.combat.weapon)
      )
        this.aiming = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (this.state === "play" && !this.quickInventory.open) {
          e.preventDefault();
          if (this.keys.has("Tab")) {
            $("board").scrollTop += e.deltaY;
            return;
          }
          const owned = this.combat.owned;
          const next =
            owned.indexOf(this.combat.weapon) + (e.deltaY > 0 ? 1 : -1);
          this.setWeapon(owned[(next + owned.length) % owned.length]);
        }
      },
      { passive: false },
    );
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.firing = false;
      if (this.state === "play") this.pause();
    });
    window.addEventListener("resize", () => this.render.resize());
    this.network.onMessage = (m) => this.onNetwork(m);
  }
  private differentRelease = false;
  private checkedReleaseAt = -Infinity;
  private showReleaseUpdate() {
    for (const id of ["menu-update", "pause-update"])
      $(id)?.classList.toggle("hidden", !this.differentRelease);
  }
  private async checkRelease() {
    if (
      this.weaponTest ||
      RELEASE_ID === "dev" ||
      document.hidden ||
      performance.now() - this.checkedReleaseAt < 15000
    )
      return;
    this.checkedReleaseAt = performance.now();
    try {
      const response = await fetch("/api/release", { cache: "no-store" });
      if (!response.ok) return;
      const { releaseId } = await response.json();
      if (typeof releaseId !== "string" || !/^[a-f0-9]{64}$/.test(releaseId))
        return;
      this.differentRelease = releaseId !== RELEASE_ID;
      this.showReleaseUpdate();
    } catch {
      /* An unavailable check should not interrupt a match. */
    }
  }
  private openLatest() {
    this.network.disconnect();
    const url = new URL("/", location.origin);
    if (this.countySelected) url.searchParams.set("mode", "county");
    else if (this.dustSelected) url.searchParams.set("level", DUST_A);
    else if (this.islandsSelected) url.searchParams.set("level", "islands");
    else url.searchParams.set("mode", "rust");
    location.assign(url.href);
  }
  async refreshLobbies() {
    if (this.checkingLobbies) return;
    this.checkingLobbies = true;
    try {
      const path = RELEASE_ID === "dev" ? "/lobbies?shard=" + shardForSeed(this.selectedSeed) : "/lobbies";
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) throw Error("Lobby status unavailable");
      const data = await response.json();
      this.lobbies = data.lobbies.filter(
        (r: {
          seed?: string;
          releaseId?: string;
          players: number;
          capacity: number;
        }) =>
          (!r.releaseId || r.releaseId === RELEASE_ID) &&
          publicMapSeed(r.seed) === publicMapSeed(this.selectedSeed) &&
          r.players > 0 &&
          r.players < r.capacity,
      );
      if (this.state === "menu") this.paintLobbyOptions();
    } catch {
      this.lobbies = [];
      if (this.state === "menu") this.paintLobbyOptions();
    } finally {
      this.checkingLobbies = false;
    }
  }
  private paintLobbyOptions() {
    if (this.busy) return;
    const mode = this.menuMode,
      county = this.countySelected;
    const text = {
      public: county
        ? "Explore a shared city with traffic and up to 30 players."
        : "Face other players and waves of ink rivals in the oil yard.",
      duel: "Players only. First to 15 eliminations wins.",
      roam: county
        ? "Cruise a GTA VI-inspired suncoast: palms, busy streets, fast cars, and a county with a life of its own."
        : "Explore the map and practice movement on your own.",
      contract:
        "Eliminate six rivals, collect three rooftop marks, then return to spawn.",
    };
    if (this.islandsSelected) {
      text.public = "Join other players across the five islands.";
      text.roam = "Start at Compass Cay and explore four islands linked by bridges.";
      text.contract = "Eliminate six rivals, collect three island marks, then return to Compass Cay.";
    }
    if (this.dustSelected) {
      text.public = "Join a public match at Dust II’s A site.";
      text.roam = "Explore the site, Long A and the short approach.";
    }
    const lobby =
      (mode === "duel" || mode === "public") &&
      this.lobbies.find((r) => r.mode === (mode === "duel" ? "duel" : "play"));
    $("mode-detail").textContent =
      text[mode] +
      (lobby ? ` · ${lobby.players}/${lobby.capacity} players in lobby` : "");
    $("play").textContent = {
      public: "Join public game",
      duel: "Join duel",
      roam: county ? "Play solo" : "Start free roam",
      contract: "Start district run",
    }[mode];
    for (const [id, value] of [
      ["public-mode", "public"],
      ["duel", "duel"],
      ["roam-mode", "roam"],
      ["contract-mode", "contract"],
    ]) {
      $(id).setAttribute("aria-pressed", String(value === mode));
    }
    if (mode === "contract" || mode === "roam") this.soloMode = mode;
  }
  async joinPublic(mode: "public" | "duel" = "public", code?: string) {
    if (this.busy) return;
    this.busy = true;
    $("menu").inert = true;
    const button = $<HTMLButtonElement>("play");
    button.disabled = true;
    $<HTMLButtonElement>("duel").disabled = true;
    button.textContent = "Joining…";
    try {
      const welcome = await this.network.connect(
        code ? "join" : mode,
        this.identity.name,
        this.selectedSeed,
        code ?? "",
        this.loadout,
      );
      this.mode = "online";
      this.state = "loading";
      await this.build(welcome.seed, 1, welcome.spawn);
      $("menu").classList.add("hidden");
      $("hud").classList.remove("hidden");
      this.state = "paused";
      this.updateMission();
      this.resume();
      this.notice(
        this.network.duel
          ? "DUEL · REAL PLAYERS ONLY"
          : this.seed === COUNTY
            ? "SWITCHBACK COUNTY · E TO ENTER A CAR"
            : this.seed === DUST_A ? "DUST II · A SITE" : "WELCOME TO RUST",
        2,
      );
    } catch (error) {
      this.network.disconnect();
      this.state = "menu";
      this.showDialog(
        `<h2>Couldn’t join the city.</h2><p>${escape((error as Error).message)}</p><button id="public-retry" class="primary-button">TRY AGAIN</button>`,
      );
      $("menu").classList.remove("hidden");
      $("public-retry").onclick = () => {
        this.closeDialog();
        void this.joinPublic(mode);
      };
    } finally {
      button.disabled = false;
      $<HTMLButtonElement>("duel").disabled = false;
      this.busy = false;
      $("menu").inert = false;
      this.paintLobbyOptions();
    }
  }
  showHelp(paused = false) {
    const back = () => (paused ? this.showPause() : this.closeDialog());
    const county = this.seed === COUNTY;
    const controls = [
      ["W A S D / Mouse", "Move / look"],
      ["Shift / Ctrl", "Sprint / crouch or slide"],
      ["Space", "Jump, vault or mantle"],
      ["Space / F in air", "Double jump or boost"],
      ...(this.player.grappleEnabled
        ? [["Q / E", "Hook or release. Hold to reel in."]]
        : []),
      ["LMB / RMB", "Fire / aim"],
      ["1 / 2 / 3", "Primary / secondary / equipment · scroll to cycle"],
      [
        "B at spawn",
        "Open the loadout grid. Press a category number, then an item number. B confirms.",
      ],
      ["Hold T", "Point at a carried weapon and release to equip"],
      [
        this.player.grappleEnabled ? "X" : "Q / X",
        "Switch to your last weapon",
      ],
      ["R", "Reload"],
      ["M / Shift + M", "Toggle floating map / toggle sound"],
      ...(county
        ? [
            ["E", "Open a door or enter / exit a car"],
            ["W S / A D", "Accelerate or reverse / steer"],
            ["Space / V in car", "Brake / change camera"],
          ]
        : []),
      ["Tab / Esc", "Scoreboard / pause"],
    ];
    this.showDialog(
      `<h2>Controls</h2><div class="help-grid">${controls.map(([key, action]) => `<kbd>${key}</kbd><span>${action}</span>`).join("")}</div>${county ? "<p>Civilians give you space. Threaten one in view and witnesses run and call the county police. Kill someone or steal another car to raise your wanted level. Each star brings another police cruiser, up to five. Officers get out and open fire. Break line of sight and stay hidden until the search ends.</p>" : ""}<button id="help-done" class="secondary-button">Back</button>`,
      back,
    );
    $("help-done").onclick = back;
  }
  showSettings(paused = false) {
    this.showDialog(
      `<h2>Settings</h2><label for="ui-theme">Appearance</label><select id="ui-theme"><option value="system">Use system setting</option><option value="light">Light</option><option value="dark">Dark</option></select><label for="sensitivity">LOOK SENSITIVITY <span id="sensitivity-value">${settings.sensitivity.toFixed(1)}</span></label><input id="sensitivity" type="range" min=".2" max="2.5" step=".1" value="${settings.sensitivity}"><label for="fov">FIELD OF VIEW <span id="fov-value">${settings.fov}°</span></label><input id="fov" type="range" min="65" max="105" value="${settings.fov}"><label for="volume">SOUND VOLUME</label><input id="volume" type="range" min="0" max="1" step=".05" value="${settings.volume}"><label><input id="reduced" type="checkbox" ${settings.reduced ? "checked" : ""}> REDUCE CAMERA MOTION</label><label><input id="invert" type="checkbox" ${settings.invert ? "checked" : ""}> INVERT VERTICAL LOOK</label><label><input id="quality" type="checkbox" ${settings.quality ? "checked" : ""}> HIGH RESOLUTION RENDERING</label>${this.selectedSeed ? '<button id="settings-account" class="secondary-button">Player account</button>' : ""}<button id="settings-done" class="primary-button">Done</button>`,
      () => (paused ? this.showPause() : this.closeDialog()),
    );
    if (this.selectedSeed) $("settings-account").onclick = () => $("player-account").click();
    const theme = $<HTMLSelectElement>("ui-theme");
    theme.value = ["light", "dark"].includes(settings.theme)
      ? settings.theme
      : "system";
    theme.onchange = () => {
      settings.theme = theme.value;
      applyTheme();
      saveSettings();
    };
    for (const key of ["sensitivity", "fov", "volume"])
      $<HTMLInputElement>(key).oninput = (e) => {
        settings[key] = Number((e.target as HTMLInputElement).value);
        if ($(key + "-value"))
          $(key + "-value").textContent =
            key === "fov" ? settings[key] + "°" : settings[key].toFixed(1);
        this.audio.volume = settings.volume;
        saveSettings();
      };
    for (const key of ["reduced", "invert", "quality"])
      $<HTMLInputElement>(key).onchange = (e) => {
        settings[key] = (e.target as HTMLInputElement).checked;
        if (key === "quality") this.render.setQuality(settings.quality);
        saveSettings();
      };
    $("settings-done").onclick = () =>
      paused ? this.showPause() : this.closeDialog();
  }
  showOnline() {
    this.showDialog(
      `<h2>Private room</h2><p>Playing as <b>${escape(this.identity.name)}</b></p><form id="room-form"><label for="room-input">Room code</label><div class="code-entry"><input id="room-input" maxlength="5" placeholder="ABCDE" autocapitalize="characters" autocomplete="off" spellcheck="false"><button id="join-room" class="primary-button">Join room</button></div></form><div class="room-divider">or</div><button id="create-room" class="secondary-button">Create a new room</button><p id="network-error" class="error" role="status"></p>`,
    );
    $("create-room").onclick = () => void this.join("create");
    $("room-form").onsubmit = (e) => {
      e.preventDefault();
      void this.join("join");
    };
  }
  async join(type: "create" | "join") {
    const code = $<HTMLInputElement>("room-input").value.trim();
    if (this.busy) return;
    if (type === "join" && !/^[a-z0-9]{5}$/i.test(code)) {
      $("network-error").textContent = "Enter the five-character room code.";
      $("room-input").focus();
      return;
    }
    this.busy = true;
    $<HTMLButtonElement>("create-room").disabled = true;
    $<HTMLButtonElement>("join-room").disabled = true;
    $("network-error").textContent = "Drawing a shared district…";
    try {
      const welcome = await this.network.connect(
        type,
        this.identity.name,
        $<HTMLInputElement>("seed").value || "notebook",
        code,
        this.loadout,
      );
      this.mode = "online";
      this.state = "loading";
      await this.build(welcome.seed, 1, welcome.spawn);
      $("menu").classList.add("hidden");
      $("hud").classList.remove("hidden");
      this.updateMission();
      this.state = "paused";
      if (type === "join") {
        this.resume();
        return;
      }
      this.showDialog(
        `<h2>Room ready</h2><p>Share this code or invite link with friends.</p><div class="room-code">${escape(welcome.code)}</div><button id="enter-room" class="primary-button">Enter game</button><button id="copy-invite" class="secondary-button">Copy invite link</button><input id="invite-link" aria-label="Shareable invite link" readonly value="${escape(location.origin + (welcome.seed === COUNTY ? "/?mode=county&room=" : welcome.seed === DUST_A ? "/?level=dust-a&room=" : publicMapSeed(welcome.seed) === ISLANDS ? "/?level=islands&room=" : "/?room=") + welcome.code)}"><button id="copy-room" class="secondary-button">Copy room code</button>`,
      );
      $("copy-invite").onclick = async () => {
        const field = $<HTMLInputElement>("invite-link");
        try {
          await navigator.clipboard.writeText(field.value);
          $("copy-invite").textContent = "INVITE LINK COPIED!";
        } catch {
          field.focus();
          field.select();
          $("copy-invite").textContent = "SELECTED — COPY THE LINK BELOW";
        }
      };
      $("copy-room").onclick = async () => {
        try {
          await navigator.clipboard.writeText(welcome.code);
          $("copy-room").textContent = "COPIED!";
        } catch {
          $("copy-room").textContent = "ROOM CODE: " + welcome.code;
        }
      };
      $("enter-room").onclick = () => this.resume();
    } catch (e) {
      if ($("network-error")) {
        $("network-error").textContent = (e as Error).message;
        $<HTMLButtonElement>("create-room").disabled = false;
        $<HTMLButtonElement>("join-room").disabled = false;
      }
    } finally {
      this.busy = false;
    }
  }
  private showNetworkGrenade(effect: import("./grenades.ts").GrenadeEffect) {
    this.combat.addGrenade({
      ...effect,
      expires: effect.expires - this.network.serverOffset,
      flight: effect.flight && {
        ...effect.flight,
        start: effect.flight.start - this.network.serverOffset,
        arrival: effect.flight.arrival - this.network.serverOffset,
        impact: effect.flight.impact - this.network.serverOffset,
      },
    });
  }
  applyResume(m: any) {
    const player = m.player || m;
    const stamina = this.player.stamina;
    this.player.reset(player.p || m.p);
    this.armorySpawn = player.armorySpawn;
    if (m.drive) {
      this.driveAuthority = true;
      this.drivePending = [];
      this.sentDriveSequence = this.driveSequence = m.drive.seq;
      this.carSpeed = m.drive.pose.speed;
      this.carSteer = m.drive.pose.steer;
    }
    this.player.stamina = stamina;
    this.player.height = player.height ?? 1.76;
    this.player.yaw = player.yaw ?? this.player.yaw;
    this.player.pitch = player.pitch ?? this.player.pitch;
    this.combat.hp = player.hp;
    this.notoriety = player.notoriety ?? 0;
    this.wanted = player.wanted;
    this.combat.kills = player.kills;
    this.combat.score = player.kills * 100;
    this.combat.mags = m.mags || player.mags;
    this.combat.reloadTime = Math.max(
      0,
      (m.reloadRemaining ?? player.reloadRemaining ?? 0) / 1000,
    );
    this.loadout = readLoadout(player.loadout);
    this.combat.owned = inventory(
      readLoadout(player.loadout),
      this.seed === COUNTY,
    ).owned;
    this.combat.weapon = player.weapon ?? 0;
    this.setWeapon(this.combat.weapon, true);
    this.combat.cooldown = Math.max(
      0,
      (m.fireRemaining ?? player.fireRemaining ?? 0) / 1000,
    );
    this.keys.clear();
    this.firing = false;
    this.aiming = false;
    this.netTick = 0;
    this.accumulator = 0;
    if (player.hp <= 0) this.finish(false);
    else {
      this.clearDeathBody();
      this.state = "paused";
      this.showPause(
        "BACK IN YOUR MATCH",
        "Your connection is restored. Continue when you are ready.",
      );
    }
  }
  private rubbleMessage(m: RubbleMessage, remote: boolean) {
    if (!this.rubbleView) return;
    if (m.type === "rubble-spawn") {
      if (remote) for (const i of m.indices) this.structures?.set(i, 2, true);
      this.rubbleView.add(m);
    } else if (m.type === "rubble-remove") this.rubbleView.remove(m.index);
    else this.rubbleView.move(m.poses, remote ? 1 / 15 : 1 / 60);
  }
  private restoreStructures() {
    this.restoringStructures = true;
    this.structures?.restore(this.network.structures);
    this.rubbleView?.clear();
    for (const c of this.network.rubble.clusters.values())
      this.rubbleView?.add(c);
    this.restoringStructures = false;
  }
  onNetwork(m: any) {
    if (
      m.type === "vehicle-impact" &&
      this.mode === "online" &&
      this.seed === COUNTY
    )
      this.render.countyCars[m.index]?.showImpact(
        m.part,
        new T.Vector3(...m.point),
        new T.Vector3(...m.direction),
      );
    if (m.type === "vehicle-drive") this.reconcileDrive(m);
    if (this.mode === "online" && this.state !== "loading") {
      if (m.type === "structure") this.structures?.set(m.index, m.state);
      if (["rubble-spawn", "rubble-remove", "rubble-poses"].includes(m.type))
        this.rubbleMessage(m, true);
      if (m.type === "resumed") this.restoreStructures();
    }
    if (m.type === "vehicle-seat") {
      this.seatPending = false;
      this.driveAuthority = m.driveVersion === 1;
      if (this.seed === COUNTY && this.cars[m.index] && m.car) {
        this.cars[m.index] = m.car;
        this.syncSeat();
      }
    }
    if (
      m.type === "snapshot" &&
      (m.cars || m.carUpdates) &&
      this.seed === COUNTY
    ) {
      if (m.cars) this.cars = m.cars;
      else for (const [index, car] of m.carUpdates) this.cars[index] = car;
      if (this.seatPending && performance.now() - this.seatRequestedAt > 2000)
        this.seatPending = false;
    }
    if (
      m.type === "resumed" &&
      this.mode === "online" &&
      this.state !== "loading"
    )
      this.applyResume(m);
    if (m.type === "reconnecting" && this.mode === "online") {
      this.seatPending = false;
      this.state = "paused";
      this.keys.clear();
      this.firing = false;
      this.aiming = false;
      document.exitPointerLock();
      this.showDialog(
        '<div class="modal-kicker">RECONNECTING</div><h2>Finding your way back…</h2><p>Your match is continuing. Reconnecting to your runner.</p><button id="reconnect-menu" class="secondary-button">Main menu</button>',
      );
      $("reconnect-menu").onclick = () => this.mainMenu();
    }
    if (m.type === "impact") {
      if (m.reaction) {
        if (m.id === this.network.id) this.selfReaction = m.reaction;
        else
          this.remotes
            .get(m.id)
            ?.reactToPunch(m.reaction, this.network.worldTime * 1000);
      } else this.remotes.get(m.id)?.react(m.region, m.side, m.damage);
      if (m.id === this.network.id)
        this.combat.hurt = Math.max(this.combat.hurt, 0.65);
    }
    if (m.type === "snapshot" && this.mode === "online") {
      const me = m.players.find((p: any) => p.id === this.network.id);
      if (me) {
        this.identity.updateRating(me.name, me.rating);
        if (me.hp < this.combat.hp) this.combat.hurt = 0.8;
        if (me.reaction) this.selfReaction = me.reaction;
        this.combat.hp = me.hp;
        if (me.hp <= 0 && this.state === "paused" && $("kit-form"))
          this.finish();
        this.notoriety = me.notoriety ?? 0;
        this.wanted = me.wanted;
        this.combat.kills = me.kills;
        this.combat.score = me.kills * 100;
      }
      for (const [id, model] of this.remotes)
        if (!m.players.some((p: any) => p.id === id)) {
          this.ragdolls?.remove(model);
          model.dispose();
          this.remotes.delete(id);
        }
      const winner = m.players.find((p: any) => p.kills >= 15);
      if (
        (this.seed !== COUNTY || this.network.duel) &&
        !this.network.public &&
        winner &&
        this.state !== "complete"
      )
        this.finish(true, winner.name);
    }
    if (m.type === "shot" && m.id !== this.network.id) {
      const model = this.remotes.get(m.id);
      model?.fire();
      const muzzle = model?.group.getObjectByName("muzzle");
      model?.group.updateWorldMatrix(true, true);
      this.combat.tracer(
        muzzle
          ? muzzle.getWorldPosition(new T.Vector3())
          : new T.Vector3(...m.from),
        new T.Vector3(...m.to),
        "#347a75",
      );
    }
    if (m.type === "hit") {
      this.combat.hitTime = 0.2;
      this.combat.hitRegion = m.region ?? (m.head ? "head" : "body");
      if (m.melee) this.audio.tone(125, 0.09, "triangle", 0.26, 48);
      if (m.kill && m.npc) this.audio.npcEliminated();
      else if (m.kill) this.audio.playerEliminated();
      else this.audio.hit();
      if (m.kill) this.notice("RIVAL ERASED +100");
    }
    if (m.type === "kill") {
      $("feed").textContent = `${m.by} erased ${m.victim}`;
      this.feedUntil = this.time + 5;
    }
    if (m.type === "correction") {
      if (m.shore && this.city.seed === ISLANDS) {
        this.player.reset(m.p);
        this.notice("BACK AT COMPASS CAY");
      } else this.player.position.fromArray(m.p);
      this.player.velocity.set(0, 0, 0);
    }
    if (m.type === "grenade" && this.combat?.online && this.state !== "loading")
      this.showNetworkGrenade(m.effect);
    if (m.type === "ammo") {
      this.combat.mags = m.mags;
      this.combat.reloadTime = Math.max(0, m.reloadRemaining / 1000);
    }
    if (m.type === "armory-closed") {
      this.armorySpawn = undefined;
      const kit = readLoadout(m.loadout);
      if (kit) {
        this.loadout = kit;
        try {
          localStorage.setItem("dc.loadout", JSON.stringify(kit));
        } catch {}
      }
      Object.assign(this.combat, inventory(kit, this.seed === COUNTY), {
        weapon: m.weapon,
        mags: m.mags,
      });
      this.setWeapon(m.weapon, true);
      this.notice("Loadout changes are available at spawn");
    }
    if (m.type === "respawn") {
      this.armorySpawn = m.p;
      this.clearDeathBody();
      this.combat.cancelPunch();
      this.player.reset(m.p);
      this.notoriety = 0;
      this.wanted = undefined;
      this.combat.hp = 100;
      this.loadout = readLoadout(m.loadout);
      Object.assign(
        this.combat,
        inventory(readLoadout(m.loadout), this.seed === COUNTY),
      );
      this.combat.cooldown = this.combat.reloadTime = 0;
      this.setWeapon(this.combat.weapon, true);
      this.resume();
    }
    if (
      m.type === "disconnected" &&
      this.mode === "online" &&
      this.state !== "menu"
    ) {
      this.state = "paused";
      document.exitPointerLock();
      this.showDialog(
        '<div class="modal-kicker">CONNECTION LOST</div><h2>The line went quiet.</h2><p>Your connection to the room closed. Return to the menu to reconnect.</p><button id="disconnect-menu" class="primary-button">BACK TO MENU</button>',
      );
      $("disconnect-menu").onclick = () => this.mainMenu();
    }
  }
  sendState() {
    if (!this.network.active) return;
    const pending =
      this.vehicle >= 0
        ? this.drivePending
            .filter((i) => i.seq > this.sentDriveSequence)
            .slice(0, 12)
        : [];
    const drive = pending.length
      ? { seq: pending[0].seq, inputs: pending.map((i) => i.input) }
      : this.drivePending.length
        ? { seq: this.sentDriveSequence, inputs: [] }
        : undefined;
    const sent = this.network.send({
      type: "state",
      drive,
      vehicle: this.vehicle,
      p: this.player.position.toArray(),
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      weapon: this.combat.weapon,
      height: this.player.height,
      lean: this.coverPeek.lean,
      aiming: this.aiming,
      anchor: this.player.anchor
        ? [this.player.anchor.x, this.player.anchor.y, this.player.anchor.z]
        : null,
    });
    if (sent && pending.length)
      this.sentDriveSequence = pending[pending.length - 1].seq;
  }
  private clearDeathBody() {
    if (this.deathBody) {
      this.ragdolls?.remove(this.deathBody);
      this.deathBody.dispose();
      this.deathBody = undefined;
    }
    document.body.classList.remove("county-death");
  }
  private placeDeathBody(
    model: Doodle,
    position: V3,
    yaw: number,
    height: number,
  ) {
    model.group.position.fromArray(position);
    model.group.rotation.y = yaw + Math.PI;
    model.group.scale.y = height / 1.76;
    const car = this.cars.find(
      (c) =>
        Math.hypot(c.p[0] - position[0], c.p[2] - position[2]) < 0.35 &&
        Math.abs(c.p[1] - position[1]) < 0.5,
    );
    if (car) {
      model.group.position.x -= Math.cos(car.yaw) * 1.65;
      model.group.position.z += Math.sin(car.yaw) * 1.65;
    }
    this.ragdolls?.playerDeath(model, yaw, this.render.camera.position);
  }
  finish(win = false, winner = "") {
    if (win) this.clearDeathBody();
    else if (this.seed === COUNTY && !this.deathBody) {
      this.deathBody = new Doodle("#347a75", undefined, "combatant", this.appearanceId);
      this.render.scene.add(this.deathBody.group);
      this.placeDeathBody(
        this.deathBody,
        this.player.position.toArray(),
        this.player.yaw,
        this.player.height,
      );
      this.weaponMesh.visible = false;
      if (this.rope) this.rope.visible = false;
      document.body.classList.add("county-death");
    }
    this.respawnAt = this.mode === "online" ? Date.now() + 2500 : 0;
    this.state = win ? "complete" : "dead";
    this.keys.clear();
    this.firing = false;
    document.exitPointerLock();
    this.audio.tone(win ? 820 : 160, 0.4, "triangle", 0.2, win ? 1000 : 55);
    const best = Math.max(this.combat.score, Number(safeRead("dc.best", 0)));
    localStorage.setItem("dc.best", JSON.stringify(best));
    this.showResult(win, winner);
  }
  private showResult(win: boolean, winner: string) {
    const online = this.mode === "online";
    this.showDialog(
      `<div class="modal-kicker">${win ? "A PAGE WORTH KEEPING" : "THERE’S ALWAYS ANOTHER BLANK PAGE"}</div><h2>${win ? (online ? escape(winner) + " wins." : "District, signed.") : this.deathBody ? "You died" : "Erased. Not forgotten."}</h2><p>${win ? "You left your mark on the city." : online ? "Catch your breath. You can rejoin the fight in a moment." : this.city.arena ? "Keep moving, climb the tower, and use cover to break the crossfire." : "Try a rooftop route, keep moving, and use your grapple to get above the crossfire."}</p><div class="result-stats"><div><b>${this.combat.kills}</b><span>RIVALS ERASED</span></div><div><b>${this.combat.score}</b><span>STYLE POINTS</span></div><div><b>${timeLabel(this.elapsed)}</b><span>TIME IN DISTRICT</span></div></div>${online && win ? "" : `<button id="retry" class="primary-button">${win ? "DRAW THE NEXT DISTRICT" : "Respawn"} <span>↗</span></button>`}${win ? "" : '<button id="change-kit" class="secondary-button">Change loadout</button>'}<button id="finish-menu" class="secondary-button">Main menu</button>`,
    );
    if ($("retry")) {
      const spawn = () => {
        if (online) {
          if (Date.now() < this.respawnAt) return;
          this.network.send({ type: "respawn", loadout: this.loadout });
        } else {
          if (win) this.district++;
          void this.start(this.mode);
        }
      };
      this.waitForRespawn($<HTMLButtonElement>("retry"));
      $("retry").onclick = spawn;
      if (!win)
        $("change-kit").onclick = () =>
          this.pickLoadout(spawn, true, () => this.showResult(false, ""));
    }
    $("finish-menu").onclick = () => this.mainMenu();
  }
  step(dt: number) {
    if (this.state !== "play") return;
    if (
      this.armorySpawn &&
      (this.vehicle >= 0 ||
        distance(this.armorySpawn, this.player.position.toArray()) >
          ARMORY_RADIUS)
    )
      this.armorySpawn = undefined;
    this.elapsed += dt;
    const held = (...keys: string[]) => keys.some((k) => this.keys.has(k));
    const grapple = held("KeyQ") || (!this.carKeyHeld && held("KeyE"));
    const input = {
      forward:
        Number(held("KeyW", "ArrowUp")) - Number(held("KeyS", "ArrowDown")),
      side:
        Number(held("KeyD", "ArrowRight")) - Number(held("KeyA", "ArrowLeft")),
      sprint: held("ShiftLeft", "ShiftRight"),
      crouch: held("KeyC", "ControlLeft"),
      jump: held("Space"),
      grapple,
      reel: grapple,
      boost: held("KeyF"),
    };
    this.input = input;
    const action = this.player.action,
      hooks = this.player.hooks;
    const previousBodyY = this.player.position.y;
    if (this.vehicle >= 0) {
      const p = this.player;
      this.previousCarPosition.copy(p.position);
      this.previousCarYaw = p.yaw;
      const inputCode = driveInput(
        performance.now() >= this.doorUntil ? input.forward : 0,
        input.side,
        input.jump,
      );
      const pose = this.drivePose(),
        from = pose.p;
      const car = this.cars[this.vehicle];
      const online = this.mode === "online";
      if (
        !online ||
        !this.driveAuthority ||
        this.drivePending.length < MAX_PENDING_DRIVE_STEPS
      ) {
        const impact = this.driveWorld!.advance(
          pose,
          car.kind,
          inputCode,
          online
            ? undefined
            : (box, amount) => this.structures!.damage(box.pieceId!, amount),
          car,
        );
        this.applyDrivePose(pose);
        if (online) {
          if (this.driveAuthority)
            this.drivePending.push({
              seq: ++this.driveSequence,
              input: inputCode,
              pose,
            });
        } else {
          if (impact) {
            if (this.elapsed >= this.crashUntil) this.countyVandalism();
            this.crashUntil = this.elapsed + 0.4;
          }
          if (from !== pose.p)
            this.countyCarContact(
              this.vehicle,
              from,
              pose.p,
              pose.yaw,
              pose.speed,
            );
          car.p = pose.p;
          car.yaw = pose.yaw;
        }
      }
      p.action = "DRIVING";
      p.grounded = true;
      this.aiming = false;
    } else if (!this.seatPending) {
      if (this.seed === COUNTY)
        this.physics.setVehicleColliders(
          this.cars,
          this.vehicle,
          this.render.countyCars,
        );
      this.player.update(dt, input);
    }
    const nearGround =
      this.vehicle < 0 &&
      this.player.velocity.y <= 0 &&
      !!this.physics.ray(
        this.player.position.clone().add(new T.Vector3(0, 0.08, 0)),
        new T.Vector3(0, -1, 0),
        0.4,
      );
    this.viewMotion.trackHeight(
      this.player.eye.y,
      this.player.grounded,
      this.player.resetRevision,
      dt,
      this.player.grounded || nearGround || this.player.traversing
        ? 0
        : this.player.position.y - previousBodyY,
    );
    if (this.player.hooks > hooks) {
      this.audio.tone(600, 0.15, "triangle", 0.14, 220);
      this.notice("HOOKED", 0.6);
    }
    if (
      this.player.action !== action &&
      [
        "VAULT",
        "MANTLE",
        "WALL RUN",
        "WALL JUMP",
        "RELEASE",
        "DOUBLE JUMP",
        "AIR BOOST",
      ].includes(this.player.action)
    ) {
      this.notice(this.player.action, 0.8);
      this.audio.tone(260, 0.1, "sine", 0.08, 450);
      if (this.mode !== "online") this.combat.score += 10;
    }
    if (
      this.vehicle < 0 &&
      !this.seatPending &&
      (this.firing || this.combat.burstLeft > 0) &&
      !this.player.traversing
    )
      this.combat.fire();
    this.tickCitizens(dt);
    this.combat.update(dt, this.time, this.render.camera);
    if (this.player.grounded) this.audio.step(this.time, this.player.speed);
    if (
      Math.abs(this.player.position.x) > this.city.bounds ||
      Math.abs(this.player.position.z) > this.city.bounds ||
      (this.city.seed === ISLANDS ? this.mode !== "online" && this.player.position.y < SEA_LEVEL : this.player.position.y < -6)
    ) {
      this.player.reset(this.city.spawns[0]);
      this.notice(this.city.seed === ISLANDS ? "BACK AT COMPASS CAY" : "BACK INSIDE THE MARGINS");
    }
    if (this.mode === "contract" && this.seed !== COUNTY) {
      this.city.beacons.forEach((p, i) => {
        if (
          !this.collected.has(i) &&
          this.player.position.distanceTo(new T.Vector3(...p)) < 2.3
        ) {
          this.collected.add(i);
          const mark =
            this.render.beaconMeshes[i] ??
            this.render.cityGroup.children.filter(
              (o) => o.name === "county-mark",
            )[i];
          if (mark) mark.visible = false;
          this.combat.score += 300;
          this.combat.hp = Math.min(100, this.combat.hp + 25);
          this.audio.collect();
          this.notice(this.city.seed === ISLANDS ? "ISLAND MARK +300" : "ROOFTOP MARK +300", 2);
        }
      });
      if (
        this.collected.size === 3 &&
        this.combat.kills >= 6 &&
        this.player.position.distanceTo(new T.Vector3(...this.city.spawns[0])) <
          3
      )
        this.finish(true);
    }
    if (this.combat.hp <= 0 && this.state === "play") this.finish();
  }
  updateVisuals(dt: number) {
    const p = this.player,
      cam = this.render.camera;
    if (this.state === "menu") {
      $("sniper-scope").style.opacity = "0";
      if (this.rope) this.rope.visible = false;
      const t = settings.reduced ? 0 : this.time * 0.025;
      cam.position.set(
        (this.seed === COUNTY ? -295 : 46) + Math.sin(t) * 5,
        this.city.seed === ISLANDS ? 49 : this.city.arena ? 26 : 29,
        50 + Math.cos(t) * 4,
      );
      cam.lookAt(this.seed === COUNTY ? -320 : -4, 3, 0);
      cam.fov = 58;
      cam.updateProjectionMatrix();
      this.weaponMesh.visible = false;
      return;
    }
    if (this.deathBody && this.state === "dead") {
      $("sniper-scope").style.opacity = "0";
      this.updateActors(dt);
      const focus = this.deathBody.pelvis.getWorldPosition(new T.Vector3());
      const offset = new T.Vector3(1.25, 1.65, 2.7).applyAxisAngle(
        T.Object3D.DEFAULT_UP,
        p.yaw,
      );
      const distance = offset.length();
      offset.normalize();
      const hit = this.physics.ray(focus, offset, distance);
      cam.position
        .copy(focus)
        .addScaledVector(
          offset,
          hit ? Math.max(0.06, hit.distance - 0.16) : distance,
        );
      cam.lookAt(focus);
      cam.fov = 60;
      cam.updateProjectionMatrix();
      return;
    }
    const motion = settings.reduced ? 0 : 1;
    const v = this.viewMotion;
    v.trackHeight(p.eye.y, p.grounded, p.resetRevision, 0);
    const canAim = this.vehicle < 0 && !this.seatPending && this.combat.hp > 0;
    const aiming =
      canAim && this.aiming && !p.traversing && this.combat.reloadTime <= 0;
    const zoom = scopeMagnification(this.combat.weapon);
    v.update(
      dt,
      aiming,
      p.speed,
      p.grounded,
      settings.reduced,
      settings.fov,
      zoom ? scopedFov(settings.fov, zoom) : 57,
    );
    const steady = (1 - v.ads * 0.85) * (1 - v.fireWeight * 0.7) * motion;
    const recoil = v.kick * (1 - v.ads * 0.5) * motion;
    const peek = this.coverPeek.update(
      dt,
      p.eye.toArray() as V3,
      p.yaw,
      p.pitch,
      aiming,
      (o, d, n) =>
        this.physics.ray(new T.Vector3(...o), new T.Vector3(...d), n),
    );
    cam.position.copy(p.eye);
    // Reset/respawn is immediate; normal terrain smoothing runs at physics rate.
    cam.position.y = v.eyeY;
    cam.position.y += v.bob;
    cam.position.x += Math.cos(p.yaw) * peek;
    cam.position.z -= Math.sin(p.yaw) * peek;
    cam.rotation.set(
      p.pitch + recoil * 0.004,
      p.yaw,
      (p.action === "WALL RUN" ? 0.055 * motion * (1 - v.ads) : 0) -
        peek * 0.12,
      "YXZ",
    );
    if (
      this.selfReaction &&
      this.combat.hp > 0 &&
      this.vehicle < 0 &&
      !settings.reduced
    ) {
      const r = this.selfReaction;
      const age =
        ((this.mode === "online" ? this.network.worldTime * 1000 : Date.now()) -
          r.at) /
        1000;
      if (age < REACTION_SECONDS) {
        const { snap, brace } = reactionWeights(age, r.move);
        cam.rotation.x -=
          snap * r.forward * (r.region === "head" ? 0.062 : 0.038);
        cam.rotation.z += snap * (r.lateral * 0.048 + r.side * 0.023);
        cam.position.y -= brace * 0.026;
      }
    }
    const car = this.render.countyCars[this.vehicle];
    if (car) {
      const yaw = car.rotation.y;
      if (this.cockpit) {
        cam.position
          .copy(car.seat)
          .applyQuaternion(car.quaternion)
          .add(car.position);
        cam.rotation.set(p.pitch, yaw + this.cockpitYaw, 0, "YXZ");
      } else {
        cam.position
          .set(0, 3.1, 6)
          .applyQuaternion(car.quaternion)
          .add(car.position);
        cam.lookAt(car.position.x, car.position.y + 1, car.position.z);
      }
      const entry = T.MathUtils.smoothstep(
        (performance.now() - this.entryTime) / 450,
        0,
        1,
      );
      if (entry < 1) {
        cam.position.lerp(this.entryPosition, 1 - entry);
        cam.quaternion.slerp(this.entryRotation, 1 - entry);
      }
    }
    cam.fov = v.fov;
    cam.updateProjectionMatrix();
    const scoped =
      canAim && zoom > 1 ? T.MathUtils.smoothstep(v.ads, 0.55, 0.94) : 0;
    $("sniper-scope").style.opacity = String(scoped);
    $("crosshair").classList.toggle("reflex-dot", zoom === 1 && v.ads > 0.85);
    $("crosshair").style.opacity = String(1 - scoped);
    $("crosshair").style.setProperty("--spread-opacity", String(1 - v.ads));
    this.weaponMesh.visible =
      this.vehicle < 0 && this.combat.hp > 0 && scoped < 0.98;
    if (this.combat.weapon === FISTS) {
      this.weaponMesh.position.set(
        v.swayX * steady,
        v.bob * 0.35 + v.swayY * steady,
        0,
      );
      animateFists(
        this.weaponMesh,
        this.combat.punch?.move ?? 0,
        this.combat.punchAge,
        this.time,
        this.time - this.equippedAt,
      );
    } else {
      const reloadProgress =
        this.combat.reloadTime > 0
          ? 1 - this.combat.reloadTime / WEAPONS[this.combat.weapon].reload
          : 0;
      const reload = animateWeaponParts(
        this.weaponMesh,
        this.combat.weapon,
        reloadProgress,
        recoil,
        this.combat.mags[this.combat.weapon] > 0,
      );
      this.animateArms?.(reload, reloadProgress);
      const reloadScale = settings.reduced ? 0.35 : 1;
      const vaultPose = Math.sin(Math.PI * p.traversalProgress);
      // One camera-local pose: stride, restrained look sway, then shared shot impulse.
      this.weaponMesh.position.set(
        0.3 * (1 - v.ads) + v.swayX * steady + reload.x * reloadScale,
        T.MathUtils.lerp(
          -0.3,
          -(this.weaponMesh.userData.sightHeight ??
            [0.0816, 0.046, 0.046, 0.095][WEAPONS[this.combat.weapon].model]),
          v.ads,
        ) +
          v.bob * 0.35 +
          v.swayY * steady -
          -reload.y * reloadScale -
          vaultPose * 0.14,
        T.MathUtils.lerp(
          WEAPONS[this.combat.weapon].model === 2 ? -0.38 : -0.68,
          zoom === 1 ? -0.46 : -0.72,
          v.ads,
        ) +
          recoil * 0.035,
      );
      this.weaponMesh.rotation.set(
        reload.pitch * reloadScale + recoil * 0.04 - vaultPose * 0.3,
        -0.04 * (1 - v.ads) + reload.yaw * reloadScale,
        reload.roll * reloadScale +
          v.bob * 0.3 -
          vaultPose * 0.22 +
          this.combat.hurt * (settings.reduced ? 0.01 : 0.045),
      );
      const clearance = this.weaponClearance.update(
        dt,
        cam.position,
        cam.quaternion,
        WEAPONS[this.combat.weapon].model,
        v.ads,
        this.physics.ray.bind(this.physics),
      );
      // Apply last, after reload/ADS/recoil; only the viewmodel is raised.
      this.weaponMesh.rotation.x += clearance.pitch;
      this.weaponMesh.position.z += clearance.retract;
      this.weaponMesh.position.y -= clearance.lower;
      if (this.combat.weapon === KNIFE) {
        this.weaponMesh.rotation.z -= recoil * 0.8;
        this.weaponMesh.position.z -= recoil * 0.18;
      }
      if (
        isGrenade(this.combat.weapon) &&
        this.combat.mags[this.combat.weapon] === 0
      )
        this.weaponMesh.visible = false;
      this.weaponMesh.scale.setScalar(0.68);
    }
    if (!this.rope) {
      this.rope = new GrappleVisual();
      this.render.scene.add(this.rope);
    }
    this.rope.update(p, this.render.camera, dt);
    this.updateActors(dt);
  }
  private updateActors(dt: number) {
    const cam = this.render.camera;
    const states: RemoteState[] =
      this.citizens?.actors ??
      (this.mode === "online" ? this.network.players : []);
    const seated = new Set(this.cars.map((c) => c.driver));
    const now =
      this.mode === "online" ? this.network.worldTime * 1000 : Date.now();
    for (const state of states) {
      if (state.id === this.network.id && this.mode === "online") continue;
      const civil = state.id.startsWith("civilian-");
      const police = state.id.startsWith("police-");
      let model = this.remotes.get(state.id);
      const nearby =
        !state.npc ||
        this.player.position.distanceToSquared(new T.Vector3(...state.p)) <=
          NPC_RADIUS * NPC_RADIUS;
      if (!nearby || (seated.has(state.id) && state.hp > 0)) {
        if (model) model.group.visible = false;
        continue;
      }
      if (!model) {
        model = new Doodle(
          police
            ? "#17395c"
            : civil
              ? "#446e95"
              : state.npc
                ? "#d23c45"
                : "#347a75",
          police ? "POLICE" : state.npc ? undefined : state.name,
          police ? "police" : civil ? "civilian" : undefined,
          state.id,
        );
        model.group.position.fromArray(state.p);
        this.render.scene.add(model.group);
        this.remotes.set(state.id, model);
      }
      if (!state.npc && this.ragdolls) {
        if (state.hp <= 0) {
          if (!this.deadActors.has(model)) {
            this.placeDeathBody(
              model,
              state.p,
              state.yaw,
              state.height ?? 1.76,
            );
            this.deadActors.add(model);
          }
          continue;
        }
        if (this.deadActors.delete(model)) this.ragdolls.remove(model);
      }
      if (state.reaction) model.reactToPunch(state.reaction, now);
      model.group.visible = state.hp > 0;
      const target = new T.Vector3(
          ...(this.citizens ? state.p : this.network.position(state)),
        ),
        dist = model.group.position.distanceTo(target);
      const dx = target.x - model.group.position.x,
        dz = target.z - model.group.position.z;
      if (dist > 6) model.group.position.copy(target);
      else model.group.position.lerp(target, 1 - Math.exp(-dt * 35));
      if (civil || police) {
        model.setCivilianAction(state.action ?? "idle");
        if (state.fall && this.lastFall.get(model) !== state.fall.at) {
          const age = Math.max(0, (now - state.fall.at) / 1000);
          if (
            this.ragdolls?.hit(
              model,
              state.fall.impulse,
              cam.position,
              state.hp <= 0,
              age,
            )
          )
            this.lastFall.set(model, state.fall.at);
        }
        if (this.ragdolls?.has(model)) {
          if (state.hp <= 0) this.ragdolls.markDead(model);
          model.group.visible = true;
          continue;
        }
      }
      if (!state.npc) {
        if (state.weapon !== FISTS) model.showHeldWeapon(state.weapon);
        model.setFistPose(
          state.weapon === FISTS,
          state.swing?.move ?? 0,
          state.swing ? (now - state.swing.start) / 1000 : 1,
          this.seed === COUNTY,
        );
      }
      const desiredYaw = state.yaw + Math.PI;
      const turn = Math.atan2(
        Math.sin(desiredYaw - model.group.rotation.y),
        Math.cos(desiredYaw - model.group.rotation.y),
      );
      model.group.rotation.y += turn * (1 - Math.exp(-dt * 24));
      if (model.group.visible)
        model.animate(
          this.time,
          this.citizens
            ? Math.hypot(
                (state as CountyCitizen).vx ?? 0,
                (state as CountyCitizen).vz ?? 0,
              )
            : this.network.speed(state),
          cam,
          state.pitch,
          dt,
          dx,
          dz,
          !!state.npc && !!state.engaged,
        );
      if (state.npc && state.hp <= 0) {
        model.fall(dt);
        if (
          dist > NPC_RADIUS ||
          this.player.position.distanceToSquared(target) >
            NPC_RADIUS * NPC_RADIUS
        )
          model.group.visible = false;
      }
      model.group.scale.y = (state.height ?? 1.76) / 1.76;
      model.spine.position.x = -(state.lean ?? 0);
      let rope = this.remoteRopes.get(state.id);
      if (state.anchor && state.hp > 0) {
        if (!rope) {
          rope = new T.Line(
            new T.BufferGeometry().setFromPoints([
              new T.Vector3(),
              new T.Vector3(),
            ]),
            new T.LineBasicMaterial({ color: "#347a75" }),
          );
          this.remoteRopes.set(state.id, rope);
          this.render.scene.add(rope);
        }
        rope.visible = true;
        const from = model.group.position
          .clone()
          .add(new T.Vector3(0, (state.height ?? 1.76) - 0.16, 0));
        const route = routeRope(
          from,
          new T.Vector3(...state.anchor),
          rope.userData.path ?? [],
          this.physics.ray.bind(this.physics),
        );
        if (route) {
          rope.userData.path = route;
          rope.geometry.dispose();
          rope.geometry = new T.BufferGeometry().setFromPoints([
            from,
            ...route,
          ]);
        } else rope.visible = false;
      } else if (rope) rope.visible = false;
    }
    if (this.citizens) {
      for (const [id, model] of this.remotes) {
        if (id.startsWith("police-") && !states.some((a) => a.id === id)) {
          this.ragdolls?.remove(model);
          model.dispose();
          this.remotes.delete(id);
        }
      }
    }
    this.ragdolls?.update(dt, cam.position);
    for (const [id, line] of this.remoteRopes)
      if (!this.remotes.has(id)) {
        this.render.scene.remove(line);
        line.geometry.dispose();
        (line.material as T.Material).dispose();
        this.remoteRopes.delete(id);
      }
  }
  private setMapExpanded(expanded: boolean) {
    if (this.mapExpanded === expanded) return;
    this.mapExpanded = expanded;
    $("city-map-panel").classList.toggle("expanded", expanded);
    const canvas = $<HTMLCanvasElement>("city-map");
    canvas.width = canvas.height = expanded ? 570 : 190;
    $("map-toggle-hint").textContent = expanded
      ? "M · close map"
      : "M · expand map";
  }

  private drawMapPlayers(
    c: CanvasRenderingContext2D,
    centerX: number,
    centerZ: number,
    scale: number,
  ) {
    const marker = (x: number, z: number, yaw: number, local: boolean) => {
      const dx = (x - centerX) * scale,
        dz = (z - centerZ) * scale;
      const edge = Math.max(1, Math.abs(dx) / 89, Math.abs(dz) / 89);
      c.save();
      c.translate(95 + dx / edge, 95 + dz / edge);
      c.rotate(edge > 1 ? Math.atan2(dx, -dz) : -yaw);
      if (this.mapExpanded) c.scale(0.68, 0.68);
      c.fillStyle = local ? "#d23c45" : "#2442ae";
      c.strokeStyle = "#fffdf3";
      c.lineWidth = 1.2;
      c.lineJoin = "round";
      c.beginPath();
      if (local || edge > 1) {
        c.moveTo(0, -5);
        c.lineTo(4, 4);
        c.lineTo(0, 2);
        c.lineTo(-4, 4);
        c.closePath();
      } else c.arc(0, 0, 3.6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    };
    if (this.mode === "online" && this.network.active) {
      for (const other of this.network.players) {
        if (other.npc || other.id === this.network.id || other.hp <= 0)
          continue;
        const [x, , z] = this.network.position(other);
        marker(x, z, other.yaw, false);
      }
    }
    const p = this.player.position;
    marker(p.x, p.z, this.player.yaw, true);
  }

  drawCityMap() {
    const canvas = $<HTMLCanvasElement>("city-map"),
      c = canvas.getContext("2d")!;
    const resolution = canvas.width / 190;
    c.setTransform(resolution, 0, 0, resolution, 0, 0);
    if (this.city.seed === ISLANDS) {
      const {x,z} = this.player.position;
      $("neighborhood-label").textContent = drawIslandMap(c,x,z);
      this.drawMapPlayers(c,0,0,islandMapScale);
      return;
    }
    if (this.seed === COUNTY) {
      const p = this.player.position;
      const scale = this.mapExpanded
        ? 90 / this.city.bounds
        : this.vehicle >= 0
          ? 0.82
          : 1.18;
      const centerX = this.mapExpanded ? 0 : p.x,
        centerZ = this.mapExpanded ? 0 : p.z;
      c.clearRect(0, 0, 190, 190);
      c.save();
      c.translate(95 - centerX * scale, 95 - centerZ * scale);
      c.scale(scale, scale);
      c.fillStyle = "#8d9eb72c";
      for (const b of this.city.plan.parcels)
        c.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
      c.lineCap = "round";
      for (const road of this.city.plan.streets) {
        c.lineWidth = road.width * 0.62;
        c.strokeStyle = road.class === "arterial" ? "#687da0" : "#a3afc0";
        c.beginPath();
        c.moveTo(road.a[0], road.a[2]);
        c.lineTo(road.b[0], road.b[2]);
        c.stroke();
      }
      c.restore();
      this.drawMapPlayers(c, centerX, centerZ, scale);
      const district = this.city.plan.blocks.find(
        (b) =>
          p.x >= b.minX - 8 &&
          p.x <= b.maxX + 8 &&
          p.z >= b.minZ - 8 &&
          p.z <= b.maxZ + 8,
      );
      $("neighborhood-label").textContent = district
        ? p.x < 0
          ? "Westhaven"
          : "Eastbank"
        : this.city.plan.streets.some(
              (s) =>
                s.class === "arterial" &&
                Math.hypot(
                  p.x - (s.a[0] + s.b[0]) / 2,
                  p.z - (s.a[2] + s.b[2]) / 2,
                ) < 29,
            )
          ? "County Highway"
          : "Highlands";
      return;
    }
    if (this.seed === DUST_A) {
      const scale = 90 / this.city.bounds;
      c.clearRect(0, 0, 190, 190);
      for (const b of this.city.boxes) {
        if (b.kind === "boundary") continue;
        c.fillStyle = b.kind === "crate" ? "#528883" : b.kind === "platform" ? "#d18a72" : ["hotel","stucco","ochre"].includes(b.kind) ? "#ac947d" : "#d3c8b3";
        c.fillRect(95 + (b.p[0] - b.s[0]/2) * scale, 95 + (b.p[2] - b.s[2]/2) * scale, b.s[0]*scale, b.s[2]*scale);
      }
      this.drawMapPlayers(c, 0, 0, scale);
      const { x, z } = this.player.position;
      $("neighborhood-label").textContent = this.city.buildings.reduce((a, b) =>
        Math.hypot(x-a.x, z-a.z) < Math.hypot(x-b.x, z-b.z) ? a : b
      ).name;
      return;
    }
    const mapBounds =
      this.city.arena && !this.mapExpanded
        ? Math.max(
            42,
            Math.abs(this.player.position.x) + 12,
            Math.abs(this.player.position.z) + 12,
          )
        : this.city.bounds;
    const scale = 90 / mapBounds;
    const map = (n: number) => 95 + n * scale;
    c.clearRect(0, 0, 190, 190);
    for (const b of this.city.buildings) {
      const n = NEIGHBORHOODS.find((n) => n.id === b.neighborhood)!;
      c.fillStyle = n.accent + "45";
      c.fillRect(
        map(b.x - b.w / 2),
        map(b.z - b.d / 2),
        b.w * scale,
        b.d * scale,
      );
    }
    c.strokeStyle = "#222bc3";
    c.lineWidth = 1.4;
    for (const s of this.city.plan.streets) {
      c.beginPath();
      c.moveTo(map(s.a[0]), map(s.a[2]));
      c.lineTo(map(s.b[0]), map(s.b[2]));
      c.stroke();
    }
    c.strokeStyle = "#bd782d";
    c.lineWidth = 0.6;
    c.setLineDash([2, 2]);
    for (const link of this.city.roofLinks) {
      const a = this.city.buildings[link.from],
        b = this.city.buildings[link.to];
      c.beginPath();
      c.moveTo(map(a.x), map(a.z));
      c.lineTo(map(b.x), map(b.z));
      c.stroke();
    }
    c.setLineDash([]);
    c.strokeStyle = "#dfa52b";
    c.lineWidth = 2;
    for (const bridge of this.city.bridges) {
      c.beginPath();
      c.moveTo(map(bridge.from[0]), map(bridge.from[2]));
      c.lineTo(map(bridge.to[0]), map(bridge.to[2]));
      c.stroke();
    }
    c.fillStyle = "#dfa52b";
    for (const h of this.player.movingHooks()) {
      c.beginPath();
      c.arc(map(h.position[0]), map(h.position[2]), 2, 0, Math.PI * 2);
      c.fill();
    }
    const p = this.player.position;
    this.drawMapPlayers(c, 0, 0, scale);
    const nearest = this.city.buildings.reduce((a, b) =>
      Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z)
        ? b
        : a,
    );
    $("neighborhood-label").textContent = this.city.arena
      ? nearest.name
      : NEIGHBORHOODS.find((n) => n.id === nearest.neighborhood)!.name;
  }
  updateHUD() {
    if (!this.weaponTest) this.drawCityMap();
    const p = this.player,
      c = this.combat,
      gun = WEAPONS[c.weapon];
    const wave =
      this.mode === "online"
        ? this.network.wave
        : this.mode === "contract" && this.seed !== COUNTY
          ? c.waves.snapshot(c.bots.filter((b) => b.hp > 0).length)
          : null;
    $("notoriety").hidden =
      this.seed !== COUNTY || (this.mode === "online" && this.network.duel);
    if (this.seed === COUNTY) {
      const stars = this.wanted?.stars ?? 0;
      $("wanted-stars").textContent = "★".repeat(stars) + "☆".repeat(MAX_WANTED - stars);
      $("wanted-stars").setAttribute("aria-label", stars + " of " + MAX_WANTED + " stars");
    }
    $("wave-status").textContent = wave
      ? wave.nextIn > 0
        ? `WAVE ${wave.number} CLEARED · Next in ${Math.ceil(wave.nextIn)}s`
        : `WAVE ${wave.number} · ${wave.alive + wave.queued} ENEMIES LEFT`
      : "";
    $("health").textContent = String(Math.ceil(c.hp));
    $("health-fill").style.width = c.hp + "%";
    $("health-fill").style.backgroundColor =
      c.hp < 30 ? "#d23c4530" : "transparent";
    $("speed").textContent = String(Math.round(p.speed));
    const nearby =
      this.seed === COUNTY && this.vehicle < 0 ? this.nearestCar() : -1;
    const door = this.aimedDoor();
    $("action").textContent = this.seatPending
      ? this.vehicle < 0
        ? "ENTERING…"
        : "EXITING…"
      : this.vehicle >= 0
        ? "DRIVING · E EXIT · V CAMERA"
        : door !== undefined
          ? this.structures?.states.get(door) === 1
            ? "E · CLOSE DOOR"
            : "E · OPEN DOOR"
          : nearby >= 0
            ? "E · TAKE " + (this.cars[nearby].cruiser ? "POLICE CRUISER" : this.cars[nearby].kind.toUpperCase())
            : p.action;
    $("speed-fill").style.width = Math.min(100, (p.speed / 35) * 100) + "%";
    $("ammo").textContent = String(c.mags[c.weapon] ?? 0).padStart(2, "0");
    $("mag-size").textContent = String(gun.mag);
    $("reload-label").textContent =
      c.weapon === FISTS
        ? this.seed === COUNTY
          ? "LMB · SLASH"
          : "LMB · PUNCH"
        : c.weapon === KNIFE
          ? "LMB · SLASH"
          : isGrenade(c.weapon)
            ? c.mags[c.weapon]
              ? "LMB · THROW"
              : "USED · SWITCH SLOT"
            : c.reloadTime > 0
              ? "RELOADING…"
              : c.mags[c.weapon] === 0
                ? "EMPTY · R TO RELOAD"
                : `${String(c.weapon + 1).padStart(2, "0")} / ${gun.tag.toUpperCase()} · R RELOAD`;
    $("score").textContent = String(c.score).padStart(4, "0");
    $("timer").textContent = timeLabel(this.elapsed);
    $("hook-fill").style.width = p.stamina * 100 + "%";
    $("air-charge").textContent = p.airActionReady
      ? "AIR CHARGE ●  SPACE double jump / F boost"
      : "AIR CHARGE ○  Land to recharge";
    const eye = p.eye.toArray();
    const now = Date.now();
    const veil = c.effects.reduce((opacity, effect) => {
      if (effect.flight) return opacity;
      const flash = effect.weapon === FLASH;
      const d = distance(eye, effect.p);
      return Math.max(
        opacity,
        d < (flash ? 7 : SMOKE_RADIUS)
          ? Math.min(
              1,
              Math.max(0, (effect.expires - now) / (flash ? 1400 : 400)),
            ) * (flash ? 0.94 : 0.86)
          : 0,
      );
    }, 0);
    $("vision-effect").style.opacity = String(veil);
    $("hurt").style.opacity = String(c.hurt * 0.6);
    $("hitmarker").style.opacity = c.hitTime > 0 ? "1" : "0";
    $("hit-region").style.opacity = c.hitTime > 0 ? "1" : "0";
    $("hit-region").textContent =
      this.weaponTest ? "TARGET" : c.hitRegion === "head"
        ? "HEADSHOT"
        : c.hitRegion === "body"
          ? "BODY"
          : "LIMB";
    $("armory-hint").hidden = !this.armorySpawn || this.vehicle >= 0;
    $("notice").style.opacity = this.time < this.noticeUntil ? "1" : "0";
    $("feed").style.opacity = this.time < this.feedUntil ? "1" : "0";
    const hit = p.grappleHit();
    $("hook-reticle").style.opacity =
      hit && hit.distance > 2 ? String(0.65 * (1 - this.viewMotion.ads)) : "0";
    $("grapple-status").textContent = p.anchor
      ? `${Math.round(p.ropeLength)}m · ${this.input.reel ? "REELING" : "HOLD Q TO REEL"}`
      : hit && hit.distance > 2
        ? `${Math.round(hit.distance)}m · Q TO HOOK${hit.movingId ? " SKY HOOK" : ""}`
        : "";
    this.updateMission();
    const directions = ["N", "NW", "W", "SW", "S", "SE", "E", "NE"],
      angle = ((((p.yaw / (Math.PI * 2)) * 8) % 8) + 8) % 8;
    $("compass").textContent =
      `· · · ${directions[Math.round(angle) % 8]} · · ·`;
    const markers: $Marker[] = [];
    if (this.mode === "contract" && this.seed !== COUNTY) {
      this.city.beacons.forEach((b, i) => {
        if (!this.collected.has(i))
          markers.push({ p: b, label: "0" + (i + 1), icon: "◇" });
      });
      if (this.collected.size === 3 && c.kills >= 6)
        markers.push({ p: this.city.spawns[0], label: "EXTRACT", icon: "↳" });
    }
    $("world-markers").innerHTML = markers
      .map((m) => {
        const point = new T.Vector3(...m.p);
        point.y += 2.2;
        const distance = p.eye.distanceTo(point),
          projection = point.project(this.render.camera);
        if (projection.z > 1 || projection.z < 0) return "";
        return `<div style="left:${T.MathUtils.clamp((projection.x * 0.5 + 0.5) * 100, 3, 97)}%;top:${T.MathUtils.clamp((-projection.y * 0.5 + 0.5) * 100, 15, 80)}%"><b>${m.icon}</b>${m.label} · ${Math.round(distance)}m</div>`;
      })
      .join("");
    const board = $("board");
    const visible = this.keys.has("Tab");
    board.classList.toggle("hidden", !visible);
    if (!visible) return;
    const content = this.sessionBoard();
    if (content !== this.boardContent) {
      board.innerHTML = content;
      this.boardContent = content;
    }
  }
  private sessionBoard() {
    const title = "<h2>Session scoreboard</h2>";
    if (this.mode === "online") {
      const network = this.network;
      const mode = network.duel ? "Duel" : network.public ? "Public game" : "Private room";
      const rows = network.players
        .filter((p) => this.seed !== COUNTY || !p.npc)
        .sort((a, b) => Number(!!a.npc) - Number(!!b.npc) || b.kills - a.kills)
        .map((p) => {
          const self = p.id === network.id;
          const status = p.npc ? "NPC" : p.rating === undefined ? "Guest" : "Signed in";
          return `<tr${self ? ' class="board-self"' : ""}>
            <th scope="row">${escape(p.name)}${self ? " (you)" : ""}<small>${status}</small></th>
            <td>${p.hp > 0 ? Math.ceil(p.hp) + " HP" : "Down"}</td>
            <td>${p.kills}</td><td>${p.deaths}</td><td>${p.rating ?? "—"}</td>
          </tr>`;
        });
      return `${title}<p class="board-mode">${mode} · ${escape(network.code)}</p>
        <table><thead><tr><th>Player</th><th>Status</th><th>Kills</th><th>Deaths</th><th>Elo</th></tr></thead>
        <tbody>${rows.join("")}</tbody></table>`;
    }
    const p = this.player;
    const { name, rating } = this.identity;
    const stats = [
      ["Health", `${Math.ceil(this.combat.hp)} HP`],
      ["Rivals erased", this.combat.kills],
      this.seed === COUNTY
        ? ["Wanted", `${this.wanted?.stars ?? 0} / ${MAX_WANTED} stars`]
        : [this.city.seed === ISLANDS ? "Island marks" : "Rooftop marks", `${this.collected.size} / 3`],
      ["Distance travelled", `${Math.round(p.travel)} m`],
      this.city.arena ? ["Vaults", p.vaults] : ["Vaults / hooks", `${p.vaults} / ${p.hooks}`],
      ["Frame rate", `${this.fps} fps`],
    ];
    return `${title}<p class="board-mode">${this.mode === "roam" ? "Free roam" : "District run"}</p>
      <div class="row"><b>${escape(name)} (you)</b><span>${rating === undefined ? "Guest" : `Signed in · ${rating} Elo`}</span></div>
      ${stats.map(([label, value]) => `<div class="row"><span>${label}</span><b>${value}</b></div>`).join("")}`;
  }
  loop(now: number) {
    const frameSeconds = (now - this.previous) / 1000;
    if (this.state === "play") this.render.adjustCountyResolution(frameSeconds);
    const dt = Math.min(frameSeconds, 0.05);
    this.previous = now;
    this.time += dt;
    this.frames++;
    this.fpsTime += frameSeconds;
    if (this.fpsTime > 1) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
    if (this.state !== "loading") {
      if (this.seed === COUNTY) {
        this.syncSeat();
        if (this.state === "play") this.wreckage?.step(dt);
        this.rubbleView?.update(dt);
      }
      this.accumulator += dt;
      let count = 0;
      while (this.accumulator >= 1 / 120 && count++ < 6) {
        this.step(1 / 120);
        this.accumulator -= 1 / 120;
      }
      if (this.mode === "online" && this.network.active) {
        this.netTick += dt;
        if (this.netTick > 1 / 30) {
          this.netTick = 0;
          this.sendState();
        }
      }
      if (this.seed === COUNTY) {
        this.syncCars(frameSeconds);
        this.render.cityGroup.userData.updateDoors?.(dt);
        this.debris?.update(dt);
        this.casings?.update(dt);
      }
      this.updateVisuals(dt);
      this.combat.renderShots(dt);
      if (this.state !== "menu" && this.frame % 3 === 0) this.updateHUD();
      this.render.draw(
        this.time,
        this.network.active ? this.network.worldTime : Date.now() / 1000,
      );
    }
    this.frame++;
    requestAnimationFrame((t) => this.loop(t));
  }
}
interface $Marker {
  p: V3;
  label: string;
  icon: string;
}
const game = new Game();
if (import.meta.env.DEV) (window as any).__doodles = game;
game.init().catch((e) => {
  console.error(e);
  $("loading").innerHTML =
    '<strong>We couldn’t draw this district.</strong><span>Enable WebGL in your browser, then refresh to try again.</span><button onclick="location.reload()">TRY AGAIN</button>';
});
