import { Court } from "./court.js";
import { palace } from "./stage.js";

const byId = (id) => document.getElementById(id);
const game = new Court();
const canvas = byId("scene"),
  draw = palace(canvas);
const action = byId("action"),
  start = byId("start"),
  curtain = byId("curtain");
const endings = {
  dungeon: [
    "To the dungeon",
    "The king saw the blade. Drop your arm when the question mark appears, then try again after he turns away.",
  ],
  usurped: [
    "A short reign",
    "Another courtier claimed the crown. Look back while the silver blade is raised.",
  ],
  revolt: [
    "Palace revolt",
    "Two innocent courtiers were arrested. Let anyone carrying a rose pass.",
  ],
  jubilee: [
    "Long live the ruler",
    "Eight audiences survived. Tonight the crown stays with you.",
  ],
};
let paused = false,
  clock = 0,
  scroll = 0,
  last = 0,
  best = 0,
  muted = false,
  audio;
let visualState = "",
  source = null;
try {
  best = Math.max(
    0,
    Math.min(8, Number(localStorage.getItem("revenge.reign")) || 0),
  );
  muted = localStorage.getItem("revenge.muted") === "1";
} catch {}
function store(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}
function tone(notes) {
  if (muted || !audio || audio.state !== "running") return;
  notes.forEach((f, i) => {
    const t = audio.currentTime + i * 0.085,
      osc = audio.createOscillator(),
      amp = audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = f;
    amp.gain.setValueAtTime(0.0005, t);
    amp.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0005, t + 0.15);
    osc.connect(amp).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.16);
    osc.onended = () => {
      osc.disconnect();
      amp.disconnect();
    };
  });
}
function wake() {
  if (muted || !window.AudioContext) return;
  audio ??= new AudioContext();
  if (audio.state !== "running") void audio.resume().catch(() => {});
}
function put(id, text) {
  const e = byId(id);
  if (e.textContent !== text) e.textContent = text;
}
function release() {
  source = null;
  game.release();
  action.classList.remove("active");
}
function press(input) {
  if (source !== null || paused || !["plot", "rule"].includes(game.phase))
    return;
  source = input;
  wake();
  game.press();
  action.classList.add("active");
  renderUI();
}
function newGame() {
  release();
  wake();
  game.start();
  paused = false;
  tone([220, 330]);
  renderUI();
  action.focus({ preventScroll: true });
}
function pause() {
  if (!["plot", "crown", "rule"].includes(game.phase) || paused) return;
  release();
  paused = true;
  renderUI();
  start.focus({ preventScroll: true });
}
function resume() {
  paused = false;
  last = performance.now();
  wake();
  renderUI();
  if (!action.disabled) action.focus({ preventScroll: true });
}
function renderUI() {
  const phase = game.phase,
    cue = game.cue;
  if (game.reign > best) {
    best = game.reign;
    store("revenge.reign", best);
  }
  put("score", "BEST REIGN · " + best);
  const isRule = phase === "rule";
  const accessibleCue =
    phase === "plot"
      ? {
          walk: "The king is facing forward.",
          tell: "The king is about to look back.",
          watch: "The king is looking at you.",
        }[cue]
      : isRule
        ? cue === "raise"
          ? game.hostile
            ? "Silver blade raised."
            : "A rose is offered."
          : cue === "depart"
            ? game.message
            : "A courtier approaches."
        : "";
  const state = [phase, cue, game.visitor, game.result, paused].join("/");
  if (state !== visualState) {
    visualState = state;
    if (!paused) {
      if (phase === "crown") tone([330, 494, 660, 880]);
      else if (phase === "ending")
        tone(
          game.result === "jubilee" ? [330, 440, 554, 660] : [292, 247, 185],
        );
      else if (cue === "tell" && phase === "plot") tone([294]);
      else if (isRule && cue === "depart") tone([440, 554]);
    }
  }
  const modal = paused || phase === "title" || phase === "ending";
  curtain.hidden = !modal;
  byId("pause").hidden = modal;
  canvas.setAttribute(
    "aria-label",
    accessibleCue || "Royal gallery with the king and his adviser.",
  );
  if (paused) {
    put("name", "Intermission");
    put("brief", "The court can wait.");
    put("start", "Resume game →");
  } else if (phase === "ending") {
    put("name", endings[game.result][0]);
    put("brief", endings[game.result][1]);
    put("start", "Play again →");
  }
  put(
    "act",
    isRule
      ? "ON THE THRONE · AUDIENCE " + game.visitor + " / 8"
      : phase === "plot"
        ? "IN THE KING’S SHADOW"
        : phase === "crown"
          ? "CORONATION"
          : "THE ROYAL GALLERY",
  );
  put(
    "label",
    isRule
      ? "ROYAL TRUST · " + game.trust + " / 2"
      : phase === "plot"
        ? "BLADE CHARGE"
        : "HOW TO PLAY",
  );
  put(
    "tip",
    paused
      ? "Your game is paused."
      : phase === "plot"
        ? cue === "walk"
          ? "Hold while the king faces forward."
          : cue === "tell"
            ? "He’s turning. Release!"
            : "Keep your blade down."
        : isRule
          ? cue === "raise"
            ? game.hostile
              ? "A blade! Look back now."
              : "A rose. Let them pass."
            : cue === "depart"
              ? game.message
              : "Watch for a blade. Spare anyone offering a rose."
          : phase === "crown"
            ? "The crown is yours. Now watch your back."
            : phase === "ending"
              ? "Audiences survived · " + game.reign
              : "Hold to raise the blade. Release before the king looks back.",
  );
  const percent = Math.round((isRule ? game.reign / 8 : game.charge) * 100);
  const meter = byId("meter");
  meter.firstElementChild.style.width = percent + "%";
  meter.setAttribute("aria-valuenow", String(percent));
  meter.setAttribute("aria-label", isRule ? "Reign progress" : "Blade charge");
  put("verb", isRule ? "Look back" : "Raise blade");
  action.setAttribute(
    "aria-label",
    isRule ? "Look back" : "Hold to raise blade",
  );
  action.disabled = modal || phase === "crown";
}
start.onclick = () => (paused ? resume() : newGame());
byId("pause").onclick = pause;
const sound = byId("sound");
function soundLabel() {
  sound.textContent = muted ? "Sound off" : "Sound on";
  sound.setAttribute("aria-label", muted ? "Enable sound" : "Mute sound");
  sound.setAttribute("aria-pressed", String(!muted));
}
sound.onclick = () => {
  muted = !muted;
  store("revenge.muted", muted ? 1 : 0);
  soundLabel();
  if (!muted) {
    wake();
    tone([440]);
  }
};
soundLabel();
for (const e of [canvas, action]) {
  e.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || source !== null || action.disabled) return;
    e.setPointerCapture(event.pointerId);
    press(event.pointerId);
  });
  e.addEventListener("lostpointercapture", (event) => {
    if (source === event.pointerId) release();
  });
  e.addEventListener("pointerup", (event) => {
    if (source === event.pointerId) release();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    if (paused) resume();
    else pause();
    return;
  }
  if (e.code !== "Space" || e.target.closest?.("a,#pause,#sound")) return;
  e.preventDefault();
  if (e.repeat) return;
  if (paused) resume();
  else if (game.phase === "title" || game.phase === "ending") newGame();
  else press("key");
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && source === "key") {
    e.preventDefault();
    release();
  }
});
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
function resize() {
  const width = Math.min(
    1920,
    Math.max(720, Math.round(canvas.clientWidth * devicePixelRatio)),
  );
  canvas.width = width;
  canvas.height = Math.round((width * 420) / 960);
  draw(game, clock, scroll);
}
window.addEventListener("resize", resize);
resize();
renderUI();
let uiTime = 0;
function frame(now) {
  const dt = last ? Math.min(0.08, (now - last) / 1000) : 0;
  last = now;
  if (!paused) {
    clock += dt;
    if (game.phase !== "ending") {
      scroll += dt * (game.phase === "title" ? 9 : 43);
      game.step(dt);
    }
    draw(game, clock, scroll);
    uiTime += dt;
    if (uiTime > 0.04) {
      renderUI();
      uiTime = 0;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
