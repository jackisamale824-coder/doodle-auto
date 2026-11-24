import { levels, newCar, step, clamp } from "./physics.js";
import { makeScene } from "./scene.js";

const el = (id) => document.getElementById(id);
const draw = makeScene(el("scene"));
const panel = el("panel"),
  body = el("panel-body");
const saveKey = "ridge-run-progress-v1";
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(saveKey)) || {};
} catch {}
let best = Array.from({ length: levels.length }, (_, i) =>
  Number.isFinite(saved.best?.[i]) && saved.best[i] > 0 ? saved.best[i] : null,
);
let unlocked = 0;
while (unlocked < levels.length - 1 && best[unlocked]) unlocked++;
let index = clamp(
  Number.isInteger(saved.course) ? saved.course : 0,
  0,
  unlocked,
);
let muted = saved.sound !== true,
  audio,
  oscillator,
  gain;
let car,
  state,
  elapsed,
  started,
  previous,
  accumulator = 0,
  endDelay = 0,
  menu = "";
const pressed = new Map();
const time = (n) => {
  const cs = Math.floor(n * 100);
  return (
    [Math.floor(cs / 6000), Math.floor(cs / 100) % 60]
      .map((v) => String(v).padStart(2, "0"))
      .join(":") +
    "." +
    String(cs % 100).padStart(2, "0")
  );
};
const number = (n) => String(n).padStart(2, "0");
const courseLabel = () =>
  "COURSE " + number(index + 1) + " / " + number(levels.length);
function save() {
  try {
    localStorage.setItem(
      saveKey,
      JSON.stringify({ course: index, best, sound: !muted }),
    );
  } catch {}
}
function begin(i) {
  index = i;
  car = newCar();
  elapsed = 0;
  state = "running";
  started = false;
  accumulator = 0;
  endDelay = 0;
  closePanel();
  save();
  el("course-num").textContent = courseLabel();
  el("course-title").textContent = levels[i].name;
  el("tip").style.opacity = "1";
}
function soundUI() {
  el("audio").setAttribute(
    "aria-label",
    muted ? "Turn sound on" : "Mute sound",
  );
  el("audio").setAttribute("aria-pressed", String(!muted));
  el("sound-mark").setAttribute(
    "d",
    muted ? "m17 9 5 6m0-6-5 6" : "M17 9q3 3 0 6m2-9q6 6 0 12",
  );
}
function wakeAudio() {
  if (muted) return;
  try {
    if (!audio) {
      audio = new AudioContext();
      oscillator = audio.createOscillator();
      gain = audio.createGain();
      oscillator.type = "triangle";
      gain.gain.value = 0;
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
    }
    if (audio.state === "suspended") audio.resume().catch(() => {});
  } catch {}
}
function drive() {
  let forward = false,
    reverse = false;
  for (const value of pressed.values()) {
    if (value > 0) forward = true;
    else reverse = true;
  }
  el("gas").classList.toggle("active", forward);
  el("back").classList.toggle("active", reverse);
  return Number(forward) - Number(reverse);
}
function clearInput() {
  pressed.clear();
  drive();
}
function closePanel() {
  menu = "";
  if (panel.open) panel.close();
  clearInput();
}
function add(tag, text, cls) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  body.append(node);
  return node;
}
function action(parent, text, fn) {
  const button = document.createElement("button");
  button.textContent = text;
  button.addEventListener("click", fn);
  parent.append(button);
  return button;
}
function show(which) {
  menu = which;
  clearInput();
  body.replaceChildren();
  add("div", courseLabel(), "eyebrow");
  const title = add(
    "h2",
    {
      paused: "Pit stop",
      courses: "Choose a course",
      crashed: "Wipeout!",
      won: index === levels.length - 1 ? "Circuit complete!" : "Finish line!",
    }[which],
  );
  title.id = "dialog-title";
  panel.setAttribute("aria-labelledby", title.id);
  if (which === "courses") {
    const grid = add("div", "", "levels");
    levels.forEach((level, i) => {
      const b = action(grid, number(i + 1), () => begin(i));
      b.disabled = i > unlocked;
      b.title = level.name;
      b.setAttribute(
        "aria-label",
        "Course " +
          (i + 1) +
          ", " +
          level.name +
          (b.disabled ? ", locked" : ""),
      );
      if (index === i) b.className = "current";
    });
    add("p", "Finish a course to unlock the next.", "fine");
  } else if (which === "won")
    add(
      "p",
      levels[index].name +
        " · " +
        time(elapsed) +
        " · Best " +
        time(best[index]),
    );
  else if (which === "crashed")
    add("p", "Try a shorter burst of throttle before the crest.");
  else add("p", levels[index].name + " · " + time(elapsed));
  const a = add("div", "", "actions");
  if (which === "paused") action(a, "Resume drive", closePanel);
  if (which === "won" && index < levels.length - 1)
    action(a, "Next course", () => begin(index + 1));
  if (which !== "courses")
    action(a, which === "won" ? "Race again" : "Restart course", () =>
      begin(index),
    );
  if (which !== "courses") action(a, "Courses", () => show("courses"));
  else action(a, "Back", () => show(state === "running" ? "paused" : state));
  if (!panel.open) panel.showModal();
  a.querySelector("button")?.focus();
}
function togglePause() {
  if (panel.open) {
    if (menu === "courses") show(state === "running" ? "paused" : state);
    else if (state === "running") closePanel();
  } else if (state === "running") show("paused");
}
el("pause").onclick = togglePause;
el("restart").onclick = () => begin(index);
el("audio").onclick = () => {
  muted = !muted;
  soundUI();
  wakeAudio();
  save();
};
panel.addEventListener("cancel", (e) => {
  e.preventDefault();
  togglePause();
});
const keys = {
  ArrowRight: 1,
  ArrowUp: 1,
  KeyD: 1,
  KeyW: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  KeyA: -1,
  KeyS: -1,
};
window.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.code === "Escape" && panel.open) return;
  if (e.code === "Escape" || e.code === "KeyP") {
    e.preventDefault();
    if (!e.repeat) togglePause();
    return;
  }
  if (e.code === "KeyR") {
    e.preventDefault();
    if (!e.repeat) begin(index);
    return;
  }
  if (e.code in keys && !panel.open && state === "running") {
    e.preventDefault();
    pressed.set(e.code, keys[e.code]);
    wakeAudio();
  }
});
window.addEventListener("keyup", (e) => pressed.delete(e.code));
for (const [id, dir] of [
  ["back", -1],
  ["gas", 1],
]) {
  const b = el(id);
  b.onpointerdown = (e) => {
    if (state !== "running" || panel.open) return;
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    pressed.set(e.pointerId, dir);
    wakeAudio();
  };
  b.onlostpointercapture =
    b.onpointerup =
    b.onpointercancel =
      (e) => pressed.delete(e.pointerId);
  b.oncontextmenu = (e) => e.preventDefault();
  b.onkeydown = (e) => {
    if (["Space", "Enter"].includes(e.code) && !panel.open) {
      e.preventDefault();
      pressed.set(e.code, dir);
      wakeAudio();
    }
  };
}
const interrupt = () => {
  clearInput();
  if (started && state === "running" && !panel.open) show("paused");
};
window.addEventListener("blur", interrupt);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) interrupt();
  previous = undefined;
});
const fixed = 1 / 120;
function frame(now) {
  const dt = Math.min((now - (previous ?? now)) / 1000, 0.075);
  previous = now;
  const input = drive();
  if (state === "running" && !panel.open) {
    if (input) started = true;
    accumulator += dt;
    while (accumulator >= fixed && state === "running") {
      accumulator -= fixed;
      if (started) elapsed += fixed;
      state = step(levels[index], car, input, fixed);
    }
    if (state !== "running") {
      clearInput();
      if (state === "won") {
        best[index] = Math.min(best[index] ?? Infinity, elapsed);
        unlocked = Math.max(unlocked, Math.min(index + 1, levels.length - 1));
        save();
      }
    }
  } else if (!panel.open && state !== "running") {
    endDelay += dt;
    if (endDelay > 0.27) show(state);
  }
  if (gain) {
    gain.gain.setTargetAtTime(
      !muted && !panel.open && started && state === "running"
        ? input
          ? 0.045
          : 0.014
        : 0,
      audio.currentTime,
      0.06,
    );
    oscillator.frequency.setTargetAtTime(
      41 + Math.abs(car.vx) * 5 + Math.abs(input) * 11,
      audio.currentTime,
      0.07,
    );
  }
  el("tip").style.opacity = started ? "0" : "1";
  el("time").textContent = time(elapsed);
  el("fill").style.width =
    clamp(((car.x - 1) / (levels[index].finish - 1)) * 100, 0, 100) + "%";
  draw(levels[index], car, dt);
  requestAnimationFrame(frame);
}
soundUI();
begin(index);
requestAnimationFrame(frame);
