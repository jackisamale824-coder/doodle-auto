import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Directory, type Worker } from "../server/control/directory.ts";
import { ReleaseManager } from "../server/control/releases.ts";
import type { Gateway } from "../server/control/gateway.ts";
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "dc-control-failures-"));
  const file = path.join(root, "directory.sqlite");
  const db = new Directory(file);
  const gateway = { update() {} } as unknown as Gateway;
  const manager = new ReleaseManager(
    db,
    gateway,
    root,
    path.join(root, "releases"),
    "test",
    "process",
  );
  const release = (id: string, state = "READY", created = Date.now()) => {
    db.stage(id, { releaseId: id });
    db.db
      .prepare("UPDATE releases SET state=?,created=? WHERE id=?")
      .run(state, created, id);
    mkdirSync(path.join(root, "releases", id), { recursive: true });
    writeFileSync(
      path.join(root, "releases", id, "manifest.json"),
      JSON.stringify({ releaseId: id }),
    );
  };
  const worker = (id: string, releaseId: string, state = "RUNNING") => {
    db.db
      .prepare(
        "INSERT INTO workers(id,releaseId,epoch,port,state) VALUES(?,?,?,?,?)",
      )
      .run(id, releaseId, "epoch-" + id, 20000 + db.workers().length, state);
    return db.worker(id)!;
  };
  const cleanup = () => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { root, file, db, gateway, manager, release, worker, cleanup };
}
const status = (w: Worker) => ({
  releaseId: w.releaseId,
  workerId: w.id,
  workerEpoch: w.epoch,
  closing: false,
  active: 0,
  resumable: 0,
  pending: 0,
  rooms: [],
  tickCount: 10,
  tickP99Ms: 1,
  rss: 100,
});
test("fourth generation queues without starting or stopping occupied workers", async () => {
  const f = fixture();
  try {
    for (let i = 1; i <= 3; i++) {
      const id = String(i).repeat(16);
      f.release(id);
      f.worker("w" + i, id);
    }
    const id = "4".repeat(16);
    f.release(id, "STAGED");
    let calls = 0;
    f.manager.workerCall = async () => {
      calls++;
      throw Error("should not contact retained workers");
    };
    const result = await f.manager.prepare(id);
    assert.equal(result.queued, true);
    assert.equal(f.db.workers().length, 3);
    assert.equal(calls, 0);
    assert.equal(
      (
        f.db.db.prepare("SELECT count(*) AS n FROM queue").get() as {
          n: number;
        }
      ).n,
      1,
    );
  } finally {
    f.cleanup();
  }
});
test("garbage collection preserves occupied, recent, room-pinned and two newest validated releases", async () => {
  const f = fixture();
  try {
    const old = Date.now() - 9 * 86400000;
    for (let i = 1; i <= 7; i++) {
      const id = String(i).repeat(16);
      f.release(id, "RETIRED", i);
      f.db.db.prepare("UPDATE releases SET retired=? WHERE id=?").run(old, id);
    }
    const active = "1".repeat(16);
    f.worker("active", active);
    const recent = "2".repeat(16);
    f.db.db
      .prepare("UPDATE releases SET retired=? WHERE id=?")
      .run(Date.now(), recent);
    const pinned = "3".repeat(16);
    const w = f.worker("pinned", pinned, "RETIRED");
    f.db.syncRooms(w, {
      ...status(w),
      rooms: [{ roomId: "room", code: "ABCDE" }],
    });
    const removed = await f.manager.gc();
    assert.deepEqual(removed.sort(), ["4".repeat(16), "5".repeat(16)]);
    for (const id of [active, recent, pinned, "6".repeat(16), "7".repeat(16)])
      assert.ok(existsSync(path.join(f.root, "releases", id)));
  } finally {
    f.cleanup();
  }
});
test("failed performance or closing readiness never changes current release", async () => {
  const f = fixture();
  try {
    f.release("a".repeat(16));
    f.release("b".repeat(16));
    f.worker("a", "a".repeat(16));
    const b = f.worker("b", "b".repeat(16));
    f.db.promote("a".repeat(16), null, "initial");
    f.db.db
      .prepare("INSERT INTO validations VALUES(?,?,?,?,?)")
      .run(b.releaseId, b.id, b.epoch, Date.now(), "{}");
    for (const bad of [
      { closing: true },
      { tickP99Ms: 34 },
      { tickP99Ms: Number.NaN },
      { tickP99Ms: undefined },
      { tickCount: 0 },
    ]) {
      f.manager.workerCall = async () => ({ ...status(b), ...bad });
      await assert.rejects(
        f.manager.promote(
          b.releaseId,
          "a".repeat(16),
          "bad-" + JSON.stringify(bad),
        ),
        /readiness/,
      );
      assert.equal(f.db.current(), "a".repeat(16));
    }
  } finally {
    f.cleanup();
  }
});
test("control restart retains identities and refuses a changed worker epoch before allocation", async () => {
  const f = fixture();
  let reopened: Directory | undefined;
  try {
    f.release("a".repeat(16));
    const w = f.worker("a", "a".repeat(16));
    f.db.promote(w.releaseId, null, "initial");
    f.db.syncRooms(w, {
      ...status(w),
      rooms: [{ roomId: "live-room", code: "ABCDE" }],
    });
    reopened = new Directory(f.file);
    const manager = new ReleaseManager(
      reopened,
      f.gateway,
      f.root,
      path.join(f.root, "releases"),
      "test",
      "process",
    );
    assert.equal(reopened.current(), w.releaseId);
    assert.equal(reopened.worker(w.id)?.epoch, w.epoch);
    const calls: string[] = [];
    manager.workerCall = async (_w, action) => {
      calls.push(action);
      return { ...status(w), workerEpoch: "replacement-process" };
    };
    await assert.rejects(
      manager.allocate({
        type: "join",
        code: "ABCDE",
        name: "Runner",
        requestId: "restart-epoch-test",
      }),
      /epoch mismatch/,
    );
    assert.deepEqual(calls, ["status"]);
  } finally {
    reopened?.close();
    f.cleanup();
  }
});
test("retired workers cannot receive explicit canary admissions", async () => {
  const f = fixture();
  try {
    f.release("a".repeat(16), "RETIRED");
    const w = f.worker("old", "a".repeat(16), "RETIRED");
    let calls = 0;
    f.manager.workerCall = async () => {
      calls++;
      throw Error("not reached");
    };
    await assert.rejects(
      f.manager.allocate(
        { type: "create", name: "Runner", requestId: "retired-worker-test" },
        w.id,
      ),
      /unavailable/,
    );
    assert.equal(calls, 0);
  } finally {
    f.cleanup();
  }
});

test("new unvalidated candidates cannot displace the two validated rollback artifacts", async () => {
  const f = fixture();
  try {
    for (let i = 1; i <= 4; i++)
      f.release(String(i).repeat(16), i < 3 ? "RETIRED" : "READY", i);
    f.db.db
      .prepare("UPDATE releases SET retired=? WHERE state='RETIRED'")
      .run(Date.now() - 8 * 86400000);
    for (let i = 1; i <= 2; i++)
      f.db.db
        .prepare("INSERT INTO validations VALUES(?,?,?,?,?)")
        .run(String(i).repeat(16), "worker-" + i, "epoch", i, "{}");
    assert.deepEqual(await f.manager.gc(), []);
    assert.ok(existsSync(path.join(f.root, "releases", "1".repeat(16))));
    assert.ok(existsSync(path.join(f.root, "releases", "2".repeat(16))));
  } finally {
    f.cleanup();
  }
});
