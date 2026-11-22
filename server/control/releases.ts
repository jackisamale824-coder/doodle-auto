import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { Directory, type Worker } from "./directory.ts";
import { Gateway } from "./gateway.ts";
export class ReleaseManager {
  children = new Map<string, ChildProcess>();
  inflight = new Map<string, Promise<any>>();
  private maintenance = false;
  private lifecycle: Promise<unknown> = Promise.resolve();
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.lifecycle.then(fn, fn);
    this.lifecycle = task.catch(() => {});
    return task;
  }
  constructor(
    public db: Directory,
    public gateway: Gateway,
    public root: string,
    public releaseRoot: string,
    public secret: string,
    public supervisor = "systemd",
  ) {}
  async workerCall(w: Worker, action: string, body?: unknown) {
    const response = await fetch(
      `http://127.0.0.1:${w.port}/internal/${action}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.secret}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      },
    );
    const result = (await response.json()) as any;
    if (!response.ok) throw Error(result.error ?? `Worker ${action} failed`);
    return result;
  }
  async refresh(w: Worker) {
    const s = await this.workerCall(w, "status");
    if (
      s.releaseId !== w.releaseId ||
      s.workerId !== w.id ||
      s.workerEpoch !== w.epoch
    )
      throw Error("Worker epoch mismatch");
    this.db.syncRooms(w, s);
    return s;
  }
  status() {
    return {
      current: this.db.current(),
      releases: this.db.releases(),
      workers: this.db
        .workers()
        .map((w) => ({ ...w, status: JSON.parse(w.status) })),
      queue: this.db.db.prepare("SELECT * FROM queue ORDER BY created").all(),
    };
  }
  prepare(id: string) {
    return this.exclusive(() => this.prepareLocked(id));
  }
  private async prepareLocked(id: string) {
    if (!/^[a-f0-9]{16,64}$/.test(id)) throw Error("Invalid release ID");
    const dir = path.join(this.releaseRoot, id);
    const manifest = JSON.parse(
      readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    if (manifest.releaseId !== id) throw Error("Artifact manifest mismatch");
    this.db.stage(id, manifest);
    const existing = this.db
      .workers()
      .find((w) => w.releaseId === id && w.state === "RUNNING");
    if (existing) {
      await this.refresh(existing);
      return { worker: existing, queued: false };
    }
    const live = this.db
      .workers()
      .filter((w) => ["RUNNING", "STARTING"].includes(w.state));
    if (
      new Set(live.map((w) => w.releaseId)).size >= 3 ||
      os.freemem() < 384 * 1024 * 1024
    ) {
      this.db.db
        .prepare("INSERT OR IGNORE INTO queue VALUES(?,?)")
        .run(id, Date.now());
      return {
        queued: true,
        reason: "Existing sessions retain available release capacity",
      };
    }
    const listener = net.createServer();
    await new Promise<void>((r, j) =>
      listener.listen(0, "127.0.0.1", r).once("error", j),
    );
    const port = (listener.address() as net.AddressInfo).port;
    await new Promise<void>((r) => listener.close(() => r()));
    const wid = "w" + randomBytes(10).toString("hex"),
      epoch = randomUUID();
    this.db.db
      .prepare(
        "INSERT INTO workers(id,releaseId,epoch,port,state) VALUES(?,?,?,?,'STARTING')",
      )
      .run(wid, id, epoch, port);
    const w = this.db.worker(wid)!;
    const env = {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      RELEASE_ID: id,
      WORKER_ID: wid,
      WORKER_EPOCH: epoch,
      CONTROL_SECRET: this.secret,
      STATIC_DIR: path.join(dir, "client"),
      SERVER_ENTRY: path.join(dir, "server/index.mjs"),
    };
    mkdirSync(path.join(this.root, "workers"), { recursive: true });
    writeFileSync(
      path.join(this.root, "workers", wid + ".env"),
      Object.entries(env)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    try {
      if (this.supervisor === "systemd")
        execFileSync(
          "systemctl",
          ["--user", "start", `doodlescreed-worker@${wid}.service`],
          { stdio: "pipe" },
        );
      else {
        const child = spawn(process.execPath, [env.SERVER_ENTRY], {
          env: { ...process.env, ...env },
          stdio: ["ignore", "ignore", "pipe"],
        });
        child.stderr?.on("data", (d) => process.stderr.write(d));
        this.children.set(wid, child);
      }
      let ready = false;
      for (let i = 0; i < 80; i++) {
        try {
          const s = await this.refresh(w);
          if (s.tickCount > 1 && Number.isFinite(s.tickP99Ms)) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!ready) throw Error("Worker never became simulation-ready");
      this.db.db
        .prepare("UPDATE workers SET state='RUNNING' WHERE id=?")
        .run(wid);
      this.gateway.update(this.db.workers());
      this.db.db
        .prepare("UPDATE releases SET state=?,retired=NULL WHERE id=?")
        .run(this.db.current() === id ? "CURRENT" : "READY", id);
      this.db.db.prepare("DELETE FROM queue WHERE releaseId=?").run(id);
      this.db.event("prepared", { releaseId: id, workerId: wid });
      return { queued: false, worker: this.db.worker(wid) };
    } catch (e) {
      await this.stop(w);
      this.db.db
        .prepare("UPDATE workers SET state='FAILED' WHERE id=?")
        .run(wid);
      this.db.event("prepare-failed", { releaseId: id, error: String(e) });
      throw e;
    }
  }
  async stop(w: Worker) {
    if (this.supervisor === "systemd") {
      try {
        execFileSync(
          "systemctl",
          ["--user", "stop", `doodlescreed-worker@${w.id}.service`],
          { stdio: "pipe" },
        );
      } catch {}
    } else {
      this.children.get(w.id)?.kill("SIGTERM");
      this.children.delete(w.id);
    }
  }
  promote(id: string, expected: string | null, deploymentId: string) {
    return this.exclusive(() => this.promoteLocked(id, expected, deploymentId));
  }
  private async promoteLocked(
    id: string,
    expected: string | null,
    deploymentId: string,
  ) {
    const committed = this.db.db
      .prepare("SELECT * FROM deployments WHERE id=?")
      .get(deploymentId) as any;
    if (committed) return this.db.promote(id, expected, deploymentId);
    const w = this.db
      .workers()
      .find((w) => w.releaseId === id && w.state === "RUNNING");
    if (!w) throw Error("No ready worker for release");
    const validation = this.db.db
      .prepare("SELECT * FROM validations WHERE releaseId=?")
      .get(id) as any;
    if (
      !validation ||
      validation.workerId !== w.id ||
      validation.epoch !== w.epoch ||
      validation.verified < Date.now() - 1800000
    )
      throw Error("A fresh candidate canary is required before promotion");
    const s = await this.refresh(w);
    if (
      s.closing ||
      !Number.isFinite(s.tickP99Ms) ||
      s.tickP99Ms > 33.3 ||
      !(s.tickCount > 1)
    )
      throw Error("Worker readiness/performance gate failed");
    return this.db.promote(id, expected, deploymentId);
  }
  allocate(req: any, canaryWorker?: string): Promise<any> {
    return this.exclusive(() => this.allocateLocked(req, canaryWorker));
  }
  private async allocateLocked(req: any, canaryWorker?: string): Promise<any> {
    const requestId = String(req.requestId ?? "");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))
      throw Error("A unique requestId is required");
    const type = req.type;
    if (!["public", "duel", "create", "join"].includes(type))
      throw Error("Invalid match type");
    const input = {
      type,
      name: String(req.name ?? "Runner").slice(0, 16),
      seed: String(req.seed ?? "paper").slice(0, 40),
      code: String(req.code ?? "").toUpperCase(),
      canaryWorker,
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const saved = this.db.db
      .prepare("SELECT * FROM allocations WHERE id=?")
      .get(requestId) as any;
    if (saved) {
      if (saved.fingerprint !== fingerprint)
        throw Error("Request ID reused with different admission");
      if (saved.expires < Date.now())
        throw Error("Admission expired; retry with a new request");
      return JSON.parse(saved.response);
    }
    if (this.inflight.has(requestId)) {
      await this.inflight.get(requestId);
      return this.allocateLocked(req, canaryWorker);
    }
    const task = (async () => {
      const prior = this.db.db
        .prepare("SELECT * FROM reservation_inputs WHERE id=?")
        .get(requestId) as any;
      if (prior && prior.fingerprint !== fingerprint)
        throw Error("Request ID reused with different admission");
      let w: Worker | undefined;
      if (prior) {
        w = this.db.worker(prior.workerId);
        if (!w || w.epoch !== prior.epoch)
          throw Error("Reserved worker is no longer available");
      } else if (canaryWorker) w = this.db.worker(canaryWorker);
      else if (type === "join") {
        const r = this.db.db
          .prepare("SELECT * FROM rooms WHERE code=?")
          .get(input.code) as any;
        if (r) w = this.db.worker(r.workerId);
      } else
        w = this.db
          .workers()
          .find(
            (w) => w.releaseId === this.db.current() && w.state === "RUNNING",
          );
      if (!w || w.state !== "RUNNING")
        throw Error(
          type === "join"
            ? "That match has ended or does not exist"
            : "Matchmaking is temporarily unavailable",
        );
      await this.refresh(w);
      let code = prior?.code ?? "";
      if (!code) {
        do {
          code = randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
        } while (
          this.db.db.prepare("SELECT 1 FROM codes WHERE code=?").get(code)
        );
        this.db.db.transaction(() => {
          this.db.db.prepare("INSERT INTO codes VALUES(?)").run(code);
          this.db.db
            .prepare("INSERT INTO reservation_inputs VALUES(?,?,?,?,?)")
            .run(requestId, fingerprint, code, w!.id, w!.epoch);
        })();
      }
      const reservation = await this.workerCall(w, "reserve", {
        ...input,
        roomCode: code,
        reservationId: requestId,
      });
      await this.refresh(w);
      const result = {
        ...reservation,
        releaseId: w.releaseId,
        workerId: w.id,
        workerEpoch: w.epoch,
        clientUrl: `/releases/${w.releaseId}/`,
        wsUrl: `/ws/${w.id}`,
      };
      this.db.db
        .prepare("INSERT INTO allocations VALUES(?,?,?,?)")
        .run(
          requestId,
          fingerprint,
          JSON.stringify(result),
          reservation.expiresAt,
        );
      return result;
    })();
    this.inflight.set(requestId, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(requestId);
    }
  }
  retire(w: Worker) {
    return this.exclusive(() => this.retireLocked(w));
  }
  private async retireLocked(w: Worker) {
    if (w.releaseId === this.db.current())
      throw Error("Cannot retire current release");
    const result = await this.workerCall(w, "retire", {});
    if (!result.retired) return false;
    this.db.db
      .prepare("UPDATE workers SET state='RETIRED' WHERE id=?")
      .run(w.id);
    this.db.db.prepare("DELETE FROM rooms WHERE workerId=?").run(w.id);
    this.gateway.update(this.db.workers());
    await this.stop(w);
    this.db.db
      .prepare("UPDATE releases SET state='RETIRED',retired=? WHERE id=?")
      .run(Date.now(), w.releaseId);
    this.db.event("retired", { workerId: w.id, releaseId: w.releaseId });
    return true;
  }
  isGone(w: Worker) {
    if (this.supervisor === "systemd") {
      try {
        const state = execFileSync(
          "systemctl",
          [
            "--user",
            "show",
            `doodlescreed-worker@${w.id}.service`,
            "--property=ActiveState,MainPID",
          ],
          { encoding: "utf8" },
        );
        return (
          /^ActiveState=(inactive|failed)$/m.test(state) &&
          /^MainPID=0$/m.test(state)
        );
      } catch {
        return false;
      }
    }
    const pid = JSON.parse(w.status).pid;
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "ESRCH";
    }
  }
  async sweep() {
    if (this.maintenance) return;
    this.maintenance = true;
    try {
      for (const w of this.db.workers().filter((w) => w.state === "RUNNING")) {
        try {
          await this.refresh(w);
        } catch (e) {
          if (Date.now() - w.seen > 30000 && this.isGone(w)) {
            this.db.db
              .prepare("UPDATE workers SET state='LOST' WHERE id=?")
              .run(w.id);
            this.db.db.prepare("DELETE FROM rooms WHERE workerId=?").run(w.id);
            this.db.event("worker-lost", { id: w.id });
          }
          continue;
        }
        if (this.db.release(w.releaseId)?.state === "DRAINING")
          await this.retire(w).catch(() => {});
      }
      this.gateway.update(this.db.workers());
      const queued = this.db.db
        .prepare("SELECT releaseId FROM queue ORDER BY created LIMIT 1")
        .get() as any;
      if (
        queued &&
        new Set(
          this.db
            .workers()
            .filter((w) => w.state === "RUNNING")
            .map((w) => w.releaseId),
        ).size < 3
      )
        await this.prepare(queued.releaseId);
      this.db.db
        .prepare("DELETE FROM allocations WHERE expires<?")
        .run(Date.now() - 86400000);
    } finally {
      this.maintenance = false;
    }
  }
  async validate(id: string, workerId: string, report: unknown) {
    const w = this.db.worker(workerId);
    if (!w || w.releaseId !== id || w.state !== "RUNNING")
      throw Error("Invalid canary worker");
    await this.refresh(w);
    this.db.db
      .prepare(
        "INSERT INTO validations VALUES(?,?,?,?,?) ON CONFLICT(releaseId) DO UPDATE SET workerId=excluded.workerId,epoch=excluded.epoch,verified=excluded.verified,report=excluded.report",
      )
      .run(id, w.id, w.epoch, Date.now(), JSON.stringify(report));
    return { validated: true };
  }
  gc() {
    return this.exclusive(async () => this.gcLocked());
  }
  private gcLocked() {
    const retained = new Set(
      this.db
        .releases()
        .filter((r) => r.state !== "STAGED")
        .slice(0, 2)
        .map((r) => r.id),
    );
    // Preserve actual browser-validated rollback releases even when newer unvalidated candidates exist.
    for (const row of this.db.db
      .prepare(
        "SELECT releaseId FROM validations ORDER BY verified DESC LIMIT 2",
      )
      .all() as { releaseId: string }[])
      retained.add(row.releaseId);
    const removed: string[] = [];
    for (const r of this.db.releases()) {
      if (
        r.state !== "RETIRED" ||
        !r.retired ||
        r.retired > Date.now() - 7 * 86400000 ||
        retained.has(r.id)
      )
        continue;
      if (
        this.db
          .workers()
          .some(
            (w) =>
              w.releaseId === r.id && ["RUNNING", "STARTING"].includes(w.state),
          )
      )
        continue;
      if (this.db.db.prepare("SELECT 1 FROM rooms WHERE releaseId=?").get(r.id))
        continue;
      const target = path.join(this.releaseRoot, r.id);
      const unseal = (dir: string) => {
        if (!existsSync(dir)) return;
        chmodSync(dir, 0o755);
        for (const e of readdirSync(dir, { withFileTypes: true }))
          if (e.isDirectory()) unseal(path.join(dir, e.name));
      };
      unseal(target);
      rmSync(target, { recursive: true, force: true });
      this.db.db
        .prepare("UPDATE releases SET state='COLLECTED' WHERE id=?")
        .run(r.id);
      removed.push(r.id);
    }
    return removed;
  }
}
