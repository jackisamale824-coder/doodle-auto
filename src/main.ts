/// <reference types="vite/client" />
import "./style.css";
import * as T from "three";
import { generateCity, type City, type V3 } from "./world.ts";
import { Controller, Physics, idleInput } from "./physics.ts";
import { Renderer, INK, GOLD, stroke, disposeGroup } from "./render.ts";
import { buildWeapon, Doodle } from "./actors.ts";
import { Combat, WEAPONS } from "./combat.ts";
import { AudioEngine } from "./audio.ts";
import { Network } from "./network.ts";
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
  network = new Network();
  city!: City;
  physics!: Physics;
  player!: Controller;
  combat!: Combat;
  mode: Mode = "contract";
  soloMode: Mode = "contract";
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
  weaponMesh = new T.Group();
  rope: T.Mesh | null = null;
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
    this.audio.volume = settings.volume;
    this.render.setQuality(settings.quality);
    $<HTMLInputElement>("seed").value = this.seed;
    await document.fonts.ready;
    await this.build(this.seed, 1);
    this.state = "menu";
    $("loading").classList.add("hidden");
    $("menu").classList.remove("hidden");
    this.bind();
    requestAnimationFrame((t) => this.loop(t));
  }
  async build(seed: string, district: number, spawn?: V3) {
    const version = ++this.buildVersion;
    const city = generateCity(seed, district),
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
    this.physics = physics;
    this.seed = seed;
    this.district = district;
    this.render.build(city);
    this.player = new Controller(physics, spawn ?? city.spawns[0]);
    this.combat = new Combat(
      this.render.scene,
      city,
      this.player,
      this.audio,
      this.mode === "contract",
    );
    this.combat.online = this.mode === "online";
    this.combat.onNotice = (s) => this.notice(s);
    this.combat.onFire = () => {
      if (this.mode === "online") {
        this.sendState();
        this.network.send({ type: "fire" });
      }
    };
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
          ? "THE CITY IS YOURS"
          : mode === "online"
            ? "FREE FOR ALL"
            : "MAKE YOUR MARK",
        3,
      );
      this.updateMission();
    } finally {
      this.busy = false;
    }
  }
  resume() {
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
      ? "FREE FOR ALL"
      : roam
        ? "FREE ROAM"
        : "THE PAPER DISTRICT";
    $("mission-title").textContent = online
      ? "MAKE EVERY SHOT COUNT"
      : roam
        ? "FIND YOUR OWN WAY"
        : ready
          ? "BACK TO THE START"
          : "LEAVE YOUR MARK";
    $("mission").textContent = online
      ? "First to 15 eliminations · TAB for the scoreboard"
      : roam
        ? "No rivals. No objectives. Just you and the skyline."
        : ready
          ? "Reach the starting plaza to draw the next district."
          : "Erase 6 rivals · Find 3 rooftop marks";
    $("mission-progress").style.display = online || roam ? "none" : "flex";
    $("kill-objective").textContent =
      `${this.combat.kills >= 6 ? "✓" : "○"} ${Math.min(6, this.combat.kills)} / 6 RIVALS`;
    $("beacon-objective").textContent =
      `${this.collected.size === 3 ? "✓" : "◇"} ${this.collected.size} / 3 MARKS`;
    $("room-badge").textContent = online ? "ROOM " + this.network.code : "";
  }
  bind() {
    $("play").onclick = () => {
      this.district = 1;
      void this.start(this.soloMode);
    };
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
      const sens = 0.002 * settings.sensitivity * (this.aiming ? 0.6 : 1);
      this.player.yaw -= e.movementX * sens;
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
      if (e.code === "KeyR") this.combat.reload();
      if (/^Digit[123]$/.test(e.code))
        this.setWeapon(Number(e.code.slice(-1)) - 1);
      if (e.code === "KeyM") {
        this.audio.enabled = !this.audio.enabled;
        this.notice(this.audio.enabled ? "SOUND ON" : "SOUND OFF");
      }
      if (e.code === "KeyH")
        this.notice("WASD MOVE · SPACE VAULT · Q GRAPPLE · C SLIDE", 5);
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
          this.setWeapon((this.combat.weapon + (e.deltaY > 0 ? 1 : 2)) % 3);
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
  selectMode(mode: "contract" | "roam") {
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
      `<div class="modal-kicker">A FIELD GUIDE TO THE ROOFTOPS</div><h2>Keep your momentum.</h2><p>Every building has an open front door and stairs to the roof. Swing across streets, vault low walls, and run alongside walls in the air.</p><div class="help-grid"><kbd>W A S D</kbd><span>Move · Mouse to look</span><kbd>SHIFT</kbd><span>Sprint and build speed</span><kbd>SPACE</kbd><span>Jump · Vault · Mantle · Wall jump</span><kbd>C / CTRL</kbd><span>Crouch · Slide while sprinting</span><kbd>Q / E</kbd><span>Tap to hook / release · Hold to reel in</span><kbd>SPACE</kbd><span>Launch while grappling</span><kbd>LMB / RMB</kbd><span>Fire / Aim down sights</span><kbd>1 2 3 / WHEEL</kbd><span>Rifle · Shotgun · Pistol</span><kbd>R</kbd><span>Reload (unlimited reserve ammo)</span><kbd>ESC / TAB</kbd><span>Pause / Scoreboard</span></div><p>District run: erase six rivals, collect the three gold marks on rooftops, then return to the starting plaza. Free roam is a combat-free practice city.</p><button id="help-done" class="primary-button">GOT IT. LET’S GO. <span>↗</span></button>`,
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
        `<div class="modal-kicker">YOUR DISTRICT IS READY</div><h2>Room for a little chaos.</h2><p>Share this code with your friends. They can join while you play.</p><div class="room-code">${escape(welcome.code)}</div><button id="copy-room" class="secondary-button">COPY ROOM CODE</button><button id="enter-room" class="primary-button">ENTER MATCH <span>↗</span></button>`,
      );
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
  onNetwork(m: any) {
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
          const model = new Doodle("#347a75", p.name);
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
      if (winner && this.state !== "complete") this.finish(true, winner.name);
    }
    if (m.type === "shot" && m.id !== this.network.id)
      this.combat.tracer(
        new T.Vector3(...m.from),
        new T.Vector3(...m.to),
        "#347a75",
      );
    if (m.type === "hit") {
      this.combat.hitTime = 0.2;
      this.audio.hit(m.kill);
      if (m.kill) this.notice("RIVAL ERASED +100");
    }
    if (m.type === "kill") {
      $("feed").textContent = `${m.by} erased ${m.victim}`;
      this.feedUntil = this.time + 5;
    }
    if (m.type === "correction") this.player.position.fromArray(m.p);
    if (m.type === "respawn") {
      this.player.reset(m.p);
      this.combat.hp = 100;
      this.combat.mags = [30, 8, 14];
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
    this.network.send({
      type: "state",
      p: this.player.position.toArray(),
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      weapon: this.combat.weapon,
      height: this.player.height,
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
      `<div class="modal-kicker">${win ? "A PAGE WORTH KEEPING" : "THERE’S ALWAYS ANOTHER BLANK PAGE"}</div><h2>${win ? (online ? escape(winner) + " wins." : "District, signed.") : "Erased. Not forgotten."}</h2><p>${win ? "You left your mark on the city." : online ? "Catch your breath. You can rejoin the fight in a moment." : "Try a rooftop route, keep moving, and use your grapple to get above the crossfire."}</p><div class="result-stats"><div><b>${this.combat.kills}</b><span>RIVALS ERASED</span></div><div><b>${this.combat.score}</b><span>STYLE POINTS</span></div><div><b>${timeLabel(this.elapsed)}</b><span>TIME IN DISTRICT</span></div></div>${online && win ? "" : `<button id="retry" class="primary-button">${win ? "DRAW THE NEXT DISTRICT" : online ? "RESPAWN" : "TRY ANOTHER LINE"} <span>↗</span></button>`}<button id="finish-menu" class="secondary-button">RETURN TO SKETCHBOOK</button>`,
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
    };
    this.input = input;
    const action = this.player.action,
      hooks = this.player.hooks;
    this.player.update(dt, input);
    if (this.player.hooks > hooks) {
      this.audio.tone(600, 0.15, "triangle", 0.14, 220);
      this.notice("HOOKED", 0.6);
    }
    if (
      this.player.action !== action &&
      ["VAULT", "MANTLE", "WALL RUN", "WALL JUMP", "RELEASE"].includes(
        this.player.action,
      )
    ) {
      this.notice(this.player.action, 0.8);
      this.audio.tone(260, 0.1, "sine", 0.08, 450);
      if (this.mode !== "online") this.combat.score += 10;
    }
    if (this.firing) this.combat.fire();
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
          this.render.beaconMeshes[i].visible = false;
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
      if (this.rope) this.rope.visible = false;
      const t = settings.reduced ? 0 : this.time * 0.025;
      cam.position.set(46 + Math.sin(t) * 5, 29, 50 + Math.cos(t) * 4);
      cam.lookAt(-4, 3, 0);
      cam.fov = 58;
      cam.updateProjectionMatrix();
      this.weaponMesh.visible = false;
      return;
    }
    const motion = settings.reduced ? 0 : 1,
      bob = p.grounded
        ? Math.sin(this.time * (p.speed > 9 ? 15 : 10)) *
          Math.min(p.speed * 0.0018, 0.025) *
          motion
        : 0;
    cam.position.copy(p.eye);
    cam.position.y += bob;
    cam.rotation.set(
      p.pitch + this.combat.recoil * 0.008 * motion,
      p.yaw,
      p.action === "WALL RUN"
        ? 0.055 * motion
        : Math.sin(this.time * 2) * 0.0015 * motion,
      "YXZ",
    );
    const targetFov =
      (this.aiming ? 57 : settings.fov) +
      Math.min(12, Math.max(0, p.speed - 8) * 0.7) * motion;
    cam.fov = T.MathUtils.lerp(cam.fov, targetFov, 1 - Math.exp(-dt * 9));
    cam.updateProjectionMatrix();
    this.weaponMesh.visible = this.combat.hp > 0;
    const reload = this.combat.reloadTime > 0;
    this.weaponMesh.position.set(
      this.aiming ? 0 : 0.24,
      -0.25 - bob * 2 - (reload ? 0.22 : 0),
      -0.68 + this.combat.recoil * 0.035,
    );
    this.weaponMesh.rotation.set(
      reload ? -0.45 : 0,
      this.aiming ? 0 : -0.04,
      (reload ? -0.3 : 0) + bob * 0.8,
    );
    this.weaponMesh.scale.setScalar(0.68);
    if (!this.rope) {
      this.rope = stroke(new T.Vector3(), new T.Vector3(0, 1, 0), INK, 0.024);
      this.render.scene.add(this.rope);
    }
    this.rope.visible = !!p.anchor;
    if (p.anchor) {
      const from = p.eye.clone().add(new T.Vector3(-0.22, -0.3, 0)),
        to = new T.Vector3(p.anchor.x, p.anchor.y, p.anchor.z),
        delta = to.clone().sub(from);
      this.rope.position.copy(from).add(to).multiplyScalar(0.5);
      this.rope.scale.y = delta.length();
      this.rope.quaternion.setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        delta.normalize(),
      );
    }
    for (const state of this.network.players) {
      const model = this.remotes.get(state.id);
      if (!model) continue;
      model.group.visible = state.hp > 0;
      const target = new T.Vector3(...state.p),
        dist = model.group.position.distanceTo(target);
      model.group.position.lerp(target, 1 - Math.exp(-dt * 16));
      model.group.rotation.y = state.yaw + Math.PI;
      model.animate(this.time, Math.min(10, dist / dt), cam);
      model.group.scale.y = (state.height ?? 1.76) / 1.76;
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
        const attr = rope.geometry.getAttribute(
          "position",
        ) as T.BufferAttribute;
        attr.setXYZ(
          0,
          model.group.position.x,
          model.group.position.y + 1.3,
          model.group.position.z,
        );
        attr.setXYZ(1, ...state.anchor);
        attr.needsUpdate = true;
        rope.geometry.computeBoundingSphere();
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
  updateHUD() {
    const p = this.player,
      c = this.combat,
      gun = WEAPONS[c.weapon];
    $("health").textContent = String(Math.ceil(c.hp));
    $("health-fill").style.width = c.hp + "%";
    $("health-fill").style.backgroundColor =
      c.hp < 30 ? "#d23c4530" : "transparent";
    $("speed").textContent = String(Math.round(p.speed));
    $("action").textContent = p.action;
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
    $("hurt").style.opacity = String(c.hurt * 0.6);
    $("hitmarker").style.opacity = c.hitTime > 0 ? "1" : "0";
    $("notice").style.opacity = this.time < this.noticeUntil ? "1" : "0";
    $("feed").style.opacity = this.time < this.feedUntil ? "1" : "0";
    const hit = this.physics.ray(p.eye, p.forward, 65);
    $("hook-reticle").style.opacity = hit && hit.distance > 2 ? "0.65" : "0";
    $("grapple-status").textContent = p.anchor
      ? "HOLD Q TO REEL"
      : hit && hit.distance > 2
        ? `${Math.round(hit.distance)}m · Q TO HOOK`
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
          : `<h2>Your field notes</h2><div class="row"><span>Rivals erased</span><b>${c.kills}</b></div><div class="row"><span>Rooftop marks</span><b>${this.collected.size} / 3</b></div><div class="row"><span>Distance travelled</span><b>${Math.round(p.travel)} m</b></div><div class="row"><span>Vaults / hooks</span><b>${p.vaults} / ${p.hooks}</b></div><div class="row"><span>Frame rate</span><b>${this.fps} fps</b></div>`;
  }
  loop(now: number) {
    const dt = Math.min((now - this.previous) / 1000, 0.05);
    this.previous = now;
    this.time += dt;
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime > 1) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
    if (this.state !== "loading") {
      this.accumulator += dt;
      let count = 0;
      while (this.accumulator >= 1 / 120 && count++ < 6) {
        this.step(1 / 120);
        this.accumulator -= 1 / 120;
      }
      if (this.mode === "online" && this.network.active) {
        this.netTick += dt;
        if (this.netTick > 0.05) {
          this.netTick = 0;
          this.sendState();
        }
      }
      this.updateVisuals(dt);
      if (this.state !== "menu" && this.frame % 3 === 0) this.updateHUD();
      this.render.draw(this.time);
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
