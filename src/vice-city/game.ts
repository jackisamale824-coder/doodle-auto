import * as T from "three";
import { Doodle } from "../actors";
import { loadFleet, type CountyCarModel } from "../county-car";
import { avenues, streets, buildCoast, type Point } from "./coast";
import { jobs, completedJobs, earnings, saveJobs } from "./jobs";
import { CoastSound } from "./sound";
import { nextPunch, PUNCHES, type Punch } from "../fists";
import "./style.css";

const el = <E extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as E;
const start = el<HTMLButtonElement>("start");
const menu = el("menu"),
  hud = el("hud");
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const nearest = (values: number[], v: number) =>
  values.reduce((a, b) => (Math.abs(a - v) < Math.abs(b - v) ? a : b));
const clamp = T.MathUtils.clamp;
const keys = new Set<string>();
const spawn = { x: 63, z: 87 };
type Car = {
  model: CountyCarModel;
  yaw: number;
  id: string;
  route: Point[];
  next: number;
  cruise: number;
};

async function boot() {
  const canvas = el<HTMLCanvasElement>("view");
  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(60, 1, 0.12, 800);
  const world = buildCoast(scene);
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();
  function titleCamera() {
    camera.position.set(67, 2.05, 93.6);
    camera.lookAt(60.5, 2.1, 80);
  }
  titleCamera();
  renderer.render(scene, camera);
  const fleet = await loadFleet();
  const sound = new CoastSound();
  const cars: Car[] = [];
  function car(
    kind: Parameters<typeof fleet>[0],
    paint: number,
    x: number,
    z: number,
    yaw = 0,
    route: Point[] = [],
    cruise = 0,
    police = false,
  ) {
    const model = fleet(kind, paint, police);
    model.position.set(x, 0.075, z);
    model.rotation.y = -yaw;
    scene.add(model);
    const item = {
      model,
      yaw,
      id: String(cars.length),
      route,
      next: 0,
      cruise,
    };
    cars.push(item);
    return item;
  }
  const coupe = car("coupe", 6, spawn.x, spawn.z);
  car("saloon", 1, -43, 32, Math.PI);
  car("minivan", 3, 7, -28, Math.PI);
  car("coupe", 0, 57, -82, Math.PI);
  function circuit(x0: number, x1: number, z0: number, z1: number) {
    return [
      { x: x0, z: z0 },
      { x: x1, z: z0 },
      { x: x1, z: z1 },
      { x: x0, z: z1 },
    ];
  }
  car("taxi", 1, 13, 32, 0, circuit(13, 57, -52, 48), 6.8);
  car("saloon", 0, 57, 81, Math.PI, circuit(57, 13, 98, 52), 5.5);
  car("delivery", 7, -37, 64, 0, circuit(-37, 7, -2, 98), 5.2);
  car("saloon", 2, -87, -5, 0, circuit(-87, -43, -98, 48), 7.3);
  const cop = car("saloon", 0, 0, 0, 0, [], 0, true);
  cop.model.visible = false;
  const avatar = new Doodle(
    "#70ccbb",
    undefined,
    "civilian",
    "vice-coast-driver",
  );
  scene.add(avatar.group);
  avatar.group.visible = false;
  const walkers = [
    [-1, 67, 35],
    [1, 52, 80],
    [1, 17, -27],
    [-1, -33, 20],
    [1, 69, -68],
    [-1, 3, 65],
  ].map(([dir, x, z], i) => {
    const actor = new Doodle(
      "#d58999",
      undefined,
      "civilian",
      "coast-walker-" + i,
    );
    actor.group.position.set(x, 0.09, z);
    scene.add(actor.group);
    return { actor, dir, home: z, alarm: 0 };
  });
  const beacon = new T.Group();
  const glow = new T.MeshBasicMaterial({
    color: 0x78ffe1,
    transparent: true,
    opacity: 0.91,
    side: T.DoubleSide,
  });
  const ring = new T.Mesh(new T.RingGeometry(2.9, 3.3, 48), glow);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.11;
  beacon.add(ring);
  const arrow = new T.Mesh(new T.OctahedronGeometry(0.82), glow);
  arrow.scale.y = 1.45;
  beacon.add(arrow);
  scene.add(beacon);
  const radar = el<HTMLCanvasElement>("radar").getContext("2d")!;
  const lookAt = new T.Vector3(),
    eye = new T.Vector3(),
    focus = new T.Vector3();
  let vehicle: Car | null = coupe;
  let x = spawn.x,
    z = spawn.z,
    yaw = 0,
    speed = 0;
  let playing = false,
    started = false,
    time = 0,
    noticeTime = 0,
    heat = 0,
    arrest = 0,
    impactCooldown = 0;
  let job = completedJobs(),
    stop = 0,
    lastUi = 0;
  let policeTarget: Point | null = null;
  let punch: Punch | undefined;
  let contactChecked = false;
  let flashText = "";
  const target = () => jobs[job]?.stops[stop];
  function notify(text: string) {
    flashText = text;
    noticeTime = 3.1;
  }
  function refreshTask() {
    const goal = target();
    el("chapter").textContent = jobs[job]
      ? `JOB ${job + 1} / ${jobs.length} · ${jobs[job].name.toUpperCase()}`
      : "SHIFT COMPLETE";
    el("objective").textContent = goal?.task ?? "Free roam the coast";
    el("cash").textContent = "$" + earnings(job).toLocaleString("en-US");
    beacon.visible = !!goal;
    if (goal) beacon.position.set(goal.x, 0, goal.z);
  }
  function progress() {
    const goal = target();
    if (
      !goal ||
      dist({ x, z }, goal) > 5 ||
      !!vehicle === !!goal.onFoot ||
      (goal.losePatrol && heat)
    )
      return;
    stop++;
    if (stop === jobs[job].stops.length) {
      const done = jobs[job];
      job++;
      stop = 0;
      saveJobs(job);
      notify(done.name + " complete · +$" + done.pay);
    } else notify("Pickup complete");
    if (target()?.chase) startChase();
    refreshTask();
  }
  function startChase() {
    if (!heat) {
      const street = nearest(avenues, x);
      cop.model.position.set(street, 0.075, clamp(z + 24, -100, 100));
      cop.model.visible = true;
      policeTarget = { x: street, z: nearest(streets, cop.model.position.z) };
      notify("Patrol alerted · open a gap to lose them");
    }
    heat = 8;
  }
  function endChase() {
    heat = 0;
    arrest = 0;
    policeTarget = null;
    cop.model.visible = false;
  }
  function returnToStreet() {
    endChase();
    speed = 0;
    vehicle = coupe;
    x = spawn.x;
    z = spawn.z;
    yaw = 0;
    stop = 0;
    coupe.model.position.set(x, 0.075, z);
    coupe.yaw = 0;
    avatar.group.visible = false;
    refreshTask();
    notify("Back at the Lido · current job restarted");
  }
  function nearby() {
    return cars
      .filter((c) => c !== cop && dist(c.model.position, { x, z }) < 4.4)
      .sort(
        (a, b) =>
          dist(a.model.position, { x, z }) - dist(b.model.position, { x, z }),
      )[0];
  }
  function swap() {
    if (!playing) return;
    if (vehicle) {
      if (Math.abs(speed) > 4) {
        notify("Slow down to leave the car");
        return;
      }
      for (const side of [-1, 1]) {
        const dx = side * Math.cos(yaw) * 2.15,
          dz = side * Math.sin(yaw) * 2.15;
        if (!world.canStand(x + dx, z + dz, 0.35)) continue;
        vehicle = null;
        x += dx;
        z += dz;
        speed = 0;
        avatar.group.visible = true;
        return;
      }
      notify("Move away from the wall first");
    } else {
      const closest = nearby();
      if (!closest) {
        notify("Stand beside a car");
        return;
      }
      vehicle = closest;
      x = closest.model.position.x;
      z = closest.model.position.z;
      yaw = closest.yaw;
      if (closest.route.length) {
        closest.route = [];
        startChase();
      }
      speed = 0;
      avatar.group.visible = false;
    }
  }
  function pause() {
    if (!playing) return;
    playing = false;
    sound.pause();
    keys.clear();
    menu.hidden = false;
    hud.hidden = true;
    start.textContent = "Resume game";
    el("brief").textContent =
      target()?.task ??
      "Your shift is complete. The coast is yours to explore.";
    start.focus();
  }
  function swing() {
    if (
      vehicle ||
      !playing ||
      (punch && time - punch.start / 1000 < PUNCHES[punch.move].duration)
    )
      return;
    punch = nextPunch(punch, time * 1000);
    contactChecked = false;
  }
  function follow(dt: number, immediate = false) {
    const zoom = vehicle ? 6.8 + Math.abs(speed) * 0.08 : 4.3;
    eye.set(
      x - Math.sin(yaw) * zoom,
      vehicle ? 3.0 : 2.6,
      z + Math.cos(yaw) * zoom,
    );
    // Shorten the boom when backing into a building.
    for (let i = 1; i <= 8; i++) {
      const k = i / 8,
        cx = x + (eye.x - x) * k,
        cz = z + (eye.z - z) * k;
      if (!world.canStand(cx, cz, 0.15)) {
        eye.x = x + ((eye.x - x) * (i - 1)) / 8;
        eye.z = z + ((eye.z - z) * (i - 1)) / 8;
        eye.y += 0.7;
        break;
      }
    }
    focus.set(
      x + Math.sin(yaw) * 3.1,
      vehicle ? 1.0 : 1.25,
      z - Math.cos(yaw) * 3.1,
    );
    const blend = immediate ? 1 : 1 - Math.exp(-dt * 9);
    camera.position.lerp(eye, blend);
    lookAt.lerp(focus, blend);
    camera.lookAt(lookAt);
  }
  function begin() {
    playing = true;
    sound.start();
    menu.hidden = true;
    hud.hidden = false;
    keys.clear();
    refreshTask();
    follow(0, true);
    if (!started) {
      notify(
        job === jobs.length
          ? "Shift complete · free roam"
          : "Follow the mint diamond",
      );
      started = true;
    }
    drawHud();
  }
  const driveKeys = [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
    "ShiftLeft",
    "ShiftRight",
  ];
  window.addEventListener("keydown", (e) => {
    if (!playing) return;
    if (e.code === "Escape") {
      pause();
      return;
    }
    if (e.code === "KeyF" && !e.repeat) swap();
    if (e.code === "Space" && !e.repeat) swing();
    if (driveKeys.includes(e.code)) {
      e.preventDefault();
      keys.add(e.code);
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", pause);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  start.onclick = begin;
  el("pause").onclick = pause;
  el("sound").onclick = () => {
    sound.enabled = !sound.enabled;
    if (sound.enabled) sound.start();
    else sound.pause();
    el("sound").setAttribute(
      "aria-label",
      sound.enabled ? "Mute game audio" : "Enable game audio",
    );
    el("sound").setAttribute("aria-pressed", String(sound.enabled));
    el("sound").textContent = sound.enabled ? "♫" : "♪";
  };
  el("swap").onclick = swap;
  el("punch").onclick = swing;
  document.querySelectorAll<HTMLButtonElement>("[data-key]").forEach((btn) => {
    const key = btn.dataset.key!;
    btn.onpointerdown = (e) => {
      btn.setPointerCapture(e.pointerId);
      keys.add(key);
    };
    btn.onlostpointercapture = () => keys.delete(key);
  });
  function movePlayer(dt: number) {
    const forward =
      Number(keys.has("ArrowUp") || keys.has("KeyW")) -
      Number(keys.has("ArrowDown") || keys.has("KeyS"));
    const steer =
      Number(keys.has("ArrowRight") || keys.has("KeyD")) -
      Number(keys.has("ArrowLeft") || keys.has("KeyA"));
    if (vehicle) {
      const offroad =
        avenues.every((v) => Math.abs(x - v) > 7) &&
        streets.every((v) => Math.abs(z - v) > 7);
      const limit = offroad ? 13 : 32;
      const desired = keys.has("Space")
        ? 0
        : forward * (forward < 0 ? 9 : limit);
      const accel = keys.has("Space")
        ? 36
        : forward &&
            Math.sign(forward) !== Math.sign(speed) &&
            Math.abs(speed) > 1
          ? 25
          : forward
            ? 11
            : 5.5;
      speed += clamp(desired - speed, -accel * dt, accel * dt);
      yaw +=
        steer *
        Math.sign(speed) *
        Math.min(Math.abs(speed) / 5, 1) *
        dt *
        (keys.has("Space") ? 2.25 : 1.65);
    } else {
      yaw += steer * dt * 2.5;
      speed =
        forward * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 7 : 4.5);
    }
    const nx = x + Math.sin(yaw) * speed * dt,
      nz = z - Math.cos(yaw) * speed * dt;
    const radius = vehicle ? 1.65 : 0.32;
    const hit = cars.find(
      (c) =>
        c !== vehicle &&
        c !== cop &&
        dist(c.model.position, { x: nx, z: nz }) < (vehicle ? 3.3 : 1.3) &&
        dist(c.model.position, { x: nx, z: nz }) <
          dist(c.model.position, { x, z }),
    );
    if (hit || !world.canStand(nx, nz, radius)) {
      if (vehicle && Math.abs(speed) > 8 && impactCooldown <= 0) {
        if (hit) startChase();
        else notify("Collision · reverse to pull clear");
        impactCooldown = 2;
      }
      speed = 0;
    } else {
      x = nx;
      z = nz;
    }
    if (vehicle) {
      vehicle.yaw = yaw;
      vehicle.model.position.set(x, 0.075, z);
    } else {
      avatar.group.position.set(x, 0.075, z);
      avatar.group.rotation.y = Math.PI - yaw;
      const age = punch ? time - punch.start / 1000 : 1;
      avatar.setFistPose(!!punch && age < 0.8, punch?.move ?? 0, age);
      avatar.aimRig.visible = false;
      if (punch && !contactChecked && age >= PUNCHES[punch.move].contact) {
        contactChecked = true;
        const pedestrian = walkers.find((w) => {
          const p = w.actor.group.position;
          return (
            dist(p, { x, z }) < 1.8 &&
            (p.x - x) * Math.sin(yaw) - (p.z - z) * Math.cos(yaw) > 0
          );
        });
        if (pedestrian) {
          pedestrian.actor.react("body");
          pedestrian.alarm = 4;
          startChase();
        }
      }
      avatar.animate(time, Math.abs(speed), camera, 0, dt);
    }
    return steer;
  }
  function advance(c: Car, goal: Point, pace: number, dt: number) {
    const p = c.model.position,
      dx = goal.x - p.x,
      dz = goal.z - p.z,
      d = Math.hypot(dx, dz);
    if (d < 0.12) return true;
    const step = Math.min(d, pace * dt);
    c.yaw = Math.atan2(dx, -dz);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    return step === d;
  }
  function pursue(dt: number) {
    if (!heat) return;
    const p = cop.model.position,
      d = dist(p, { x, z });
    if (d > 29) heat = Math.max(0, heat - dt);
    else heat = Math.min(8, heat + 0.5 * dt);
    if (!heat) {
      endChase();
      notify("Patrol lost");
      return;
    }
    if (!policeTarget) {
      // Pursue in sight, otherwise travel from junction to junction.
      let clear = true;
      for (let f = 0.12; f <= 1; f += 0.12)
        if (!world.canStand(p.x + (x - p.x) * f, p.z + (z - p.z) * f, 1.4))
          clear = false;
      if (clear) policeTarget = { x, z };
      else {
        const ix = nearest(avenues, p.x),
          iz = nearest(streets, p.z);
        if (Math.abs(p.x - ix) > 1 || Math.abs(p.z - iz) > 1)
          policeTarget = { x: ix, z: iz };
        else {
          const tx = nearest(avenues, x),
            tz = nearest(streets, z);
          policeTarget =
            Math.abs(tx - ix) > Math.abs(tz - iz)
              ? { x: ix + Math.sign(tx - ix) * 50, z: iz }
              : { x: ix, z: iz + Math.sign(tz - iz) * 50 };
        }
      }
    }
    if (advance(cop, policeTarget, 13, dt)) policeTarget = null;
    arrest = d < 4 ? arrest + dt : 0;
    if (arrest > 2.5) returnToStreet();
  }
  function simulate(dt: number) {
    time += dt;
    noticeTime -= dt;
    impactCooldown -= dt;
    const steer = movePlayer(dt);
    for (const c of cars) {
      if (c.route.length && dist(c.model.position, { x, z }) > 3.8) {
        if (advance(c, c.route[c.next], c.cruise, dt))
          c.next = (c.next + 1) % c.route.length;
      }
    }
    pursue(dt);
    progress();
    follow(dt);
    for (const c of cars) {
      if (!c.model.visible) continue;
      c.model.rotation.y = -c.yaw;
      const driver =
        c === cop
          ? "police-coast"
          : c === vehicle || c.route.length
            ? "civilian-driver-" + c.id
            : null;
      c.model.update(
        driver,
        time,
        c.model.position.distanceTo(camera.position),
        c === vehicle ? steer : 0,
      );
    }
    for (const w of walkers) {
      const p = w.actor.group.position;
      if (Math.abs(p.z - w.home) > 10) w.dir = p.z > w.home ? -1 : 1;
      w.alarm = Math.max(0, w.alarm - dt);
      const pace = w.alarm > 0 ? 4 : 1;
      p.z += w.dir * pace * dt;
      w.actor.group.rotation.y = w.dir > 0 ? 0 : Math.PI;
      w.actor.animate(time, pace, camera, 0, dt);
    }
    arrow.position.y = 3.2 + Math.sin(time * 3) * 0.38;
    arrow.rotation.y = time;
    if (time - lastUi > 0.08) {
      drawHud();
      lastUi = time;
    }
  }
  function drawHud() {
    const goal = target(),
      at = { x, z };
    el("speed").textContent = vehicle
      ? String(Math.round(Math.abs(speed) * 3.6))
      : "On foot";
    el("unit").textContent = vehicle ? "km/h" : "";
    el("interaction").textContent = vehicle
      ? "F · Exit car"
      : nearby()?.route.length
        ? "F · Take car"
        : nearby()
          ? "F · Enter car"
          : "Walk to a car";
    el("swap").textContent = vehicle ? "Exit car" : "Enter car";
    el("punch").hidden = !!vehicle;
    el("heat").textContent = heat
      ? arrest > 0.4
        ? "Getting caught"
        : "★ Wanted"
      : "";
    el("notice").textContent = noticeTime > 0 ? flashText : "";
    el("distance").textContent = goal
      ? `${Math.round(dist(goal, at))} m · ${goal.losePatrol && heat ? "Lose the patrol first" : goal.onFoot ? "Collect on foot" : vehicle ? "Drive to the marker" : "Find a car"}`
      : "Explore on foot or by car";
    const ctx = radar;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#343545";
    ctx.fillRect(0, 0, 230, 210);
    ctx.setTransform(0.93, 0, 0, 0.91, 102, 105);
    ctx.fillStyle = "#397d83";
    ctx.fillRect(103, -116, 44, 232);
    ctx.fillStyle = "#d1a984";
    ctx.fillRect(70, -116, 33, 232);
    ctx.fillStyle = "#837d86";
    for (const v of avenues) ctx.fillRect(v - 4, -107, 8, 214);
    for (const v of streets) ctx.fillRect(-97, v - 4, 166, 8);
    if (goal) {
      ctx.fillStyle = "#88ffe2";
      ctx.save();
      ctx.translate(goal.x, goal.z);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    if (heat) {
      ctx.fillStyle = "#ff8298";
      ctx.beginPath();
      ctx.arc(cop.model.position.x, cop.model.position.z, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const c of cars)
      if (c !== vehicle && c !== cop && !c.route.length) {
        ctx.fillStyle = "#f0be85";
        ctx.fillRect(c.model.position.x - 1.5, c.model.position.z - 2, 3, 4);
      }
    ctx.save();
    ctx.translate(x, z);
    ctx.rotate(yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.7, 5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-4.7, 5);
    ctx.closePath();
    ctx.fillStyle = "#fff5de";
    ctx.fill();
    ctx.strokeStyle = "#241f30";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
  refreshTask();
  start.textContent = job > 0 ? "Continue shift" : "Start engine";
  start.disabled = false;
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
    last = now;
    if (playing) {
      const steps = Math.max(1, Math.ceil(dt / 0.025));
      for (let i = 0; i < steps; i++) simulate(dt / steps);
      sound.update(speed, !!vehicle, heat > 0);
    } else if (!started) {
      coupe.model.update(
        "civilian-driver-0",
        now / 1000,
        coupe.model.position.distanceTo(camera.position),
      );
    } else return;
    renderer.render(scene, camera);
  });
}
boot().catch((error) => {
  console.error(error);
  el("brief").textContent =
    "The game could not start. Check that WebGL is enabled and reload to try again.";
  start.disabled = false;
  start.textContent = "Reload game";
  start.onclick = () => location.reload();
});
