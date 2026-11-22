import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
export interface Release {
  id: string;
  state: string;
  created: number;
  manifest: string;
  retired: number | null;
}
export interface Worker {
  id: string;
  releaseId: string;
  epoch: string;
  port: number;
  state: string;
  status: string;
  seen: number;
}
export class Directory {
  db: Database.Database;
  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,state TEXT NOT NULL,created INTEGER NOT NULL,manifest TEXT NOT NULL,retired INTEGER);
CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY,releaseId TEXT NOT NULL,epoch TEXT NOT NULL,port INTEGER UNIQUE NOT NULL,state TEXT NOT NULL,status TEXT NOT NULL DEFAULT '{}',seen INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,workerId TEXT NOT NULL,releaseId TEXT NOT NULL,epoch TEXT NOT NULL,metadata TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS reservation_inputs(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,code TEXT NOT NULL,workerId TEXT NOT NULL,epoch TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS allocations(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,releaseId TEXT NOT NULL,previous TEXT,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS validations(releaseId TEXT PRIMARY KEY,workerId TEXT NOT NULL,epoch TEXT NOT NULL,verified INTEGER NOT NULL,report TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS queue(releaseId TEXT PRIMARY KEY,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL);`);
  }
  current(): string | null {
    return (
      (
        this.db
          .prepare("SELECT value FROM settings WHERE key='current'")
          .get() as any
      )?.value ?? null
    );
  }
  release(id: string) {
    return this.db.prepare("SELECT * FROM releases WHERE id=?").get(id) as
      Release | undefined;
  }
  releases() {
    return this.db
      .prepare("SELECT * FROM releases ORDER BY created DESC")
      .all() as Release[];
  }
  workers() {
    return this.db.prepare("SELECT * FROM workers").all() as Worker[];
  }
  worker(id: string) {
    return this.db.prepare("SELECT * FROM workers WHERE id=?").get(id) as
      Worker | undefined;
  }
  stage(id: string, manifest: unknown) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO releases(id,state,created,manifest) VALUES(?,'STAGED',?,?)",
      )
      .run(id, Date.now(), JSON.stringify(manifest));
  }
  event(kind: string, detail: unknown) {
    this.db
      .prepare("INSERT INTO events(time,kind,detail) VALUES(?,?,?)")
      .run(Date.now(), kind, JSON.stringify(detail));
  }
  promote(id: string, expected: string | null, deploymentId: string) {
    return this.db.transaction(() => {
      const done = this.db
        .prepare("SELECT * FROM deployments WHERE id=?")
        .get(deploymentId) as any;
      if (done) {
        if (done.releaseId !== id)
          throw Error("Deployment ID already belongs to another release");
        return { current: id, previous: done.previous, idempotent: true };
      }
      if (this.current() !== expected)
        throw Error("Current release changed; promotion aborted");
      if (
        !["READY", "DRAINING", "CURRENT"].includes(
          this.release(id)?.state ?? "",
        )
      )
        throw Error("Release is not ready");
      if (expected && expected !== id)
        this.db
          .prepare("UPDATE releases SET state='DRAINING' WHERE id=?")
          .run(expected);
      this.db
        .prepare("UPDATE releases SET state='CURRENT',retired=NULL WHERE id=?")
        .run(id);
      this.db
        .prepare(
          "INSERT INTO settings VALUES('current',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(id);
      this.db
        .prepare("INSERT INTO deployments VALUES(?,?,?,?)")
        .run(deploymentId, id, expected, Date.now());
      this.event("promoted", { id, previous: expected, deploymentId });
      return { current: id, previous: expected, idempotent: false };
    })();
  }
  syncRooms(w: Worker, status: any) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM rooms WHERE workerId=?").run(w.id);
      for (const r of status.rooms ?? [])
        this.db
          .prepare("INSERT INTO rooms VALUES(?,?,?,?,?,?)")
          .run(r.roomId, r.code, w.id, w.releaseId, w.epoch, JSON.stringify(r));
      this.db
        .prepare("UPDATE workers SET status=?,seen=? WHERE id=?")
        .run(JSON.stringify(status), Date.now(), w.id);
    })();
  }
  close() {
    this.db.close();
  }
}
