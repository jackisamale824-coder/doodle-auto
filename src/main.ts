import { RELEASE_ID } from "./release-info.ts";
import { COUNTY, countyLadders, parkedCars, type CountyCar } from "./county.ts";
import { CoverPeek, peekEye, validatedLean } from "./cover-peek.ts";
import { WeaponClearance } from "./weapon-clearance.ts";
/// <reference types="vite/client" />
import { generateLevel } from "./levels.ts";
import "./style.css";
import * as T from "three";
import { type City, type V3 } from "./world.ts";
import { Controller, Physics, idleInput } from "./physics.ts";
import { Renderer, INK, GOLD, stroke, disposeGroup } from "./render.ts";
import { buildWeapon, Doodle } from "./actors.ts";
import { Combat, WEAPONS } from "./combat.ts";
import { AudioEngine } from "./audio.ts";
import { animateWeaponParts } from "./weapon-motion.ts";
import { ViewMotion, sensitivityScale } from "./motion.ts";
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
  render = new Renderer(canvas);
  audio = new AudioEngine();
  countySelected =
    new URLSearchParams(location.search).get("mode") === "county";
  network = new Network(this.countySelected ? "county" : "dc");
  cars: CountyCar[] = [];
  vehicle = -1;
  carSpeed = 0;
  cockpit = false;
  private cockpitYaw = 0;
  private doorUntil = 0;
  nearestCar() {
    return this.cars.findIndex(
      (c) =>
        !c.driver && this.player.position.distanceTo(new T.Vector3(...c.p)) < 5,
    );
  }
  useCar() {
    const i = this.vehicle >= 0 ? this.vehicle : this.nearestCar();
    if (i < 0) return;
    if (this.mode === "online") {
      this.sendState();
      this.network.send({ type: "vehicle", index: i });
    } else this.cars[i].driver = this.vehicle >= 0 ? null : "local";
  }
  syncCars(dt: number) {
    const mine = this.mode === "online" ? this.network.id : "local";
    const i = this.cars.findIndex((c) => c.driver === mine);
    if (this.vehicle !== i) {
      this.doorUntil = performance.now() + 650;
      this.carSpeed = 0;
      if (i >= 0) {
        this.player.reset(this.cars[i].p);
        this.cockpitYaw = 0;
        this.player.yaw = this.cars[i].yaw;
      } else if (this.vehicle >= 0 && this.combat.hp > 0) {
        const p = this.player;
        this.physics.move(
          p.position,
          new T.Vector3(-Math.cos(p.yaw) * 2.2, 0, Math.sin(p.yaw) * 2.2),
          1.76,
        );
      }
      this.vehicle = i;
    }
    this.render.countyCars.forEach((model, k) => {
      const c = this.cars[k];
      if (!c) return;
      if (k === i) {
        model.position.copy(this.player.position);
        model.rotation.y = this.player.yaw;
      } else if (c.driver) {
        const target = new T.Vector3(...c.p),
          alpha = 1 - Math.exp(-14 * dt);
        if (model.position.distanceToSquared(target) > 400)
          model.position.copy(target);
        else model.position.lerp(target, alpha);
        const angle = c.yaw - model.rotation.y;
        model.rotation.y +=
          Math.atan2(Math.sin(angle), Math.cos(angle)) * alpha;
      } else {
        model.position.fromArray(c.p);
        model.rotation.y = c.yaw;
      }
      model.update(
        c.driver,
        performance.now() / 1000,
        model.position.distanceTo(this.render.camera.position),
        k === i ? this.input.side : 0,
      );
    });
  }
  city!: City;
  physics!: Physics;
  player!: Controller;
  combat!: Combat;
  mode: Mode = "contract";
  soloMode: Mode = "contract";
  publicSelected = true;
  activeLobby: {
    code: string;
    mode: "play" | "duel";
    players: number;
    capacity: number;
  } | null = null;
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
  private lookReady = 0;
  async init() {
    if (new URLSearchParams(location.search).get("level") === "city")
      this.seed = "city:notebook";
    else this.seed = this.countySelected ? COUNTY : "rust";
    this.audio.volume = settings.volume;
    this.render.setQuality(settings.quality);
    $<HTMLInputElement>("seed").value = this.seed;
    await document.fonts.ready;
    await this.build(this.seed, 1);
    const tagline = document.querySelector(".tagline");
    if (tagline && !this.city.arena)
      tagline.textContent = this.countySelected
        ? "SWITCHBACK COUNTY · 30-player open world"
        : "Procedural city · preserved build";
    if (this.countySelected) {
      document.title = "doodlesCreed — Switchback County";
      $("public-mode").textContent = "PUBLIC COUNTY";
      document
        .querySelector(".notebook-footer")
        ?.insertAdjacentHTML(
          "beforeend",
          '<a class="text-button" href="' +
            new URL("models/CREDITS.txt", location.href).pathname +
            '">MODEL CREDITS</a>',
        );
      document
        .querySelector(".grapple-only")
        ?.insertAdjacentHTML(
          "beforebegin",
          "<p><b>E beside a car</b> enter or exit · WASD drive · Space brake</p>",
        );
      document.querySelector<HTMLAnchorElement>(
        'a[href="/?mode=county"]',
      )!.outerHTML =
        '<a class="secondary-button" href="./">RUST · THE OIL YARD</a>';
      this.paintLobbyOptions();
    }
    this.state = "menu";
    $("loading").classList.add("hidden");
    $("menu").classList.remove("hidden");
    this.bind();
    try {
      const restored = await this.network.bootstrap();
      if (restored) {
        this.mode = "online";
        this.state = "loading";
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
    const invite = new URLSearchParams(location.search).get("room");
    if (this.mode !== "online" && invite && /^[A-Z0-9]{5}$/i.test(invite)) {
      this.showOnline();
      $<HTMLInputElement>("room-input").value = invite.toUpperCase();
    }
    requestAnimationFrame((t) => this.loop(t));
  }
  async build(seed: string, district: number, spawn?: V3) {
    if (
      this.mode !== "online" &&
      new URLSearchParams(location.search).get("level") === "city" &&
      !seed.startsWith("city:")
    )
      seed = "city:" + seed;
    const version = ++this.buildVersion;
    const city = generateLevel(seed, district),
      physics = await Physics.create(city.boxes);
    if (version !== this.buildVersion) {
      physics.dispose();
      return;
    }
    this.combat?.dispose();
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
    this.cars = seed === COUNTY ? parkedCars() : [];
    this.vehicle = -1;
    this.carSpeed = 0;
    this.physics = physics;
    this.seed = seed;
    this.district = district;
    await this.render.build(city);
    if (version !== this.buildVersion) return;
    this.player = new Controller(physics, spawn ?? city.spawns[0]);
    this.player.ladders =
      city.arena?.ladders ?? (seed === COUNTY ? countyLadders(city.boxes) : []);
    this.player.grappleEnabled = !city.arena && seed !== COUNTY;
    this.player.jumpHeightScale = city.arena || seed === COUNTY ? 0.85 : 1;
    document.body.classList.toggle(
      "no-grapple",
      !!city.arena || seed === COUNTY,
    );
    if (city.arena)
      this.player.yaw = Math.atan2(
        this.player.position.x + 3,
        this.player.position.z + 3,
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
      this.mode === "contract",
    );
    this.combat.online = this.mode === "online";
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
    this.combat.onFire = () => {
      this.viewMotion.shot(this.combat.weapon);
      if (this.mode === "online") {
        this.sendState();
        this.network.send({ type: "fire" });
      }
    };
    $("building-count").textContent = String(this.city.buildings.length);
    this.collected.clear();
    this.elapsed = 0;
    this.setWeapon(0, true);
    $("district-number").textContent = String(district).padStart(2, "0");
    $("district-stamp")?.setAttribute("data-district", String(district));
  }
  notice(text: string, duration = 1.5) {
    $("notice").textContent = text;
    this.noticeUntil = this.time + duration;
  }
  setWeapon(i: number, force = false) {
    if (!force && !this.combat.switchWeapon(i)) return;
    disposeGroup(this.weaponMesh);
    this.weaponMesh = buildWeapon(i);
    this.render.camera.add(this.weaponMesh);
    $("weapon-name").textContent = WEAPONS[i].name;
    [...$("weapon-slots").children].forEach((el, n) =>
      el.classList.toggle("active", n === i),
    );
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
          ? this.city.arena
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
  showPause(
    title = "TAKE A BREATHER",
    body = "Your next great shortcut is out there.",
  ) {
    this.showDialog(
      `<div class="modal-kicker">DOODLESCREED / ${this.mode === "online" ? "LIVE MATCH" : "PAUSED"}</div><h2>${title}</h2><p>${body}</p>${this.mode === "online" ? `<p>Room <b>${escape(this.network.code)}</b> · The match continues while you pause.</p>` : ""}<button id="resume" class="primary-button">BACK TO THE ROOFTOPS <span>↗</span></button><button id="pause-settings" class="secondary-button">SETTINGS</button><button id="main-menu" class="secondary-button">RETURN TO SKETCHBOOK</button>`,
    );
    $("resume").onclick = () => this.resume();
    $("pause-settings").onclick = () => this.showSettings(true);
    $("main-menu").onclick = () => this.mainMenu();
  }
  mainMenu() {
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
  showDialog(html: string) {
    $("dialog-content").innerHTML = html;
    if (!dialog.open) dialog.showModal();
  }
  closeDialog() {
    if (dialog.open) dialog.close();
  }
  updateMission() {
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
    $("kill-objective").textContent =
      `${this.combat.kills >= 6 ? "✓" : "○"} ${Math.min(6, this.combat.kills)} / 6 RIVALS`;
    $("beacon-objective").textContent =
      `${this.collected.size === 3 ? "✓" : "◇"} ${this.collected.size} / 3 MARKS`;
    $("room-badge").textContent = online
      ? `${this.network.public ? "PUBLIC" : this.network.duel ? "DUEL" : "ROOM"} ${this.network.code} · ${this.network.players.filter((p) => !p.npc).length} PLAYERS · ${Math.round(this.network.rtt)} ms`
      : "";
  }
  bind() {
    $("play").onclick = () => {
      this.district = 1;
      if (this.publicSelected) void this.joinPublic("public");
      else void this.start(this.soloMode);
    };
    $("duel").onclick = () => void this.joinPublic("duel");
    void this.refreshLobbies();
    setInterval(() => {
      if (this.state === "menu") void this.refreshLobbies();
    }, 3000);
    $("public-mode").onclick = () => this.selectPublic();
    $("contract-mode").onclick = () => this.selectMode("contract");
    $("roam-mode").onclick = () => this.selectMode("roam");
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
    $("online").onclick = () => this.showOnline();
    $("close-dialog").onclick = () => {
      if (this.state === "paused") this.resume();
      else if (this.state === "dead" || this.state === "complete")
        this.mainMenu();
      else this.closeDialog();
    };
    dialog.addEventListener("cancel", (e) => {
      if (this.state === "paused") {
        e.preventDefault();
        this.resume();
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.lookReady = performance.now() + 120;
      if (!document.pointerLockElement && this.state === "play") this.pause();
    });
    document.addEventListener("mousemove", (e) => {
      if (
        document.pointerLockElement !== canvas ||
        this.state !== "play" ||
        performance.now() < this.lookReady
      )
        return;
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
      } else this.player.yaw -= e.movementX * sens;
      this.player.pitch = T.MathUtils.clamp(
        this.player.pitch - e.movementY * sens * (settings.invert ? -1 : 1),
        -1.48,
        1.48,
      );
    });
    document.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).matches("input")) return;
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
      if (e.code === "KeyV" && this.vehicle >= 0) {
        this.cockpit = !this.cockpit;
        return;
      }
      if (e.code === "KeyE" && this.seed === COUNTY) {
        this.useCar();
        return;
      }
      if (e.code === "KeyR") this.combat.reload();
      if (/^Digit[1234]$/.test(e.code))
        this.setWeapon(Number(e.code.slice(-1)) - 1);
      if (e.code === "KeyM") {
        this.audio.enabled = !this.audio.enabled;
        this.notice(this.audio.enabled ? "SOUND ON" : "SOUND OFF");
      }
      if (e.code === "KeyH")
        this.notice(
          this.city.arena
            ? "WASD MOVE · SPACE VAULT · C SLIDE"
            : "WASD MOVE · SPACE VAULT · Q GRAPPLE · C SLIDE",
          5,
        );
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    document.addEventListener("mousedown", (e) => {
      if (this.state !== "play" || document.pointerLockElement !== canvas)
        return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (this.state === "play") {
          e.preventDefault();
          this.setWeapon(
            (this.combat.weapon + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) %
              WEAPONS.length,
          );
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
  async refreshLobbies() {
    if (this.checkingLobbies) return;
    this.checkingLobbies = true;
    try {
      const response = await fetch("/lobbies", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      this.activeLobby =
        data.lobbies.find(
          (r: {
            players: number;
            capacity: number;
            seed?: string;
            releaseId?: string;
          }) =>
            (!this.countySelected ||
              !r.releaseId ||
              r.releaseId === RELEASE_ID) &&
            (r.seed === COUNTY) === this.countySelected &&
            r.players > 0 &&
            r.players < r.capacity,
        ) ?? null;
      if (this.publicSelected && this.state === "menu")
        this.paintLobbyOptions();
    } catch {
      /* Keep Play/Duel usable during a temporary status failure. */
    } finally {
      this.checkingLobbies = false;
    }
  }
  paintLobbyOptions() {
    if ($<HTMLButtonElement>("play").disabled) return;
    const lobby = this.activeLobby;
    $("duel").classList.toggle("hidden", !this.publicSelected);
    $("play").innerHTML = this.countySelected
      ? "<span>PLAY</span><small>COUNTY · players + NPCs</small>"
      : "<span>PLAY</span><small>RUST · players + NPCs</small>";
    let join = document.getElementById(
      "existing-lobby",
    ) as HTMLButtonElement | null;
    if (!join) {
      join = document.createElement("button");
      join.id = "existing-lobby";
      join.className = "secondary-button";
      $("play").after(join);
    }
    join.classList.toggle("hidden", !lobby || !this.publicSelected);
    join.textContent = lobby
      ? `JOIN LOBBY · ${lobby.players}/${lobby.capacity} PLAYERS`
      : "JOIN LOBBY";
    join.onclick = () => {
      if (lobby)
        void this.joinPublic(
          lobby.mode === "duel" ? "duel" : "public",
          lobby.code,
        );
    };
  }
  selectPublic() {
    this.publicSelected = true;
    $("public-mode").classList.add("selected");
    $("public-mode").setAttribute("aria-pressed", "true");
    for (const id of ["contract-mode", "roam-mode"]) {
      $(id).classList.remove("selected");
      $(id).setAttribute("aria-pressed", "false");
    }
    this.paintLobbyOptions();
    void this.refreshLobbies();
  }
  async joinPublic(mode: "public" | "duel" = "public", code?: string) {
    const button = $<HTMLButtonElement>("play");
    button.disabled = true;
    $<HTMLButtonElement>("duel").disabled = true;
    button.innerHTML =
      "<span>JOINING…</span><small>finding your public city</small>";
    try {
      const welcome = await this.network.connect(
        code ? "join" : mode,
        String(safeRead("dc.name", "Runner")),
        this.countySelected ? COUNTY : "",
        code ?? "",
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
            : "WELCOME TO RUST",
        2,
      );
    } catch (error) {
      this.network.disconnect();
      this.state = "menu";
      this.showDialog(
        `<h2>Couldn’t join the city.</h2><p>${escape((error as Error).message)}</p><button id="public-retry" class="primary-button">TRY AGAIN</button>`,
      );
      $("public-retry").onclick = () => {
        this.closeDialog();
        void this.joinPublic(mode);
      };
    } finally {
      button.disabled = false;
      $<HTMLButtonElement>("duel").disabled = false;
      this.selectPublic();
    }
  }
  selectMode(mode: "contract" | "roam") {
    this.publicSelected = false;
    document.getElementById("existing-lobby")?.classList.add("hidden");
    $("duel").classList.add("hidden");
    $("public-mode").classList.remove("selected");
    $("public-mode").setAttribute("aria-pressed", "false");
    $("play").innerHTML =
      "<span>PLAY SOLO</span><small>your own " +
      (mode === "roam" ? "practice city" : "district run") +
      "</small>";
    this.soloMode = mode;
    $("contract-mode").classList.toggle("selected", mode === "contract");
    $("roam-mode").classList.toggle("selected", mode === "roam");
    $("contract-mode").setAttribute(
      "aria-pressed",
      String(mode === "contract"),
    );
    $("roam-mode").setAttribute("aria-pressed", String(mode === "roam"));
  }
  showHelp() {
    this.showDialog(
      `<div class="modal-kicker">A FIELD GUIDE TO THE ROOFTOPS</div><h2>Keep your momentum.</h2><p>${this.seed === COUNTY ? "Climb building ladders, vault barriers or approach a car and press E to drive. Press E again to get out." : this.city.arena ? "Climb the tower ladders, vault low walls, and use double jumps and air boosts to navigate Rust." : "Every building has an open front door and stairs to the roof. Swing across streets, vault low walls, and run alongside walls in the air."}</p><div class="help-grid"><kbd>W A S D</kbd><span>Move · Mouse to look</span><kbd>SHIFT</kbd><span>Sprint and build speed</span><kbd>SPACE</kbd><span>Jump · Vault · Mantle · Wall jump</span><kbd>C / CTRL</kbd><span>Crouch · Slide while sprinting</span>${!this.player.grappleEnabled ? "" : "<kbd>Q / E</kbd><span>Tap to hook / release · Hold to reel in</span><kbd>SPACE</kbd><span>Launch while grappling</span>"}<kbd>LMB / RMB</kbd><span>Fire / Aim down sights</span><kbd>1 2 3 4 / WHEEL</kbd><span>Rifle · Shotgun · Pistol · Sniper</span><kbd>SPACE / F in air</kbd><span>Double jump / directional boost · one shared charge per landing</span><kbd>R</kbd><span>Reload (unlimited reserve ammo)</span><kbd>ESC / TAB</kbd><span>Pause / Scoreboard</span></div><p>District run: erase six rivals, collect the three gold marks on rooftops, then return to the starting plaza. Free roam is a combat-free practice city.</p><button id="help-done" class="primary-button">GOT IT. LET’S GO. <span>↗</span></button>`,
    );
    $("help-done").onclick = () => this.closeDialog();
  }
  showSettings(paused = false) {
    this.showDialog(
      `<div class="modal-kicker">MAKE YOURSELF AT HOME</div><h2>Your kind of flow.</h2><label for="sensitivity">LOOK SENSITIVITY <span id="sensitivity-value">${settings.sensitivity.toFixed(1)}</span></label><input id="sensitivity" type="range" min=".2" max="2.5" step=".1" value="${settings.sensitivity}"><label for="fov">FIELD OF VIEW <span id="fov-value">${settings.fov}°</span></label><input id="fov" type="range" min="65" max="105" value="${settings.fov}"><label for="volume">SOUND VOLUME</label><input id="volume" type="range" min="0" max="1" step=".05" value="${settings.volume}"><label><input id="reduced" type="checkbox" ${settings.reduced ? "checked" : ""}> REDUCE CAMERA MOTION</label><label><input id="invert" type="checkbox" ${settings.invert ? "checked" : ""}> INVERT VERTICAL LOOK</label><label><input id="quality" type="checkbox" ${settings.quality ? "checked" : ""}> HIGH RESOLUTION RENDERING</label><button id="settings-done" class="primary-button">SAVE & RETURN <span>↗</span></button>`,
    );
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
      `<div class="modal-kicker">BETTER WITH A LITTLE COMPETITION</div><h2>Meet on the rooftops.</h2><p>Create a district and share its room code. Everyone gets the same city. Eight runners, three weapons, first to 15.</p><label for="player-name">YOUR NAME</label><input id="player-name" maxlength="16" value="${escape(safeRead("dc.name", "Runner"))}" placeholder="Runner"><button id="create-room" class="primary-button">CREATE A ROOM <span>↗</span></button><div class="room-divider">OR JOIN YOUR FRIENDS</div><label for="room-input">ROOM CODE</label><input id="room-input" maxlength="5" placeholder="ABCDE" style="text-transform:uppercase;letter-spacing:5px"><button id="join-room" class="secondary-button">JOIN ROOM</button><p id="network-error" class="error" role="alert"></p>`,
    );
    $("create-room").onclick = () => void this.join("create");
    $("join-room").onclick = () => void this.join("join");
  }
  async join(type: "create" | "join") {
    const name = $<HTMLInputElement>("player-name").value.trim() || "Runner",
      code = $<HTMLInputElement>("room-input").value.trim();
    if (type === "join" && code.length !== 5) {
      $("network-error").textContent = "Enter the five-character room code.";
      return;
    }
    localStorage.setItem("dc.name", JSON.stringify(name));
    $<HTMLButtonElement>("create-room").disabled = true;
    $<HTMLButtonElement>("join-room").disabled = true;
    $("network-error").textContent = "Drawing a shared district…";
    try {
      const welcome = await this.network.connect(
        type,
        name,
        $<HTMLInputElement>("seed").value || "notebook",
        code,
      );
      $<HTMLInputElement>("seed").value = welcome.seed;
      this.mode = "online";
      this.state = "loading";
      await this.build(welcome.seed, 1, welcome.spawn);
      $("menu").classList.add("hidden");
      $("hud").classList.remove("hidden");
      this.updateMission();
      this.state = "paused";
      this.showDialog(
        `<div class="modal-kicker">YOUR DISTRICT IS READY</div><h2>Room for a little chaos.</h2><p>Share this code with your friends. They can join while you play.</p><div class="room-code">${escape(welcome.code)}</div><button id="copy-invite" class="primary-button">COPY INVITE LINK ↗</button><input id="invite-link" aria-label="Shareable invite link" readonly value="${escape(location.origin + "/?room=" + welcome.code)}"><button id="copy-room" class="secondary-button">COPY ROOM CODE</button><button id="enter-room" class="primary-button">ENTER MATCH <span>↗</span></button>`,
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
    }
  }
  applyResume(m: any) {
    const player = m.player || m;
    const stamina = this.player.stamina;
    this.player.reset(player.p || m.p);
    this.player.stamina = stamina;
    this.player.height = player.height ?? 1.76;
    this.player.yaw = player.yaw ?? this.player.yaw;
    this.player.pitch = player.pitch ?? this.player.pitch;
    this.combat.hp = player.hp;
    this.combat.kills = player.kills;
    this.combat.score = player.kills * 100;
    this.combat.mags = m.mags || player.mags;
    this.combat.reloadTime = Math.max(
      0,
      (m.reloadRemaining ?? player.reloadRemaining ?? 0) / 1000,
    );
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
      this.state = "paused";
      this.showPause(
        "BACK IN YOUR MATCH",
        "Your connection is restored. Continue when you are ready.",
      );
    }
  }
  onNetwork(m: any) {
    if (m.type === "snapshot" && m.cars && this.seed === COUNTY)
      this.cars = m.cars;
    if (
      m.type === "resumed" &&
      this.mode === "online" &&
      this.state !== "loading"
    )
      this.applyResume(m);
    if (m.type === "reconnecting" && this.mode === "online") {
      this.state = "paused";
      this.keys.clear();
      this.firing = false;
      this.aiming = false;
      document.exitPointerLock();
      this.showDialog(
        '<div class="modal-kicker">RECONNECTING</div><h2>Finding your way back…</h2><p>Your match is continuing. Reconnecting to your runner.</p><button id="reconnect-menu" class="secondary-button">RETURN TO SKETCHBOOK</button>',
      );
      $("reconnect-menu").onclick = () => this.mainMenu();
    }
    if (m.type === "impact") {
      this.remotes.get(m.id)?.react(m.region, m.side, m.damage);
      if (m.id === this.network.id)
        this.combat.hurt = Math.max(this.combat.hurt, 0.65);
    }
    if (m.type === "snapshot" && this.mode === "online") {
      const me = m.players.find((p: any) => p.id === this.network.id);
      if (me) {
        if (me.hp < this.combat.hp) this.combat.hurt = 0.8;
        this.combat.hp = me.hp;
        this.combat.kills = me.kills;
        this.combat.score = me.kills * 100;
      }
      for (const p of m.players)
        if (p.id !== this.network.id && !this.remotes.has(p.id)) {
          const model = new Doodle(
            p.npc ? "#d23c45" : "#347a75",
            p.npc ? undefined : p.name,
          );
          model.group.position.fromArray(p.p);
          this.render.scene.add(model.group);
          this.remotes.set(p.id, model);
        }
      for (const [id, model] of this.remotes)
        if (!m.players.some((p: any) => p.id === id)) {
          model.dispose();
          this.remotes.delete(id);
        }
      const winner = m.players.find((p: any) => p.kills >= 15);
      if (!this.network.public && winner && this.state !== "complete")
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
      this.player.position.fromArray(m.p);
      this.player.velocity.set(0, 0, 0);
    }
    if (m.type === "ammo") {
      this.combat.mags = m.mags;
      this.combat.reloadTime = Math.max(0, m.reloadRemaining / 1000);
    }
    if (m.type === "respawn") {
      this.player.reset(m.p);
      this.combat.hp = 100;
      this.combat.mags = WEAPONS.map((g) => g.mag);
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
    this.network.send({
      type: "state",
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
  }
  finish(win = false, winner = "") {
    this.state = win ? "complete" : "dead";
    this.keys.clear();
    this.firing = false;
    document.exitPointerLock();
    this.audio.tone(win ? 820 : 160, 0.4, "triangle", 0.2, win ? 1000 : 55);
    const best = Math.max(this.combat.score, Number(safeRead("dc.best", 0)));
    localStorage.setItem("dc.best", JSON.stringify(best));
    const online = this.mode === "online";
    this.showDialog(
      `<div class="modal-kicker">${win ? "A PAGE WORTH KEEPING" : "THERE’S ALWAYS ANOTHER BLANK PAGE"}</div><h2>${win ? (online ? escape(winner) + " wins." : "District, signed.") : "Erased. Not forgotten."}</h2><p>${win ? "You left your mark on the city." : online ? "Catch your breath. You can rejoin the fight in a moment." : this.city.arena ? "Keep moving, climb the tower, and use cover to break the crossfire." : "Try a rooftop route, keep moving, and use your grapple to get above the crossfire."}</p><div class="result-stats"><div><b>${this.combat.kills}</b><span>RIVALS ERASED</span></div><div><b>${this.combat.score}</b><span>STYLE POINTS</span></div><div><b>${timeLabel(this.elapsed)}</b><span>TIME IN DISTRICT</span></div></div>${online && win ? "" : `<button id="retry" class="primary-button">${win ? "DRAW THE NEXT DISTRICT" : online ? "RESPAWN" : "TRY ANOTHER LINE"} <span>↗</span></button>`}<button id="finish-menu" class="secondary-button">RETURN TO SKETCHBOOK</button>`,
    );
    if ($("retry")) {
      if (online) {
        const button = $<HTMLButtonElement>("retry");
        button.disabled = true;
        setTimeout(() => {
          if (button.isConnected) {
            button.disabled = false;
          }
        }, 2500);
      }
      $("retry").onclick = () => {
        if (online) this.network.send({ type: "respawn" });
        else {
          if (win) this.district++;
          void this.start(this.mode);
        }
      };
    }
    $("finish-menu").onclick = () => this.mainMenu();
  }
  step(dt: number) {
    if (this.state !== "play") return;
    this.elapsed += dt;
    const held = (...keys: string[]) => keys.some((k) => this.keys.has(k));
    const input = {
      forward:
        Number(held("KeyW", "ArrowUp")) - Number(held("KeyS", "ArrowDown")),
      side:
        Number(held("KeyD", "ArrowRight")) - Number(held("KeyA", "ArrowLeft")),
      sprint: held("ShiftLeft", "ShiftRight"),
      crouch: held("KeyC", "ControlLeft"),
      jump: held("Space"),
      grapple: held("KeyQ", "KeyE"),
      reel: held("KeyQ", "KeyE"),
      boost: held("KeyF"),
    };
    this.input = input;
    const action = this.player.action,
      hooks = this.player.hooks;
    const previousBodyY = this.player.position.y;
    if (this.vehicle >= 0) {
      const p = this.player;
      this.carSpeed =
        T.MathUtils.clamp(
          this.carSpeed +
            (performance.now() >= this.doorUntil ? input.forward : 0) * 17 * dt,
          -12,
          40,
        ) * Math.exp(-dt * (input.jump ? 5 : input.forward ? 0.12 : 0.7));
      p.yaw -=
        input.side *
        1.6 *
        dt *
        Math.min(1, Math.abs(this.carSpeed) / 6) *
        Math.sign(this.carSpeed);
      p.velocity.set(
        -Math.sin(p.yaw) * this.carSpeed,
        0,
        -Math.cos(p.yaw) * this.carSpeed,
      );
      const delta = p.velocity.clone().multiplyScalar(dt);
      delta.y = -0.12;
      const result = this.physics.move(p.position, delta, 1.5);
      if (result.wall) this.carSpeed = 0;
      p.action = "DRIVING";
      p.grounded = result.grounded;
      this.aiming = false;
      if (this.mode !== "online") {
        this.cars[this.vehicle].p = p.position.toArray();
        this.cars[this.vehicle].yaw = p.yaw;
      }
    } else this.player.update(dt, input);
    const nearGround =
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
    if (this.vehicle < 0 && this.firing && !this.player.traversing)
      this.combat.fire();
    this.combat.update(dt, this.time, this.render.camera);
    if (this.player.grounded) this.audio.step(this.time, this.player.speed);
    if (
      Math.abs(this.player.position.x) > this.city.bounds ||
      Math.abs(this.player.position.z) > this.city.bounds ||
      this.player.position.y < -6
    ) {
      this.player.reset(this.city.spawns[0]);
      this.notice("BACK INSIDE THE MARGINS");
    }
    if (this.mode === "contract") {
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
          this.notice("ROOFTOP MARK +300", 2);
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
        this.city.arena ? 26 : 29,
        50 + Math.cos(t) * 4,
      );
      cam.lookAt(this.seed === COUNTY ? -320 : -4, 3, 0);
      cam.fov = 58;
      cam.updateProjectionMatrix();
      this.weaponMesh.visible = false;
      return;
    }
    const motion = settings.reduced ? 0 : 1;
    const v = this.viewMotion;
    v.trackHeight(p.eye.y, p.grounded, p.resetRevision, 0);
    v.update(
      dt,
      this.aiming && !p.traversing && this.combat.reloadTime <= 0,
      p.speed,
      p.grounded,
      settings.reduced,
      settings.fov,
      this.combat.weapon === 3 ? 22 : 57,
    );
    const steady = (1 - v.ads * 0.85) * (1 - v.fireWeight * 0.7) * motion;
    const recoil = v.kick * (1 - v.ads * 0.5) * motion;
    const peek = this.coverPeek.update(
      dt,
      p.eye.toArray() as V3,
      p.yaw,
      p.pitch,
      this.aiming && !p.traversing && this.combat.reloadTime <= 0,
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
    if (this.vehicle >= 0) {
      cam.position
        .copy(p.position)
        .add(new T.Vector3(Math.sin(p.yaw) * 6, 3.1, Math.cos(p.yaw) * 6));
      cam.lookAt(p.position.clone().add(new T.Vector3(0, 1, 0)));
    }
    if (this.vehicle >= 0 && this.cockpit) {
      const seat = new T.Vector3(-0.345, 0.99, 0.075).applyAxisAngle(
        new T.Vector3(0, 1, 0),
        p.yaw,
      );
      cam.position.copy(p.position).add(seat);
      cam.rotation.set(p.pitch, p.yaw + this.cockpitYaw, 0, "YXZ");
    }
    cam.fov = v.fov;
    cam.updateProjectionMatrix();
    const scoped =
      this.combat.weapon === 3 ? T.MathUtils.smoothstep(v.ads, 0.65, 0.98) : 0;
    $("sniper-scope").style.opacity = String(scoped);
    $("crosshair").style.opacity = String(1 - scoped);
    this.weaponMesh.visible =
      this.vehicle < 0 && this.combat.hp > 0 && scoped < 0.98;
    const reloadProgress =
      this.combat.reloadTime > 0
        ? 1 - this.combat.reloadTime / WEAPONS[this.combat.weapon].reload
        : 0;
    const reload = animateWeaponParts(
      this.weaponMesh,
      this.combat.weapon,
      reloadProgress,
      recoil,
    );
    const reloadScale = settings.reduced ? 0.35 : 1;
    const vaultPose = Math.sin(Math.PI * p.traversalProgress);
    // One camera-local pose: stride, restrained look sway, then shared shot impulse.
    this.weaponMesh.position.set(
      0.3 * (1 - v.ads) + v.swayX * steady + reload.x * reloadScale,
      T.MathUtils.lerp(
        -0.3,
        this.combat.weapon === 0 ? -0.0816 : -0.046,
        v.ads,
      ) +
        v.bob * 0.35 +
        v.swayY * steady -
        -reload.y * reloadScale -
        vaultPose * 0.14,
      T.MathUtils.lerp(this.combat.weapon === 2 ? -0.38 : -0.68, -0.72, v.ads) +
        recoil * 0.035,
    );
    this.weaponMesh.rotation.set(
      reload.pitch * reloadScale + recoil * 0.04 - vaultPose * 0.3,
      -0.04 * (1 - v.ads),
      reload.roll * reloadScale +
        v.bob * 0.3 -
        vaultPose * 0.22 +
        this.combat.hurt * (settings.reduced ? 0.01 : 0.045),
    );
    const clearance = this.weaponClearance.update(
      dt,
      cam.position,
      cam.quaternion,
      this.combat.weapon,
      v.ads,
      this.physics.ray.bind(this.physics),
    );
    // Apply last, after reload/ADS/recoil; only the viewmodel is raised.
    this.weaponMesh.rotation.x += clearance.pitch;
    this.weaponMesh.position.z += clearance.retract;
    this.weaponMesh.position.y -= clearance.lower;
    this.weaponMesh.scale.setScalar(0.68);
    if (!this.rope) {
      this.rope = new GrappleVisual();
      this.render.scene.add(this.rope);
    }
    this.rope.update(p, this.render.camera, dt);
    for (const state of this.network.players) {
      const model = this.remotes.get(state.id);
      if (!model) continue;
      model.group.visible =
        state.hp > 0 &&
        !this.cars.some((c) => c.driver === state.id) &&
        (!state.npc ||
          this.player.position.distanceTo(new T.Vector3(...state.p)) <=
            NPC_RADIUS);
      const target = new T.Vector3(...this.network.position(state)),
        dist = model.group.position.distanceTo(target);
      if (dist > 6) model.group.position.copy(target);
      else model.group.position.lerp(target, 1 - Math.exp(-dt * 35));
      const desiredYaw = state.yaw + Math.PI;
      const turn = Math.atan2(
        Math.sin(desiredYaw - model.group.rotation.y),
        Math.cos(desiredYaw - model.group.rotation.y),
      );
      model.group.rotation.y += turn * (1 - Math.exp(-dt * 24));
      model.animate(this.time, this.network.speed(state), cam, state.pitch, dt);
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
    for (const [id, line] of this.remoteRopes)
      if (!this.remotes.has(id)) {
        this.render.scene.remove(line);
        line.geometry.dispose();
        (line.material as T.Material).dispose();
        this.remoteRopes.delete(id);
      }
  }
  drawCityMap() {
    const canvas = $<HTMLCanvasElement>("city-map"),
      c = canvas.getContext("2d")!;
    const mapBounds = this.city.arena
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
    if (this.seed === COUNTY) {
      c.fillStyle = "#222bc340";
      for (const box of this.city.boxes)
        if (box.kind === "building")
          c.fillRect(
            map(box.p[0] - box.s[0] / 2),
            map(box.p[2] - box.s[2] / 2),
            box.s[0] * scale,
            box.s[2] * scale,
          );
    }
    const p = this.player.position;
    c.save();
    c.translate(map(p.x), map(p.z));
    c.rotate(-this.player.yaw);
    c.fillStyle = "#d23c45";
    c.beginPath();
    c.moveTo(0, -5);
    c.lineTo(4, 4);
    c.lineTo(0, 2);
    c.lineTo(-4, 4);
    c.closePath();
    c.fill();
    c.restore();
    if (this.seed === COUNTY) {
      $("neighborhood-label").textContent =
        Math.abs(p.z) > 145
          ? "Highlands"
          : p.x < -160
            ? "Westhaven"
            : p.x > 160
              ? "Eastbank"
              : "County Highway";
      return;
    }
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
    this.drawCityMap();
    const p = this.player,
      c = this.combat,
      gun = WEAPONS[c.weapon];
    const wave =
      this.mode === "online"
        ? this.network.wave
        : this.mode === "contract"
          ? c.waves.snapshot(c.bots.filter((b) => b.hp > 0).length)
          : null;
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
    $("action").textContent =
      this.vehicle >= 0
        ? "DRIVING · E EXIT · V CAMERA"
        : this.seed === COUNTY && this.nearestCar() >= 0
          ? "E · ENTER CAR"
          : p.action;
    $("speed-fill").style.width = Math.min(100, (p.speed / 35) * 100) + "%";
    $("ammo").textContent = String(c.mags[c.weapon]).padStart(2, "0");
    $("mag-size").textContent = String(gun.mag);
    $("reload-label").textContent =
      c.reloadTime > 0
        ? "RELOADING…"
        : c.mags[c.weapon] === 0
          ? "EMPTY · R TO RELOAD"
          : gun.tag + " · R RELOAD";
    $("score").textContent = String(c.score).padStart(4, "0");
    $("timer").textContent = timeLabel(this.elapsed);
    $("hook-fill").style.width = p.stamina * 100 + "%";
    $("air-charge").textContent = p.airActionReady
      ? "AIR CHARGE ●  SPACE double jump / F boost"
      : "AIR CHARGE ○  Land to recharge";
    $("hurt").style.opacity = String(c.hurt * 0.6);
    $("hitmarker").style.opacity = c.hitTime > 0 ? "1" : "0";
    $("hit-region").style.opacity = c.hitTime > 0 ? "1" : "0";
    $("hit-region").textContent =
      c.hitRegion === "head"
        ? "HEADSHOT"
        : c.hitRegion === "body"
          ? "BODY"
          : "LIMB";
    $("notice").style.opacity = this.time < this.noticeUntil ? "1" : "0";
    $("feed").style.opacity = this.time < this.feedUntil ? "1" : "0";
    const hit = p.grappleHit();
    $("hook-reticle").style.opacity = hit && hit.distance > 2 ? "0.65" : "0";
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
    if (this.mode === "contract") {
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
    board.classList.toggle("hidden", !this.keys.has("Tab"));
    if (this.keys.has("Tab"))
      board.innerHTML =
        this.mode === "online"
          ? `<h2>Rooftop roll call</h2>${[...this.network.players]
              .sort((a, b) => b.kills - a.kills)
              .map(
                (r) =>
                  `<div class="row"><span>${escape(r.name)}${r.id === this.network.id ? " (you)" : ""}</span><b>${r.kills} / ${r.deaths}</b></div>`,
              )
              .join("")}`
          : `<h2>Your field notes</h2><div class="row"><span>Rivals erased</span><b>${c.kills}</b></div><div class="row"><span>Rooftop marks</span><b>${this.collected.size} / 3</b></div><div class="row"><span>Distance travelled</span><b>${Math.round(p.travel)} m</b></div><div class="row"><span>${this.city.arena ? "Vaults" : "Vaults / hooks"}</span><b>${this.city.arena ? p.vaults : `${p.vaults} / ${p.hooks}`}</b></div><div class="row"><span>Frame rate</span><b>${this.fps} fps</b></div>`;
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
      if (this.seed === COUNTY) this.syncCars(frameSeconds);
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
