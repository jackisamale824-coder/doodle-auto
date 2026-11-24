import "./style.css";
import {
  DT,
  H,
  W,
  canPlace,
  other,
  rack,
  settle,
  step,
  strike,
  type Match,
  type Motion,
  type Seat,
  type Stroke,
} from "./game.ts";
import { botStroke, predict, type Point } from "./aim.ts";
import { drawTable, drawBall } from "./table.ts";

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>("table"),
  ctx = canvas.getContext("2d")!;
const lobby = el<HTMLDialogElement>("lobby"),
  help = el<HTMLDialogElement>("help"),
  slider = el<HTMLInputElement>("power");
let game = rack(),
  motion: Motion | null = null,
  seat: Seat = 0,
  angle = 0,
  placing = false,
  guide = true,
  sound = false;
let mode: "solo" | "online" = "solo",
  socket: WebSocket | null = null,
  pending = false,
  room = "",
  rematch = -1;
let botAt = 0,
  bank = 0,
  prior = 0,
  lastTone = 0,
  audio: AudioContext | undefined,
  guidePath: ReturnType<typeof predict> | null = null;
let drops: { id: number; x: number; y: number; roll: number; at: number }[] =
  [];
const active = () =>
  !motion && !pending && game.winner === null && game.turn === seat;
const name = (who: Seat) =>
  who === seat ? "You" : mode === "solo" ? "House Bot" : "Opponent";
const stroke = (): Stroke => ({
  angle,
  power: Number(slider.value) / 100,
  ...(game.hand ? { x: game.balls[0].x, y: game.balls[0].y } : {}),
});
let redraw = true;
function invalidateAim() {
  guidePath = null;
  redraw = true;
}
function update() {
  invalidateAim();
  el("mode").textContent =
    mode === "solo" ? "Solo vs. bot" : "Online · " + room;
  el("online").textContent = mode === "solo" ? "Play online" : "Leave table";
  for (const i of [0, 1] as const) {
    el("name" + i).textContent = name(i);
    const g = game.groups[i];
    const left = game.balls.filter(
      (b) => !b.down && (g === "Solids" ? b.id > 0 && b.id < 8 : b.id > 8),
    ).length;
    el("group" + i).textContent = g
      ? left
        ? g + " · " + left + " left"
        : "On the eight"
      : "Open table";
    el("p" + i).classList.toggle(
      "active",
      game.winner === null && game.turn === i,
    );
  }
  el("turn").textContent =
    game.winner !== null
      ? "Rack complete"
      : game.turn === seat
        ? "Your turn"
        : name(game.turn) + "’s turn";
  el("announcement").textContent = motion ? "Shot in motion" : game.message;
  el<HTMLButtonElement>("shoot").disabled = !active() || placing;
  slider.disabled = !active();
  el("place").hidden = !active() || !game.hand;
  el("place").textContent = placing ? "Finish placement" : "Place cue ball";
  el("tip").textContent = placing
    ? "Tap a clear spot on the felt."
    : game.winner !== null
      ? "The rack is complete."
      : motion
        ? "Balls in motion…"
        : !active()
          ? "Waiting for " + name(game.turn) + "…"
          : game.hand
            ? "Ball in hand. Place the cue ball or shoot from here."
            : "Tap or drag on the felt to aim.";
  el("result").hidden = game.winner === null;
  if (game.winner !== null) {
    el("victory").textContent =
      game.winner === seat ? "You win the rack" : name(game.winner) + " wins";
    el("finish").textContent = game.message;
    el("again").textContent =
      rematch === seat
        ? "Waiting for opponent…"
        : rematch === other(seat)
          ? "Accept rematch"
          : "Play again";
    el<HTMLButtonElement>("again").disabled = rematch === seat;
  }
}
function fresh(m: Match) {
  game = m;
  motion = null;
  pending = false;
  placing = false;
  angle = 0;
  rematch = -1;
  bank = 0;
  drops = [];
  botAt = performance.now() + 850;
  update();
}
function tone(freq: number, duration: number, gain: number) {
  if (!sound || !audio || audio.state !== "running") return;
  const t = audio.currentTime,
    o = audio.createOscillator(),
    a = audio.createGain();
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(
    Math.max(35, freq * 0.32),
    t + duration,
  );
  a.gain.setValueAtTime(gain, t);
  a.gain.exponentialRampToValueAtTime(0.001, t + duration);
  o.connect(a);
  a.connect(audio.destination);
  o.start(t);
  o.stop(t + duration);
}
function rolling(s: Motion) {
  motion = s;
  pending = false;
  placing = false;
  bank = 0;
  tone(320, 0.07, 0.11);
  update();
}
function shoot() {
  if (!active() || placing) return;
  if (mode === "online") {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "shoot", ...stroke() }));
    pending = true;
    update();
  } else {
    const s = strike(game, stroke());
    if (s) rolling(s);
  }
}
function nextBot(now: number) {
  if (
    mode !== "solo" ||
    game.turn === seat ||
    game.winner !== null ||
    motion ||
    now < botAt ||
    help.open ||
    lobby.open
  )
    return;
  const s = botStroke(game),
    result = strike(game, s);
  if (result) rolling(result);
}
function simulate(now: number) {
  if (!motion) return;
  const shot = motion;
  while (bank >= DT) {
    const before = shot.drops.length,
      hits = shot.hit,
      banks = shot.bank;
    const moving = step(game, shot);
    bank -= DT;
    for (const id of shot.drops.slice(before)) {
      const b = game.balls[id];
      drops.push({ id, x: b.x, y: b.y, roll: b.roll, at: now });
      tone(110, 0.14, 0.11);
    }
    if (now - lastTone > 42 && (hits !== shot.hit || banks !== shot.bank)) {
      tone(hits !== shot.hit ? 540 : 190, 0.045, 0.055);
      lastTone = now;
    }
    if (!moving) {
      if (mode === "solo") {
        settle(game, shot);
        motion = null;
        placing = false;
        botAt = now + 800;
        update();
      }
      bank = 0;
      break;
    }
  }
}
let scale = 1,
  ox = 0,
  oy = 0;
function resize() {
  redraw = true;
  const rect = canvas.getBoundingClientRect(),
    dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  scale = Math.min(canvas.width / (W + 92), canvas.height / (H + 92));
  ox = (canvas.width - W * scale) / 2;
  oy = (canvas.height - H * scale) / 2;
}
new ResizeObserver(resize).observe(canvas);
resize();
function line(points: Point[], color: string, dashed: boolean) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.9;
  ctx.setLineDash(dashed ? [6, 7] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}
function draw(now: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  drawTable(ctx);
  const cue = game.balls[0];
  if (active() && !placing) {
    if (guide) {
      guidePath ??= predict(game, stroke());
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      line(guidePath.line, "rgba(255,251,217,.80)", true);
      line(guidePath.branch, "#f7d68e", false);
      line(guidePath.deflect, "rgba(255,251,217,.60)", true);
      const end = guidePath.line.at(-1);
      if (end) {
        ctx.beginPath();
        ctx.arc(end.x, end.y, 9.8, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(255,251,217,.68)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.translate(cue.x, cue.y);
    ctx.rotate(angle);
    const gap = 16 + Number(slider.value) * 0.06;
    const grad = ctx.createLinearGradient(0, -3, 0, 3);
    grad.addColorStop(0, "#724421");
    grad.addColorStop(0.45, "#f6d99f");
    grad.addColorStop(1, "#926339");
    ctx.beginPath();
    ctx.moveTo(-gap, -1.9);
    ctx.lineTo(-gap - 142, -3.6);
    ctx.lineTo(-gap - 142, 3.6);
    ctx.lineTo(-gap, 1.9);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.fillStyle = "#f6ead1";
    ctx.fillRect(-gap - 6, -1.9, 5, 3.8);
    ctx.fillStyle = "#72b6c2";
    ctx.fillRect(-gap - 1, -2, 2, 4);
    ctx.restore();
  }
  for (const b of game.balls)
    if (!b.down) drawBall(ctx, b.id, b.x, b.y, b.roll);
  drops = drops.filter((b) => now - b.at < 190);
  for (const b of drops)
    drawBall(ctx, b.id, b.x, b.y, b.roll, 1 - (now - b.at) / 190);
}
function frame(now: number) {
  bank += Math.min(0.125, (now - prior) / 1000);
  prior = now;
  if (motion) simulate(now);
  else bank = 0;
  nextBot(now);
  if (redraw || motion || drops.length) {
    draw(now);
    redraw = false;
  }
  requestAnimationFrame(frame);
}
function aim(e: PointerEvent) {
  if (!active()) return;
  const rect = canvas.getBoundingClientRect(),
    x = (((e.clientX - rect.left) * canvas.width) / rect.width - ox) / scale,
    y = (((e.clientY - rect.top) * canvas.height) / rect.height - oy) / scale;
  const b = game.balls[0];
  if (placing) {
    if (canPlace(game, x, y)) {
      b.x = x;
      b.y = y;
      placing = false;
      update();
    } else
      el("tip").textContent =
        "Choose a spot clear of the rails, pockets and balls.";
    return;
  }
  if (Math.hypot(x - b.x, y - b.y) < 2) return;
  angle = Math.atan2(y - b.y, x - b.x);
  invalidateAim();
}
canvas.onpointerdown = (e) => {
  canvas.focus();
  if (!placing) canvas.setPointerCapture(e.pointerId);
  aim(e);
};
canvas.onpointermove = (e) => {
  if (canvas.hasPointerCapture(e.pointerId)) aim(e);
};
canvas.onkeydown = (e) => {
  if (!active()) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) shoot();
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    angle += (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.02 : 0.0025);
    invalidateAim();
  }
};
slider.oninput = () => {
  el("strength").textContent = slider.value + "%";
  invalidateAim();
};
el("shoot").onclick = shoot;
el("place").onclick = () => {
  placing = !placing;
  update();
};
el("guide").onclick = () => {
  guide = !guide;
  redraw = true;
  el("guide").setAttribute("aria-pressed", String(guide));
  el("guide").querySelector("b")!.textContent = guide ? "On" : "Off";
};
el("sound").onclick = () => {
  sound = !sound;
  if (sound) {
    audio ??= new AudioContext();
    void audio.resume().then(() => tone(350, 0.06, 0.08));
  }
  el("sound").setAttribute("aria-pressed", String(sound));
  el("sound").querySelector("b")!.textContent = sound ? "On" : "Off";
};
el("rules").onclick = () => help.showModal();
function disconnect() {
  const old = socket;
  socket = null;
  old?.close();
}
function backToSolo(note: string) {
  mode = "solo";
  pending = false;
  rematch = -1;
  placing = false;
  botAt = performance.now() + 850;
  if (note && game.winner === null) game.message = note;
  update();
}
function choices(error = "") {
  el("choices").hidden = false;
  el("waiting").hidden = true;
  el("error").textContent = error;
}
function enter(kind: "find" | "create" | "join", code = "") {
  disconnect();
  el("choices").hidden = true;
  el("waiting").hidden = false;
  el("copy").hidden = true;
  el("roomcode").textContent = "";
  el("error").textContent = "";
  el("waittext").textContent = "Connecting to the table…";
  const url = new URL("/pool/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url);
  let assignedSeat: Seat = 0;
  socket = ws;
  const timeout = window.setTimeout(() => {
    if (ws === socket && ws.readyState !== WebSocket.OPEN) {
      disconnect();
      choices("Connection timed out. Try again or play solo.");
    }
  }, 15000);
  ws.onopen = () => {
    clearTimeout(timeout);
    ws.send(JSON.stringify({ type: "enter", mode: kind, code }));
  };
  ws.onmessage = (e) => {
    if (ws !== socket) return;
    const msg = JSON.parse(e.data);
    if (msg.type === "seat") {
      room = msg.code;
      el("roomcode").textContent = room;
      el("copy").hidden = false;
      el("waittext").textContent =
        kind === "find"
          ? "Finding an opponent. A friend can also join with this code."
          : "Waiting for your opponent. Share the link or table code.";
      assignedSeat = msg.seat;
    }
    if (msg.type === "start") {
      mode = "online";
      seat = assignedSeat;
      fresh(msg.game);
      lobby.close();
    }
    if (msg.type === "rolling") {
      game = msg.game;
      rolling(msg.shot);
    }
    if (msg.type === "settled") {
      game = msg.game;
      motion = null;
      pending = false;
      placing = false;
      update();
    }
    if (msg.type === "rematch") {
      rematch = msg.seat;
      update();
    }
    if (msg.type === "departed") {
      game = msg.game;
      motion = msg.shot;
      disconnect();
      backToSolo("Opponent left · bot joined");
    }
    if (msg.type === "error") {
      if (mode === "online") {
        pending = false;
        game.message = msg.message;
        update();
      } else {
        disconnect();
        choices(msg.message);
      }
    }
  };
  ws.onclose = () => {
    clearTimeout(timeout);
    if (ws !== socket) return;
    socket = null;
    if (mode === "online") backToSolo("Connection closed · bot joined");
    else choices("Couldn’t reach the table. Try again or play solo.");
  };
}
el("online").onclick = () => {
  if (mode === "online") {
    disconnect();
    backToSolo("You left online play · bot joined");
    return;
  }
  choices();
  lobby.showModal();
};
lobby.onclose = () => {
  if (mode !== "online") disconnect();
};
el("cancel").onclick = () => lobby.close();
el("find").onclick = () => enter("find");
el("create").onclick = () => enter("create");
el<HTMLFormElement>("joinform").onsubmit = (e) => {
  e.preventDefault();
  enter("join", el<HTMLInputElement>("code").value.trim().toUpperCase());
};
el("copy").onclick = async () => {
  const invite = new URL(
    location.hostname === "pool.sully6.com" ? "/" : "/pool/",
    location.origin,
  );
  invite.searchParams.set("table", room);
  try {
    await navigator.clipboard.writeText(invite.href);
    el("waittext").textContent =
      "Invite link copied. Waiting for your opponent.";
  } catch {
    el("waittext").textContent =
      "Share table code " + room + " with your opponent.";
  }
};
el("again").onclick = () => {
  if (mode === "online") socket?.send(JSON.stringify({ type: "rematch" }));
  else {
    seat = 0;
    fresh(rack());
  }
};
const invite = new URLSearchParams(location.search).get("table");
if (invite && /^[0-9a-f]{6}$/i.test(invite)) {
  choices();
  lobby.showModal();
  enter("join", invite);
}
update();
requestAnimationFrame(frame);
