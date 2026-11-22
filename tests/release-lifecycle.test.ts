import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Directory } from "../server/control/directory.ts";
import { ReleaseManager } from "../server/control/releases.ts";
import { Gateway } from "../server/control/gateway.ts";
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "dc-control-"));
  const db = new Directory(path.join(root, "state.sqlite"));
  const gateway = { update() {} } as unknown as Gateway;
  const manager = new ReleaseManager(
    db,
    gateway,
    root,
    root,
    "test",
    "process",
  );
  return {
    root,
    db,
    manager,
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function ready(db: Directory, id: string) {
  db.stage(id, { releaseId: id });
  db.db.prepare("UPDATE releases SET state='READY' WHERE id=?").run(id);
}
test("promotion is atomic, compare-and-swap, durable and idempotent; rollback leaves rooms pinned", () => {
  const f = fixture();
  try {
    const { db } = f;
    ready(db, "a");
    ready(db, "b");
    db.promote("a", null, "deploy-a");
    db.db
      .prepare(
        "INSERT INTO rooms VALUES('room','ABCDE','worker-a','a','epoch-a','{}')",
      )
      .run();
    db.promote("b", "a", "deploy-b");
    assert.equal(db.current(), "b");
    assert.equal(db.release("a")?.state, "DRAINING");
    assert.equal(db.promote("b", "a", "deploy-b").idempotent, true);
    assert.throws(() => db.promote("a", "a", "race"));
    assert.equal(db.current(), "b");
    db.promote("a", "b", "rollback");
    assert.equal(
      (
        db.db
          .prepare("SELECT releaseId FROM rooms WHERE id='room'")
          .get() as any
      ).releaseId,
      "a",
    );
    const other = new Directory(path.join(f.root, "state.sqlite"));
    assert.equal(other.current(), "a");
    other.close();
  } finally {
    f.close();
  }
});
test("allocation retry reuses reserved input after a lost response and rejects request mutation", async () => {
  const f = fixture();
  try {
    const { db, manager } = f;
    ready(db, "a");
    db.promote("a", null, "first");
    db.db
      .prepare(
        "INSERT INTO workers VALUES('wa','a','ea',4211,'RUNNING','{}',?)",
      )
      .run(Date.now());
    let calls = 0;
    const codes: string[] = [];
    manager.refresh = async () => ({});
    manager.workerCall = async (_w, action, body: any) => {
      assert.equal(action, "reserve");
      codes.push(body.roomCode);
      if (++calls === 1) throw Error("lost transport");
      return {
        code: body.roomCode,
        roomId: "r",
        joinTicket: "secret",
        expiresAt: Date.now() + 30000,
      };
    };
    const req = { requestId: "1234567890123456", type: "public", name: "A" };
    await assert.rejects(manager.allocate(req));
    const result = await manager.allocate(req);
    assert.equal(codes[0], codes[1]);
    assert.equal(result.code.length, 5);
    assert.deepEqual(await manager.allocate(req), result);
    await assert.rejects(manager.allocate({ ...req, name: "B" }));
  } finally {
    f.close();
  }
});
test("lifecycle serialization prevents retirement racing promotion", async () => {
  const f = fixture();
  try {
    const { db, manager } = f;
    ready(db, "a");
    ready(db, "b");
    db.promote("b", null, "first");
    db.db
      .prepare(
        "INSERT INTO workers VALUES('wa','a','ea',4211,'RUNNING','{}',?)",
      )
      .run(Date.now());
    db.db
      .prepare("INSERT INTO validations VALUES(?,?,?,?,?)")
      .run("a", "wa", "ea", Date.now(), "{}");
    let unblock!: () => void;
    const gate = new Promise<void>((r) => (unblock = r));
    manager.refresh = async () => {
      await gate;
      return { closing: false, tickP99Ms: 1, tickCount: 10 };
    };
    let retired = false;
    manager.workerCall = async () => {
      retired = true;
      return { retired: true };
    };
    const promotion = manager.promote("a", "b", "next");
    const retirement = manager.retire(db.worker("wa")!);
    unblock();
    await promotion;
    await assert.rejects(retirement, /current/);
    assert.equal(retired, false);
  } finally {
    f.close();
  }
});
