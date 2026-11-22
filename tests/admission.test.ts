import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
import { Admissions } from "../server/admission.ts";
test("tickets expire and are consumed exactly once", () => {
  const a = new Admissions();
  const t = a.issue("room", "ABCDE", "Runner");
  assert.equal(a.consume(t.joinTicket), t);
  assert.equal(a.consume(t.joinTicket), undefined);
  const expired = a.issue("room", "ABCDE", "Runner");
  expired.expiresAt = Date.now() - 1;
  assert.equal(a.consume(expired.joinTicket), undefined);
});
test("reserved capacity prevents retirement and allocation is idempotent", () => {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Rooms(wss, undefined, {
    releaseId: "A",
    workerId: "a",
    workerEpoch: "epoch",
  });
  try {
    const request = {
      type: "duel" as const,
      name: "Runner",
      roomCode: "ABCDE",
      reservationId: "one",
    };
    const first = rooms.reserve(request);
    assert.deepEqual(rooms.reserve(request), first);
    for (let i = 0; i < 7; i++)
      rooms.reserve({ type: "join", name: "Other", roomId: first.roomId });
    assert.throws(
      () => rooms.reserve({ type: "join", name: "Full", roomId: first.roomId }),
      /full/,
    );
    assert.equal(rooms.status().pending, 8);
    assert.equal(rooms.status().admissionRejections, 1);
    assert.equal(rooms.beginRetirement(), false);
  } finally {
    rooms.dispose();
    wss.close();
  }
  const empty = new Rooms(wss, undefined, {
    releaseId: "B",
    workerId: "b",
    workerEpoch: "epoch2",
  });
  try {
    assert.equal(empty.beginRetirement(), true);
    assert.throws(() =>
      empty.reserve({ type: "duel", name: "Late", roomCode: "FGHIJ" }),
    );
  } finally {
    empty.dispose();
  }
});
