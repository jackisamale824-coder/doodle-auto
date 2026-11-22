import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import WebSocket from "ws";

// Deliberately no production defaults: this rehearsal promotes releases.
const { CONTROL_URL, GAME_URL, CONTROL_SECRET, RELEASE_A, RELEASE_B } =
  process.env;
if (
  ![CONTROL_URL, GAME_URL, CONTROL_SECRET, RELEASE_A, RELEASE_B].every(Boolean)
)
  throw Error(
    "Set CONTROL_URL, GAME_URL, CONTROL_SECRET, RELEASE_A and RELEASE_B for an isolated rehearsal environment.",
  );
if (RELEASE_A === RELEASE_B)
  throw Error("Rehearsal requires two distinct releases.");
const clients = [];
let browser;
const browserPages = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const histogram = monitorEventLoopDelay({ resolution: 10 });
const report = {
  startedAt: new Date().toISOString(),
  releaseA: RELEASE_A,
  releaseB: RELEASE_B,
  checks: [],
};
async function api(route, body, internal = true) {
  const response = await fetch(
    new URL(route, internal ? CONTROL_URL : GAME_URL),
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internal ? { Authorization: `Bearer ${CONTROL_SECRET}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );
  const value = await response.json();
  if (!response.ok)
    throw Error(
      `${route}: ${response.status} ${value.error || value.message || "request failed"}`,
    );
  return value;
}
function check(name) {
  report.checks.push(name);
  console.log(`PASS ${name}`);
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null
  );
}
async function connect(admission, resume) {
  const url = new URL(admission.wsUrl, GAME_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url, { origin: new URL(GAME_URL).origin });
  const client = {
    ws,
    admission,
    identity: null,
    latest: null,
    mags: null,
    gaps: [],
    last: 0,
    lastTime: 0,
    closed: 0,
    reset: false,
    clockRegressed: false,
    messages: [],
    sequence: 0,
  };
  clients.push(client);
  ws.on("close", () => client.closed++);
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    client.messages.push(m);
    client.sequence++;
    if (client.messages.length > 200) client.messages.shift();
    if (m.type === "welcome" || m.type === "resumed") client.identity = m;
    if (m.type === "ammo") client.mags = m.mags;
    if (m.type === "snapshot") {
      const now = performance.now();
      if (client.last) client.gaps.push(now - client.last);
      client.last = now;
      if (client.lastTime && m.time < client.lastTime)
        client.clockRegressed = true;
      client.lastTime = m.time;
      const me = m.players?.find((p) => p.id === client.identity?.id);
      if (me) {
        if (
          client.latest &&
          (me.hp > client.latest.hp ||
            me.kills < client.latest.kills ||
            me.deaths < client.latest.deaths)
        )
          client.reset = true;
        client.latest = me;
      }
    }
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(
    JSON.stringify(
      resume || {
        type: "admit",
        joinTicket: admission.joinTicket,
        releaseId: admission.releaseId,
      },
    ),
  );
  const message = await until(client, (m) =>
    ["welcome", "resumed", "error"].includes(m.type),
  );
  if (message.type === "error") {
    ws.close();
    throw Error(message.message);
  }
  return client;
}
async function until(client, predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const m = client.messages.find(predicate);
    if (m) return m;
    await wait(20);
  }
  throw Error("Timed out waiting for game message");
}
const allocation = (workerId, type = "public", extra = {}) =>
  api("/internal/allocate", {
    workerId,
    type,
    name: `Rehearsal ${clients.length}`,
    requestId: randomUUID(),
    ...extra,
  });
const publicAllocation = (type = "public", extra = {}) =>
  api(
    "/api/matches",
    { type, name: "Rehearsal", requestId: randomUUID(), ...extra },
    false,
  );
const promote = (releaseId, expectedCurrent, deploymentId = randomUUID()) =>
  api("/internal/promote", { releaseId, expectedCurrent, deploymentId });
try {
  const initial = await api("/internal/status");
  const preparedA = await api("/internal/prepare", { releaseId: RELEASE_A });
  assert.ok(preparedA.worker && !preparedA.queued, "A must have capacity");
  const workerA = preparedA.worker.id;
  const groupA = [];
  for (let i = 0; i < 16; i++)
    groupA.push(await connect(await allocation(workerA)));
  assert.equal(
    new Set(groupA.map((c) => c.identity.roomId)).size,
    1,
    "all 16 humans share public room A",
  );
  for (const c of groupA)
    c.ws.send(
      JSON.stringify({
        type: "state",
        p: c.identity.spawn,
        yaw: 0,
        pitch: 0,
        weapon: 0,
        height: 1.76,
      }),
    );
  await api("/internal/validate", {
    releaseId: RELEASE_A,
    workerId: workerA,
    report: { checks: ["16 real WebSocket admissions in one A room"] },
  });
  await promote(RELEASE_A, initial.current);
  histogram.enable();
  await wait(3000);
  report.baseline = {
    snapshotGapP99Ms: percentile(
      groupA.flatMap((c) => c.gaps),
      0.99,
    ),
    clientEventLoopP99Ms: histogram.percentile(99) / 1e6,
  };
  histogram.reset();
  groupA.forEach((c) => (c.gaps = []));
  const identities = groupA.map((c) => ({
    id: c.identity.id,
    sessionId: c.identity.sessionId,
    roomId: c.identity.roomId,
    code: c.identity.code,
  }));
  const preparedB = await api("/internal/prepare", { releaseId: RELEASE_B });
  assert.ok(
    preparedB.worker && !preparedB.queued,
    "B must have capacity alongside occupied A",
  );
  // Exercise B under concurrent public simulation load before promotion.
  const groupB = [];
  for (let i = 0; i < 16; i++)
    groupB.push(await connect(await allocation(preparedB.worker.id)));
  for (const c of [...groupA, ...groupB]) {
    c.ws.send(
      JSON.stringify({
        type: "state",
        p: c.identity.spawn,
        yaw: 0,
        pitch: 0,
        weapon: 0,
        height: 1.76,
      }),
    );
    c.ws.send(JSON.stringify({ type: "fire" }));
  }
  if (process.env.CANARY_BROWSERS === "1") {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const workerId of [workerA, preparedB.worker.id]) {
      const admission = await allocation(workerId, "create", { seed: "rust" });
      const context = await browser.newContext();
      await context.addInitScript((value) => {
        if (!sessionStorage.getItem("dc.session"))
          sessionStorage.setItem("dc.pendingAdmission", JSON.stringify(value));
      }, admission);
      const page = await context.newPage();
      await page.goto(new URL(admission.clientUrl, GAME_URL).href);
      await page.waitForFunction(
        () => !!sessionStorage.getItem("dc.session"),
        {},
        { timeout: 60000 },
      );
      await page.locator("#hud:not(.hidden)").waitFor({ timeout: 60000 });
      const identity = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("dc.session")),
      );
      let navigations = 0;
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations++;
      });
      browserPages.push({ page, identity, navigations: () => navigations });
    }
  }
  await api("/internal/validate", {
    releaseId: RELEASE_B,
    workerId: preparedB.worker.id,
    report: {
      checks: [
        "16 real WebSocket admissions in B while A remains occupied",
        ...(browserPages.length
          ? ["two browser canaries loaded retained client assets"]
          : []),
      ],
    },
  });
  const deploymentId = randomUUID();
  await promote(RELEASE_B, RELEASE_A, deploymentId);
  await promote(RELEASE_B, RELEASE_A, deploymentId);
  await wait(3000);
  for (const [i, c] of groupA.entries()) {
    assert.equal(c.closed, 0, "promotion must preserve A sockets");
    assert.equal(c.clockRegressed, false, "simulation time remains monotonic");
    assert.equal(
      c.reset,
      false,
      "promotion must not refill HP or reset scores",
    );
    assert.deepEqual(
      {
        id: c.identity.id,
        sessionId: c.identity.sessionId,
        roomId: c.identity.roomId,
        code: c.identity.code,
      },
      identities[i],
    );
    assert.ok(c.lastTime && c.latest, "A continues receiving state");
  }
  check(
    "16-player A continuity across B prepare, gateway route reload, loaded B promotion and idempotent promotion retry",
  );
  const fresh = await publicAllocation();
  assert.equal(fresh.releaseId, RELEASE_B);
  const newcomer = await connect(fresh);
  check("new default admission uses B");
  const room = await api(
    `/api/matches/${groupA[0].identity.code}`,
    undefined,
    false,
  );
  assert.equal(room.releaseId, RELEASE_A);
  check("old invitation resolves retained A release");
  const departing = groupA.at(-1);
  departing.ws.send(JSON.stringify({ type: "leave" }));
  departing.ws.close();
  await wait(100);
  const invitedAdmission = await publicAllocation("join", {
    code: groupA[0].identity.code,
  });
  assert.equal(invitedAdmission.releaseId, RELEASE_A);
  const invited = await connect(invitedAdmission);
  assert.equal(invited.identity.roomId, groupA[0].identity.roomId);
  check("new invitation admission joins existing retained A room");
  const old = groupA[0],
    oldIdentity = old.identity;
  old.ws.terminate();
  await wait(10000);
  const retirement = await api("/internal/retire", { workerId: workerA });
  assert.equal(retirement.retired, false, "active/resumable A cannot retire");
  const resumed = await connect(old.admission, {
    type: "resume",
    sessionId: oldIdentity.sessionId,
    secret: oldIdentity.resumeSecret,
    attemptId: randomUUID(),
    releaseId: RELEASE_A,
  });
  assert.equal(resumed.identity.sessionId, oldIdentity.sessionId);
  assert.equal(resumed.identity.id, oldIdentity.id);
  assert.equal(resumed.identity.roomId, oldIdentity.roomId);
  assert.notEqual(resumed.identity.resumeSecret, oldIdentity.resumeSecret);
  if (old.mags)
    assert.deepEqual(
      resumed.identity.mags,
      old.mags,
      "resume preserves ammunition",
    );
  check(
    "10-second detached A session resumes original player with rotated secret and preserved ammunition; retirement blocked",
  );
  await assert.rejects(
    connect(old.admission),
    /ticket|admission|expired|used|invalid/i,
  );
  check("admission replay rejected");
  const reservation = await allocation(workerA, "create", { seed: "rust" });
  assert.ok(reservation.joinTicket);
  for (const c of [...groupA, resumed, invited]) {
    if (c.ws.readyState === WebSocket.OPEN)
      c.ws.send(JSON.stringify({ type: "leave" }));
    c.ws.close();
  }
  // Browser canaries also release A before testing a reservation-only pin.
  for (const c of browserPages) {
    assert.equal(
      c.navigations(),
      0,
      "promotion cannot navigate an existing browser",
    );
    const current = await c.page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("dc.session")),
    );
    assert.equal(current.sessionId, c.identity.sessionId);
    assert.equal(current.releaseId, c.identity.releaseId);
    await c.page.locator("#main-menu").click();
  }
  if (browserPages.length) {
    check(
      "two real browsers retain release, session and page across promotion",
    );
    await browser.close();
    browser = undefined;
  }
  await wait(100);
  assert.equal(
    (await api("/internal/retire", { workerId: workerA })).retired,
    false,
  );
  check(
    "outstanding admission alone prevents retirement after all A humans explicitly leave",
  );
  await promote(RELEASE_A, RELEASE_B);
  const afterRollback = await publicAllocation();
  assert.equal(afterRollback.releaseId, RELEASE_A);
  await wait(1000);
  for (const c of [...groupB, newcomer])
    assert.equal(c.closed, 0, "rollback preserves existing B sockets");
  check("rollback redirects new admissions to A and preserves occupied B");
  const status = await api("/internal/status");
  report.rollout = {
    snapshotGapP99Ms: percentile(
      groupA.flatMap((c) => c.gaps),
      0.99,
    ),
    clientEventLoopP99Ms: histogram.percentile(99) / 1e6,
    workers: status.workers.map((w) => ({
      id: w.id,
      releaseId: w.releaseId,
      tickP99Ms: w.status?.tickP99Ms,
      tickCount: w.status?.tickCount,
    })),
  };
  assert.ok(
    report.rollout.snapshotGapP99Ms <= report.baseline.snapshotGapP99Ms + 100,
    "snapshot p99 regression exceeds 100ms",
  );
  for (const w of report.rollout.workers)
    if ([RELEASE_A, RELEASE_B].includes(w.releaseId))
      assert.ok(w.tickP99Ms < 33.3, "worker tick p99 exceeds 33.3ms");
  check("snapshot latency and worker tick performance gates");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  histogram.disable();
  if (browser) await browser.close();
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN)
      c.ws.send(JSON.stringify({ type: "leave" }));
    c.ws.close();
  }
  await wait(200);
  for (const c of clients)
    if (c.ws.readyState !== WebSocket.CLOSED) c.ws.terminate();
  report.finishedAt = new Date().toISOString();
  const output = process.env.REHEARSAL_REPORT || "rolling-release-report.json";
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Rehearsal evidence: ${output}`);
}
